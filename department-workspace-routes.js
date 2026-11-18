'use strict';
const { randomUUID } = require('node:crypto');
const { createIpRateLimiter } = require('./request-limiter');

// Every query derives school and department exclusively from the server session.
// Verified gate movements are NEVER official DTR or absence determinations.
function registerDepartmentWorkspaceRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles }) {
  const authorize = [authenticateSchoolClient, requireSchoolRoles('DEPARTMENT_HEAD')];
  const hasDepartment = (req, res, next) => {
    if (!req.auth?.departmentId || !req.auth.schoolId || !req.auth.userId)
      return res.status(403).json({ error: 'An assigned department is required.' });
    next();
  };
  const access = [...authorize, hasDepartment];
  const limitAnnouncements = createIpRateLimiter({
    windowMs: 10 * 60 * 1000, maxRequests: 10,
    message: 'Too many department announcements. Please try later.'
  });

  app.get('/api/department-head/overview', ...access, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, private');
    const args = [req.auth.schoolId, req.auth.departmentId];
    try {
      const [staff, arrivals, pending, uncovered] = await Promise.all([
        pool.query(
          `SELECT u.user_id AS "userId", u.display_name AS "displayName",
             u.active, u.teacher_status AS "teacherStatus",
             (SELECT count(DISTINCT a.period_id)::int
                FROM teacher_period_assignments a
                JOIN class_periods p ON p.school_id=a.school_id
                  AND p.period_id=a.period_id AND p.active=TRUE
                WHERE a.school_id=u.school_id AND a.teacher_user_id=u.user_id)
               AS "assignedPeriods",
             (SELECT count(*)::int FROM teacher_period_substitutions ts
                WHERE ts.school_id=u.school_id AND ts.substitute_teacher_user_id=u.user_id
                  AND ts.status='ACTIVE'
                  AND ts.start_date <= (NOW() AT TIME ZONE 'Asia/Manila')::date
                  AND ts.end_date >= (NOW() AT TIME ZONE 'Asia/Manila')::date)
               AS "activeSubstitutions"
           FROM school_users u
           WHERE u.school_id=$1 AND u.department_id=$2 AND u.role='TEACHER'
           ORDER BY u.display_name, u.user_id LIMIT 200`,
          args),
        pool.query(
          `SELECT count(DISTINCT e.staff_user_id)::int AS "verifiedGateArrivals"
           FROM staff_attendance_events e
           JOIN school_users u ON u.school_id=e.school_id AND u.user_id=e.staff_user_id
           WHERE e.school_id=$1 AND u.department_id=$2 AND u.role='TEACHER'
             AND e.school_date=(NOW() AT TIME ZONE 'Asia/Manila')::date
             AND e.event_kind='GATE_MOVEMENT' AND e.gate_direction='IN'
             AND e.verification_status='VERIFIED'`,
          args),
        pool.query(
          `SELECT count(*)::int AS count FROM staff_official_business_requests
           WHERE school_id=$1 AND department_id=$2 AND status='PENDING_HEAD'`,
          args),
        pool.query(
          `SELECT count(*)::int AS count
           FROM staff_ob_class_coverage c
           JOIN staff_official_business_requests o ON o.school_id=c.school_id
             AND o.request_id=c.request_id
           WHERE c.school_id=$1 AND o.department_id=$2
             AND o.status='APPROVED' AND c.status='NEEDS_COVERAGE'
             AND c.class_date >= (NOW() AT TIME ZONE 'Asia/Manila')::date`,
          args)
      ]);
      const teachers = staff.rows;
      res.json({
        teachers,
        summary: {
          teacherCount: teachers.length,
          activeTeachers: teachers.filter(t => t.active && t.teacherStatus !== 'ON_LEAVE').length,
          verifiedGateArrivals: arrivals.rows[0]?.verifiedGateArrivals || 0,
          pendingObRecommendations: pending.rows[0]?.count || 0,
          uncoveredClasses: uncovered.rows[0]?.count || 0
        },
        attendanceNote: 'Verified gate arrivals are not official attendance, absence, or DTR determinations.'
      });
    } catch (error) {
      console.error('Department overview:', error.message);
      res.status(503).json({ error: 'Department monitoring is temporarily unavailable.' });
    }
  });

  app.get('/api/department-head/announcements', ...access, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, private');
    try {
      const result = await pool.query(
        `SELECT notification_id AS "notificationId", title, body,
           created_at AS "createdAt"
         FROM user_notifications
         WHERE school_id=$1 AND recipient_kind='SCHOOL_USER' AND recipient_id=$2
           AND category='SYSTEM' AND event_key LIKE ('DEPT_NOTICE:' || $3::text || ':%')
         ORDER BY created_at DESC LIMIT 20`,
        [req.auth.schoolId, req.auth.userId, req.auth.departmentId]
      );
      res.json({ announcements: result.rows });
    } catch (error) {
      console.error('Department announcements list:', error.message);
      res.status(503).json({ error: 'Unable to load department announcements.' });
    }
  });

  app.post('/api/department-head/announcements', ...access, limitAnnouncements, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, private');
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host)
          return res.status(403).json({ error: 'Cross-origin requests are not permitted.' });
      } catch {
        return res.status(403).json({ error: 'Invalid request origin.' });
      }
    }
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] || '')))
      return res.status(415).json({ error: 'Submit department notices as JSON.' });
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (title.length < 3 || title.length > 120 || body.length < 3 || body.length > 1200)
      return res.status(400).json({ error: 'Provide a title (3–120 characters) and message (3–1200 characters).' });
    const key = 'DEPT_NOTICE:' + req.auth.departmentId + ':' + randomUUID();
    try {
      const result = await pool.query(
        `INSERT INTO user_notifications
           (school_id,recipient_kind,recipient_id,event_key,category,title,body,action_url)
         SELECT $1,'SCHOOL_USER',u.user_id,$3,'SYSTEM',$4,$5,'/portal.html#dashboard'
         FROM school_users u
         WHERE u.school_id=$1 AND u.department_id=$2 AND u.active=TRUE
           AND u.role IN ('TEACHER','DEPARTMENT_HEAD')`,
        [req.auth.schoolId, req.auth.departmentId, key, title, body]
      );
      res.status(201).json({ created: true, recipients: result.rowCount });
    } catch (error) {
      console.error('Department announcement:', error.message);
      res.status(503).json({ error: 'The announcement could not be sent.' });
    }
  });
}

module.exports = { registerDepartmentWorkspaceRoutes };
