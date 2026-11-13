'use strict';
require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const { runMigrations } = require('./scripts/migrate');
const QRCode = require('qrcode');
const path = require('path');
const https = require('https');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { registerAuthRoutes } = require('./auth-routes');
const { hashPassword } = require('./auth-security');
const { createAuthMiddleware } = require('./auth-middleware');
const { registerParentRoutes } = require('./parent-routes');
const { registerStudentRoutes } = require('./student-routes');
const { registerAcademicRoutes } = require('./academic-routes');
const { registerDepartmentRoutes } = require('./department-routes');
const registerCloudSyncRoutes = require('./cloud-sync-routes');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '2mb' }));

registerAuthRoutes(app, pool);
const { authenticateSchoolClient, requireSchoolRoles, requireSchoolPermission, requireTeacherDesignations, requireSchoolClient } = createAuthMiddleware(pool);
const requireSchoolAdmin = requireSchoolRoles('SCHOOL_ADMIN');
const requireSchoolAdminOrTeacher = requireSchoolRoles('SCHOOL_ADMIN', 'TEACHER');
const requireSchoolAdminOrDepartmentHeadOrTeacher = requireSchoolRoles('SCHOOL_ADMIN', 'DEPARTMENT_HEAD', 'TEACHER');
const requireSchoolUser = requireSchoolRoles('SCHOOL_ADMIN', 'DEPARTMENT_HEAD', 'TEACHER');
const requireSchoolAdminOrDepartmentHead = requireSchoolRoles('SCHOOL_ADMIN', 'DEPARTMENT_HEAD');
const validText = value => typeof value === 'string' && value.trim().length > 0;
registerParentRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerStudentRoutes(app, pool, { authenticateSchoolClient, requireSchoolAdmin });
registerAcademicRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerDepartmentRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles });
registerCloudSyncRoutes(app, pool, { authenticateSchoolClient, requireSchoolAdmin });
const registerSf2Routes = require('./sf2-routes');
registerSf2Routes(app, pool, { authenticateSchoolClient, requireSchoolUser, requireSchoolAdmin, requireSchoolAdminOrDepartmentHead });


const isUuid = value => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

// Teacher management is available only to the authenticated School Administrator.
// All reads/writes are scoped to req.auth.schoolId; callers cannot submit a school_id.
app.get('/api/teachers', authenticateSchoolClient, requireSchoolAdminOrDepartmentHead, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT su.user_id AS "userId", su.username,
              su.display_name AS "displayName", su.active,
              su.department_id AS "departmentId",
              COALESCE((SELECT d.department_name FROM school_departments d WHERE d.school_id=su.school_id AND d.department_id=su.department_id), 'Unassigned') AS "departmentName",
              su.teacher_designations AS "teacherDesignations",
              (su.teacher_photo_path IS NOT NULL) AS "hasTeacherPhoto",
              COALESCE((SELECT json_agg(json_build_object('gradeLevel', ca.grade_level, 'section', ca.section) ORDER BY ca.grade_level, ca.section)
                        FROM class_adviser_assignments ca
                        WHERE ca.school_id=su.school_id AND ca.adviser_user_id=su.user_id), '[]'::json) AS "adviserSections",
              CASE
                WHEN UPPER(COALESCE(su.teacher_status, '')) = 'ON_LEAVE'
                  OR (su.active = FALSE AND su.leave_type IS NOT NULL
                      AND su.expected_return_date IS NOT NULL)
                  THEN 'ON_LEAVE'
                WHEN su.active = TRUE THEN 'ACTIVE'
                ELSE COALESCE(NULLIF(UPPER(su.teacher_status), ''), 'INACTIVE')
              END AS "teacherStatus",
              su.leave_type AS "leaveType",
              su.leave_start_date AS "leaveStartDate",
              su.expected_return_date AS "expectedReturnDate",
              su.leave_auto_reactivate AS "leaveAutoReactivate",
              su.created_at AS "createdAt", su.last_login_at AS "lastLoginAt",
              COALESCE(
                json_agg(json_build_object(
                  'periodId', p.period_id,
                  'periodName', p.period_name,
                  'subjectName', p.subject_name,
                  'gradeLevel', p.grade_level,
                  'section', p.section,
                  'classroom', p.classroom,
                  'departmentId', p.department_id,
                  'startTime', to_char(p.start_time, 'HH24:MI'),
                  'endTime', to_char(p.end_time, 'HH24:MI')
                ) ORDER BY p.start_time)
                FILTER (WHERE p.period_id IS NOT NULL), '[]'::json
              ) AS "assignedPeriods"
       FROM school_users su
       LEFT JOIN teacher_period_assignments a
         ON a.school_id=su.school_id AND a.teacher_user_id=su.user_id
       LEFT JOIN class_periods p
         ON p.school_id=a.school_id AND p.period_id=a.period_id AND p.active=TRUE
       WHERE su.school_id=$1 AND su.role='TEACHER'
       GROUP BY su.user_id
       ORDER BY su.active DESC, su.display_name, su.username`,
      [req.auth.schoolId]
    );
    const substitutionResult = await pool.query(
      `SELECT ts.substitution_id AS "substitutionId", ts.period_id AS "periodId",
              ts.original_teacher_user_id AS "originalTeacherUserId",
              ts.substitute_teacher_user_id AS "substituteTeacherUserId",
              original.display_name AS "originalTeacherName",
              substitute.display_name AS "substituteTeacherName",
              p.period_name AS "periodName", p.subject_name AS "subjectName",
              p.grade_level AS "gradeLevel", p.section,
              to_char(ts.start_date, 'YYYY-MM-DD') AS "startDate",
              to_char(ts.end_date, 'YYYY-MM-DD') AS "endDate"
       FROM teacher_period_substitutions ts
       JOIN school_users original
         ON original.school_id=ts.school_id AND original.user_id=ts.original_teacher_user_id
       JOIN school_users substitute
         ON substitute.school_id=ts.school_id AND substitute.user_id=ts.substitute_teacher_user_id
       JOIN class_periods p
         ON p.school_id=ts.school_id AND p.period_id=ts.period_id
       WHERE ts.school_id=$1 AND ts.status='ACTIVE'
         AND ts.end_date >= (NOW() AT TIME ZONE 'Asia/Manila')::date
       ORDER BY ts.start_date, p.start_time`,
      [req.auth.schoolId]
    );
    const teacherById = new Map(result.rows.map(teacher => {
      teacher.substitutionAssignments = [];
      return [String(teacher.userId), teacher];
    }));
    for (const sub of substitutionResult.rows) {
      const shared = {
        substitutionId: sub.substitutionId,
        periodId: sub.periodId,
        periodName: sub.periodName,
        subjectName: sub.subjectName,
        gradeLevel: sub.gradeLevel,
        section: sub.section,
        startDate: sub.startDate,
        endDate: sub.endDate,
        originalTeacherUserId: sub.originalTeacherUserId,
        substituteTeacherUserId: sub.substituteTeacherUserId,
        originalTeacherName: sub.originalTeacherName,
        substituteTeacherName: sub.substituteTeacherName
      };
      const originalRow = teacherById.get(String(sub.originalTeacherUserId));
      const substituteRow = teacherById.get(String(sub.substituteTeacherUserId));
      if (originalRow) originalRow.substitutionAssignments.push({ ...shared, relationship: 'ORIGINAL' });
      if (substituteRow) substituteRow.substitutionAssignments.push({ ...shared, relationship: 'SUBSTITUTE' });
    }
    return res.json({ teachers: result.rows });
  } catch (err) {
    console.error('Teacher list failed:', err.message);
    return res.status(500).json({ error: 'Could not load teachers.' });
  }
});

// School account directory and creation. Parent accounts use the dedicated parent workflow.
app.get('/api/school-users', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT user_id AS "userId", username, display_name AS "displayName", role,
              teacher_designations AS "teacherDesignations", active,
              created_at AS "createdAt", last_login_at AS "lastLoginAt"
       FROM school_users
       WHERE school_id=$1 AND role IN ('DEPARTMENT_HEAD', 'GATE_KEEPER')
       ORDER BY CASE role WHEN 'DEPARTMENT_HEAD' THEN 1 WHEN 'GATE_KEEPER' THEN 2 ELSE 3 END,
                display_name, username`,
      [req.auth.schoolId]
    );
    return res.json({ users: result.rows });
  } catch (err) {
    console.error('School account list failed:', err.message);
    return res.status(500).json({ error: 'Could not load school accounts.' });
  }
});

app.post('/api/school-users', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  const { username, displayName, password } = req.body || {};
  const role = String(req.body?.role || '').toUpperCase();
  const allowedRoles = ['TEACHER', 'DEPARTMENT_HEAD', 'GATE_KEEPER'];
  let designations = [];
  if (role === 'TEACHER') {
    const supplied = Array.isArray(req.body?.teacherDesignations) ? req.body.teacherDesignations : ['SUBJECT_TEACHER'];
    designations = [...new Set(supplied.map(value => String(value).toUpperCase()))];
    if (!designations.length || designations.some(value => !['CLASS_ADVISER', 'SUBJECT_TEACHER'].includes(value))) {
      return res.status(400).json({ error: 'Select Subject Teacher, Class Adviser, or both.' });
    }
  }
  if (!allowedRoles.includes(role) || !validText(username) || username.trim().length > 80 ||
      !validText(displayName) || displayName.trim().length > 160 ||
      typeof password !== 'string' || password.length < 12 || password.length > 256) {
    return res.status(400).json({ error: 'Provide a valid account role, username, display name, and password of at least 12 characters.' });
  }
  let passwordHash;
  try { passwordHash = await hashPassword(password); }
  catch (err) { return res.status(400).json({ error: err.message || 'Password does not meet requirements.' }); }

  try {
    const created = await pool.query(
      `INSERT INTO school_users (school_id, username, display_name, password_hash, role, teacher_designations, teacher_qr_token)
       VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $5='TEACHER' THEN gen_random_uuid() ELSE NULL END)
       RETURNING user_id AS "userId", username, display_name AS "displayName", role,
                 teacher_designations AS "teacherDesignations", active, created_at AS "createdAt"`,
      [req.auth.schoolId, username.trim(), displayName.trim(), passwordHash, role, designations]
    );
    await pool.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_CREATE_ACCOUNT','school_user',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, created.rows[0].userId,
       JSON.stringify({ username: username.trim(), role, teacherDesignations: designations })]
    );
    return res.status(201).json({ user: created.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That username is already used by an account in this school.' });
    console.error('School account creation failed:', err.message);
    return res.status(500).json({ error: 'Could not create school account.' });
  }
});

// Gate Keeper monitoring is available to the School Administrator only.
// This summary counts actual gate events recorded by each Gate Keeper, not login activity.
app.get('/api/admin/gatekeeper-monitoring', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT su.user_id AS "userId", su.username, su.display_name AS "displayName", su.active,
              COALESCE((SELECT COUNT(*)::int FROM attendance_events e
                        WHERE e.school_id=su.school_id AND e.recorded_by_user_id=su.user_id
                          AND e.attendance_scope='SCHOOL' AND e.sync_status='ACCEPTED'
                          AND e.school_date=(NOW() AT TIME ZONE 'Asia/Manila')::date),0) AS "studentScansToday",
              COALESCE((SELECT COUNT(*)::int FROM teacher_gate_events tge
                        WHERE tge.school_id=su.school_id AND tge.recorded_by_user_id=su.user_id
                          AND tge.school_date=(NOW() AT TIME ZONE 'Asia/Manila')::date),0) AS "teacherPunchesToday",
              GREATEST(
                (SELECT MAX(e.received_at_server) FROM attendance_events e
                 WHERE e.school_id=su.school_id AND e.recorded_by_user_id=su.user_id AND e.attendance_scope='SCHOOL'),
                (SELECT MAX(tge.created_at) FROM teacher_gate_events tge
                 WHERE tge.school_id=su.school_id AND tge.recorded_by_user_id=su.user_id)
              ) AS "lastActivityAt"
       FROM school_users su
       WHERE su.school_id=$1 AND su.role='GATE_KEEPER'
       ORDER BY su.active DESC, su.display_name, su.username`,
      [req.auth.schoolId]
    );
    return res.json({ gateKeepers: result.rows, schoolDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()) });
  } catch (err) {
    console.error('Gate Keeper monitoring failed:', err.message);
    return res.status(500).json({ error: 'Could not load Gate Keeper monitoring.' });
  }
});

// Read-only teacher gate attendance history for the School Administrator and Department Head.
app.get('/api/admin/teacher-gate-attendance', authenticateSchoolClient, requireSchoolAdminOrDepartmentHead, async (req, res) => {
  const requestedDate = typeof req.query.date === 'string' ? req.query.date : '';
  const schoolDate = requestedDate || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  if (!isValidSchoolDate(schoolDate)) return res.status(400).json({ error: 'Provide a valid school date (YYYY-MM-DD).' });
  try {
    const result = await pool.query(
      `SELECT tge.event_id AS "eventId", tge.teacher_user_id AS "teacherUserId",
              teacher.display_name AS "teacherName", teacher.username,
              tge.event_type AS "eventType", tge.school_date AS "schoolDate",
              tge.occurred_at AS "occurredAt", tge.photo_verified AS "photoVerified",
              gatekeeper.display_name AS "recordedBy"
       FROM teacher_gate_events tge
       JOIN school_users teacher ON teacher.school_id=tge.school_id AND teacher.user_id=tge.teacher_user_id
       JOIN school_users gatekeeper ON gatekeeper.school_id=tge.school_id AND gatekeeper.user_id=tge.recorded_by_user_id
       WHERE tge.school_id=$1 AND tge.school_date=$2::date
       ORDER BY tge.occurred_at DESC, teacher.display_name`,
      [req.auth.schoolId, schoolDate]
    );
    return res.json({ events: result.rows, schoolDate });
  } catch (err) {
    console.error('Teacher gate attendance list failed:', err.message);
    return res.status(500).json({ error: 'Could not load teacher gate attendance.' });
  }
});

app.get('/api/class-adviser-assignments', authenticateSchoolClient,
  requireSchoolRoles('SCHOOL_ADMIN', 'DEPARTMENT_HEAD', 'TEACHER'), async (req, res) => {
    try {
      const params = [req.auth.schoolId];
      let teacherFilter = '';
      if (req.auth.role === 'TEACHER') {
        params.push(req.auth.userId);
        teacherFilter = ' AND ca.adviser_user_id=$2';
      }
      const result = await pool.query(
        `SELECT ca.assignment_id AS "assignmentId", ca.adviser_user_id AS "adviserUserId",
                su.display_name AS "adviserName", ca.grade_level AS "gradeLevel", ca.section,
                ca.assigned_at AS "assignedAt"
         FROM class_adviser_assignments ca
         JOIN school_users su ON su.school_id=ca.school_id AND su.user_id=ca.adviser_user_id
         WHERE ca.school_id=$1${teacherFilter}
         ORDER BY ca.grade_level, ca.section`, params
      );
      return res.json({ assignments: result.rows });
    } catch (err) {
      console.error('Class adviser assignments load failed:', err.message);
      return res.status(500).json({ error: 'Could not load class adviser assignments.' });
    }
  });

app.post('/api/class-adviser-assignments', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  const { adviserUserId, gradeLevel, section } = req.body || {};
  if (!isUuid(adviserUserId) || !validText(gradeLevel) || gradeLevel.trim().length > 40 ||
      !validText(section) || section.trim().length > 100) {
    return res.status(400).json({ error: 'Select an active Class Adviser and provide a valid grade and section.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO class_adviser_assignments(school_id, adviser_user_id, grade_level, section, assigned_by)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(school_id,grade_level,section) DO UPDATE
       SET adviser_user_id=EXCLUDED.adviser_user_id, assigned_by=EXCLUDED.assigned_by, assigned_at=NOW()
       RETURNING assignment_id AS "assignmentId", adviser_user_id AS "adviserUserId",
                 grade_level AS "gradeLevel", section`,
      [req.auth.schoolId, adviserUserId, gradeLevel.trim(), section.trim(), req.auth.userId]
    );
    await pool.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_ASSIGN_CLASS_ADVISER','class_adviser_assignment',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, result.rows[0].assignmentId,
       JSON.stringify({ adviserUserId, gradeLevel: gradeLevel.trim(), section: section.trim() })]
    );
    return res.status(201).json({ assignment: result.rows[0] });
  } catch (err) {
    if (err.code === '23514') return res.status(400).json({ error: err.message });
    console.error('Class adviser assignment failed:', err.message);
    return res.status(500).json({ error: 'Could not assign the Class Adviser.' });
  }
});

