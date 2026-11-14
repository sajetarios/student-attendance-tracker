'use strict';

const isSchoolDate = value => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function registerDepartmentRoutes(app, pool, auth) {
  const { authenticateSchoolClient, requireSchoolRoles } = auth;
  const schoolManagers = requireSchoolRoles('SCHOOL_ADMIN', 'DEPARTMENT_HEAD');
  const schoolAdmin = requireSchoolRoles('SCHOOL_ADMIN');

  app.get('/api/departments', authenticateSchoolClient, schoolManagers, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT department_id AS "departmentId", department_code AS code, department_name AS name, description, active
         FROM school_departments
         WHERE school_id=$1 AND ($2::boolean=TRUE OR active=TRUE)
         ORDER BY CASE WHEN department_code='UNASSIGNED' THEN 1 ELSE 0 END, department_name`,
        [req.auth.schoolId, req.auth.role === 'SCHOOL_ADMIN']
      );
      return res.json({ departments: result.rows, ownDepartmentId: req.auth.departmentId || null });
    } catch (err) {
      console.error('Department list failed:', err.message);
      return res.status(500).json({ error: 'Could not load departments.' });
    }
  });

  app.post('/api/departments', authenticateSchoolClient, schoolAdmin, async (req, res) => {
    const { code, name, description } = req.body || {};
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{2,20}$/.test(code.trim()) ||
        typeof name !== 'string' || !name.trim() || name.trim().length > 100 ||
        (description != null && (typeof description !== 'string' || description.length > 500))) {
      return res.status(400).json({ error: 'Enter a department code (2–20 characters) and a name (up to 100 characters).' });
    }
    try {
      const result = await pool.query(
        `INSERT INTO school_departments(school_id, department_code, department_name, description)
         VALUES($1,$2,$3,$4)
         RETURNING department_id AS "departmentId", department_code AS code, department_name AS name, description, active`,
        [req.auth.schoolId, code.trim().toUpperCase(), name.trim(), description?.trim() || null]
      );
      return res.status(201).json({ department: result.rows[0] });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'A department with that code already exists.' });
      console.error('Department creation failed:', err.message);
      return res.status(500).json({ error: 'Could not create department.' });
    }
  });

  app.patch('/api/departments/:departmentId', authenticateSchoolClient, schoolAdmin, async (req, res) => {
    const { code, name, description, active } = req.body || {};
    const cleanCode = typeof code === 'string' ? code.trim().toUpperCase() : '';
    const cleanName = typeof name === 'string' ? name.trim() : '';
    const cleanDescription = typeof description === 'string' ? description.trim() : '';
    if (!/^[A-Z0-9_-]{2,20}$/.test(cleanCode) ||
        !cleanName || cleanName.length > 100 ||
        cleanDescription.length > 500 ||
        typeof active !== 'boolean') {
      return res.status(400).json({ error: 'Provide a valid department code, name, description, and active status.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        `SELECT department_id AS "departmentId", department_code AS code,
                department_name AS name, description, active
         FROM school_departments
         WHERE school_id=$1 AND department_id=$2 AND department_code<>'UNASSIGNED'
         FOR UPDATE`,
        [req.auth.schoolId, req.params.departmentId]
      );
      if (!existing.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Department not found or cannot be changed.' });
      }
      if (!active) {
        const references = await client.query(
          `SELECT
             EXISTS(SELECT 1 FROM school_users WHERE school_id=$1 AND department_id=$2 AND active=TRUE) AS "hasActiveStaff",
             EXISTS(SELECT 1 FROM class_periods WHERE school_id=$1 AND department_id=$2 AND active=TRUE) AS "hasActiveSchedules"`,
          [req.auth.schoolId, req.params.departmentId]
        );
        if (references.rows[0].hasActiveStaff || references.rows[0].hasActiveSchedules) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'This department still has active staff or class schedules. Reassign or deactivate those records before deactivating the department.' });
        }
      }
      const updated = await client.query(
        `UPDATE school_departments
         SET department_code=$3, department_name=$4, description=$5, active=$6, updated_at=NOW()
         WHERE school_id=$1 AND department_id=$2 AND department_code<>'UNASSIGNED'
         RETURNING department_id AS "departmentId", department_code AS code,
                   department_name AS name, description, active`,
        [req.auth.schoolId, req.params.departmentId, cleanCode, cleanName, cleanDescription || null, active]
      );
      await client.query(
        `INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
         VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_UPDATE_DEPARTMENT','school_department',$3,$4::jsonb)`,
        [req.auth.schoolId, req.auth.userId, req.params.departmentId,
         JSON.stringify({ before: existing.rows[0], after: updated.rows[0] })]
      );
      await client.query('COMMIT');
      return res.json({ department: updated.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err.code === '23505') return res.status(409).json({ error: 'A department with that code already exists.' });
      console.error('Department update failed:', err.message);
      return res.status(500).json({ error: 'Could not update department.' });
    } finally {
      client.release();
    }
  });

  app.post('/api/school-users/bulk-department', authenticateSchoolClient, schoolAdmin, async (req, res) => {
    const userIds = [...new Set((Array.isArray(req.body?.userIds) ? req.body.userIds : []).filter(value =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ))];
    const departmentId = req.body?.departmentId;
    if (!userIds.length || userIds.length > 200 || userIds.length !== (req.body?.userIds || []).length ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(departmentId || '')) {
      return res.status(400).json({ error: 'Select 1–200 valid teacher/Department Head accounts and an active department.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const department = await client.query(
        'SELECT department_id FROM school_departments WHERE school_id=$1 AND department_id=$2 AND active=TRUE',
        [req.auth.schoolId, departmentId]
      );
      if (!department.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Active department not found.' });
      }
      const staff = await client.query(
        `SELECT user_id,role FROM school_users
         WHERE school_id=$1 AND user_id=ANY($2::uuid[]) AND role IN ('TEACHER','DEPARTMENT_HEAD') FOR UPDATE`,
        [req.auth.schoolId, userIds]
      );
      if (staff.rowCount !== userIds.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'One or more selected accounts are not eligible staff in this school.' });
      }
      const conflict = await client.query(
        `SELECT p.period_name,su.display_name
         FROM teacher_period_assignments a
         JOIN class_periods p ON p.school_id=a.school_id AND p.period_id=a.period_id
         JOIN school_users su ON su.school_id=a.school_id AND su.user_id=a.teacher_user_id
         WHERE a.school_id=$1 AND a.teacher_user_id=ANY($2::uuid[]) AND p.department_id<>$3
         UNION ALL
         SELECT p.period_name,su.display_name
         FROM teacher_period_substitutions ts
         JOIN class_periods p ON p.school_id=ts.school_id AND p.period_id=ts.period_id
         JOIN school_users su ON su.school_id=ts.school_id AND su.user_id=ts.substitute_teacher_user_id
         WHERE ts.school_id=$1 AND ts.substitute_teacher_user_id=ANY($2::uuid[])
           AND ts.status='ACTIVE' AND ts.end_date >= (NOW() AT TIME ZONE 'Asia/Manila')::date
           AND p.department_id<>$3 LIMIT 1`,
        [req.auth.schoolId, userIds, departmentId]
      );
      if (conflict.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: conflict.rows[0].display_name + ' has a permanent or substitute schedule in another department (' + conflict.rows[0].period_name + '). Reclassify that schedule first.' });
      }
      await client.query(
        `UPDATE school_users SET department_id=$3
         WHERE school_id=$1 AND user_id=ANY($2::uuid[]) AND role IN ('TEACHER','DEPARTMENT_HEAD')`,
        [req.auth.schoolId, userIds, departmentId]
      );
      await client.query(
        `INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
         VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_BULK_CHANGE_STAFF_DEPARTMENT','school_users',$3,$4::jsonb)`,
        [req.auth.schoolId, req.auth.userId, departmentId, JSON.stringify({ userIds, departmentId })]
      );
      await client.query('COMMIT');
      return res.json({ ok: true, updated: userIds.length });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Bulk staff department assignment failed:', err.message);
      return res.status(500).json({ error: 'Could not complete bulk department assignment.' });
    } finally { client.release(); }
  });

  app.patch('/api/school-users/:userId/department', authenticateSchoolClient, schoolAdmin, async (req, res) => {
    const { departmentId } = req.body || {};
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.userId || '') ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(departmentId || '')) {
      return res.status(400).json({ error: 'Choose a valid staff account and department.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const conflicts = await client.query(
        `SELECT p.period_name
         FROM teacher_period_assignments a
         JOIN class_periods p ON p.school_id=a.school_id AND p.period_id=a.period_id
         WHERE a.school_id=$1 AND a.teacher_user_id=$2 AND p.department_id<>$3
         UNION ALL
         SELECT p.period_name
         FROM teacher_period_substitutions ts
         JOIN class_periods p ON p.school_id=ts.school_id AND p.period_id=ts.period_id
         WHERE ts.school_id=$1 AND ts.substitute_teacher_user_id=$2
           AND ts.status='ACTIVE' AND ts.end_date >= (NOW() AT TIME ZONE 'Asia/Manila')::date
           AND p.department_id<>$3
         LIMIT 1`,
        [req.auth.schoolId, req.params.userId, departmentId]
      );
      if (conflicts.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Remove or reclassify the teacher's existing schedule "${conflicts.rows[0].period_name}" before changing the teacher's department.` });
      }
      const result = await client.query(
        `UPDATE school_users su SET department_id=$3
         FROM school_departments d
         WHERE su.school_id=$1 AND su.user_id=$2 AND su.role IN ('TEACHER','DEPARTMENT_HEAD')
           AND d.school_id=su.school_id AND d.department_id=$3 AND d.active=TRUE
         RETURNING su.user_id AS "userId", su.role, su.department_id AS "departmentId", d.department_name AS "departmentName"`,
        [req.auth.schoolId, req.params.userId, departmentId]
      );
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Staff account or active department was not found.' });
      }
      await client.query(
        `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
         VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_CHANGE_STAFF_DEPARTMENT','school_user',$3,$4::jsonb)`,
        [req.auth.schoolId, req.auth.userId, req.params.userId, JSON.stringify({ departmentId })]
      );
      await client.query('COMMIT');
      return res.json({ user: result.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Staff department update failed:', err.message);
      return res.status(500).json({ error: 'Could not update staff department.' });
    } finally {
      client.release();
    }
  });

  app.patch('/api/periods/:periodId/department', authenticateSchoolClient, schoolAdmin, async (req, res) => {
    const { departmentId } = req.body || {};
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.periodId || '') ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(departmentId || '')) {
      return res.status(400).json({ error: 'Choose a valid class schedule and department.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const target = await client.query(
        'SELECT 1 FROM school_departments WHERE school_id=$1 AND department_id=$2 AND active=TRUE',
        [req.auth.schoolId, departmentId]
      );
      if (!target.rowCount) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Choose an active department in this school.' });
      }
      const assignment = await client.query(
        'SELECT 1 FROM teacher_period_assignments WHERE school_id=$1 AND period_id=$2 LIMIT 1',
        [req.auth.schoolId, req.params.periodId]
      );
      const coverage = await client.query(
        "SELECT 1 FROM teacher_period_substitutions WHERE school_id=$1 AND period_id=$2 AND status='ACTIVE' AND end_date >= (NOW() AT TIME ZONE 'Asia/Manila')::date LIMIT 1",
        [req.auth.schoolId, req.params.periodId]
      );
      if (assignment.rowCount || coverage.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Remove the current teacher assignment and active cover before changing this schedule department.' });
      }
      const changed = await client.query(
        'UPDATE class_periods SET department_id=$3 WHERE school_id=$1 AND period_id=$2 AND active=TRUE RETURNING period_id',
        [req.auth.schoolId, req.params.periodId, departmentId]
      );
      if (!changed.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Active class schedule not found.' });
      }
      await client.query(
        `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
         VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_CHANGE_SCHEDULE_DEPARTMENT','class_period',$3,$4::jsonb)`,
        [req.auth.schoolId, req.auth.userId, req.params.periodId, JSON.stringify({ departmentId })]
      );
      await client.query('COMMIT');
      return res.json({ ok: true, departmentId });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Schedule department update failed:', err.message);
      return res.status(500).json({ error: 'Could not change schedule department.' });
    } finally {
      client.release();
    }
  });

  app.get('/api/admin/teacher-coverage', authenticateSchoolClient, schoolManagers, async (req, res) => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
    const schoolDate = typeof req.query.date === 'string' ? req.query.date : today;
    if (!isSchoolDate(schoolDate)) return res.status(400).json({ error: 'Provide a valid school date (YYYY-MM-DD).' });
    try {
      const result = await pool.query(
        `SELECT p.period_id AS "periodId", p.period_name AS "periodName", p.grade_level AS "gradeLevel",
                p.section, p.subject_name AS "subjectName", p.classroom, p.department_id AS "departmentId",
                COALESCE(d.department_name, 'Unassigned') AS "departmentName",
                to_char(p.start_time,'HH24:MI') AS "startTime", to_char(p.end_time,'HH24:MI') AS "endTime",
                p.grace_minutes AS "graceMinutes", a.teacher_user_id AS "teacherUserId",
                teacher.display_name AS "teacherName", teacher.active AS "teacherActive",
                teacher.teacher_status AS "teacherStatus", teacher.leave_type AS "leaveType",
                to_char(teacher.leave_start_date,'YYYY-MM-DD') AS "leaveStartDate",
                to_char(teacher.expected_return_date,'YYYY-MM-DD') AS "expectedReturnDate",
                teacher.leave_auto_reactivate AS "leaveAutoReactivate",
                cover.substitution_id AS "substitutionId", cover.substitute_teacher_user_id AS "substituteTeacherUserId",
                substitute.display_name AS "substituteTeacherName", gate.event_id AS "effectiveTeacherTimeInId",
                CASE
                  WHEN a.teacher_user_id IS NULL THEN 'NO_TEACHER'
                  WHEN cover.substitution_id IS NOT NULL AND $2::date=(NOW() AT TIME ZONE 'Asia/Manila')::date
                       AND (NOW() AT TIME ZONE 'Asia/Manila')::time > p.start_time + make_interval(mins => p.grace_minutes)
                       AND gate.event_id IS NULL THEN 'COVERAGE_CHECK_IN_NOT_RECORDED'
                  WHEN cover.substitution_id IS NOT NULL THEN 'COVERED'
                  WHEN teacher.teacher_status='ON_LEAVE'
                       AND $2::date BETWEEN teacher.leave_start_date AND teacher.expected_return_date THEN 'ON_LEAVE_UNCOVERED'
                  WHEN teacher.active=FALSE THEN 'TEACHER_INACTIVE'
                  WHEN $2::date > (NOW() AT TIME ZONE 'Asia/Manila')::date THEN 'SCHEDULED'
                  WHEN $2::date=(NOW() AT TIME ZONE 'Asia/Manila')::date
                       AND (NOW() AT TIME ZONE 'Asia/Manila')::time <= p.start_time + make_interval(mins => p.grace_minutes) THEN 'WAITING_FOR_START'
                  WHEN $2::date=(NOW() AT TIME ZONE 'Asia/Manila')::date AND gate.event_id IS NULL THEN 'CHECK_IN_NOT_RECORDED'
                  ELSE 'ASSIGNED'
                END AS "coverageStatus"
         FROM class_periods p
         LEFT JOIN school_departments d ON d.school_id=p.school_id AND d.department_id=p.department_id
         LEFT JOIN teacher_period_assignments a ON a.school_id=p.school_id AND a.period_id=p.period_id
         LEFT JOIN school_users teacher ON teacher.school_id=a.school_id AND teacher.user_id=a.teacher_user_id
         LEFT JOIN LATERAL (
           SELECT ts.substitution_id, ts.substitute_teacher_user_id FROM teacher_period_substitutions ts
           WHERE ts.school_id=p.school_id AND ts.period_id=p.period_id AND ts.status='ACTIVE'
             AND $2::date BETWEEN ts.start_date AND ts.end_date
           ORDER BY ts.created_at DESC LIMIT 1
         ) cover ON TRUE
         LEFT JOIN school_users substitute ON substitute.school_id=p.school_id AND substitute.user_id=cover.substitute_teacher_user_id
         LEFT JOIN teacher_gate_events gate ON gate.school_id=p.school_id
          AND gate.teacher_user_id=COALESCE(cover.substitute_teacher_user_id,a.teacher_user_id)
          AND gate.school_date=$2::date AND gate.event_type='TIME_IN'
         WHERE p.school_id=$1 AND p.active=TRUE
         ORDER BY d.department_name, p.grade_level, p.section, p.start_time, p.period_name`,
        [req.auth.schoolId, schoolDate]
      );
      const rows = result.rows.map(row => ({
        ...row,
        effectiveTeacherName: row.substituteTeacherName || row.teacherName || null,
        effectiveTeacherUserId: row.substituteTeacherUserId || row.teacherUserId || null,
        checkInRecorded: Boolean(row.effectiveTeacherTimeInId)
      }));
      return res.json({
        schoolDate, isToday: schoolDate === today, coverage: rows,
        summary: {
          totalSchedules: rows.length,
          noTeacher: rows.filter(row => row.coverageStatus === 'NO_TEACHER').length,
          onLeaveUncovered: rows.filter(row => row.coverageStatus === 'ON_LEAVE_UNCOVERED').length,
          checkInNotRecorded: rows.filter(row => ['CHECK_IN_NOT_RECORDED','COVERAGE_CHECK_IN_NOT_RECORDED'].includes(row.coverageStatus)).length,
          covered: rows.filter(row => row.coverageStatus === 'COVERED').length
        }
      });
    } catch (err) {
      console.error('Teacher coverage monitoring failed:', err.message);
      return res.status(500).json({ error: 'Could not load class coverage.' });
    }
  });
}

module.exports = { registerDepartmentRoutes };
