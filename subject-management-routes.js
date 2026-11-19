'use strict';
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function registerSubjectManagementRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles }) {
  const authorize = [authenticateSchoolClient, requireSchoolRoles('SCHOOL_ADMIN', 'DEPARTMENT_HEAD')];
  app.patch('/api/subjects/:subjectId', ...authorize, async (req, res) => {
    if (!uuid(req.params.subjectId)) return res.status(400).json({ error: 'Invalid subject.' });
    const name = typeof req.body?.subjectName === 'string' ? req.body.subjectName.trim().replace(/\s+/g, ' ') : '';
    if (!name || name.length > 120) return res.status(400).json({ error: 'Subject name must be 1–120 characters.' });
    if (req.auth.role === 'DEPARTMENT_HEAD' && (!uuid(req.auth.departmentId) || req.auth.departmentCode === 'UNASSIGNED'))
      return res.status(403).json({ error: 'An assigned department is required.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const previous = await client.query(
        `SELECT s.subject_id AS "subjectId",s.department_id AS "departmentId",s.subject_name AS "subjectName"
         FROM school_subjects s JOIN school_departments d ON d.school_id=s.school_id AND d.department_id=s.department_id
         WHERE s.school_id=$1 AND s.subject_id=$2 AND s.active=TRUE AND d.active=TRUE
           AND ($3::boolean OR s.department_id=$4::uuid) FOR UPDATE OF s`,
        [req.auth.schoolId, req.params.subjectId, req.auth.role === 'SCHOOL_ADMIN', req.auth.departmentId || null]);
      if (!previous.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Subject not found in your department.' }); }
      const before = previous.rows[0];
      if (before.subjectName === name) { await client.query('COMMIT'); return res.json({ subject: before, unchanged: true }); }
      const updated = await client.query(
        `UPDATE school_subjects SET subject_name=$3,updated_at=NOW()
         WHERE school_id=$1 AND subject_id=$2
         RETURNING subject_id AS "subjectId",department_id AS "departmentId",subject_name AS "subjectName"`,
        [req.auth.schoolId, req.params.subjectId, name]);
      // Historical class-period snapshots deliberately remain unchanged.
      await client.query(
        `INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
         VALUES($1,'SCHOOL',$2,'SUBJECT_RENAMED','school_subject',$3,$4::jsonb)`,
        [req.auth.schoolId,req.auth.userId,req.params.subjectId,JSON.stringify({before,after:updated.rows[0]})]);
      await client.query('COMMIT');
      return res.json({ subject: updated.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.code === '23505') return res.status(409).json({ error: 'That subject name already exists in this department.' });
      console.error('Subject rename failed:', error.message);
      return res.status(503).json({ error: 'Could not update subject.' });
    } finally { client.release(); }
  });
}
module.exports = { registerSubjectManagementRoutes };