app.delete('/api/class-adviser-assignments/:assignmentId', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  if (!isUuid(req.params.assignmentId)) return res.status(400).json({ error: 'Invalid class adviser assignment ID.' });
  try {
    const result = await pool.query(
      `DELETE FROM class_adviser_assignments
       WHERE school_id=$1 AND assignment_id=$2
       RETURNING grade_level, section, adviser_user_id`, [req.auth.schoolId, req.params.assignmentId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Class adviser assignment not found.' });
    await pool.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_UNASSIGN_CLASS_ADVISER','class_adviser_assignment',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, req.params.assignmentId, JSON.stringify(result.rows[0])]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('Class adviser unassignment failed:', err.message);
    return res.status(500).json({ error: 'Could not remove the Class Adviser assignment.' });
  }
});

app.patch('/api/teachers/:userId/designations', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  if (!isUuid(req.params.userId)) return res.status(400).json({ error: 'Invalid teacher account ID.' });
  const incoming = req.body?.teacherDesignations;
  if (!Array.isArray(incoming)) return res.status(400).json({ error: 'Provide teacherDesignations as an array.' });
  const designations = [...new Set(incoming.map(value => String(value).toUpperCase()))];
  if (!designations.length || designations.some(value => !['CLASS_ADVISER', 'SUBJECT_TEACHER'].includes(value))) {
    return res.status(400).json({ error: 'Select Subject Teacher, Class Adviser, or both.' });
  }
  try {
    if (!designations.includes('CLASS_ADVISER')) {
      const assigned = await pool.query(
        'SELECT 1 FROM class_adviser_assignments WHERE school_id=$1 AND adviser_user_id=$2 LIMIT 1',
        [req.auth.schoolId, req.params.userId]
      );
      if (assigned.rowCount) return res.status(409).json({ error: 'Remove this teacher\'s Class Adviser section assignments before removing the designation.' });
    }
    const updated = await pool.query(
      `UPDATE school_users SET teacher_designations=$3, updated_at=NOW()
       WHERE school_id=$1 AND user_id=$2 AND role='TEACHER'
       RETURNING user_id AS "userId", teacher_designations AS "teacherDesignations"`,
      [req.auth.schoolId, req.params.userId, designations]
    );
    if (!updated.rowCount) return res.status(404).json({ error: 'Teacher account not found in this school.' });
    await pool.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_UPDATE_TEACHER_DESIGNATIONS','school_user',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, req.params.userId, JSON.stringify({ teacherDesignations: designations })]
    );
    return res.json({ teacher: updated.rows[0] });
  } catch (err) {
    if (err.code === '23514') return res.status(409).json({ error: err.message });
    console.error('Teacher designation update failed:', err.message);
    return res.status(500).json({ error: 'Could not update teacher designations.' });
  }
});

app.post('/api/teachers', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  const { username, displayName, password } = req.body || {};
  const teacherDesignations = Array.isArray(req.body?.teacherDesignations) ? [...new Set(req.body.teacherDesignations.map(value => String(value).toUpperCase()))] : ['SUBJECT_TEACHER'];
  if (!teacherDesignations.length || teacherDesignations.some(value => !['CLASS_ADVISER', 'SUBJECT_TEACHER'].includes(value))) {
    return res.status(400).json({ error: 'Select Subject Teacher, Class Adviser, or both.' });
  }
  if (!validText(username) || username.trim().length > 80 ||
      !validText(displayName) || displayName.trim().length > 160 ||
      typeof password !== 'string' || password.length < 12 || password.length > 256) {
    return res.status(400).json({ error: 'Provide a username (1â€“80 characters), display name (1â€“160 characters), and password (12â€“256 characters).' });
  }
  let passwordHash;
  try {
    passwordHash = await hashPassword(password);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Password does not meet requirements.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await client.query(
      `INSERT INTO school_users (school_id, username, display_name, password_hash, role, teacher_designations, teacher_qr_token)
       VALUES ($1,$2,$3,$4,'TEACHER',$5,gen_random_uuid())
       RETURNING user_id AS "userId", username, display_name AS "displayName", teacher_designations AS "teacherDesignations", active, created_at AS "createdAt"`,
      [req.auth.schoolId, username.trim(), displayName.trim(), passwordHash, teacherDesignations]
    );
    const teacher = created.rows[0];
    await client.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_CREATE_TEACHER','school_user',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, teacher.userId,
       JSON.stringify({ username: teacher.username, role: 'TEACHER' })]
    );
    await client.query('COMMIT');
    return res.status(201).json({ teacher });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'That username is already used by an account in this school.' });
    console.error('Teacher creation failed:', err.message);
    return res.status(500).json({ error: 'Could not create teacher account.' });
  } finally {
    client.release();
  }
});

app.patch('/api/teachers/:userId', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  if (!isUuid(req.params.userId)) return res.status(400).json({ error: 'Invalid teacher account ID.' });
  const { active, displayName } = req.body || {};
  if (typeof active !== 'boolean' && !(typeof displayName === 'string' && displayName.trim().length > 0 && displayName.trim().length <= 160)) {
    return res.status(400).json({ error: 'Provide a valid active value or display name.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE school_users
       SET active=COALESCE($3,active),
           teacher_status=CASE
             WHEN $3 IS FALSE THEN 'INACTIVE'
             WHEN $3 IS TRUE THEN 'ACTIVE'
             ELSE teacher_status
           END,
           leave_type=CASE WHEN $3 IS NOT NULL THEN NULL ELSE leave_type END,
           leave_start_date=CASE WHEN $3 IS NOT NULL THEN NULL ELSE leave_start_date END,
           expected_return_date=CASE WHEN $3 IS NOT NULL THEN NULL ELSE expected_return_date END,
           leave_auto_reactivate=CASE WHEN $3 IS NOT NULL THEN TRUE ELSE leave_auto_reactivate END,
           display_name=COALESCE($4,display_name),
           updated_at=NOW(),
           session_version=CASE WHEN $3 IS FALSE THEN session_version+1 ELSE session_version END
       WHERE school_id=$1 AND user_id=$2 AND role='TEACHER'
       RETURNING user_id AS "userId", username, display_name AS "displayName",
                 active, teacher_status AS "teacherStatus"`,
      [req.auth.schoolId, req.params.userId,
       typeof active === 'boolean' ? active : null,
       typeof displayName === 'string' ? displayName.trim() : null]
    );
    if (!updated.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Teacher account not found in this school.' });
    }
    if (active === false) {
      await client.query(
        `UPDATE user_sessions SET revoked_at=NOW()
         WHERE principal_type='SCHOOL' AND school_id=$1 AND school_user_id=$2 AND revoked_at IS NULL`,
        [req.auth.schoolId, req.params.userId]
      );
    }
    await client.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_UPDATE_TEACHER','school_user',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, req.params.userId,
       JSON.stringify({ active: typeof active === 'boolean' ? active : undefined,
                        displayName: typeof displayName === 'string' ? displayName.trim() : undefined })]
    );
    await client.query('COMMIT');
    return res.json({ teacher: updated.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Teacher update failed:', err.message);
    return res.status(500).json({ error: 'Could not update teacher account.' });
  } finally {
    client.release();
  }
});


// Put a teacher on temporary leave without deleting their account or schedule assignments.
app.post('/api/teachers/:userId/leave', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  if (!isUuid(req.params.userId)) return res.status(400).json({ error: 'Invalid teacher account ID.' });
  const { leaveType, startDate, expectedReturnDate, autoReactivate = true } = req.body || {};
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  const allowedTypes = ['MATERNITY', 'SICK', 'VACATION', 'PERSONAL', 'OTHER'];
  if (!allowedTypes.includes(leaveType) || !validDate(startDate) ||
      !validDate(expectedReturnDate) || expectedReturnDate < startDate ||
      typeof autoReactivate !== 'boolean') {
    return res.status(400).json({ error: 'Provide a valid leave type, start date, expected return date, and automatic return preference.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE school_users
       SET active=FALSE, teacher_status='ON_LEAVE', leave_type=$3,
           leave_start_date=$4::date, expected_return_date=$5::date,
           leave_auto_reactivate=$6, session_version=session_version+1, updated_at=NOW()
       WHERE school_id=$1 AND user_id=$2 AND role='TEACHER'
       RETURNING user_id AS "userId", username, display_name AS "displayName",
                 active, teacher_status AS "teacherStatus", leave_type AS "leaveType",
                 leave_start_date AS "leaveStartDate", expected_return_date AS "expectedReturnDate",
                 leave_auto_reactivate AS "leaveAutoReactivate"`,
      [req.auth.schoolId, req.params.userId, leaveType, startDate, expectedReturnDate, autoReactivate]
    );
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Teacher account not found in this school.' });
    }
    await client.query(
      `UPDATE user_sessions SET revoked_at=NOW()
       WHERE principal_type='SCHOOL' AND school_id=$1 AND school_user_id=$2 AND revoked_at IS NULL`,
      [req.auth.schoolId, req.params.userId]
    );
    await client.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_PLACE_TEACHER_ON_LEAVE','school_user',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, req.params.userId,
       JSON.stringify({ leaveType, startDate, expectedReturnDate, autoReactivate })]
    );
    await client.query('COMMIT');
    return res.json({ teacher: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Teacher leave update failed:', err.message);
    return res.status(500).json({ error: 'Could not place teacher on leave.' });
  } finally {
    client.release();
  }
});

// Manual early/late return from leave, or manual reactivation of an inactive teacher.
app.post('/api/teachers/:userId/return', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  if (!isUuid(req.params.userId)) return res.status(400).json({ error: 'Invalid teacher account ID.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE school_users
       SET active=TRUE, teacher_status='ACTIVE', leave_type=NULL,
           leave_start_date=NULL, expected_return_date=NULL,
           leave_auto_reactivate=TRUE, updated_at=NOW()
       WHERE school_id=$1 AND user_id=$2 AND role='TEACHER'
       RETURNING user_id AS "userId", username, display_name AS "displayName",
                 active, teacher_status AS "teacherStatus"`,
      [req.auth.schoolId, req.params.userId]
    );
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Teacher account not found in this school.' });
    }
    const endedCovers = await client.query(
      `UPDATE teacher_period_substitutions
       SET status='CANCELLED', cancelled_at=NOW(), updated_at=NOW()
       WHERE school_id=$1 AND original_teacher_user_id=$2 AND status='ACTIVE'
       RETURNING substitution_id, period_id, substitute_teacher_user_id`,
      [req.auth.schoolId, req.params.userId]
    );
    for (const cover of endedCovers.rows) {
      await client.query(
        `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
         VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_END_COVER_ON_TEACHER_RETURN','teacher_period_substitution',$3,$4::jsonb)`,
        [req.auth.schoolId, req.auth.userId, cover.substitution_id,
         JSON.stringify({ periodId: cover.period_id, substituteTeacherUserId: cover.substitute_teacher_user_id, reason: 'Original teacher returned' })]
      );
    }
    await client.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_RETURN_TEACHER','school_user',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, req.params.userId,
       JSON.stringify({ endedTemporaryCovers: endedCovers.rowCount })]
    );
    await client.query('COMMIT');
    return res.json({ teacher: result.rows[0], endedTemporaryCovers: endedCovers.rowCount });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Teacher return failed:', err.message);
    return res.status(500).json({ error: 'Could not reactivate teacher account.' });
  } finally {
    client.release();
  }
});

