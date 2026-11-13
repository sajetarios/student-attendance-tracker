'use strict';

const crypto = require('node:crypto');
const { decryptCloudToken } = require('./cloud-sync-security');

const SCHEMA_VERSION = 1;
const MAX_ROWS = 25000;
const COLLECTIONS = [
  'schoolUsers',
  'students',
  'schoolSettings',
  'classPeriods',
  'teacherPeriodAssignments',
  'teacherPeriodSubstitutions',
  'classAdviserAssignments',
  'schoolYears',
  'studentEnrollments',
  'studentMovements',
  'schoolCalendar',
  'specialProgramTypes',
  'studentSpecialPrograms'
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateMasterDataPayload(payload, expectedSchoolId) {
  if (!isPlainObject(payload)) return 'A master-data payload is required.';
  if (payload.schemaVersion !== SCHEMA_VERSION) return 'Unsupported master-data schema version.';
  if (!isPlainObject(payload.school) || payload.school.schoolId !== expectedSchoolId ||
      payload.schoolId !== expectedSchoolId) {
    return 'The master-data snapshot does not belong to the authenticated school.';
  }
  if (!String(payload.school.schoolCode || '').trim() ||
      !String(payload.school.schoolName || '').trim()) {
    return 'The master-data snapshot is missing the school identity.';
  }
  if (!payload.generatedAt || Number.isNaN(Date.parse(payload.generatedAt))) {
    return 'The master-data snapshot timestamp is invalid.';
  }
  for (const key of COLLECTIONS) {
    if (!Array.isArray(payload[key])) return `The master-data snapshot is missing ${key}.`;
    if (payload[key].length > MAX_ROWS) return `${key} exceeds the ${MAX_ROWS.toLocaleString()} record limit.`;
  }
  return null;
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function buildMasterDataSnapshot(pool, schoolId) {
  const queries = [
    ['school', `SELECT school_id AS "schoolId", school_code AS "schoolCode",
                      school_name AS "schoolName", active
               FROM schools WHERE school_id=$1 AND active=TRUE`],
    ['schoolUsers', `SELECT user_id AS "userId", display_name AS "displayName",
                            role, active, teacher_status AS "teacherStatus",
                            teacher_designations AS "teacherDesignations", created_at AS "createdAt",
                            updated_at AS "updatedAt"
                     FROM school_users WHERE school_id=$1 AND role <> 'PARENT'`],
    ['students', `SELECT student_id AS "studentId", lrn, full_name AS "fullName",
                         grade_level AS "gradeLevel", section, active, sex,
                         created_at AS "createdAt", updated_at AS "updatedAt"
                  FROM students WHERE school_id=$1`],
    ['schoolSettings', `SELECT setting_key AS "settingKey", setting_value AS "settingValue"
                       FROM school_settings WHERE school_id=$1
                         AND setting_key = ANY(ARRAY['school_name','school_id','school_year'])`],
    ['classPeriods', `SELECT period_id AS "periodId", period_name AS "periodName",
                             grade_level AS "gradeLevel", section, subject_name AS "subjectName",
                             start_time::text AS "startTime", end_time::text AS "endTime",
                             grace_minutes AS "graceMinutes", active, created_at AS "createdAt"
                      FROM class_periods WHERE school_id=$1`],
    ['teacherPeriodAssignments', `SELECT assignment_id AS "assignmentId",
                                         teacher_user_id AS "teacherUserId",
                                         period_id AS "periodId", assigned_at AS "assignedAt"
                                  FROM teacher_period_assignments WHERE school_id=$1`],
    ['teacherPeriodSubstitutions', `SELECT substitution_id AS "substitutionId",
                                           period_id AS "periodId",
                                           original_teacher_user_id AS "originalTeacherUserId",
                                           substitute_teacher_user_id AS "substituteTeacherUserId",
                                           start_date::text AS "startDate", end_date::text AS "endDate",
                                           status, created_by_user_id AS "createdByUserId",
                                           created_at AS "createdAt", updated_at AS "updatedAt",
                                           cancelled_at AS "cancelledAt"
                                    FROM teacher_period_substitutions WHERE school_id=$1`],
    ['classAdviserAssignments', `SELECT assignment_id AS "assignmentId",
                                        adviser_user_id AS "adviserUserId",
                                        grade_level AS "gradeLevel", section,
                                        assigned_by AS "assignedBy", assigned_at AS "assignedAt"
                                 FROM class_adviser_assignments WHERE school_id=$1`],
    ['schoolYears', `SELECT school_year_id AS "schoolYearId", school_year_label AS "schoolYearLabel",
                            start_date::text AS "startDate", end_date::text AS "endDate",
                            status, created_by_user_id AS "createdByUserId",
                            created_at AS "createdAt", updated_at AS "updatedAt"
                     FROM school_years WHERE school_id=$1`],
    ['studentEnrollments', `SELECT enrollment_id AS "enrollmentId", student_id AS "studentId",
                                   school_year_id AS "schoolYearId", grade_level AS "gradeLevel",
                                   section, enrollment_date::text AS "enrollmentDate",
                                   enrollment_status AS "enrollmentStatus",
                                   status_effective_date::text AS "statusEffectiveDate",
                                   created_by_user_id AS "createdByUserId",
                                   created_at AS "createdAt", updated_at AS "updatedAt"
                            FROM student_enrollments WHERE school_id=$1`],
    ['studentMovements', `SELECT movement_id AS "movementId", student_id AS "studentId",
                                 school_year_id AS "schoolYearId", enrollment_id AS "enrollmentId",
                                 movement_type AS "movementType", effective_date::text AS "effectiveDate",
                                 from_grade_level AS "fromGradeLevel", from_section AS "fromSection",
                                 to_grade_level AS "toGradeLevel", to_section AS "toSection",
                                 destination_school_name AS "destinationSchoolName",
                                 destination_school_id AS "destinationSchoolId",
                                 official_code AS "officialCode",
                                 recorded_by_user_id AS "recordedByUserId", created_at AS "createdAt"
                          FROM student_movements WHERE school_id=$1`],
    ['schoolCalendar', `SELECT calendar_id AS "calendarId", school_year_id AS "schoolYearId",
                              calendar_date::text AS "calendarDate", day_type AS "dayType",
                              label, remarks, created_by_user_id AS "createdByUserId",
                              created_at AS "createdAt", updated_at AS "updatedAt"
                       FROM school_calendar WHERE school_id=$1`],
    ['specialProgramTypes', `SELECT program_type_id AS "programTypeId", program_code AS "programCode",
                                    program_name AS "programName", description, active,
                                    created_by_user_id AS "createdByUserId", created_at AS "createdAt"
                             FROM special_program_types WHERE school_id=$1`],
    ['studentSpecialPrograms', `SELECT sp.student_program_id AS "studentProgramId",
                                       sp.student_id AS "studentId", sp.school_year_id AS "schoolYearId",
                                       sp.enrollment_id AS "enrollmentId", sp.program_type_id AS "programTypeId",
                                       sp.is_primary AS "isPrimary", sp.start_date::text AS "startDate",
                                       sp.end_date::text AS "endDate", sp.status,
                                       sp.assigned_by_user_id AS "assignedByUserId",
                                       sp.created_at AS "createdAt", sp.updated_at AS "updatedAt"
                                FROM student_special_programs sp
                                JOIN school_years sy ON sy.school_id=sp.school_id
                                  AND sy.school_year_id=sp.school_year_id
                                WHERE sp.school_id=$1 AND sy.status <> 'CLOSED'`]
  ];

  const client = await pool.connect();
  let values;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    values = await Promise.all(queries.map(async ([key, sql]) => {
      const result = await client.query(sql, [schoolId]);
      return [key, key === 'school' ? result.rows[0] || null : result.rows];
    }));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  const snapshot = Object.fromEntries(values);
  if (!snapshot.school) throw new Error('The active school record could not be loaded.');
  // jsonb_to_recordset uses database-style field names. Convert the public snapshot's
  // camelCase aliases before serialization so every typed import column is populated.
  for (const key of COLLECTIONS) {
    snapshot[key] = snapshot[key].map(record => Object.fromEntries(
      Object.entries(record).map(([field, value]) => [
        field.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase()), value
      ])
    ));
  }
  snapshot.schemaVersion = SCHEMA_VERSION;
  snapshot.schoolId = schoolId;
  snapshot.generatedAt = new Date().toISOString();
  snapshot.counts = Object.fromEntries(COLLECTIONS.map(key => [key, snapshot[key].length]));
  return snapshot;
}

async function importCollection(client, schoolId, rows, sql, name, allowNoop = false) {
  if (!rows.length) return 0;
  const result = await client.query(sql, [schoolId, JSON.stringify(rows)]);
  if (!allowNoop && result.rowCount !== rows.length) {
    throw new Error(`Some ${name} records belong to a different school or conflict with existing cloud identity.`);
  }
  return result.rowCount;
}

function registerCloudMasterDataRoutes(app, pool, {
  authenticateSchoolClient,
  authenticateCloudSync,
  requireSchoolAdmin
}) {
  app.get('/api/cloud-sync/master-data/status', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
    try {
      const [settings, receipt, counts] = await Promise.all([
        pool.query(
          'SELECT last_master_data_sync_at AS "lastPushedAt", ' +
          'last_master_data_sync_counts AS "lastPushedCounts", ' +
          'last_master_data_sync_hash AS "lastPushedHash", ' +
          'last_master_data_sync_error AS "lastPushError" ' +
          'FROM school_cloud_sync_settings WHERE school_id=$1',
          [req.auth.schoolId]
        ),
        pool.query(
          'SELECT schema_version AS "schemaVersion", source_generated_at AS "sourceGeneratedAt", ' +
          'received_at AS "receivedAt", record_counts AS counts ' +
          'FROM cloud_sync_master_data_receipts WHERE school_id=$1',
          [req.auth.schoolId]
        ),
        pool.query(
          'SELECT (SELECT COUNT(*)::int FROM students WHERE school_id=$1) AS students, ' +
          '(SELECT COUNT(*)::int FROM school_users WHERE school_id=$1 AND role <> \'PARENT\') AS staff, ' +
          '(SELECT COUNT(*)::int FROM class_periods WHERE school_id=$1) AS periods, ' +
          '(SELECT COUNT(*)::int FROM school_years WHERE school_id=$1) AS schoolYears, ' +
          '(SELECT COUNT(*)::int FROM student_enrollments WHERE school_id=$1) AS enrollments, ' +
          '(SELECT COUNT(*)::int FROM teacher_period_assignments WHERE school_id=$1) AS subjectAssignments, ' +
          '(SELECT COUNT(*)::int FROM class_adviser_assignments WHERE school_id=$1) AS adviserAssignments, ' +
          '(SELECT school_code FROM schools WHERE school_id=$1) AS "schoolCode", ' +
          '(SELECT school_name FROM schools WHERE school_id=$1) AS "schoolName", ' +
          '$1::text AS "schoolId"',
          [req.auth.schoolId]
        )
      ]);
      return res.json({
        source: {
          ...(settings.rows[0] || {}),
          counts: counts.rows[0] || {}
        },
        receiver: receipt.rows[0] || null
      });
    } catch (err) {
      console.error('Cloud master-data status failed:', err.message);
      return res.status(500).json({ error: 'Could not load master-data synchronization status.' });
    }
  });

  app.post('/api/cloud-sync/master-data/push', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
    try {
      const config = await pool.query(
        'SELECT cloud_base_url, cloud_auth_token_ciphertext, cloud_auth_token_iv, ' +
        'cloud_auth_token_tag, last_connection_test_at, last_connection_test_url ' +
        'FROM school_cloud_sync_settings WHERE school_id=$1',
        [req.auth.schoolId]
      );
      const row = config.rows[0];
      if (!row?.cloud_base_url || !row.cloud_auth_token_ciphertext) {
        return res.status(409).json({ error: 'Save the cloud address and receiving credential first.' });
      }
      if (!row.last_connection_test_at || row.last_connection_test_url !== row.cloud_base_url) {
        return res.status(409).json({ error: 'Test the current cloud connection before sending master data.' });
      }

      const snapshot = await buildMasterDataSnapshot(pool, req.auth.schoolId);
      const payloadHash = hashPayload(snapshot);
      const token = decryptCloudToken(row);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      let response;
      try {
        response = await fetch(
          row.cloud_base_url.replace(/\/+$/, '') + '/api/cloud-sync/receive-master-data',
          {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ payload: snapshot }),
            signal: controller.signal
          }
        );
      } finally {
        clearTimeout(timeout);
      }
      const remote = await response.json().catch(() => ({}));
      if (!response.ok || remote.ok !== true || remote.schoolId !== req.auth.schoolId) {
        throw new Error(remote.error || `Cloud server returned HTTP ${response.status}.`);
      }

      await pool.query(
        'UPDATE school_cloud_sync_settings SET last_master_data_sync_at=NOW(), ' +
        'last_master_data_sync_counts=$2::jsonb, last_master_data_sync_hash=$3, ' +
        'last_master_data_sync_url=cloud_base_url, last_master_data_sync_error=NULL, ' +
        'updated_at=NOW() WHERE school_id=$1',
        [req.auth.schoolId, JSON.stringify(snapshot.counts), payloadHash]
      );
      return res.json({
        ok: true,
        schoolId: req.auth.schoolId,
        generatedAt: snapshot.generatedAt,
        counts: snapshot.counts,
        imported: remote.imported || {},
        receivedAt: remote.receivedAt,
        message: 'Master data was securely received by the matching cloud school. Existing cloud records were updated or retained; no cloud records were deleted.'
      });
    } catch (err) {
      await pool.query(
        'UPDATE school_cloud_sync_settings SET last_master_data_sync_error=$2, updated_at=NOW() WHERE school_id=$1',
        [req.auth.schoolId, String(err.message || 'Master-data push failed.').slice(0, 1000)]
      ).catch(() => {});
      console.error('Cloud master-data push failed:', err.message);
      return res.status(502).json({ error: 'Master-data push failed: ' + err.message });
    }
  });

  app.post('/api/cloud-sync/receive-master-data', authenticateCloudSync, async (req, res) => {
    const payload = req.body?.payload;
    const validationError = validateMasterDataPayload(payload, req.auth.schoolId);
    if (validationError) return res.status(400).json({ error: validationError });

    const payloadHash = hashPayload(payload);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [req.auth.schoolId]);

      const previousReceipt = await client.query(
        'SELECT source_generated_at FROM cloud_sync_master_data_receipts WHERE school_id=$1 FOR UPDATE',
        [req.auth.schoolId]
      );
      if (previousReceipt.rowCount &&
          Date.parse(payload.generatedAt) < new Date(previousReceipt.rows[0].source_generated_at).getTime()) {
        throw new Error('A newer master-data snapshot has already been received. Refresh the local source and push again.');
      }

      const schoolConflict = await client.query(
        'SELECT school_id FROM schools WHERE lower(school_code)=lower($1) AND school_id<>$2 LIMIT 1',
        [payload.school.schoolCode, req.auth.schoolId]
      );
      if (schoolConflict.rowCount) {
        throw new Error('Another school already uses this school code on the cloud server.');
      }
      const schoolResult = await client.query(
        'INSERT INTO schools(school_id,school_code,school_name,active) VALUES($1,$2,$3,$4) ' +
        'ON CONFLICT(school_id) DO UPDATE SET school_code=EXCLUDED.school_code, ' +
        'school_name=EXCLUDED.school_name, active=EXCLUDED.active, updated_at=NOW() ' +
        'RETURNING school_id',
        [req.auth.schoolId, payload.school.schoolCode, payload.school.schoolName, payload.school.active !== false]
      );
      if (!schoolResult.rowCount) throw new Error('The cloud school identity could not be provisioned.');

      const imported = {};
      const run = (name, rows, sql, allowNoop = false) =>
        importCollection(client, req.auth.schoolId, rows, sql, name, allowNoop);

      imported.schoolUsers = await run('staff account', payload.schoolUsers,
        `INSERT INTO school_users
          (school_id,user_id,username,display_name,password_hash,role,active,teacher_status,
           teacher_designations,login_enabled,created_at,updated_at)
         SELECT $1,x.user_id,'mirror_' || replace(x.user_id::text,'-',''),x.display_name,'!CLOUD_SYNC_LOGIN_DISABLED!',x.role,
                COALESCE(x.active,TRUE),COALESCE(x.teacher_status,'ACTIVE'),
                COALESCE(x.teacher_designations,ARRAY[]::text[]),FALSE,
                COALESCE(x.created_at,NOW()),COALESCE(x.updated_at,NOW())
         FROM jsonb_to_recordset($2::jsonb) AS x(
           user_id uuid,display_name text,role text,active boolean,
           teacher_status text,teacher_designations text[],created_at timestamptz,updated_at timestamptz)
         ON CONFLICT(user_id) DO UPDATE SET display_name=EXCLUDED.display_name,role=EXCLUDED.role,active=EXCLUDED.active,
           teacher_status=EXCLUDED.teacher_status,
           teacher_designations=EXCLUDED.teacher_designations,updated_at=EXCLUDED.updated_at
         WHERE school_users.school_id=EXCLUDED.school_id
         RETURNING 1`);

      imported.students = await run('student', payload.students,
        `INSERT INTO students
          (school_id,student_id,lrn,full_name,grade_level,section,parent_name,parent_mobile,
           active,sex,created_at,updated_at)
         SELECT $1,x.student_id,x.lrn,x.full_name,x.grade_level,x.section,NULL,'',
                COALESCE(x.active,TRUE),x.sex,COALESCE(x.created_at,NOW()),COALESCE(x.updated_at,NOW())
         FROM jsonb_to_recordset($2::jsonb) AS x(
           student_id text,lrn text,full_name text,grade_level text,section text,
           active boolean,sex varchar(10),created_at timestamptz,updated_at timestamptz)
         ON CONFLICT(student_id) DO UPDATE SET lrn=EXCLUDED.lrn,full_name=EXCLUDED.full_name,
           grade_level=EXCLUDED.grade_level,section=EXCLUDED.section,active=EXCLUDED.active,
           sex=EXCLUDED.sex,updated_at=EXCLUDED.updated_at
         WHERE students.school_id=EXCLUDED.school_id
         RETURNING 1`);

      imported.schoolSettings = await run('school reporting setting', payload.schoolSettings,
        `INSERT INTO school_settings(school_id,setting_key,setting_value)
         SELECT $1,x.setting_key,x.setting_value
         FROM jsonb_to_recordset($2::jsonb) AS x(setting_key text,setting_value jsonb)
         ON CONFLICT(school_id,setting_key) DO UPDATE SET
           setting_value=EXCLUDED.setting_value,updated_at=NOW()
         RETURNING 1`);

      imported.classPeriods = await run('class period', payload.classPeriods,
        `INSERT INTO class_periods
          (school_id,period_id,period_name,grade_level,section,subject_name,start_time,end_time,
           grace_minutes,active,created_at)
         SELECT $1,x.period_id,x.period_name,x.grade_level,x.section,x.subject_name,x.start_time,
                x.end_time,COALESCE(x.grace_minutes,0),COALESCE(x.active,TRUE),COALESCE(x.created_at,NOW())
         FROM jsonb_to_recordset($2::jsonb) AS x(
           period_id uuid,period_name text,grade_level text,section text,subject_name text,
           start_time time,end_time time,grace_minutes integer,active boolean,created_at timestamptz)
         ON CONFLICT(school_id,period_id) DO UPDATE SET period_name=EXCLUDED.period_name,
           grade_level=EXCLUDED.grade_level,section=EXCLUDED.section,subject_name=EXCLUDED.subject_name,
           start_time=EXCLUDED.start_time,end_time=EXCLUDED.end_time,
           grace_minutes=EXCLUDED.grace_minutes,active=EXCLUDED.active
         RETURNING 1`);

      imported.schoolYears = await run('school year', payload.schoolYears,
        `INSERT INTO school_years
          (school_id,school_year_id,school_year_label,start_date,end_date,status,created_by_user_id,created_at,updated_at)
         SELECT $1,x.school_year_id,x.school_year_label,x.start_date,x.end_date,x.status,
                x.created_by_user_id,COALESCE(x.created_at,NOW()),COALESCE(x.updated_at,NOW())
         FROM jsonb_to_recordset($2::jsonb) AS x(
           school_year_id uuid,school_year_label varchar(20),start_date date,end_date date,status varchar(12),
           created_by_user_id uuid,created_at timestamptz,updated_at timestamptz)
         ON CONFLICT(school_year_id) DO UPDATE SET school_year_label=EXCLUDED.school_year_label,
           start_date=EXCLUDED.start_date,end_date=EXCLUDED.end_date,status=EXCLUDED.status,
           created_by_user_id=EXCLUDED.created_by_user_id,updated_at=EXCLUDED.updated_at
         WHERE school_years.school_id=EXCLUDED.school_id
         RETURNING 1`);

      imported.studentEnrollments = await run('student enrollment', payload.studentEnrollments,
        `INSERT INTO student_enrollments
          (school_id,enrollment_id,student_id,school_year_id,grade_level,section,enrollment_date,
           enrollment_status,status_effective_date,created_by_user_id,created_at,updated_at)
         SELECT $1,x.enrollment_id,x.student_id,x.school_year_id,x.grade_level,x.section,x.enrollment_date,
                COALESCE(x.enrollment_status,'ENROLLED'),x.status_effective_date,
                x.created_by_user_id,COALESCE(x.created_at,NOW()),COALESCE(x.updated_at,NOW())
         FROM jsonb_to_recordset($2::jsonb) AS x(
           enrollment_id uuid,student_id text,school_year_id uuid,grade_level text,section text,
           enrollment_date date,enrollment_status varchar(20),status_effective_date date,
           created_by_user_id uuid,created_at timestamptz,updated_at timestamptz)
         ON CONFLICT(enrollment_id) DO UPDATE SET grade_level=EXCLUDED.grade_level,
           section=EXCLUDED.section,enrollment_date=EXCLUDED.enrollment_date,
           enrollment_status=EXCLUDED.enrollment_status,status_effective_date=EXCLUDED.status_effective_date,
           created_by_user_id=EXCLUDED.created_by_user_id,updated_at=EXCLUDED.updated_at
         WHERE student_enrollments.school_id=EXCLUDED.school_id
         RETURNING 1`);

      imported.studentMovements = await run('student movement', payload.studentMovements,
        `INSERT INTO student_movements
          (movement_id,school_id,student_id,school_year_id,enrollment_id,movement_type,effective_date,
           from_grade_level,from_section,to_grade_level,to_section,destination_school_name,
           destination_school_id,official_code,recorded_by_user_id,created_at)
         SELECT x.movement_id,$1,x.student_id,x.school_year_id,x.enrollment_id,x.movement_type,
                x.effective_date,x.from_grade_level,x.from_section,x.to_grade_level,x.to_section,
                x.destination_school_name,x.destination_school_id,x.official_code,
                x.recorded_by_user_id,COALESCE(x.created_at,NOW())
         FROM jsonb_to_recordset($2::jsonb) AS x(
           movement_id uuid,student_id text,school_year_id uuid,enrollment_id uuid,movement_type varchar(30),
           effective_date date,from_grade_level text,from_section text,to_grade_level text,to_section text,
           destination_school_name text,destination_school_id text,official_code text,
           recorded_by_user_id uuid,created_at timestamptz)
         ON CONFLICT(movement_id) DO NOTHING
         RETURNING 1`, true);

      imported.schoolCalendar = await run('school calendar', payload.schoolCalendar,
        `INSERT INTO school_calendar
          (calendar_id,school_id,school_year_id,calendar_date,day_type,label,remarks,
           created_by_user_id,created_at,updated_at)
         SELECT x.calendar_id,$1,x.school_year_id,x.calendar_date,x.day_type,x.label,x.remarks,
                x.created_by_user_id,COALESCE(x.created_at,NOW()),COALESCE(x.updated_at,NOW())
         FROM jsonb_to_recordset($2::jsonb) AS x(
           calendar_id uuid,school_year_id uuid,calendar_date date,day_type varchar(25),label text,
           remarks text,created_by_user_id uuid,created_at timestamptz,updated_at timestamptz)
         ON CONFLICT(school_id,school_year_id,calendar_date) DO UPDATE SET
           day_type=EXCLUDED.day_type,label=EXCLUDED.label,remarks=EXCLUDED.remarks,
           created_by_user_id=EXCLUDED.created_by_user_id,updated_at=EXCLUDED.updated_at
         RETURNING 1`);

      imported.teacherPeriodAssignments = await run('subject assignment', payload.teacherPeriodAssignments,
        `INSERT INTO teacher_period_assignments(school_id,assignment_id,teacher_user_id,period_id,assigned_at)
         SELECT $1,x.assignment_id,x.teacher_user_id,x.period_id,COALESCE(x.assigned_at,NOW())
         FROM jsonb_to_recordset($2::jsonb) AS x(
           assignment_id uuid,teacher_user_id uuid,period_id uuid,assigned_at timestamptz)
         ON CONFLICT(school_id,teacher_user_id,period_id) DO UPDATE SET assigned_at=EXCLUDED.assigned_at
         RETURNING 1`);

      imported.teacherPeriodSubstitutions = await run('teacher substitution', payload.teacherPeriodSubstitutions,
        `INSERT INTO teacher_period_substitutions
          (substitution_id,school_id,period_id,original_teacher_user_id,substitute_teacher_user_id,
           start_date,end_date,status,created_by_user_id,created_at,updated_at,cancelled_at)
         SELECT x.substitution_id,$1,x.period_id,x.original_teacher_user_id,x.substitute_teacher_user_id,
                x.start_date,x.end_date,x.status,x.created_by_user_id,
                COALESCE(x.created_at,NOW()),COALESCE(x.updated_at,NOW()),x.cancelled_at
         FROM jsonb_to_recordset($2::jsonb) AS x(
           substitution_id uuid,period_id uuid,original_teacher_user_id uuid,substitute_teacher_user_id uuid,
           start_date date,end_date date,status text,created_by_user_id uuid,
           created_at timestamptz,updated_at timestamptz,cancelled_at timestamptz)
         ON CONFLICT(substitution_id) DO UPDATE SET period_id=EXCLUDED.period_id,
           original_teacher_user_id=EXCLUDED.original_teacher_user_id,
           substitute_teacher_user_id=EXCLUDED.substitute_teacher_user_id,
           start_date=EXCLUDED.start_date,end_date=EXCLUDED.end_date,status=EXCLUDED.status,
           created_by_user_id=EXCLUDED.created_by_user_id,updated_at=EXCLUDED.updated_at,
           cancelled_at=EXCLUDED.cancelled_at
         RETURNING 1`);

      imported.classAdviserAssignments = await run('Class Adviser assignment', payload.classAdviserAssignments,
        `INSERT INTO class_adviser_assignments
          (assignment_id,school_id,adviser_user_id,grade_level,section,assigned_by,assigned_at)
         SELECT x.assignment_id,$1,x.adviser_user_id,x.grade_level,x.section,x.assigned_by,
                COALESCE(x.assigned_at,NOW())
         FROM jsonb_to_recordset($2::jsonb) AS x(
           assignment_id uuid,adviser_user_id uuid,grade_level text,section text,
           assigned_by uuid,assigned_at timestamptz)
         ON CONFLICT(school_id,grade_level,section) DO UPDATE SET
           adviser_user_id=EXCLUDED.adviser_user_id,assigned_by=EXCLUDED.assigned_by,
           assigned_at=EXCLUDED.assigned_at
         RETURNING 1`);

      imported.specialProgramTypes = await run('special-program type', payload.specialProgramTypes,
        `INSERT INTO special_program_types
          (program_type_id,school_id,program_code,program_name,description,active,created_by_user_id,created_at)
         SELECT x.program_type_id,$1,x.program_code,x.program_name,x.description,
                COALESCE(x.active,TRUE),x.created_by_user_id,COALESCE(x.created_at,NOW())
         FROM jsonb_to_recordset($2::jsonb) AS x(
           program_type_id uuid,program_code varchar(30),program_name varchar(120),
           description text,active boolean,created_by_user_id uuid,created_at timestamptz)
         ON CONFLICT(program_type_id) DO UPDATE SET program_code=EXCLUDED.program_code,
           program_name=EXCLUDED.program_name,description=EXCLUDED.description,
           active=EXCLUDED.active,created_by_user_id=EXCLUDED.created_by_user_id
         WHERE special_program_types.school_id=EXCLUDED.school_id
         RETURNING 1`);

      imported.studentSpecialPrograms = await run('student special-program assignment', payload.studentSpecialPrograms,
        `INSERT INTO student_special_programs
          (student_program_id,school_id,student_id,school_year_id,enrollment_id,program_type_id,
           is_primary,start_date,end_date,status,notes,assigned_by_user_id,created_at,updated_at)
         SELECT x.student_program_id,$1,x.student_id,x.school_year_id,x.enrollment_id,x.program_type_id,
                x.is_primary,x.start_date,x.end_date,x.status,NULL,x.assigned_by_user_id,
                COALESCE(x.created_at,NOW()),COALESCE(x.updated_at,NOW())
         FROM jsonb_to_recordset($2::jsonb) AS x(
           student_program_id uuid,student_id text,school_year_id uuid,enrollment_id uuid,
           program_type_id uuid,is_primary boolean,start_date date,end_date date,status varchar(16),
           assigned_by_user_id uuid,created_at timestamptz,updated_at timestamptz)
         ON CONFLICT(student_program_id) DO UPDATE SET is_primary=EXCLUDED.is_primary,
           start_date=EXCLUDED.start_date,end_date=EXCLUDED.end_date,status=EXCLUDED.status,
           assigned_by_user_id=EXCLUDED.assigned_by_user_id,updated_at=EXCLUDED.updated_at
         WHERE student_special_programs.school_id=EXCLUDED.school_id
         RETURNING 1`);

      const recordCounts = { ...payload.counts, imported };
      await client.query(
        'INSERT INTO cloud_sync_master_data_receipts ' +
        '(school_id,schema_version,source_generated_at,received_at,payload_hash,record_counts) ' +
        'VALUES($1,$2,$3,NOW(),$4,$5::jsonb) ' +
        'ON CONFLICT(school_id) DO UPDATE SET schema_version=EXCLUDED.schema_version, ' +
        'source_generated_at=EXCLUDED.source_generated_at,received_at=NOW(), ' +
        'payload_hash=EXCLUDED.payload_hash,record_counts=EXCLUDED.record_counts',
        [req.auth.schoolId, payload.schemaVersion, payload.generatedAt, payloadHash, JSON.stringify(recordCounts)]
      );
      await client.query('COMMIT');
      return res.json({
        ok: true,
        schoolId: req.auth.schoolId,
        receivedAt: new Date().toISOString(),
        payloadHash,
        imported
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Cloud master-data receive failed:', err.message);
      return res.status(409).json({ error: 'Cloud master-data import was not completed: ' + err.message });
    } finally {
      client.release();
    }
  });
}

module.exports = {
  registerCloudMasterDataRoutes,
  validateMasterDataPayload,
  buildMasterDataSnapshot,
  hashPayload,
  COLLECTIONS
};
