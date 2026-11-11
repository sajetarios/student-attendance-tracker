'use strict';

const { hashPassword } = require('./auth-security');

const validText = (value, max = 160) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function registerParentRoutes(app, pool, auth) {
  const { authenticateSchoolClient, requireSchoolRoles } = auth;
  const requireAdmin = requireSchoolRoles('SCHOOL_ADMIN');
  const requireParent = requireSchoolRoles('PARENT');
  const registrationAttempts = new Map();

  async function audit(client, schoolId, actorType, actorUserId, action, entityType, entityId, details = {}) {
    await client.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [schoolId, actorType, actorUserId || null, action, entityType, String(entityId), JSON.stringify(details)]
    );
  }

  // Public self-registration. New accounts remain inactive until a school administrator approves them.
  app.post('/api/parents/register', async (req, res) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const prior = registrationAttempts.get(ip) || { count: 0, resetAt: now + 60 * 60 * 1000 };
    if (prior.resetAt <= now) { prior.count = 0; prior.resetAt = now + 60 * 60 * 1000; }
    if (prior.count >= 5) return res.status(429).json({ error: 'Too many registration attempts. Please try again later.' });
    prior.count += 1; registrationAttempts.set(ip, prior);

    const { schoolCode, username, displayName, mobile, password, studentId, relationship } = req.body || {};
    if (![schoolCode, username, displayName, mobile, studentId, relationship].every(v => validText(v, 160)) ||
        typeof password !== 'string' || password.length < 12 || password.length > 256) {
      return res.status(400).json({ error: 'Complete all fields. Passwords must be 12–256 characters.' });
    }
    let passwordHash;
    try { passwordHash = await hashPassword(password); }
    catch (err) { return res.status(400).json({ error: err.message || 'Invalid password.' }); }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const school = await client.query(
        `SELECT school_id, school_name FROM schools WHERE lower(school_code)=lower($1) AND active=TRUE`,
        [schoolCode.trim()]
      );
      if (!school.rowCount) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'School code was not found.' }); }
      const schoolId = school.rows[0].school_id;
      const student = await client.query(
        `SELECT student_id FROM students WHERE school_id=$1 AND student_id=$2 AND active=TRUE`,
        [schoolId, studentId.trim()]
      );
      if (!student.rowCount) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Student ID was not found in this school. Please check it with the school office.' }); }
      const created = await client.query(
        `INSERT INTO school_users(school_id, username, display_name, password_hash, role, active, mobile)
         VALUES($1,$2,$3,$4,'PARENT',FALSE,$5)
         RETURNING user_id`,
        [schoolId, username.trim(), displayName.trim(), passwordHash, mobile.trim()]
      );
      const parentId = created.rows[0].user_id;
      await client.query(
        `INSERT INTO parent_student_links(school_id,parent_user_id,student_id,relationship,status)
         VALUES($1,$2,$3,$4,'PENDING')`,
        [schoolId, parentId, student.rows[0].student_id, relationship.trim()]
      );
      await audit(client, schoolId, 'SYSTEM', null, 'PARENT_SELF_REGISTER', 'school_user', parentId, { username: username.trim(), studentId: studentId.trim() });
      await client.query('COMMIT');
      return res.status(201).json({ ok: true, message: 'Registration submitted. Your school must approve your account before you can sign in.' });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505') return res.status(409).json({ error: 'That username is already registered in this school.' });
      console.error('Parent self-registration failed:', err.message);
      return res.status(500).json({ error: 'Registration could not be completed.' });
    } finally { client.release(); }
  });

  app.get('/api/parents', authenticateSchoolClient, requireAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT su.user_id AS "userId", su.username, su.display_name AS "displayName", su.mobile,
                su.active, su.created_at AS "createdAt", su.last_login_at AS "lastLoginAt",
                COALESCE(json_agg(json_build_object(
                  'studentId', s.student_id, 'fullName', s.full_name,
                  'gradeLevel', s.grade_level, 'section', s.section,
                  'relationship', l.relationship, 'status', l.status
                ) ORDER BY s.full_name) FILTER (WHERE l.link_id IS NOT NULL), '[]'::json) AS children
         FROM school_users su
         LEFT JOIN parent_student_links l ON l.school_id=su.school_id AND l.parent_user_id=su.user_id
         LEFT JOIN students s ON s.school_id=l.school_id AND s.student_id=l.student_id
         WHERE su.school_id=$1 AND su.role='PARENT'
         GROUP BY su.user_id ORDER BY su.active DESC, su.display_name`,
        [req.auth.schoolId]
      );
      return res.json({ parents: result.rows });
    } catch (err) { console.error('Parent list failed:', err.message); return res.status(500).json({ error: 'Could not load parent accounts.' }); }
  });

  app.get('/api/parents/registrations', authenticateSchoolClient, requireAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT su.user_id AS "userId", su.username, su.display_name AS "displayName", su.mobile,
                su.created_at AS "createdAt", l.link_id AS "linkId", l.student_id AS "studentId",
                s.full_name AS "studentName", s.grade_level AS "gradeLevel", s.section, l.relationship
         FROM school_users su
         JOIN parent_student_links l ON l.school_id=su.school_id AND l.parent_user_id=su.user_id AND l.status='PENDING'
         JOIN students s ON s.school_id=l.school_id AND s.student_id=l.student_id
         WHERE su.school_id=$1 AND su.role='PARENT' AND su.active=FALSE
         ORDER BY su.created_at`, [req.auth.schoolId]
      );
      return res.json({ registrations: result.rows });
    } catch (err) { console.error('Parent registration list failed:', err.message); return res.status(500).json({ error: 'Could not load pending registrations.' }); }
  });

  app.post('/api/parents', authenticateSchoolClient, requireAdmin, async (req, res) => {
    const { username, displayName, mobile, password, studentId, relationship } = req.body || {};
    if (![username, displayName, mobile, studentId, relationship].every(v => validText(v, 160)) || typeof password !== 'string' || password.length < 12 || password.length > 256) {
      return res.status(400).json({ error: 'Provide username, parent name, mobile, student ID, relationship, and a password of at least 12 characters.' });
    }
    let passwordHash;
    try { passwordHash = await hashPassword(password); } catch (err) { return res.status(400).json({ error: err.message }); }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const student = await client.query(`SELECT student_id FROM students WHERE school_id=$1 AND student_id=$2`, [req.auth.schoolId, studentId.trim()]);
      if (!student.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Student not found in this school.' }); }
      const created = await client.query(
        `INSERT INTO school_users(school_id,username,display_name,password_hash,role,active,mobile)
         VALUES($1,$2,$3,$4,'PARENT',TRUE,$5) RETURNING user_id AS "userId", username, display_name AS "displayName", mobile, active`,
        [req.auth.schoolId, username.trim(), displayName.trim(), passwordHash, mobile.trim()]
      );
      const parent = created.rows[0];
      await client.query(
        `INSERT INTO parent_student_links(school_id,parent_user_id,student_id,relationship,status,approved_by,approved_at)
         VALUES($1,$2,$3,$4,'APPROVED',$5,NOW())`,
        [req.auth.schoolId, parent.userId, student.rows[0].student_id, relationship.trim(), req.auth.userId]
      );
      await audit(client, req.auth.schoolId, 'SCHOOL', req.auth.userId, 'SCHOOL_ADMIN_CREATE_PARENT', 'school_user', parent.userId, { studentId: studentId.trim() });
      await client.query('COMMIT');
      return res.status(201).json({ parent });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505') return res.status(409).json({ error: 'That username is already used in this school.' });
      console.error('Parent creation failed:', err.message); return res.status(500).json({ error: 'Could not create parent account.' });
    } finally { client.release(); }
  });

  app.post('/api/parents/:userId/approve', authenticateSchoolClient, requireAdmin, async (req, res) => {
    if (!isUuid(req.params.userId)) return res.status(400).json({ error: 'Invalid parent account ID.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const parent = await client.query(`UPDATE school_users SET active=TRUE,updated_at=NOW() WHERE school_id=$1 AND user_id=$2 AND role='PARENT' AND active=FALSE RETURNING user_id`, [req.auth.schoolId, req.params.userId]);
      if (!parent.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Pending parent account not found.' }); }
      const links = await client.query(`UPDATE parent_student_links SET status='APPROVED',approved_by=$3,approved_at=NOW(),updated_at=NOW() WHERE school_id=$1 AND parent_user_id=$2 AND status='PENDING' RETURNING link_id`, [req.auth.schoolId, req.params.userId, req.auth.userId]);
      if (!links.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'No pending student relationship was found for this parent.' }); }
      await audit(client, req.auth.schoolId, 'SCHOOL', req.auth.userId, 'SCHOOL_ADMIN_APPROVE_PARENT', 'school_user', req.params.userId, { approvedLinks: links.rowCount });
      await client.query('COMMIT'); return res.json({ ok: true });
    } catch (err) { await client.query('ROLLBACK'); console.error('Parent approval failed:', err.message); return res.status(500).json({ error: 'Could not approve parent.' }); }
    finally { client.release(); }
  });

  app.post('/api/parents/:userId/reject', authenticateSchoolClient, requireAdmin, async (req, res) => {
    if (!isUuid(req.params.userId)) return res.status(400).json({ error: 'Invalid parent account ID.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const changed = await client.query(`UPDATE parent_student_links SET status='REJECTED',updated_at=NOW() WHERE school_id=$1 AND parent_user_id=$2 AND status='PENDING' RETURNING link_id`, [req.auth.schoolId, req.params.userId]);
      if (!changed.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Pending registration not found.' }); }
      await client.query(`UPDATE school_users SET active=FALSE,session_version=session_version+1,updated_at=NOW() WHERE school_id=$1 AND user_id=$2 AND role='PARENT'`, [req.auth.schoolId, req.params.userId]);
      await client.query(`UPDATE user_sessions SET revoked_at=NOW() WHERE principal_type='SCHOOL' AND school_id=$1 AND school_user_id=$2 AND revoked_at IS NULL`, [req.auth.schoolId, req.params.userId]);
      await audit(client, req.auth.schoolId, 'SCHOOL', req.auth.userId, 'SCHOOL_ADMIN_REJECT_PARENT', 'school_user', req.params.userId);
      await client.query('COMMIT'); return res.json({ ok: true });
    } catch (err) { await client.query('ROLLBACK'); console.error('Parent rejection failed:', err.message); return res.status(500).json({ error: 'Could not reject registration.' }); }
    finally { client.release(); }
  });

  app.post('/api/parents/:userId/links', authenticateSchoolClient, requireAdmin, async (req, res) => {
    const { studentId, relationship } = req.body || {};
    if (!isUuid(req.params.userId) || !validText(studentId, 100) || !validText(relationship, 100)) return res.status(400).json({ error: 'Provide a valid parent, student ID, and relationship.' });
    try {
      const result = await pool.query(
        `INSERT INTO parent_student_links(school_id,parent_user_id,student_id,relationship,status,approved_by,approved_at)
         SELECT $1,su.user_id,s.student_id,$4,'APPROVED',$5,NOW()
         FROM school_users su JOIN students s ON s.school_id=su.school_id
         WHERE su.school_id=$1 AND su.user_id=$2 AND su.role='PARENT' AND su.active=TRUE AND s.student_id=$3
         ON CONFLICT(school_id,parent_user_id,student_id) DO UPDATE SET relationship=EXCLUDED.relationship,status='APPROVED',approved_by=EXCLUDED.approved_by,approved_at=NOW(),updated_at=NOW()
         RETURNING link_id`, [req.auth.schoolId, req.params.userId, studentId.trim(), relationship.trim(), req.auth.userId]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'Active parent or student not found in this school.' });
      await pool.query(`INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details) VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_LINK_PARENT_STUDENT','parent_student_link',$3,$4::jsonb)`, [req.auth.schoolId, req.auth.userId, result.rows[0].link_id, JSON.stringify({ parentUserId: req.params.userId, studentId })]);
      return res.status(201).json({ ok: true });
    } catch (err) { console.error('Parent link failed:', err.message); return res.status(500).json({ error: 'Could not link student.' }); }
  });

  app.delete('/api/parents/:userId/links/:studentId', authenticateSchoolClient, requireAdmin, async (req, res) => {
    if (!isUuid(req.params.userId)) return res.status(400).json({ error: 'Invalid parent account ID.' });
    try {
      const result = await pool.query(`UPDATE parent_student_links SET status='REVOKED',updated_at=NOW() WHERE school_id=$1 AND parent_user_id=$2 AND student_id=$3 AND status='APPROVED' RETURNING link_id`, [req.auth.schoolId, req.params.userId, req.params.studentId]);
      if (!result.rowCount) return res.status(404).json({ error: 'Approved parent-child link not found.' });
      await pool.query(`INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details) VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_REVOKE_PARENT_LINK','parent_student_link',$3,$4::jsonb)`, [req.auth.schoolId, req.auth.userId, result.rows[0].link_id, JSON.stringify({ parentUserId: req.params.userId, studentId: req.params.studentId })]);
      return res.json({ ok: true });
    } catch (err) { console.error('Parent link revoke failed:', err.message); return res.status(500).json({ error: 'Could not revoke parent-child link.' }); }
  });

  app.patch('/api/parents/:userId', authenticateSchoolClient, requireAdmin, async (req, res) => {
    if (!isUuid(req.params.userId) || typeof req.body?.active !== 'boolean') return res.status(400).json({ error: 'Provide a valid parent account and active status.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`UPDATE school_users SET active=$3,session_version=CASE WHEN $3=FALSE THEN session_version+1 ELSE session_version END,updated_at=NOW() WHERE school_id=$1 AND user_id=$2 AND role='PARENT' RETURNING user_id,active`, [req.auth.schoolId, req.params.userId, req.body.active]);
      if (!result.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Parent account not found.' }); }
      if (!req.body.active) await client.query(`UPDATE user_sessions SET revoked_at=NOW() WHERE principal_type='SCHOOL' AND school_id=$1 AND school_user_id=$2 AND revoked_at IS NULL`, [req.auth.schoolId, req.params.userId]);
      await audit(client, req.auth.schoolId, 'SCHOOL', req.auth.userId, 'SCHOOL_ADMIN_UPDATE_PARENT', 'school_user', req.params.userId, { active: req.body.active });
      await client.query('COMMIT'); return res.json({ parent: result.rows[0] });
    } catch (err) { await client.query('ROLLBACK'); console.error('Parent update failed:', err.message); return res.status(500).json({ error: 'Could not update parent account.' }); }
    finally { client.release(); }
  });

  app.get('/api/parent/children', authenticateSchoolClient, requireParent, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT s.student_id AS "studentId",s.full_name AS "fullName",s.grade_level AS "gradeLevel",s.section,
                l.relationship, l.status,
                COUNT(e.event_id) FILTER (WHERE e.sync_status='ACCEPTED' AND e.school_date=(NOW() AT TIME ZONE 'Asia/Manila')::date AND e.event_type='TIME_IN')::int AS "todayTimeIns"
         FROM parent_student_links l JOIN students s ON s.school_id=l.school_id AND s.student_id=l.student_id
         LEFT JOIN attendance_events e ON e.school_id=s.school_id AND e.student_id=s.student_id
         WHERE l.school_id=$1 AND l.parent_user_id=$2 AND l.status='APPROVED'
         GROUP BY s.student_id,s.full_name,s.grade_level,s.section,l.relationship,l.status ORDER BY s.full_name`,
        [req.auth.schoolId, req.auth.userId]
      );
      return res.json({ children: result.rows });
    } catch (err) { console.error('Parent children failed:', err.message); return res.status(500).json({ error: 'Could not load linked children.' }); }
  });

  app.get('/api/parent/children/:studentId/attendance', authenticateSchoolClient, requireParent, async (req, res) => {
    try {
      const link = await pool.query(`SELECT 1 FROM parent_student_links WHERE school_id=$1 AND parent_user_id=$2 AND student_id=$3 AND status='APPROVED'`, [req.auth.schoolId, req.auth.userId, req.params.studentId]);
      if (!link.rowCount) return res.status(404).json({ error: 'Student not found among your approved linked children.' });
      const result = await pool.query(
        `SELECT e.event_id AS "eventId",e.school_date AS "schoolDate",e.attendance_scope AS scope,
                e.event_type AS "eventType",e.occurred_at_device AS "occurredAt",e.late,e.sync_status AS "syncStatus",
                p.period_name AS "periodName",p.subject_name AS "subjectName"
         FROM attendance_events e LEFT JOIN class_periods p ON p.school_id=e.school_id AND p.period_id=e.period_id
         WHERE e.school_id=$1 AND e.student_id=$2 AND e.sync_status='ACCEPTED'
         ORDER BY e.occurred_at_device DESC LIMIT 200`, [req.auth.schoolId, req.params.studentId]
      );
      return res.json({ attendance: result.rows });
    } catch (err) { console.error('Parent attendance failed:', err.message); return res.status(500).json({ error: 'Could not load attendance history.' }); }
  });
}

module.exports = { registerParentRoutes };