// Create a date-limited substitute cover. The original teacher's permanent assignment is never changed.
app.post('/api/teachers/:userId/substitutions', authenticateSchoolClient, requireSchoolAdminOrDepartmentHead, async (req, res) => {
  if (!isUuid(req.params.userId)) return res.status(400).json({ error: 'Invalid original teacher account ID.' });
  const { substituteTeacherUserId, periodId, startDate, endDate } = req.body || {};
  if (!isUuid(substituteTeacherUserId) || !isUuid(periodId) ||
      !isValidSchoolDate(startDate) || !isValidSchoolDate(endDate) || endDate < startDate ||
      String(req.params.userId) === String(substituteTeacherUserId)) {
    return res.status(400).json({ error: 'Select a substitute teacher, class schedule, and valid coverage dates.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const original = await client.query(
      `SELECT user_id, display_name, teacher_status, active,
              to_char(leave_start_date, 'YYYY-MM-DD') AS leave_start_date,
              to_char(expected_return_date, 'YYYY-MM-DD') AS expected_return_date,
              leave_auto_reactivate
       FROM school_users
       WHERE school_id=$1 AND user_id=$2 AND role='TEACHER'
       FOR UPDATE`,
      [req.auth.schoolId, req.params.userId]
    );
    if (!original.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Original teacher was not found in this school.' });
    }
    const absent = original.rows[0];
    if (absent.active || absent.teacher_status !== 'ON_LEAVE' ||
        !absent.leave_start_date || !absent.expected_return_date ||
        startDate < absent.leave_start_date || endDate > absent.expected_return_date ||
        (absent.leave_auto_reactivate && endDate >= absent.expected_return_date)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Coverage dates must fall within this teacherâ€™s saved leave period.' });
    }
    const permanentAssignment = await client.query(
      `SELECT 1 FROM teacher_period_assignments
       WHERE school_id=$1 AND teacher_user_id=$2 AND period_id=$3`,
      [req.auth.schoolId, req.params.userId, periodId]
    );
    if (!permanentAssignment.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'The selected class schedule is not permanently assigned to the teacher on leave.' });
    }
    const substitute = await client.query(
      `SELECT user_id, username, display_name FROM school_users
       WHERE school_id=$1 AND user_id=$2 AND role='TEACHER' AND active=TRUE
         AND COALESCE(teacher_status, 'ACTIVE')='ACTIVE'
       FOR UPDATE`,
      [req.auth.schoolId, substituteTeacherUserId]
    );
    if (!substitute.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'The substitute must be an active teacher in this school.' });
    }
    const period = await client.query(
      `SELECT period_id, period_name, subject_name, grade_level, section, start_time, end_time
       FROM class_periods WHERE school_id=$1 AND period_id=$2 AND active=TRUE`,
      [req.auth.schoolId, periodId]
    );
    if (!period.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'The selected class schedule is not active.' });
    }
    const alreadyPermanent = await client.query(
      `SELECT 1 FROM teacher_period_assignments
       WHERE school_id=$1 AND teacher_user_id=$2 AND period_id=$3`,
      [req.auth.schoolId, substituteTeacherUserId, periodId]
    );
    if (alreadyPermanent.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This teacher already has a permanent assignment to that class schedule.' });
    }
    const overlap = await client.query(
      `SELECT 1
       FROM teacher_period_substitutions existing
       JOIN class_periods existing_period
         ON existing_period.school_id=existing.school_id AND existing_period.period_id=existing.period_id
       WHERE existing.school_id=$1 AND existing.status='ACTIVE'
         AND daterange(existing.start_date, existing.end_date, '[]') && daterange($4::date, $5::date, '[]')
         AND (
           (existing.period_id=$3 AND existing.original_teacher_user_id=$2)
           OR (existing.substitute_teacher_user_id=$6
               AND existing_period.start_time < $8::time AND $7::time < existing_period.end_time)
           OR EXISTS (
             SELECT 1 FROM teacher_period_assignments permanent
             JOIN class_periods permanent_period
               ON permanent_period.school_id=permanent.school_id AND permanent_period.period_id=permanent.period_id
             WHERE permanent.school_id=$1 AND permanent.teacher_user_id=$6
               AND permanent.period_id <> $3 AND permanent_period.active=TRUE
               AND permanent_period.start_time < $8::time AND $7::time < permanent_period.end_time
           )
         )
       LIMIT 1`,
      [req.auth.schoolId, req.params.userId, periodId, startDate, endDate,
       substituteTeacherUserId, period.rows[0].start_time, period.rows[0].end_time]
    );
    if (overlap.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'The selected teacher already has an overlapping substitute assignment for this time period.' });
    }
    const inserted = await client.query(
      `INSERT INTO teacher_period_substitutions
         (school_id, period_id, original_teacher_user_id, substitute_teacher_user_id,
          start_date, end_date, created_by_user_id)
       VALUES($1,$2,$3,$4,$5::date,$6::date,$7)
       RETURNING substitution_id AS "substitutionId",
                 to_char(start_date,'YYYY-MM-DD') AS "startDate",
                 to_char(end_date,'YYYY-MM-DD') AS "endDate"`,
      [req.auth.schoolId, periodId, req.params.userId, substituteTeacherUserId,
       startDate, endDate, req.auth.userId]
    );
    await client.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_OR_DEPARTMENT_HEAD_ASSIGN_TEMPORARY_SUBSTITUTE','teacher_period_substitution',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, inserted.rows[0].substitutionId,
       JSON.stringify({ originalTeacher: absent.display_name,
         substituteTeacher: substitute.rows[0].display_name,
         periodName: period.rows[0].period_name, startDate, endDate })]
    );
    await client.query('COMMIT');
    return res.status(201).json({
      ok: true,
      substitution: {
        ...inserted.rows[0], periodId,
        periodName: period.rows[0].period_name,
        substituteTeacherName: substitute.rows[0].display_name
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Temporary teacher substitution failed:', err.message);
    return res.status(500).json({ error: 'Could not assign the temporary substitute.' });
  } finally {
    client.release();
  }
});

// Cancel future/current coverage while retaining the audit record and the original assignment.
app.delete('/api/teacher-substitutions/:substitutionId', authenticateSchoolClient, requireSchoolAdminOrDepartmentHead, async (req, res) => {
  if (!isUuid(req.params.substitutionId)) return res.status(400).json({ error: 'Invalid substitution ID.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cancelled = await client.query(
      `UPDATE teacher_period_substitutions
       SET status='CANCELLED', cancelled_at=NOW(), updated_at=NOW()
       WHERE school_id=$1 AND substitution_id=$2 AND status='ACTIVE'
       RETURNING substitution_id, period_id, original_teacher_user_id, substitute_teacher_user_id,
                 to_char(start_date,'YYYY-MM-DD') AS start_date,
                 to_char(end_date,'YYYY-MM-DD') AS end_date`,
      [req.auth.schoolId, req.params.substitutionId]
    );
    if (!cancelled.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Active substitute assignment was not found.' });
    }
    await client.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_OR_DEPARTMENT_HEAD_CANCEL_TEMPORARY_SUBSTITUTE','teacher_period_substitution',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, req.params.substitutionId,
       JSON.stringify({ periodId: cancelled.rows[0].period_id,
         startDate: cancelled.rows[0].start_date, endDate: cancelled.rows[0].end_date })]
    );
    await client.query('COMMIT');
    return res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Temporary substitute cancellation failed:', err.message);
    return res.status(500).json({ error: 'Could not cancel the substitute assignment.' });
  } finally {
    client.release();
  }
});

app.post('/api/periods/:periodId/assignments', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  const { teacherUserId } = req.body || {};
  if (!isUuid(req.params.periodId) || !isUuid(teacherUserId)) {
    return res.status(400).json({ error: 'A valid schedule ID and teacher account ID are required.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const period = await client.query(
      `SELECT period_id, period_name FROM class_periods
       WHERE school_id=$1 AND period_id=$2 AND active=TRUE FOR UPDATE`,
      [req.auth.schoolId, req.params.periodId]
    );
    if (!period.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Active class schedule not found in this school.' });
    }
    const teacher = await client.query(
      `SELECT user_id, username, display_name FROM school_users
       WHERE school_id=$1 AND user_id=$2 AND role='TEACHER' AND active=TRUE
         AND 'SUBJECT_TEACHER'=ANY(teacher_designations)`,
      [req.auth.schoolId, teacherUserId]
    );
    if (!teacher.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Active teacher account not found in this school.' });
    }
    // A class schedule has one permanent owner. Use the temporary-substitute workflow
    // when the permanent teacher is away; never create a second permanent owner.
    const existingOwner = await client.query(
      `SELECT su.display_name
       FROM teacher_period_assignments a
       JOIN school_users su ON su.school_id=a.school_id AND su.user_id=a.teacher_user_id
       WHERE a.school_id=$1 AND a.period_id=$2 AND a.teacher_user_id<>$3
       LIMIT 1`,
      [req.auth.schoolId, req.params.periodId, teacherUserId]
    );
    if (existingOwner.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `This schedule already has a permanent teacher (${existingOwner.rows[0].display_name}). Use temporary substitute coverage from that teacherâ€™s On Leave row instead.`
      });
    }
    const assignment = await client.query(
      `INSERT INTO teacher_period_assignments(school_id, teacher_user_id, period_id)
       VALUES($1,$2,$3)
       ON CONFLICT(school_id,teacher_user_id,period_id) DO NOTHING
       RETURNING assignment_id`,
      [req.auth.schoolId, teacherUserId, req.params.periodId]
    );
    await client.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_ASSIGN_TEACHER_PERIOD','teacher_period_assignment',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, `${teacherUserId}:${req.params.periodId}`,
       JSON.stringify({ teacherUsername: teacher.rows[0].username, periodName: period.rows[0].period_name })]
    );
    await client.query('COMMIT');
    return res.status(201).json({
      ok: true,
      alreadyAssigned: assignment.rowCount === 0,
      teacher: { userId: teacher.rows[0].user_id, username: teacher.rows[0].username, displayName: teacher.rows[0].display_name },
      period: { periodId: period.rows[0].period_id, periodName: period.rows[0].period_name }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Teacher schedule assignment failed:', err.message);
    return res.status(500).json({ error: 'Could not assign teacher to schedule.' });
  } finally {
    client.release();
  }
});

app.delete('/api/periods/:periodId/assignments/:teacherUserId', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  if (!isUuid(req.params.periodId) || !isUuid(req.params.teacherUserId)) {
    return res.status(400).json({ error: 'Invalid schedule or teacher account ID.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const activeCover = await client.query(
      `SELECT 1 FROM teacher_period_substitutions
       WHERE school_id=$1 AND period_id=$2 AND original_teacher_user_id=$3
         AND status='ACTIVE' AND end_date >= (NOW() AT TIME ZONE 'Asia/Manila')::date
       LIMIT 1`,
      [req.auth.schoolId, req.params.periodId, req.params.teacherUserId]
    );
    if (activeCover.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This permanent assignment has temporary coverage. End the substitute cover before removing the original assignment.' });
    }
    const removed = await client.query(
      `DELETE FROM teacher_period_assignments a
       USING class_periods p, school_users su
       WHERE a.school_id=$1 AND a.period_id=$2 AND a.teacher_user_id=$3
         AND p.school_id=a.school_id AND p.period_id=a.period_id
         AND su.school_id=a.school_id AND su.user_id=a.teacher_user_id AND su.role='TEACHER'
       RETURNING a.assignment_id`,
      [req.auth.schoolId, req.params.periodId, req.params.teacherUserId]
    );
    if (!removed.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Teacher assignment not found in this school.' });
    }
    await client.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_UNASSIGN_TEACHER_PERIOD','teacher_period_assignment',$3,'{}'::jsonb)`,
      [req.auth.schoolId, req.auth.userId, `${req.params.teacherUserId}:${req.params.periodId}`]
    );
    await client.query('COMMIT');
    return res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Teacher schedule unassignment failed:', err.message);
    return res.status(500).json({ error: 'Could not remove teacher assignment.' });
  } finally {
    client.release();
  }
});

const TEACHER_STUDENT_SCOPE = `
  (
    EXISTS (
      SELECT 1
      FROM teacher_period_assignments a
      JOIN class_periods p
        ON p.school_id = a.school_id AND p.period_id = a.period_id AND p.active = TRUE
      WHERE a.school_id = s.school_id
        AND a.teacher_user_id = $2
        AND p.grade_level = COALESCE((SELECT en.grade_level FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1),s.grade_level)
        AND (p.section IS NULL OR p.section = COALESCE((SELECT en.section FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1),s.section))
    )
    OR EXISTS (
      SELECT 1
      FROM class_adviser_assignments ca
      WHERE ca.school_id=s.school_id
        AND ca.adviser_user_id=$2
        AND ca.grade_level=COALESCE((SELECT en.grade_level FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1),s.grade_level)
        AND ca.section=COALESCE((SELECT en.section FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1),s.section)
    )
    OR EXISTS (
      SELECT 1
      FROM teacher_period_substitutions ts
      JOIN class_periods sp
        ON sp.school_id=ts.school_id AND sp.period_id=ts.period_id AND sp.active=TRUE
      WHERE ts.school_id=s.school_id
        AND ts.substitute_teacher_user_id=$2
        AND ts.status='ACTIVE'
        AND (NOW() AT TIME ZONE 'Asia/Manila')::date BETWEEN ts.start_date AND ts.end_date
        AND sp.grade_level=COALESCE((SELECT en.grade_level FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1),s.grade_level)
        AND (sp.section IS NULL OR sp.section=COALESCE((SELECT en.section FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1),s.section))
    )
  )`;

async function isTeacherAssigned(client, schoolId, teacherId, periodId, schoolDate, occurredAt) {
  const result = await client.query(
    `SELECT 1
     WHERE EXISTS (
       SELECT 1 FROM teacher_period_assignments
       WHERE school_id=$1 AND teacher_user_id=$2 AND period_id=$3
     )
     OR EXISTS (
       SELECT 1 FROM teacher_period_substitutions ts
       WHERE ts.school_id=$1 AND ts.substitute_teacher_user_id=$2 AND ts.period_id=$3
         AND $4::date BETWEEN ts.start_date AND ts.end_date
         AND (
           ts.status='ACTIVE'
           OR (ts.status='CANCELLED' AND ts.cancelled_at IS NOT NULL AND $5::timestamptz <= ts.cancelled_at)
         )
     )`,
    [schoolId, teacherId, periodId, schoolDate, occurredAt]
  );
  return result.rowCount > 0;
}

