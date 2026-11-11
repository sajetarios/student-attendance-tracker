'use strict';

const { hashPassword, verifyPassword } = require('./auth-security');

const validText = (value, max = 160) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;

function registerStudentRoutes(app, pool, auth) {
  const { authenticateSchoolClient, requireSchoolAdmin } = auth;
  const requireStudent = (req, res, next) => {
    if (req.auth?.type !== 'STUDENT') return res.status(403).json({ error: 'A student portal session is required.' });
    return next();
  };
  const requireStudentPasswordChanged = (req, res, next) => {
    if (req.auth?.mustChangePassword) return res.status(428).json({ error: 'Change your initial password before viewing attendance.' });
    return next();
  };

  app.get('/api/student/profile', authenticateSchoolClient, requireStudent, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT student_id AS "studentId", full_name AS "fullName", grade_level AS "gradeLevel",
                section, sex
         FROM students WHERE school_id=$1 AND student_id=$2 AND active=TRUE`,
        [req.auth.schoolId, req.auth.studentId]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'Student profile not found.' });
      return res.json({ student: result.rows[0], school: { schoolCode: req.auth.schoolCode, schoolName: req.auth.schoolName } });
    } catch (err) {
      console.error('Student profile failed:', err.message);
      return res.status(500).json({ error: 'Could not load student profile.' });
    }
  });

  app.get('/api/student/attendance', authenticateSchoolClient, requireStudent, requireStudentPasswordChanged, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT e.event_id AS "eventId", e.school_date AS "schoolDate",
                e.attendance_scope AS scope, e.event_type AS "eventType",
                e.occurred_at_device AS "occurredAt", e.late, e.sync_status AS "syncStatus",
                p.period_name AS "periodName", p.subject_name AS "subjectName"
         FROM attendance_events e
         LEFT JOIN class_periods p ON p.school_id=e.school_id AND p.period_id=e.period_id
         WHERE e.school_id=$1 AND e.student_id=$2 AND e.sync_status='ACCEPTED'
         ORDER BY e.school_date DESC, e.occurred_at_device DESC
         LIMIT 200`, [req.auth.schoolId, req.auth.studentId]
      );
      return res.json({ attendance: result.rows });
    } catch (err) {
      console.error('Student attendance history failed:', err.message);
      return res.status(500).json({ error: 'Could not load your attendance history.' });
    }
  });

  app.post('/api/student/change-password', authenticateSchoolClient, requireStudent, async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 256) {
      return res.status(400).json({ error: 'Enter your current password and a new password of at least 12 characters.' });
    }
    try {
      const result = await pool.query(
        `SELECT password_hash FROM student_accounts
         WHERE school_id=$1 AND student_account_id=$2 AND active=TRUE`,
        [req.auth.schoolId, req.auth.studentAccountId]
      );
      if (!result.rowCount || !(await verifyPassword(currentPassword, result.rows[0].password_hash))) {
        return res.status(400).json({ error: 'Your current password is incorrect.' });
      }
      const passwordHash = await hashPassword(newPassword);
      await pool.query(
        `UPDATE student_accounts SET password_hash=$3, must_change_password=FALSE,
           failed_login_attempts=0, locked_until=NULL, updated_at=NOW()
         WHERE school_id=$1 AND student_account_id=$2`,
        [req.auth.schoolId, req.auth.studentAccountId, passwordHash]
      );
      return res.json({ ok: true, mustChangePassword: false });
    } catch (err) {
      console.error('Student password update failed:', err.message);
      return res.status(500).json({ error: 'Could not update student password.' });
    }
  });

  // School Administrator creates the first student login. Username defaults to Student ID.
  app.post('/api/students/:studentId/account', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
    const username = validText(req.body?.username, 80) ? req.body.username.trim() : String(req.params.studentId || '').trim();
    const password = req.body?.password;
    if (!validText(username, 80) || typeof password !== 'string' || password.length < 12 || password.length > 256) {
      return res.status(400).json({ error: 'Provide a username and initial password of at least 12 characters.' });
    }
    try {
      const student = await pool.query(
        `SELECT student_id FROM students WHERE school_id=$1 AND student_id=$2 AND active=TRUE`,
        [req.auth.schoolId, req.params.studentId]
      );
      if (!student.rowCount) return res.status(404).json({ error: 'Active student not found.' });
      const passwordHash = await hashPassword(password);
      const created = await pool.query(
        `INSERT INTO student_accounts(school_id, student_id, username, password_hash, must_change_password)
         VALUES($1,$2,$3,$4,TRUE)
         RETURNING student_account_id AS "studentAccountId", student_id AS "studentId", username, active, must_change_password AS "mustChangePassword"`,
        [req.auth.schoolId, req.params.studentId, username, passwordHash]
      );
      await pool.query(
        `INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
         VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_CREATE_STUDENT_LOGIN','student_account',$3,$4::jsonb)`,
        [req.auth.schoolId, req.auth.userId, created.rows[0].studentAccountId,
          JSON.stringify({ studentId: req.params.studentId, username })]
      );
      return res.status(201).json({ account: created.rows[0] });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'A student account or username already exists.' });
      console.error('Student account creation failed:', err.message);
      return res.status(500).json({ error: 'Could not create student account.' });
    }
  });

  app.put('/api/students/:studentId/account/password', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
    const password = req.body?.password;
    if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
      return res.status(400).json({ error: 'New password must contain at least 12 characters.' });
    }
    try {
      const passwordHash = await hashPassword(password);
      const updated = await pool.query(
        `UPDATE student_accounts SET password_hash=$3, must_change_password=TRUE,
           failed_login_attempts=0, locked_until=NULL, updated_at=NOW()
         WHERE school_id=$1 AND student_id=$2 AND active=TRUE
         RETURNING student_account_id AS "studentAccountId", username`,
        [req.auth.schoolId, req.params.studentId, passwordHash]
      );
      if (!updated.rowCount) return res.status(404).json({ error: 'Student account not found.' });
      await pool.query(
        `UPDATE student_sessions SET revoked_at=NOW()
         WHERE school_id=$1 AND student_account_id=$2 AND revoked_at IS NULL`,
        [req.auth.schoolId, updated.rows[0].studentAccountId]
      );
      await pool.query(
        `INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
         VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_RESET_STUDENT_PASSWORD','student_account',$3,$4::jsonb)`,
        [req.auth.schoolId, req.auth.userId, updated.rows[0].studentAccountId,
          JSON.stringify({ studentId: req.params.studentId, username: updated.rows[0].username })]
      );
      return res.json({ ok: true, username: updated.rows[0].username, mustChangePassword: true });
    } catch (err) {
      console.error('Student password reset failed:', err.message);
      return res.status(500).json({ error: 'Could not reset student password.' });
    }
  });
}

module.exports = { registerStudentRoutes };