function localTimeHHMM(iso) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(new Date(iso));
}
function isLateForPeriod(iso, period) {
  const [h, m] = localTimeHHMM(iso).split(':').map(Number);
  const [sh, sm] = String(period.start_time).slice(0, 5).split(':').map(Number);
  return (h * 60 + m) > (sh * 60 + sm + Number(period.grace_minutes || 0));
}
function isValidSchoolDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'school-attendance-api', build: 'roles-sf2-workflow-responsive-2026-11-11', security: 'session-and-school-device-auth' }));

// Grade-to-section options for student registration. Sections are derived from active class schedules.
app.get('/api/sections', authenticateSchoolClient, requireSchoolUser, async (req, res) => {
  const gradeLevel = typeof req.query.gradeLevel === 'string' ? req.query.gradeLevel.trim() : '';
  if (!gradeLevel || gradeLevel.length > 40) return res.status(400).json({ error: 'Select a valid grade level.' });
  try {
    const params = [req.auth.schoolId, gradeLevel];
    let teacherSections = '';
    if (req.auth.role === 'TEACHER') {
      params.push(req.auth.userId);
      teacherSections = `
        SELECT TRIM(p.section) AS section
        FROM class_periods p
        WHERE p.school_id=$1 AND p.grade_level=$2 AND p.active=TRUE
          AND p.section IS NOT NULL AND TRIM(p.section) <> ''
          AND (
            EXISTS (SELECT 1 FROM teacher_period_assignments a
                    WHERE a.school_id=p.school_id AND a.period_id=p.period_id AND a.teacher_user_id=$3)
            OR EXISTS (SELECT 1 FROM teacher_period_substitutions ts
                       WHERE ts.school_id=p.school_id AND ts.period_id=p.period_id
                         AND ts.substitute_teacher_user_id=$3 AND ts.status='ACTIVE'
                         AND (NOW() AT TIME ZONE 'Asia/Manila')::date BETWEEN ts.start_date AND ts.end_date)
          )
        UNION
        SELECT ca.section
        FROM class_adviser_assignments ca
        WHERE ca.school_id=$1 AND ca.grade_level=$2 AND ca.adviser_user_id=$3`;
    } else {
      teacherSections = `SELECT TRIM(p.section) AS section FROM class_periods p
        WHERE p.school_id=$1 AND p.grade_level=$2 AND p.active=TRUE
          AND p.section IS NOT NULL AND TRIM(p.section) <> ''`;
    }
    const result = await pool.query(`SELECT DISTINCT section FROM (${teacherSections}) available_sections ORDER BY section`, params);
    return res.json({ sections: result.rows.map(row => row.section) });
  } catch (err) {
    console.error('Section options failed:', err.message);
    return res.status(500).json({ error: 'Could not load sections.' });
  }
});
// Gate Keeper lookup resolves only the QR token presented at the entrance; it never downloads the full learner roster.
app.post('/api/gate/lookup', authenticateSchoolClient, requireSchoolRoles('GATE_KEEPER'), async (req, res) => {
  const qrToken = String(req.body?.qrToken || '').trim();
  if (!isUuid(qrToken)) return res.status(400).json({ error: 'A valid student QR token is required.' });
  try {
    const result = await pool.query(
      `SELECT student_id AS "studentId", full_name AS "fullName",
              grade_level AS "gradeLevel", section, qr_token AS "qrToken",
              (photo_path IS NOT NULL) AS "hasPhoto"
       FROM students WHERE school_id=$1 AND qr_token=$2 AND active=TRUE LIMIT 1`,
      [req.auth.schoolId, qrToken]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'QR code not found or learner is inactive.' });
    const student = result.rows[0];
    if (!student.hasPhoto) return res.status(409).json({ error: 'No registered learner photo is available. Ask the School Administrator to upload a photo before recording gate attendance.' });
    return res.json({ student: {
      studentId: student.studentId, fullName: student.fullName,
      gradeLevel: student.gradeLevel, section: student.section,
      qrToken: student.qrToken,
      photoUrl: `/api/gate/photo/${encodeURIComponent(qrToken)}`
    }});
  } catch (err) {
    console.error('Gate QR lookup failed:', err.message);
    return res.status(500).json({ error: 'Could not verify this student QR code.' });
  }
});

app.get('/api/gate/photo/:qrToken', authenticateSchoolClient, requireSchoolRoles('GATE_KEEPER'), async (req, res) => {
  const qrToken = String(req.params.qrToken || '').trim();
  if (!isUuid(qrToken)) return res.status(404).end();
  try {
    const result = await pool.query(
      `SELECT photo_path FROM students
       WHERE school_id=$1 AND qr_token=$2 AND active=TRUE`,
      [req.auth.schoolId, qrToken]
    );
    if (!result.rowCount || !result.rows[0].photo_path) return res.status(404).end();
    const relative = result.rows[0].photo_path;
    const absolute = path.resolve(STUDENT_PHOTO_ROOT, relative);
    if (!absolute.startsWith(STUDENT_PHOTO_ROOT + path.sep)) return res.status(404).end();
    await fsp.access(absolute, fs.constants.R_OK);
    const ext = path.extname(absolute).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : null;
    if (!mime) return res.status(404).end();
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.setHeader('Content-Disposition', 'inline');
    return fs.createReadStream(absolute).pipe(res);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Gate photo retrieval failed:', err.message);
    return res.status(404).end();
  }
});

// Gate Keeper teacher lookup is token-based; it never exposes a downloadable staff roster.
app.post('/api/gate/teacher-lookup', authenticateSchoolClient, requireSchoolRoles('GATE_KEEPER'), async (req, res) => {
  const qrToken = String(req.body?.qrToken || '').trim();
  if (!isUuid(qrToken)) return res.status(400).json({ error: 'A valid teacher QR token is required.' });
  try {
    const result = await pool.query(
      `SELECT user_id AS "userId", username, display_name AS "fullName",
              teacher_designations AS "teacherDesignations", teacher_status AS "teacherStatus",
              (teacher_photo_path IS NOT NULL) AS "hasPhoto"
       FROM school_users
       WHERE school_id=$1 AND teacher_qr_token=$2 AND role='TEACHER' AND active=TRUE LIMIT 1`,
      [req.auth.schoolId, qrToken]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Teacher QR code not found or account is inactive.' });
    const teacher = result.rows[0];
    if (!teacher.hasPhoto) return res.status(409).json({ error: 'No registered teacher photo is available. Ask the School Administrator to upload a photo before recording teacher gate attendance.' });
    return res.json({ teacher: {
      userId: teacher.userId, username: teacher.username, fullName: teacher.fullName,
      teacherDesignations: teacher.teacherDesignations || [], teacherStatus: teacher.teacherStatus,
      photoUrl: `/api/gate/teacher/photo/${encodeURIComponent(qrToken)}`
    }});
  } catch (err) {
    console.error('Gate teacher QR lookup failed:', err.message);
    return res.status(500).json({ error: 'Could not verify this teacher QR code.' });
  }
});

app.get('/api/gate/teacher/photo/:qrToken', authenticateSchoolClient, requireSchoolRoles('GATE_KEEPER'), async (req, res) => {
  const qrToken = String(req.params.qrToken || '').trim();
  if (!isUuid(qrToken)) return res.status(404).end();
  try {
    const result = await pool.query(
      `SELECT teacher_photo_path FROM school_users
       WHERE school_id=$1 AND teacher_qr_token=$2 AND role='TEACHER' AND active=TRUE`,
      [req.auth.schoolId, qrToken]
    );
    if (!result.rowCount || !result.rows[0].teacher_photo_path) return res.status(404).end();
    const absolute = path.resolve(TEACHER_PHOTO_ROOT, result.rows[0].teacher_photo_path);
    if (!absolute.startsWith(TEACHER_PHOTO_ROOT + path.sep)) return res.status(404).end();
    await fsp.access(absolute, fs.constants.R_OK);
    const ext = path.extname(absolute).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : null;
    if (!mime) return res.status(404).end();
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.setHeader('Content-Disposition', 'inline');
    return fs.createReadStream(absolute).pipe(res);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Teacher gate photo retrieval failed:', err.message);
    return res.status(404).end();
  }
});

app.post('/api/gate/teacher-events', authenticateSchoolClient, requireSchoolRoles('GATE_KEEPER'), async (req, res) => {
  const teacherUserId = String(req.body?.teacherUserId || '').trim();
  const eventType = String(req.body?.eventType || '').toUpperCase();
  const occurredAt = req.body?.occurredAt;
  const schoolDate = req.body?.schoolDate;
  if (!isUuid(teacherUserId) || !['TIME_IN','TIME_OUT'].includes(eventType) ||
      !Number.isFinite(Date.parse(occurredAt)) || !isValidSchoolDate(schoolDate) ||
      req.body?.photoVerified !== true) {
    return res.status(400).json({ error: 'A verified teacher photo, valid time-in/time-out action, timestamp, and school date are required.' });
  }
  const manilaDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(occurredAt));
  if (manilaDate !== schoolDate) return res.status(400).json({ error: 'The selected school date does not match the scan time in Asia/Manila.' });
  try {
    const teacher = await pool.query(
      `SELECT display_name FROM school_users
       WHERE school_id=$1 AND user_id=$2 AND role='TEACHER' AND active=TRUE AND teacher_photo_path IS NOT NULL`,
      [req.auth.schoolId, teacherUserId]
    );
    if (!teacher.rowCount) return res.status(404).json({ error: 'Active teacher or registered teacher photo not found.' });
    if (eventType === 'TIME_OUT') {
      const timeIn = await pool.query(
        `SELECT occurred_at FROM teacher_gate_events
         WHERE school_id=$1 AND teacher_user_id=$2 AND school_date=$3::date AND event_type='TIME_IN'`,
        [req.auth.schoolId, teacherUserId, schoolDate]
      );
      if (!timeIn.rowCount) return res.status(409).json({ error: 'Record the teacher time-in before recording time-out.' });
      if (new Date(occurredAt) <= new Date(timeIn.rows[0].occurred_at)) return res.status(400).json({ error: 'Time-out must be later than the recorded time-in.' });
    }
    const saved = await pool.query(
      `INSERT INTO teacher_gate_events(school_id, teacher_user_id, event_type, occurred_at, school_date, recorded_by_user_id, photo_verified)
       VALUES($1,$2,$3,$4,$5::date,$6,TRUE)
       ON CONFLICT (school_id, teacher_user_id, school_date, event_type) DO NOTHING
       RETURNING event_id AS "eventId", event_type AS "eventType", occurred_at AS "occurredAt"`,
      [req.auth.schoolId, teacherUserId, eventType, occurredAt, schoolDate, req.auth.userId]
    );
    if (!saved.rowCount) return res.status(409).json({ error: `Teacher ${eventType.replace('_',' ').toLowerCase()} has already been recorded for this date.` });
    await pool.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,'GATE_KEEPER_RECORD_TEACHER_ATTENDANCE','teacher_gate_event',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, saved.rows[0].eventId, JSON.stringify({ teacherUserId, eventType, schoolDate })]
    ).catch(err => console.error('Teacher gate audit log failed:', err.message));
    return res.status(201).json({ event: saved.rows[0], teacherName: teacher.rows[0].display_name });
  } catch (err) {
    console.error('Teacher gate event failed:', err.message);
    return res.status(500).json({ error: 'Could not record teacher gate attendance.' });
  }
});

// Roster: school-scoped for all principals; teacher results are limited to their assigned grade/sections.
// Device clients receive only the fields needed for offline QR matching (no parent contact data).
app.get('/api/students', authenticateSchoolClient, requireSchoolClient, requireSchoolPermission('students.view.all'), async (req, res) => {
  if (req.auth.type === 'SCHOOL_USER' && !['SCHOOL_ADMIN', 'TEACHER'].includes(req.auth.role)) {
    return res.status(403).json({ error: 'Parent accounts may only access their approved linked children.' });
  }
  try {
    const params = [req.auth.schoolId];
    let scope = '';
    if (req.auth.type === 'SCHOOL_USER' && req.auth.role === 'TEACHER') {
      params.push(req.auth.userId);
      scope = ` AND ${TEACHER_STUDENT_SCOPE}`;
    }
    const includeParentFields = req.auth.type === 'SCHOOL_USER' && req.auth.role === 'SCHOOL_ADMIN';
    const isGateKeeper = req.auth.type === 'SCHOOL_USER' && req.auth.role === 'GATE_KEEPER';
    const canScanQr = req.auth.type === 'DEVICE' || req.auth.role === 'SCHOOL_ADMIN' ||
      (req.auth.role === 'TEACHER' && req.auth.teacherDesignations?.includes('SUBJECT_TEACHER'));
    if (isGateKeeper) return res.status(403).json({ error: 'Gate Keeper accounts use QR lookup only and cannot download the learner roster.' });
    const parentFields = includeParentFields
      ? ', s.lrn, s.parent_name AS "parentName", s.parent_mobile AS "parentMobile", sa.username AS "studentAccountUsername", sa.active AS "studentAccountActive", sa.must_change_password AS "studentMustChangePassword"'
      : '';
    const qrField = canScanQr ? ', s.qr_token AS "qrToken"' : '';
    const result = await pool.query(
      `SELECT s.student_id AS "studentId", s.full_name AS "fullName",
              COALESCE(active_enrollment.grade_level,s.grade_level) AS "gradeLevel", COALESCE(active_enrollment.section,s.section) AS section${qrField},
               (s.photo_path IS NOT NULL) AS "hasPhoto", s.updated_at AS "updatedAt"${parentFields}
       FROM students s
       LEFT JOIN LATERAL (SELECT en.grade_level,en.section FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1) active_enrollment ON TRUE
       ${includeParentFields ? 'LEFT JOIN student_accounts sa ON sa.school_id=s.school_id AND sa.student_id=s.student_id' : ''}
       WHERE s.school_id=$1 AND s.active=TRUE${scope}
       ORDER BY s.full_name`,
      params
    );
    res.json({ students: result.rows.map(student => ({
      ...student,
      photoUrl: student.hasPhoto ? `/api/students/${encodeURIComponent(student.studentId)}/photo?v=${encodeURIComponent(student.updatedAt?.toISOString?.() || student.updatedAt || '')}` : null
    })), fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Student roster failed:', err.message);
    res.status(500).json({ error: 'Could not load students.' });
  }
});

// School admins and teachers may add students for continuity when an administrator is unavailable.
// Teachers may add ONLY new students to a grade/section covered by one of their assigned periods.
// A teacher cannot use this endpoint to edit an existing student or move a learner between sections.
// The school ID is always derived from the authenticated session, never from the request body.
app.post('/api/students', authenticateSchoolClient, requireSchoolAdminOrTeacher, async (req, res) => {
  const { studentId, lrn, fullName, gradeLevel, section, parentName, parentMobile } = req.body || {};
  if (![studentId, fullName, gradeLevel, section, parentMobile].every(validText)) {
    return res.status(400).json({ error: 'Student ID, full name, grade, section, and parent mobile are required.' });
  }
  const isTeacher = req.auth.role === 'TEACHER';
  if (isTeacher && !req.auth.teacherDesignations?.includes('CLASS_ADVISER')) {
    return res.status(403).json({ error: 'Only a designated Class Adviser may register learners in an assigned section.' });
  }
  const cleanGrade = gradeLevel.trim();
  const cleanSection = section.trim();
  const cleanStudentId = studentId.trim();
  try {
    if (isTeacher) {
      const allowed = await pool.query(
        `SELECT EXISTS (
           SELECT 1 FROM class_adviser_assignments ca
           WHERE ca.school_id=$1 AND ca.adviser_user_id=$2
             AND ca.grade_level=$3 AND ca.section=$4
         ) AS allowed`,
        [req.auth.schoolId, req.auth.userId, cleanGrade, cleanSection]
      );
      if (!allowed.rows[0]?.allowed) {
        return res.status(403).json({ error: 'You may register learners only in a section assigned to you as Class Adviser.' });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const qrToken = require('crypto').randomUUID();
      // Teachers can create new records only. Admins retain the existing same-school upsert behavior.
      const conflictAction = isTeacher
        ? 'ON CONFLICT(student_id) DO NOTHING'
        : `ON CONFLICT(student_id) DO UPDATE SET
             lrn=EXCLUDED.lrn, full_name=EXCLUDED.full_name, grade_level=EXCLUDED.grade_level,
             section=EXCLUDED.section, parent_name=EXCLUDED.parent_name,
             parent_mobile=EXCLUDED.parent_mobile, active=TRUE, updated_at=NOW()
           WHERE students.school_id=EXCLUDED.school_id`;
      const result = await client.query(
        `INSERT INTO students(school_id, student_id, lrn, full_name, grade_level, section,
                             parent_name, parent_mobile, qr_token)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ${conflictAction}
         RETURNING student_id AS "studentId", full_name AS "fullName",
                   grade_level AS "gradeLevel", section, qr_token AS "qrToken"`,
        [req.auth.schoolId, cleanStudentId, lrn || null, fullName.trim(), cleanGrade,
         cleanSection, parentName || null, parentMobile.trim(), qrToken]
      );
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: isTeacher
          ? 'That student ID is already in use. Teachers cannot edit existing student records.'
          : 'That student ID is already used by another school.' });
      }
      if (isTeacher) {
        await client.query(
          `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
           VALUES($1,'SCHOOL',$2,'TEACHER_CREATE_STUDENT','student',$3,$4::jsonb)`,
          [req.auth.schoolId, req.auth.userId, cleanStudentId,
           JSON.stringify({ gradeLevel: cleanGrade, section: cleanSection })]
        );
      }
      await client.query('COMMIT');
      return res.status(201).json({ student: result.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Student save failed:', err.message);
    if (err.code === '23505') return res.status(409).json({ error: 'That LRN is already registered.' });
    return res.status(500).json({ error: 'Could not save student.' });
  }
});

// Student IDs and private QR tokens are stable. Teachers may edit only learners within their own assignment scope.
// Subject Teachers may correct the learner name only. Class Advisers may also correct grade/section within their assigned section.
app.patch('/api/students/:studentId', authenticateSchoolClient, requireSchoolAdminOrTeacher, async (req, res) => {
  const isTeacher = req.auth.role === 'TEACHER';
  const designations = Array.isArray(req.auth.teacherDesignations) ? req.auth.teacherDesignations : [];
  const isClassAdviser = isTeacher && designations.includes('CLASS_ADVISER');
  const isSubjectTeacher = isTeacher && designations.includes('SUBJECT_TEACHER');
  const { lrn, fullName, gradeLevel, section, parentName, parentMobile } = req.body || {};
  if (!validText(fullName) || fullName.trim().length > 200) {
    return res.status(400).json({ error: 'Provide a valid student full name.' });
  }
  if (!isTeacher && (!validText(gradeLevel) || gradeLevel.trim().length > 40 ||
      !validText(section) || section.trim().length > 100 ||
      !validText(parentMobile) || parentMobile.trim().length > 30 ||
      (lrn != null && (typeof lrn !== 'string' || lrn.trim().length > 30)) ||
      (parentName != null && (typeof parentName !== 'string' || parentName.trim().length > 160)))) {
    return res.status(400).json({ error: 'Provide valid student name, grade, section, and permitted student details.' });
  }
  if (isTeacher && !isClassAdviser && !isSubjectTeacher) {
    return res.status(403).json({ error: 'Your teacher account is not assigned to manage learner records.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (isTeacher) {
      const scoped = await client.query(
        `SELECT s.grade_level AS "gradeLevel", s.section,
                EXISTS (SELECT 1 FROM class_adviser_assignments ca
                        WHERE ca.school_id=s.school_id AND ca.adviser_user_id=$3
                          AND ca.grade_level=COALESCE((SELECT en.grade_level FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1),s.grade_level) AND ca.section=COALESCE((SELECT en.section FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1),s.section)) AS "isAdviserSection"
         FROM students s
         WHERE s.school_id=$1 AND s.student_id=$2 AND s.active=TRUE
           AND ${TEACHER_STUDENT_SCOPE.replace(/\$2/g, '$3')}`,
        [req.auth.schoolId, req.params.studentId, req.auth.userId]
      );
      if (!scoped.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Student not found in your assigned subject classes or advisory section.' });
      }

      const canChangePlacement = isClassAdviser && scoped.rows[0].isAdviserSection;
      let updated;
      if (canChangePlacement) {
        if (!validText(gradeLevel) || gradeLevel.trim().length > 40 || !validText(section) || section.trim().length > 100) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Provide a valid grade and section.' });
        }
        const targetAllowed = await client.query(
          `SELECT EXISTS (SELECT 1 FROM class_adviser_assignments ca
                          WHERE ca.school_id=$1 AND ca.adviser_user_id=$2
                            AND ca.grade_level=$3 AND ca.section=$4) AS allowed`,
          [req.auth.schoolId, req.auth.userId, gradeLevel.trim(), section.trim()]
        );
        if (!targetAllowed.rows[0]?.allowed) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'You may move learners only within sections assigned to you as Class Adviser.' });
        }
        updated = await client.query(
          `UPDATE students s SET full_name=$4, grade_level=$5, section=$6, updated_at=NOW()
           WHERE s.school_id=$1 AND s.student_id=$2 AND s.active=TRUE
             AND EXISTS (SELECT 1 FROM class_adviser_assignments ca WHERE ca.school_id=s.school_id AND ca.adviser_user_id=$3 AND ca.grade_level=COALESCE((SELECT en.grade_level FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1),s.grade_level) AND ca.section=COALESCE((SELECT en.section FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1),s.section))
           RETURNING s.student_id AS "studentId", s.full_name AS "fullName",
                     s.grade_level AS "gradeLevel", s.section, s.qr_token AS "qrToken"`,
          [req.auth.schoolId, req.params.studentId, req.auth.userId, fullName.trim(), gradeLevel.trim(), section.trim()]
        );
      } else {
        // Subject-only edit; the submitted payload cannot change placement or parent/LRN data.
        updated = await client.query(
          `UPDATE students s SET full_name=$4, updated_at=NOW()
           WHERE s.school_id=$1 AND s.student_id=$2 AND s.active=TRUE
             AND ${TEACHER_STUDENT_SCOPE.replace(/\$2/g, '$3')}
           RETURNING s.student_id AS "studentId", s.full_name AS "fullName",
                     s.grade_level AS "gradeLevel", s.section, s.qr_token AS "qrToken"`,
          [req.auth.schoolId, req.params.studentId, req.auth.userId, fullName.trim()]
        );
      }
      if (!updated.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Student was not found in your authorized classes.' });
      }
      await client.query(
        `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
         VALUES($1,'SCHOOL',$2,'TEACHER_UPDATE_ASSIGNED_STUDENT','student',$3,$4::jsonb)`,
        [req.auth.schoolId, req.auth.userId, req.params.studentId,
         JSON.stringify({ nameUpdated: true, placementUpdated: canChangePlacement })]
      );
      await client.query('COMMIT');
      return res.json({ student: updated.rows[0], qrTokenPreserved: true, placementEditable: canChangePlacement });
    }

    const updated = await client.query(
      `UPDATE students
       SET lrn=$3, full_name=$4, grade_level=$5, section=$6,
           parent_name=$7, parent_mobile=$8, updated_at=NOW()
       WHERE school_id=$1 AND student_id=$2 AND active=TRUE
       RETURNING student_id AS "studentId", lrn, full_name AS "fullName",
                 grade_level AS "gradeLevel", section, parent_name AS "parentName",
                 parent_mobile AS "parentMobile", qr_token AS "qrToken"`,
      [req.auth.schoolId, req.params.studentId, lrn?.trim() || null,
       fullName.trim(), gradeLevel.trim(), section.trim(),
       parentName?.trim() || null, parentMobile.trim()]
    );
    if (!updated.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Student not found in your authorized school.' });
    }
    await client.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_UPDATE_STUDENT','student',$3,$4::jsonb)`,
      [req.auth.schoolId, req.auth.userId, req.params.studentId,
       JSON.stringify({ gradeLevel: gradeLevel.trim(), section: section.trim() })]
    );
    await client.query('COMMIT');
    return res.json({ student: updated.rows[0], qrTokenPreserved: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ error: 'That LRN is already registered.' });
    console.error('Student update failed:', err.message);
    return res.status(500).json({ error: 'Could not update student information.' });
  } finally {
    client.release();
  }
});

// Student photos are stored outside /public and served only after school authentication.
const STUDENT_PHOTO_ROOT = path.join(__dirname, 'storage', 'student-photos');
const TEACHER_PHOTO_ROOT = path.join(__dirname, 'storage', 'teacher-photos');
function photoMimeFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { mime: 'image/png', ext: '.png' };
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: '.webp' };
  return null;
}

// Authenticated photo retrieval also supports gate devices so photos can be cached for offline use.
app.get('/api/students/:studentId/photo', authenticateSchoolClient, requireSchoolClient, async (req, res) => {
  if (req.auth.type === 'SCHOOL_USER' && !['SCHOOL_ADMIN', 'TEACHER'].includes(req.auth.role)) {
    return res.status(403).json({ error: 'This account cannot access the school student photo roster.' });
  }
  try {
    const params = [req.auth.schoolId, req.params.studentId];
    let teacherScope = '';
    if (req.auth.type === 'SCHOOL_USER' && req.auth.role === 'TEACHER') {
      params.push(req.auth.userId);
      teacherScope = ` AND ${TEACHER_STUDENT_SCOPE.replace(/\$2/g, '$3')}`;
    }
    const result = await pool.query(
      `SELECT photo_path FROM students s WHERE s.school_id=$1 AND s.student_id=$2 AND s.active=TRUE${teacherScope}`,
      params
    );
    if (!result.rowCount || !result.rows[0].photo_path) return res.status(404).json({ error: 'Student photo not found.' });
    const relative = result.rows[0].photo_path;
    const absolute = path.resolve(STUDENT_PHOTO_ROOT, relative);
    if (!absolute.startsWith(STUDENT_PHOTO_ROOT + path.sep)) return res.status(404).json({ error: 'Student photo not found.' });
    await fsp.access(absolute, fs.constants.R_OK);
    const ext = path.extname(absolute).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : null;
    if (!mime) return res.status(404).json({ error: 'Student photo not found.' });
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String((await fsp.stat(absolute)).size));
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.setHeader('Content-Disposition', 'inline');
    return fs.createReadStream(absolute).pipe(res);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Student photo retrieval failed:', err.message);
    return res.status(err.code === 'ENOENT' ? 404 : 500).json({ error: 'Could not retrieve student photo.' });
  }
});

// Upload or replace a student's photo. The binary request is capped at 5 MB and verified by file signature.
app.put('/api/students/:studentId/photo', authenticateSchoolClient, requireSchoolAdminOrTeacher,
  express.raw({ type: '*/*', limit: '5mb' }), async (req, res) => {
    if (req.auth.role === 'TEACHER' && !req.auth.teacherDesignations?.includes('CLASS_ADVISER')) {
      return res.status(403).json({ error: 'Only a designated Class Adviser may upload or replace learner photos.' });
    }
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Select a JPG, PNG, or WebP photo (maximum 5 MB).' });
    const detected = photoMimeFromBuffer(req.body);
    if (!detected || req.headers['content-type'] !== detected.mime) {
      return res.status(415).json({ error: 'Unsupported photo. Upload a valid JPG, PNG, or WebP image.' });
    }
    try {
      const params = [req.auth.schoolId, req.params.studentId];
      let teacherScope = '';
      if (req.auth.role === 'TEACHER') {
        params.push(req.auth.userId);
        teacherScope = ` AND EXISTS (SELECT 1 FROM class_adviser_assignments ca WHERE ca.school_id=s.school_id AND ca.adviser_user_id=$3 AND ca.grade_level=COALESCE((SELECT en.grade_level FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1),s.grade_level) AND ca.section=COALESCE((SELECT en.section FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1),s.section))`;
      }
      const student = await pool.query(
        `SELECT s.student_id, s.photo_path FROM students s WHERE s.school_id=$1 AND s.student_id=$2 AND s.active=TRUE${teacherScope}`,
        params
      );
      if (!student.rowCount) return res.status(404).json({ error: 'Student not found in your authorized school/classes.' });
      const schoolDir = path.join(STUDENT_PHOTO_ROOT, String(req.auth.schoolId));
      await fsp.mkdir(schoolDir, { recursive: true });
      const filename = `${crypto.randomUUID()}${detected.ext}`;
      const absolute = path.join(schoolDir, filename);
      const relative = path.join(String(req.auth.schoolId), filename);
      await fsp.writeFile(absolute, req.body, { flag: 'wx', mode: 0o600 });
      try {
        await pool.query(
          `UPDATE students SET photo_path=$3, updated_at=NOW() WHERE school_id=$1 AND student_id=$2`,
          [req.auth.schoolId, req.params.studentId, relative]
        );
      } catch (dbError) {
        await fsp.unlink(absolute).catch(() => {});
        throw dbError;
      }
      if (student.rows[0].photo_path) {
        const oldPath = path.resolve(STUDENT_PHOTO_ROOT, student.rows[0].photo_path);
        if (oldPath.startsWith(STUDENT_PHOTO_ROOT + path.sep)) await fsp.unlink(oldPath).catch(() => {});
      }
      await pool.query(
        `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
         VALUES($1,'SCHOOL',$2,'SCHOOL_UPLOAD_STUDENT_PHOTO','student',$3,$4::jsonb)`,
        [req.auth.schoolId, req.auth.userId, req.params.studentId, JSON.stringify({ mimeType: detected.mime, bytes: req.body.length })]
      ).catch(err => console.error('Student photo audit log failed:', err.message));
      return res.json({ ok: true, photoUrl: `/api/students/${encodeURIComponent(req.params.studentId)}/photo?v=${Date.now()}` });
    } catch (err) {
      console.error('Student photo upload failed:', err.message);
      return res.status(500).json({ error: 'Could not save student photo.' });
    }
  }
);

// School Administrator manages private teacher photos and prints individual teacher gate QR badges.
app.put('/api/teachers/:userId/photo', authenticateSchoolClient, requireSchoolAdmin,
  express.raw({ type: '*/*', limit: '5mb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Select a JPG, PNG, or WebP teacher photo (maximum 5 MB).' });
    const detected = photoMimeFromBuffer(req.body);
    if (!detected || req.headers['content-type'] !== detected.mime) return res.status(415).json({ error: 'Unsupported photo. Upload a valid JPG, PNG, or WebP image.' });
    try {
      const existing = await pool.query(
        `SELECT teacher_photo_path FROM school_users WHERE school_id=$1 AND user_id=$2 AND role='TEACHER'`,
        [req.auth.schoolId, req.params.userId]
      );
      if (!existing.rowCount) return res.status(404).json({ error: 'Teacher account not found in this school.' });
      const schoolDir = path.join(TEACHER_PHOTO_ROOT, String(req.auth.schoolId));
      await fsp.mkdir(schoolDir, { recursive: true });
      const filename = `${crypto.randomUUID()}${detected.ext}`;
      const absolute = path.join(schoolDir, filename);
      const relative = path.join(String(req.auth.schoolId), filename);
      await fsp.writeFile(absolute, req.body, { flag: 'wx', mode: 0o600 });
      try {
        await pool.query(`UPDATE school_users SET teacher_photo_path=$3, updated_at=NOW() WHERE school_id=$1 AND user_id=$2 AND role='TEACHER'`,
          [req.auth.schoolId, req.params.userId, relative]);
      } catch (dbError) { await fsp.unlink(absolute).catch(() => {}); throw dbError; }
      if (existing.rows[0].teacher_photo_path) {
        const oldPath = path.resolve(TEACHER_PHOTO_ROOT, existing.rows[0].teacher_photo_path);
        if (oldPath.startsWith(TEACHER_PHOTO_ROOT + path.sep)) await fsp.unlink(oldPath).catch(() => {});
      }
      await pool.query(
        `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
         VALUES($1,'SCHOOL',$2,'SCHOOL_UPLOAD_TEACHER_PHOTO','school_user',$3,$4::jsonb)`,
        [req.auth.schoolId, req.auth.userId, req.params.userId, JSON.stringify({ mimeType: detected.mime, bytes: req.body.length })]
      ).catch(err => console.error('Teacher photo audit log failed:', err.message));
      return res.json({ ok: true, hasTeacherPhoto: true });
    } catch (err) {
      console.error('Teacher photo upload failed:', err.message);
      return res.status(500).json({ error: 'Could not save teacher photo.' });
    }
  }
);

app.get('/api/teachers/:userId/qr', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT user_id AS "userId", username, display_name AS "displayName",
              teacher_qr_token AS "qrToken", (teacher_photo_path IS NOT NULL) AS "hasTeacherPhoto"
       FROM school_users WHERE school_id=$1 AND user_id=$2 AND role='TEACHER' AND active=TRUE`,
      [req.auth.schoolId, req.params.userId]
    );
    if (!result.rowCount || !result.rows[0].qrToken) return res.status(404).json({ error: 'Active teacher QR badge is not available.' });
    const teacher = result.rows[0];
    const qrCode = await QRCode.toDataURL(`TCH:${teacher.qrToken}`, { width: 360, margin: 2, errorCorrectionLevel: 'H' });
    return res.json({ teacher: { userId: teacher.userId, username: teacher.username, displayName: teacher.displayName, hasTeacherPhoto: teacher.hasTeacherPhoto }, qrCode });
  } catch (err) {
    console.error('Teacher QR generation failed:', err.message);
    return res.status(500).json({ error: 'Could not generate teacher gate QR.' });
  }
});

// QR images are returned only for a student in the authenticated school; teachers must be assigned to that student's class.
app.get('/api/students/:studentId/qr', authenticateSchoolClient, requireSchoolAdminOrTeacher, async (req, res) => {
  try {
    if (
  req.auth.role === 'TEACHER' &&
  !req.auth.teacherDesignations?.some(d =>
    ['CLASS_ADVISER', 'SUBJECT_TEACHER'].includes(d)
  )
) {
  return res.status(403).json({ error: 'Only authorized teachers may view QR codes.' });
}
    const params = [req.auth.schoolId, req.params.studentId];
    let teacherScope = '';
    if (req.auth.type === 'SCHOOL_USER' && req.auth.role === 'TEACHER') {
      params.push(req.auth.userId);
      teacherScope = ` AND ${TEACHER_STUDENT_SCOPE.replace(/\$2/g, '$3')}`;
    }
    const result = await pool.query(
      `SELECT s.qr_token AS token FROM students s
       WHERE s.school_id=$1 AND s.student_id=$2 AND s.active=TRUE${teacherScope}`,
      params
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Student not found in your authorized school/classes.' });
    const dataUrl = await QRCode.toDataURL(`JHS:${result.rows[0].token}`, {
      errorCorrectionLevel: 'H', margin: 2, width: 320
    });
    return res.json({ qrDataUrl: dataUrl });
  } catch (err) {
    console.error('QR generation failed:', err.message);
    return res.status(500).json({ error: 'Could not generate student QR code.' });
  }
});

app.get('/api/settings', authenticateSchoolClient, requireSchoolUser, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT setting_key, setting_value FROM school_settings WHERE school_id=$1',
      [req.auth.schoolId]
    );
    const settings = Object.fromEntries(result.rows.map(row => [row.setting_key, row.setting_value]));
    return res.json({
      schoolStartTime: settings.school_start_time?.time || null,
      schoolGraceMinutes: settings.school_start_time?.graceMinutes ?? 0
    });
  } catch (err) {
    console.error('Settings read failed:', err.message);
    return res.status(500).json({ error: 'Could not load settings.' });
  }
});

app.put('/api/settings', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
  const { schoolStartTime, schoolGraceMinutes = 0 } = req.body || {};
  if (!validText(schoolStartTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(schoolStartTime) ||
      !Number.isInteger(Number(schoolGraceMinutes)) || Number(schoolGraceMinutes) < 0 || Number(schoolGraceMinutes) > 240) {
    return res.status(400).json({ error: 'Provide a valid school start time and grace minutes from 0 to 240.' });
  }
  try {
    await pool.query(
      `INSERT INTO school_settings(school_id, setting_key, setting_value)
       VALUES($1,'school_start_time',$2::jsonb)
       ON CONFLICT(school_id,setting_key)
       DO UPDATE SET setting_value=EXCLUDED.setting_value, updated_at=NOW()`,
      [req.auth.schoolId, JSON.stringify({ time: schoolStartTime, graceMinutes: Number(schoolGraceMinutes) })]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('Settings save failed:', err.message);
    return res.status(500).json({ error: 'Could not save settings.' });
  }
});

app.get('/api/periods', authenticateSchoolClient, requireSchoolUser, async (req, res) => {
  try {
    const params = [req.auth.schoolId];
    let teacherScope = '';
    if (req.auth.role === 'TEACHER') {
      params.push(req.auth.userId);
      teacherScope = ` AND (
        EXISTS (
          SELECT 1 FROM teacher_period_assignments a
          WHERE a.school_id=p.school_id AND a.period_id=p.period_id AND a.teacher_user_id=$2
        )
        OR EXISTS (
          SELECT 1 FROM teacher_period_substitutions ts
          WHERE ts.school_id=p.school_id AND ts.period_id=p.period_id
            AND ts.substitute_teacher_user_id=$2 AND ts.status='ACTIVE'
            AND (NOW() AT TIME ZONE 'Asia/Manila')::date BETWEEN ts.start_date AND ts.end_date
        )
        OR EXISTS (
          SELECT 1 FROM class_adviser_assignments ca
          WHERE ca.school_id=p.school_id AND ca.adviser_user_id=$2
            AND ca.grade_level=p.grade_level AND ca.section=p.section
        )
      )`;
    }
    const result = await pool.query(
      `SELECT p.period_id AS "periodId", p.period_name AS "periodName",
              p.grade_level AS "gradeLevel", p.section, p.subject_name AS "subjectName",
              to_char(p.start_time,'HH24:MI') AS "startTime",
              to_char(p.end_time,'HH24:MI') AS "endTime", p.grace_minutes AS "graceMinutes"
       FROM class_periods p
       WHERE p.school_id=$1 AND p.active=TRUE${teacherScope}
       ORDER BY p.start_time`,
      params
    );
    return res.json({ periods: result.rows });
  } catch (err) {
    console.error('Period list failed:', err.message);
    return res.status(500).json({ error: 'Could not load periods.' });
  }
});

// School Administrators create school schedules. Subject Teachers may create a schedule only for their own account.
app.post('/api/periods', authenticateSchoolClient, requireSchoolAdminOrTeacher, async (req, res) => {
  const isTeacher = req.auth.role === 'TEACHER';
  if (isTeacher && !req.auth.teacherDesignations?.includes('SUBJECT_TEACHER')) {
    return res.status(403).json({ error: 'Only a Subject Teacher may create a personal class schedule.' });
  }
  const { periodName, gradeLevel, section, subjectName, startTime, endTime, graceMinutes = 0 } = req.body || {};
  if (![periodName, gradeLevel, startTime, endTime].every(validText) ||
      (isTeacher && !validText(section)) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) ||
      startTime >= endTime || !Number.isInteger(Number(graceMinutes)) || Number(graceMinutes) < 0 || Number(graceMinutes) > 240 ||
      String(periodName).trim().length > 120 || String(gradeLevel).trim().length > 40 || String(section || '').trim().length > 100 || String(subjectName || '').trim().length > 120) {
    return res.status(400).json({ error: 'Provide a valid schedule name, grade, section, time range, and grace period.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (isTeacher) {
      const conflict = await client.query(
        `SELECT EXISTS (
           SELECT 1 FROM class_periods p
           LEFT JOIN teacher_period_assignments a ON a.school_id=p.school_id AND a.period_id=p.period_id
           WHERE p.school_id=$1 AND p.active=TRUE
             AND p.start_time < $4::time AND $3::time < p.end_time
             AND (
               a.teacher_user_id=$2
               OR (p.grade_level=$5 AND (p.section IS NULL OR p.section=$6))
             )
         ) AS conflict`,
        [req.auth.schoolId, req.auth.userId, startTime, endTime, gradeLevel.trim(), section.trim()]
      );
      if (conflict.rows[0]?.conflict) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This time overlaps another active schedule for you or the selected class section.' });
      }
    }
    const result = await client.query(
      `INSERT INTO class_periods(school_id, period_name, grade_level, section, subject_name,
                                 start_time, end_time, grace_minutes)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING period_id AS "periodId", period_name AS "periodName",
                 grade_level AS "gradeLevel", section, subject_name AS "subjectName",
                 to_char(start_time,'HH24:MI') AS "startTime", to_char(end_time,'HH24:MI') AS "endTime"`,
      [req.auth.schoolId, periodName.trim(), gradeLevel.trim(), section?.trim() || null,
       subjectName?.trim() || null, startTime, endTime, Number(graceMinutes)]
    );
    const period = result.rows[0];
    if (isTeacher) {
      await client.query(
        `INSERT INTO teacher_period_assignments(school_id, teacher_user_id, period_id)
         VALUES($1,$2,$3)`,
        [req.auth.schoolId, req.auth.userId, period.periodId]
      );
    }
    await client.query(
      `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
       VALUES($1,'SCHOOL',$2,$3,'class_period',$4,$5::jsonb)`,
      [req.auth.schoolId, req.auth.userId,
       isTeacher ? 'TEACHER_CREATE_OWN_PERIOD' : 'SCHOOL_ADMIN_CREATE_PERIOD',
       period.periodId,
       JSON.stringify({ periodName: period.periodName, gradeLevel: period.gradeLevel, section: period.section, selfAssigned: isTeacher })]
    );
    await client.query('COMMIT');
    return res.status(201).json({ period, assignedToCreator: isTeacher });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Period creation failed:', err.message);
    return res.status(400).json({ error: 'Could not create schedule. Check for duplicate or conflicting entries.' });
  } finally {
    client.release();
  }
});

// Teacher attendance history is limited to the signed-in teacher's adviser sections
// and permanent or active substitute subject periods. Gate records are never included.
app.get('/api/teacher/class-attendance', authenticateSchoolClient, requireSchoolRoles('TEACHER'), async (req, res) => {
  const designations = Array.isArray(req.auth.teacherDesignations) ? req.auth.teacherDesignations : [];
  const hasAdviser = designations.includes('CLASS_ADVISER');
  const hasSubject = designations.includes('SUBJECT_TEACHER');
  if (!hasAdviser && !hasSubject) {
    return res.status(403).json({ error: 'This account has no class-attendance designation.' });
  }

  const view = String(req.query.view || 'ALL').toUpperCase();
  if (!['ALL', 'ADVISORY', 'SUBJECT'].includes(view)) {
    return res.status(400).json({ error: 'Select All, Advisory, or Subject attendance.' });
  }
  if (view === 'ADVISORY' && !hasAdviser) {
    return res.status(403).json({ error: 'Only the assigned Class Adviser can view advisory attendance.' });
  }
  if (view === 'SUBJECT' && !hasSubject) {
    return res.status(403).json({ error: 'Only a Subject Teacher can view subject-class attendance.' });
  }

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const from = typeof req.query.from === 'string' ? req.query.from : today;
  const to = typeof req.query.to === 'string' ? req.query.to : today;
  if (!isValidSchoolDate(from) || !isValidSchoolDate(to) || from > to) {
    return res.status(400).json({ error: 'Provide a valid date range.' });
  }

  const includeAdvisory = hasAdviser && view !== 'SUBJECT';
  const includeSubject = hasSubject && view !== 'ADVISORY';
  try {
    const result = await pool.query(
      `SELECT e.event_id AS "eventId", e.student_id AS "studentId",
              s.full_name AS "fullName", s.grade_level AS "gradeLevel", s.section,
              e.school_date::text AS "schoolDate", e.occurred_at_device AS "occurredAt",
              e.attendance_scope AS scope, e.event_type AS "eventType", e.late,
              e.sync_status AS "syncStatus",
              p.period_name AS "periodName", p.subject_name AS "subjectName"
       FROM attendance_events e
       JOIN students s ON s.school_id=e.school_id AND s.student_id=e.student_id
       LEFT JOIN class_periods p ON p.school_id=e.school_id AND p.period_id=e.period_id
       WHERE e.school_id=$1 AND e.sync_status='ACCEPTED'
         AND e.attendance_scope IN ('CLASS','ADVISORY')
         AND e.school_date BETWEEN $2::date AND $3::date
         AND (
           ($4::boolean AND e.attendance_scope='ADVISORY'
             AND EXISTS (
               SELECT 1 FROM class_adviser_assignments ca
               WHERE ca.school_id=e.school_id AND ca.adviser_user_id=$5
                 AND ca.grade_level=s.grade_level AND ca.section=s.section
             ))
           OR
           ($6::boolean AND e.attendance_scope='CLASS'
             AND (
               EXISTS (
                 SELECT 1 FROM teacher_period_assignments a
                 WHERE a.school_id=e.school_id AND a.period_id=e.period_id AND a.teacher_user_id=$5
               )
               OR EXISTS (
                 SELECT 1 FROM teacher_period_substitutions ts
                 WHERE ts.school_id=e.school_id AND ts.period_id=e.period_id
                   AND ts.substitute_teacher_user_id=$5 AND ts.status='ACTIVE'
                   AND e.school_date BETWEEN ts.start_date AND ts.end_date
               )
             ))
         )
       ORDER BY e.school_date DESC, e.occurred_at_device DESC
       LIMIT 1500`,
      [req.auth.schoolId, from, to, includeAdvisory, req.auth.userId, includeSubject]
    );
    return res.json({ records: result.rows, count: result.rowCount, view, from, to });
  } catch (err) {
    console.error('Teacher class attendance history failed:', err.message);
    return res.status(500).json({ error: 'Could not load your assigned class attendance records.' });
  }
});

// School-scoped idempotent event ingestion. Gate Keepers/devices submit school-gate events;
// teachers submit only designated subject or advisory attendance. School Administrators do not scan.
app.post('/api/sync/events', authenticateSchoolClient, requireSchoolClient, async (req, res) => {
  if (req.auth.type === 'SCHOOL_USER' && req.auth.role === 'PARENT') {
    return res.status(403).json({ error: 'Parent accounts cannot submit or modify attendance events.' });
  }
  if (req.auth.type === 'SCHOOL_USER' && req.auth.role === 'DEPARTMENT_HEAD') {
    return res.status(403).json({ error: 'Department Head accounts are read-only and cannot submit attendance punches.' });
  }
  if (req.auth.type === 'SCHOOL_USER' && req.auth.role === 'SCHOOL_ADMIN') {
    return res.status(403).json({ error: 'School Administrator accounts do not record attendance. Use a Gate Keeper account for school-gate attendance or a designated teacher account for class attendance.' });
  }
  const events = req.body && req.body.events;
  if (!Array.isArray(events) || events.length < 1 || events.length > 500) {
    return res.status(400).json({ error: 'events must be an array containing 1 to 500 records.' });
  }
  const client = await pool.connect();
  const results = [];
  try {
    await client.query('BEGIN');
    for (const event of events) {
      if (!event || !event.eventId || !event.studentId || !event.eventType || !event.occurredAt ||
          !isValidSchoolDate(event.schoolDate) || !event.attendanceScope ||
          !['TIME_IN', 'TIME_OUT'].includes(event.eventType) ||
          !['SCHOOL', 'CLASS', 'ADVISORY'].includes(event.attendanceScope) ||
          (event.attendanceScope === 'CLASS' && !event.periodId) ||
          (['SCHOOL', 'ADVISORY'].includes(event.attendanceScope) && event.periodId) ||
          !Number.isFinite(Date.parse(event.occurredAt))) {
        results.push({ eventId: event?.eventId || null, status: 'REJECTED', reason: 'Invalid or missing event fields.' });
        continue;
      }
      if (req.auth.type === 'DEVICE' && event.attendanceScope !== 'SCHOOL') {
        results.push({ eventId: event.eventId, status: 'REJECTED', reason: 'Gate device credentials may submit school-level attendance only.' });
        continue;
      }
      if (req.auth.type === 'SCHOOL_USER' && req.auth.role === 'TEACHER' && !['CLASS', 'ADVISORY'].includes(event.attendanceScope)) {
        results.push({ eventId: event.eventId, status: 'REJECTED', reason: 'Teachers may submit subject or assigned advisory attendance only.' });
        continue;
      }
      if (req.auth.type === 'SCHOOL_USER' && req.auth.role === 'TEACHER' && event.attendanceScope === 'CLASS' && !req.auth.teacherDesignations?.includes('SUBJECT_TEACHER')) {
        results.push({ eventId: event.eventId, status: 'REJECTED', reason: 'This teacher account is not designated to record subject attendance.' });
        continue;
      }
      if (req.auth.type === 'SCHOOL_USER' && req.auth.role === 'TEACHER' && event.attendanceScope === 'ADVISORY' && !req.auth.teacherDesignations?.includes('CLASS_ADVISER')) {
        results.push({ eventId: event.eventId, status: 'REJECTED', reason: 'This teacher account is not designated to record advisory attendance.' });
        continue;
      }
      if (req.auth.type === 'SCHOOL_USER' && req.auth.role === 'GATE_KEEPER' && event.attendanceScope !== 'SCHOOL') {
        results.push({ eventId: event.eventId, status: 'REJECTED', reason: 'Gate Keeper accounts may submit school-gate attendance only.' });
        continue;
      }

      const already = await client.query(
        'SELECT school_id FROM attendance_events WHERE event_id=$1', [event.eventId]
      );
      if (already.rowCount) {
        if (already.rows[0].school_id === req.auth.schoolId) {
          results.push({ eventId: event.eventId, status: 'ALREADY_SYNCED' });
        } else {
          results.push({ eventId: event.eventId, status: 'REJECTED', reason: 'Event ID belongs to a different school.' });
        }
        continue;
      }

      const student = await client.query(
        `SELECT student_id, full_name, parent_mobile, grade_level, section, photo_path
         FROM students WHERE school_id=$1 AND student_id=$2 AND active=TRUE`,
        [req.auth.schoolId, event.studentId]
      );
      if (!student.rowCount) {
        results.push({ eventId: event.eventId, status: 'REJECTED', reason: 'Unknown or inactive student in this school.' });
        continue;
      }
      if (req.auth.type === 'SCHOOL_USER' && req.auth.role === 'GATE_KEEPER' &&
          (!student.rows[0].photo_path || event.metadata?.photoVerified !== true)) {
        results.push({ eventId: event.eventId, status: 'REJECTED', reason: 'A registered student photo and explicit photo-match confirmation are required for Gate Keeper attendance.' });
        continue;
      }

      let period = null;
      let late = false;
      if (event.attendanceScope === 'CLASS') {
        const periodResult = await client.query(
          `SELECT * FROM class_periods
           WHERE school_id=$1 AND period_id=$2 AND active=TRUE`,
          [req.auth.schoolId, event.periodId]
        );
        if (!periodResult.rowCount) {
          results.push({ eventId: event.eventId, status: 'REJECTED', reason: 'Unknown class period in this school.' });
          continue;
        }
        period = periodResult.rows[0];
        if (period.grade_level !== student.rows[0].grade_level ||
            (period.section && period.section !== student.rows[0].section)) {
          results.push({ eventId: event.eventId, status: 'REJECTED', reason: 'Student is not enrolled in this period section.' });
          continue;
        }
        if (req.auth.type === 'SCHOOL_USER' && req.auth.role === 'TEACHER' &&
            !(await isTeacherAssigned(client, req.auth.schoolId, req.auth.userId, event.periodId, event.schoolDate, event.occurredAt))) {
          results.push({ eventId: event.eventId, status: 'REJECTED', reason: 'Teacher is not assigned to this class period.' });
          continue;
        }
        late = event.eventType === 'TIME_IN' && isLateForPeriod(event.occurredAt, period);
      } else if (event.attendanceScope === 'ADVISORY') {
        const adviser = await client.query(
          `SELECT 1 FROM class_adviser_assignments
           WHERE school_id=$1 AND adviser_user_id=$2 AND grade_level=$3 AND section=$4 LIMIT 1`,
          [req.auth.schoolId, req.auth.userId, student.rows[0].grade_level, student.rows[0].section]
        );
        if (req.auth.type !== 'SCHOOL_USER' || req.auth.role !== 'TEACHER' || !adviser.rowCount) {
          results.push({ eventId: event.eventId, status: 'REJECTED', reason: 'Teacher is not the assigned Class Adviser for this learner section.' });
          continue;
        }
      } else if (event.eventType === 'TIME_IN') {
        const setting = await client.query(
          `SELECT setting_value FROM school_settings
           WHERE school_id=$1 AND setting_key='school_start_time'`,
          [req.auth.schoolId]
        );
        if (setting.rowCount && setting.rows[0].setting_value.time) {
          late = isLateForPeriod(event.occurredAt, {
            start_time: setting.rows[0].setting_value.time,
            grace_minutes: setting.rows[0].setting_value.graceMinutes || 0
          });
        }
      }

      const duplicate = await client.query(
        `SELECT event_id FROM attendance_events
         WHERE school_id=$1 AND student_id=$2 AND school_date=$3 AND attendance_scope=$4
           AND COALESCE(period_id::text,'SCHOOL')=COALESCE($5::text,'SCHOOL')
           AND event_type=$6 AND sync_status='ACCEPTED'
         LIMIT 1`,
        [req.auth.schoolId, event.studentId, event.schoolDate, event.attendanceScope, event.periodId || null, event.eventType]
      );
      const rawDeviceId = req.auth.type === 'DEVICE'
        ? req.auth.deviceId
        : (validText(event.deviceId) ? event.deviceId.trim() : `USER-${req.auth.userId}`);
      const actorUserId = req.auth.type === 'SCHOOL_USER' ? req.auth.userId : null;
      const safeMetadata = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
        ? event.metadata : {};

      if (duplicate.rowCount) {
        await client.query(
          `INSERT INTO attendance_events
           (event_id, school_id, device_id, student_id, attendance_scope, period_id, event_type,
            occurred_at_device, school_date, sync_status, duplicate_of, metadata, recorded_by_user_id)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'DUPLICATE',$10,$11,$12)
           ON CONFLICT(event_id) DO NOTHING`,
          [event.eventId, req.auth.schoolId, rawDeviceId, event.studentId, event.attendanceScope,
           event.periodId || null, event.eventType, event.occurredAt, event.schoolDate,
           duplicate.rows[0].event_id, safeMetadata, actorUserId]
        );
        results.push({ eventId: event.eventId, status: 'DUPLICATE', duplicateOf: duplicate.rows[0].event_id });
        continue;
      }

      await client.query(
        `INSERT INTO attendance_events
         (event_id, school_id, device_id, student_id, attendance_scope, period_id, event_type,
          occurred_at_device, school_date, late, metadata, recorded_by_user_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [event.eventId, req.auth.schoolId, rawDeviceId, event.studentId, event.attendanceScope,
         event.periodId || null, event.eventType, event.occurredAt, event.schoolDate,
         late, safeMetadata, actorUserId]
      );

      if (student.rows[0].parent_mobile) {
        const time = new Date(event.occurredAt).toLocaleTimeString('en-PH', {
          timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit'
        });
        const action = event.eventType === 'TIME_IN' ? 'checked in' : 'checked out';
        const context = event.attendanceScope === 'CLASS'
          ? ` for ${period.period_name}${period.subject_name ? ` (${period.subject_name})` : ''}`
          : event.attendanceScope === 'ADVISORY' ? ' in the advisory class' : ' at school';
        const lateText = late ? 'LATE ARRIVAL: ' : '';
        const message = `${lateText}${student.rows[0].full_name} ${action}${context} at ${time}.`;
        await client.query(
          `INSERT INTO sms_outbox(event_id,recipient,message)
           VALUES($1,$2,$3) ON CONFLICT(event_id) DO NOTHING`,
          [event.eventId, student.rows[0].parent_mobile, message]
        );
      }
      results.push({ eventId: event.eventId, status: 'ACCEPTED', late });
    }
    await client.query('COMMIT');
    return res.json({ results, serverTime: new Date().toISOString() });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Attendance sync failed:', err.message);
    return res.status(500).json({ error: 'Attendance synchronization failed.' });
  } finally {
    client.release();
  }
});

// School dashboard: school admins see their school; teachers see only assigned class data.
app.get('/api/admin/dashboard', authenticateSchoolClient, requireSchoolUser, async (req, res) => {
  const isSchoolWideViewer = ['SCHOOL_ADMIN', 'DEPARTMENT_HEAD'].includes(req.auth.role);
  try {
    const studentSql = isSchoolWideViewer
      ? `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE active)::int AS active
         FROM students WHERE school_id=$1`
      : `SELECT COUNT(DISTINCT s.student_id)::int AS total,
                COUNT(DISTINCT s.student_id) FILTER (WHERE s.active)::int AS active
         FROM students s WHERE s.school_id=$1 AND s.active=TRUE AND ${TEACHER_STUDENT_SCOPE}`;
    const attendanceSql = isSchoolWideViewer
      ? `SELECT
           COUNT(*) FILTER (WHERE attendance_scope='SCHOOL' AND event_type='TIME_IN' AND sync_status='ACCEPTED')::int AS school_arrivals,
           COUNT(*) FILTER (WHERE attendance_scope='SCHOOL' AND event_type='TIME_IN' AND late AND sync_status='ACCEPTED')::int AS late_arrivals,
           COUNT(*) FILTER (WHERE attendance_scope='CLASS' AND event_type='TIME_IN' AND sync_status='ACCEPTED')::int AS class_checkins
         FROM attendance_events
         WHERE school_id=$1 AND school_date=(NOW() AT TIME ZONE 'Asia/Manila')::date`
      : `SELECT
           0::int AS school_arrivals, 0::int AS late_arrivals,
           COUNT(*) FILTER (WHERE e.attendance_scope='CLASS' AND e.event_type='TIME_IN' AND e.sync_status='ACCEPTED')::int AS class_checkins
         FROM attendance_events e
         WHERE e.school_id=$1 AND e.school_date=(NOW() AT TIME ZONE 'Asia/Manila')::date
           AND (
             EXISTS (SELECT 1 FROM teacher_period_assignments a
                     WHERE a.school_id=e.school_id AND a.period_id=e.period_id AND a.teacher_user_id=$2)
             OR EXISTS (SELECT 1 FROM teacher_period_substitutions ts
                        WHERE ts.school_id=e.school_id AND ts.period_id=e.period_id
                          AND ts.substitute_teacher_user_id=$2 AND ts.status='ACTIVE'
                          AND e.school_date BETWEEN ts.start_date AND ts.end_date)
           )`;
    const params = isSchoolWideViewer ? [req.auth.schoolId] : [req.auth.schoolId, req.auth.userId];
    const smsSql = isSchoolWideViewer
      ? `SELECT o.status, COUNT(*)::int AS count FROM sms_outbox o
         JOIN attendance_events e ON e.event_id=o.event_id AND e.school_id=$1 GROUP BY o.status`
      : `SELECT o.status, COUNT(*)::int AS count FROM sms_outbox o
         JOIN attendance_events e ON e.event_id=o.event_id AND e.school_id=$1
         WHERE (
           EXISTS (SELECT 1 FROM teacher_period_assignments a
                   WHERE a.school_id=e.school_id AND a.period_id=e.period_id AND a.teacher_user_id=$2)
           OR EXISTS (SELECT 1 FROM teacher_period_substitutions ts
                      WHERE ts.school_id=e.school_id AND ts.period_id=e.period_id
                        AND ts.substitute_teacher_user_id=$2 AND ts.status='ACTIVE'
                        AND e.school_date BETWEEN ts.start_date AND ts.end_date)
         )
         GROUP BY o.status`;
    const devicesSql = isSchoolWideViewer
      ? `SELECT COUNT(*)::int AS registered,
                COUNT(*) FILTER (WHERE active)::int AS active
         FROM attendance_devices WHERE school_id=$1`
      : `SELECT 0::int AS registered, 0::int AS active`;
    const recentSql = isSchoolWideViewer
      ? `SELECT e.event_id AS "eventId", e.student_id AS "studentId", s.full_name AS "fullName",
                e.attendance_scope AS scope, e.event_type AS "eventType", e.late,
                e.occurred_at_device AS "occurredAt", e.sync_status AS "syncStatus"
         FROM attendance_events e JOIN students s
           ON s.school_id=e.school_id AND s.student_id=e.student_id
         WHERE e.school_id=$1
         ORDER BY e.received_at_server DESC LIMIT 20`
      : `SELECT e.event_id AS "eventId", e.student_id AS "studentId", s.full_name AS "fullName",
                e.attendance_scope AS scope, e.event_type AS "eventType", e.late,
                e.occurred_at_device AS "occurredAt", e.sync_status AS "syncStatus"
         FROM attendance_events e JOIN students s
           ON s.school_id=e.school_id AND s.student_id=e.student_id
         WHERE e.school_id=$1 AND e.attendance_scope='CLASS'
           AND (
             EXISTS (SELECT 1 FROM teacher_period_assignments a
                     WHERE a.school_id=e.school_id AND a.period_id=e.period_id AND a.teacher_user_id=$2)
             OR EXISTS (SELECT 1 FROM teacher_period_substitutions ts
                        WHERE ts.school_id=e.school_id AND ts.period_id=e.period_id
                          AND ts.substitute_teacher_user_id=$2 AND ts.status='ACTIVE'
                          AND e.school_date BETWEEN ts.start_date AND ts.end_date)
           )
         ORDER BY e.received_at_server DESC LIMIT 20`;

    const learnerSummarySql = isSchoolWideViewer
      ? `SELECT
           COUNT(DISTINCT s.student_id) FILTER (WHERE s.active)::int AS active_learners,
           COUNT(DISTINCT e.student_id) FILTER (
             WHERE e.school_date=(NOW() AT TIME ZONE 'Asia/Manila')::date
               AND e.attendance_scope='CLASS' AND e.event_type='TIME_IN'
               AND e.sync_status='ACCEPTED'
           )::int AS confirmed_present_today,
           COUNT(DISTINCT (e.student_id, e.school_date)) FILTER (
             WHERE e.school_date >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Manila')::date
               AND e.school_date <= (NOW() AT TIME ZONE 'Asia/Manila')::date
               AND e.attendance_scope='CLASS' AND e.event_type='TIME_IN'
               AND e.sync_status='ACCEPTED'
           )::int AS confirmed_learner_days_month,
           COUNT(*) FILTER (
             WHERE e.school_date=(NOW() AT TIME ZONE 'Asia/Manila')::date
               AND e.attendance_scope='CLASS' AND e.event_type='TIME_IN'
               AND e.sync_status='ACCEPTED'
           )::int AS subject_checkins_today
         FROM students s
         LEFT JOIN attendance_events e ON e.school_id=s.school_id AND e.student_id=s.student_id
         WHERE s.school_id=$1`
      : `SELECT
           COUNT(DISTINCT s.student_id) FILTER (WHERE s.active)::int AS active_learners,
           COUNT(DISTINCT e.student_id) FILTER (
             WHERE e.school_date=(NOW() AT TIME ZONE 'Asia/Manila')::date
               AND e.attendance_scope='CLASS' AND e.event_type='TIME_IN'
               AND e.sync_status='ACCEPTED'
           )::int AS confirmed_present_today,
           COUNT(DISTINCT (e.student_id, e.school_date)) FILTER (
             WHERE e.school_date >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Manila')::date
               AND e.school_date <= (NOW() AT TIME ZONE 'Asia/Manila')::date
               AND e.attendance_scope='CLASS' AND e.event_type='TIME_IN'
               AND e.sync_status='ACCEPTED'
           )::int AS confirmed_learner_days_month,
           COUNT(*) FILTER (
             WHERE e.school_date=(NOW() AT TIME ZONE 'Asia/Manila')::date
               AND e.attendance_scope='CLASS' AND e.event_type='TIME_IN'
               AND e.sync_status='ACCEPTED'
           )::int AS subject_checkins_today
         FROM students s
         LEFT JOIN attendance_events e ON e.school_id=s.school_id AND e.student_id=s.student_id
         WHERE s.school_id=$1 AND s.active=TRUE AND ${TEACHER_STUDENT_SCOPE}`;

    const [students, attendance, sms, devices, recent, learnerSummary] = await Promise.all([
      pool.query(studentSql, params),
      pool.query(attendanceSql, params),
      pool.query(smsSql, params),
      pool.query(devicesSql, isSchoolWideViewer ? params : []),
      pool.query(recentSql, params),
      pool.query(learnerSummarySql, params)
    ]);
    const learner = learnerSummary.rows[0] || {};
    const activeLearners = Number(learner.active_learners || 0);
    const confirmedPresent = Number(learner.confirmed_present_today || 0);
    return res.json({
      students: students.rows[0],
      today: attendance.rows[0],
      learnerAttendance: {
        activeLearners,
        confirmedPresentToday: confirmedPresent,
        pendingConfirmationToday: Math.max(0, activeLearners - confirmedPresent),
        confirmedLearnerDaysMonth: Number(learner.confirmed_learner_days_month || 0),
        subjectCheckinsToday: Number(learner.subject_checkins_today || 0),
        absenceFinalizationAvailable: false
      },
      sardo: {
        alerts: null,
        monitoringEnabled: false,
        message: 'SARDO alerts will activate after teachers can finalize subject attendance and advisers can classify absences as excused or unexcused.'
      },
      sms: Object.fromEntries(sms.rows.map(row => [row.status, row.count])),
      devices: devices.rows[0],
      recent: recent.rows,
      school: { schoolId: req.auth.schoolId, schoolCode: req.auth.schoolCode, schoolName: req.auth.schoolName },
      viewerRole: req.auth.role
    });
  } catch (err) {
    console.error('School dashboard failed:', err.message);
    return res.status(500).json({ error: 'Dashboard data unavailable.' });
  }
});

app.get('/vendor/html5-qrcode.min.js', (_req, res) =>
  res.sendFile(path.join(__dirname, 'node_modules', 'html5-qrcode', 'html5-qrcode.min.js'))
);
// Basic liveness endpoint for deployment and diagnostics. No school data is exposed.
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'school-attendance' }));

// Main application login page
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'portal-login.html'));
});

// Retire the legacy Attendance Desk landing page
app.get('/index.html', (_req, res) => {
  res.redirect('/');
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));

const port = Number(process.env.PORT || 3000);
const httpsPort = Number(process.env.HTTPS_PORT || 3443);


async function processDueTeacherReturns() {
  try {
    const result = await pool.query(
      `WITH due AS (
         UPDATE school_users
         SET active=TRUE, teacher_status='ACTIVE', leave_type=NULL,
             leave_start_date=NULL, expected_return_date=NULL,
             updated_at=NOW()
         WHERE role='TEACHER' AND teacher_status='ON_LEAVE'
           AND leave_auto_reactivate=TRUE
           AND expected_return_date <= (NOW() AT TIME ZONE 'Asia/Manila')::date
         RETURNING school_id, user_id, username
       ), cancelled_covers AS (
         UPDATE teacher_period_substitutions ts
         SET status='CANCELLED', cancelled_at=NOW(), updated_at=NOW()
         FROM due d
         WHERE ts.school_id=d.school_id
           AND ts.original_teacher_user_id=d.user_id
           AND ts.status='ACTIVE'
         RETURNING ts.school_id, ts.substitution_id, ts.original_teacher_user_id,
                   ts.substitute_teacher_user_id, ts.period_id
       ), teacher_audit AS (
         INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
         SELECT school_id, 'SYSTEM', NULL, 'SYSTEM_AUTO_RETURN_TEACHER',
                'school_user', user_id::text,
                jsonb_build_object('username', username, 'returnedOn', (NOW() AT TIME ZONE 'Asia/Manila')::date)
         FROM due
         RETURNING entity_id
       ), cover_audit AS (
         INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
         SELECT school_id, 'SYSTEM', NULL, 'SYSTEM_END_SUBSTITUTE_ON_TEACHER_RETURN',
                'teacher_period_substitution', substitution_id::text,
                jsonb_build_object('originalTeacherUserId', original_teacher_user_id,
                                   'substituteTeacherUserId', substitute_teacher_user_id,
                                   'periodId', period_id,
                                   'reason', 'Original teacher automatically returned')
         FROM cancelled_covers
         RETURNING entity_id
       )
       SELECT (SELECT COUNT(*) FROM due)::int AS returned_count,
              (SELECT COUNT(*) FROM cancelled_covers)::int AS cancelled_cover_count`
    );
    const returned = result.rows[0]?.returned_count || 0;
    const cancelled = result.rows[0]?.cancelled_cover_count || 0;
    if (returned) console.log(`Automatically returned ${returned} teacher account(s) from leave.`);
    if (cancelled) console.log(`Automatically ended ${cancelled} temporary substitute cover(s).`);
  } catch (err) {
    console.error('Automatic teacher return check failed:', err.message);
  }
}

async function start() {
  console.log('Checking database migrations...');
  const migrationResult = await runMigrations(pool);
  console.log(`Database migrations ready: ${migrationResult.applied.length} applied, ${migrationResult.total} total.`);

  await processDueTeacherReturns();
  const teacherReturnTimer = setInterval(processDueTeacherReturns, 60 * 1000);
  teacherReturnTimer.unref();
  // Ensure QR credentials exist before accepting requests; this is a harmless, idempotent compatibility migration.
  await pool.query('ALTER TABLE students ADD COLUMN IF NOT EXISTS qr_token UUID');
  await pool.query('ALTER TABLE students ADD COLUMN IF NOT EXISTS photo_path TEXT');
  await fsp.mkdir(STUDENT_PHOTO_ROOT, { recursive: true });
  await pool.query('UPDATE students SET qr_token=gen_random_uuid() WHERE qr_token IS NULL');
  app.listen(port, '0.0.0.0', () => console.log(`Attendance API listening on ${port} (roles-sf2-workflow-responsive-2026-11-11)`));
  const certPath = path.join(__dirname, 'localhost+ip.pem');
  const keyPath = path.join(__dirname, 'localhost+ip-key.pem');
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, app)
      .listen(httpsPort, '0.0.0.0', () => console.log(`Secure HTTPS server listening on ${httpsPort}`));
  } else {
    console.warn('HTTPS certificates not found; HTTPS listener not started. Use HTTPS for non-local network deployments.');
  }
}

start().catch(err => {
  console.error('Server startup failed:', err.message);
  process.exit(1);
});

process.on('SIGINT', async () => { await pool.end(); process.exit(0); });
process.on('SIGTERM', async () => { await pool.end(); process.exit(0); });


