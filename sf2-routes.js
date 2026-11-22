'use strict';

const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('node:crypto');
const MAX_OFFICIAL_SF2_BYTES = 8 * 1024 * 1024;
const TEMPLATE = path.join(__dirname, 'templates', 'School Form 2 (SF2) Daily Attendance Report of Learners.xlsx');
const SF2_STORAGE = path.join(__dirname, 'storage', 'sf2');
const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
const validMonth = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value || '');
const safePart = value => String(value || '').replace(/[^a-z0-9_-]/gi, '_').slice(0, 80) || 'section';

function datesFor(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const dates = [];
  for (let day = 1; day <= last; day++) {
    const date = new Date(Date.UTC(year, monthNumber - 1, day));
    if (![0, 6].includes(date.getUTCDay())) dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

function teacherHas(req, designation) {
  return req.auth?.role === 'TEACHER' &&
    Array.isArray(req.auth.teacherDesignations) &&
    req.auth.teacherDesignations.includes(designation);
}

function registerSf2Routes(app, pool, { authenticateSchoolClient, requireSchoolUser, requireSchoolAdmin, requireSchoolAdminOrDepartmentHead }) {
  const migration = pool.query(`
    ALTER TABLE students ADD COLUMN IF NOT EXISTS sex VARCHAR(10);
    CREATE TABLE IF NOT EXISTS sf2_daily_overrides(
      school_id UUID NOT NULL, student_id TEXT NOT NULL, school_date DATE NOT NULL,
      status VARCHAR(20) NOT NULL CHECK(status='ABSENT'),
      absence_type VARCHAR(20) NOT NULL DEFAULT 'UNEXCUSED' CHECK(absence_type IN ('EXCUSED','UNEXCUSED')),
      note TEXT, recorded_by_user_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(school_id,student_id,school_date),
      FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,student_id) ON DELETE CASCADE,
      FOREIGN KEY(school_id,recorded_by_user_id) REFERENCES school_users(school_id,user_id));
    CREATE INDEX IF NOT EXISTS sf2_daily_overrides_month_idx
      ON sf2_daily_overrides(school_id,school_date);
    CREATE TABLE IF NOT EXISTS sf2_submissions(
      submission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
      reporting_month DATE NOT NULL CHECK(EXTRACT(DAY FROM reporting_month)=1),
      grade_level TEXT NOT NULL, section TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision > 0),
      status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK(status IN ('SUBMITTED','COLLECTED')),
      is_current BOOLEAN NOT NULL DEFAULT TRUE,
      file_name TEXT NOT NULL, file_path TEXT NOT NULL,
      submitted_by_user_id UUID NOT NULL,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      collected_by_user_id UUID, collected_at TIMESTAMPTZ,
      summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      FOREIGN KEY(school_id,submitted_by_user_id)
        REFERENCES school_users(school_id,user_id),
      FOREIGN KEY(school_id,collected_by_user_id)
        REFERENCES school_users(school_id,user_id),
      UNIQUE(school_id,reporting_month,grade_level,section,revision));
    CREATE UNIQUE INDEX IF NOT EXISTS sf2_submissions_current_section_month_idx
      ON sf2_submissions(school_id,reporting_month,grade_level,section) WHERE is_current=TRUE;
    CREATE INDEX IF NOT EXISTS sf2_submissions_school_month_idx
      ON sf2_submissions(school_id,reporting_month DESC,status);
  `);

  async function getSectionAccess(req, gradeLevel, section, requestedMode = '') {
    if (req.auth.role === 'SCHOOL_ADMIN') return { allowed: true, mode: 'OFFICIAL', canEditSex: true, canConfirmAbsence: false, canSubmit: false };
    if (req.auth.role === 'DEPARTMENT_HEAD') return { allowed: true, mode: 'OFFICIAL', readOnly: true, canEditSex: false, canConfirmAbsence: false, canSubmit: false };
    if (req.auth.role !== 'TEACHER') return { allowed: false };

    if (requestedMode === 'PERSONAL' && teacherHas(req, 'SUBJECT_TEACHER')) {
      const personalAssignment = await pool.query(
        `SELECT 1
         FROM teacher_period_assignments a
         JOIN class_periods p ON p.school_id=a.school_id AND p.period_id=a.period_id
         WHERE a.school_id=$1 AND a.teacher_user_id=$2 AND p.grade_level=$3 AND p.section=$4
         UNION ALL
         SELECT 1
         FROM teacher_period_substitutions ts
         JOIN class_periods p ON p.school_id=ts.school_id AND p.period_id=ts.period_id
         WHERE ts.school_id=$1 AND ts.substitute_teacher_user_id=$2
           AND ts.status='ACTIVE' AND ts.end_date >= (NOW() AT TIME ZONE 'Asia/Manila')::date
           AND p.grade_level=$3 AND p.section=$4
         LIMIT 1`,
        [req.auth.schoolId, req.auth.userId, gradeLevel, section]
      );
      return personalAssignment.rowCount
        ? { allowed: true, mode: 'PERSONAL', readOnly: true, canEditSex: false, canConfirmAbsence: false, canSubmit: false }
        : { allowed: false };
    }

    if (requestedMode === 'OFFICIAL' && !teacherHas(req, 'CLASS_ADVISER')) return { allowed: false };

    if (teacherHas(req, 'CLASS_ADVISER')) {
      const adviser = await pool.query(
        `SELECT 1 FROM class_adviser_assignments
         WHERE school_id=$1 AND adviser_user_id=$2 AND grade_level=$3 AND section=$4 LIMIT 1`,
        [req.auth.schoolId, req.auth.userId, gradeLevel, section]
      );
      if (adviser.rowCount) return { allowed: true, mode: 'OFFICIAL', canEditSex: true, canConfirmAbsence: true, canSubmit: true };
    }

    if (teacherHas(req, 'SUBJECT_TEACHER')) {
      const assignment = await pool.query(
        `SELECT 1
         FROM teacher_period_assignments a
         JOIN class_periods p ON p.school_id=a.school_id AND p.period_id=a.period_id
         WHERE a.school_id=$1 AND a.teacher_user_id=$2 AND p.grade_level=$3 AND p.section=$4
         UNION ALL
         SELECT 1
         FROM teacher_period_substitutions ts
         JOIN class_periods p ON p.school_id=ts.school_id AND p.period_id=ts.period_id
         WHERE ts.school_id=$1 AND ts.substitute_teacher_user_id=$2
           AND ts.status='ACTIVE' AND ts.end_date >= (NOW() AT TIME ZONE 'Asia/Manila')::date
           AND p.grade_level=$3 AND p.section=$4
         LIMIT 1`,
        [req.auth.schoolId, req.auth.userId, gradeLevel, section]
      );
      if (assignment.rowCount) return { allowed: true, mode: 'PERSONAL', readOnly: true, canEditSex: false, canConfirmAbsence: false, canSubmit: false };
    }
    return { allowed: false };
  }

  async function getReportData(req, month, gradeLevel, section, access) {
    const dateFrom = `${month}-01`;
    const students = await pool.query(
      `SELECT s.student_id AS id,s.full_name AS name,COALESCE(en.grade_level,s.grade_level) AS "gradeLevel",COALESCE(en.section,s.section) AS section,s.sex
       FROM students s
       LEFT JOIN LATERAL (SELECT e.grade_level,e.section FROM student_enrollments e JOIN school_years sy ON sy.school_id=e.school_id AND sy.school_year_id=e.school_year_id WHERE e.school_id=s.school_id AND e.student_id=s.student_id AND sy.status='ACTIVE' AND e.enrollment_status='ENROLLED' ORDER BY e.created_at DESC LIMIT 1) en ON TRUE
       WHERE s.school_id=$1 AND s.active=TRUE AND COALESCE(en.grade_level,s.grade_level)=$2 AND COALESCE(en.section,s.section)=$3
       ORDER BY s.full_name`,
      [req.auth.schoolId, gradeLevel, section]
    );

    let present;
    if (access.mode === 'PERSONAL') {
      present = await pool.query(
        `SELECT DISTINCT e.student_id AS id,e.school_date::text AS date
         FROM attendance_events e
         JOIN students s ON s.school_id=e.school_id AND s.student_id=e.student_id
         LEFT JOIN LATERAL (SELECT en.grade_level,en.section FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1) active_enrollment ON TRUE
         WHERE e.school_id=$1 AND COALESCE(active_enrollment.grade_level,s.grade_level)=$3 AND COALESCE(active_enrollment.section,s.section)=$4
           AND e.attendance_scope='CLASS' AND e.event_type='TIME_IN'
           AND COALESCE(e.sync_status,'ACCEPTED')='ACCEPTED'
           AND e.recorded_by_user_id=$2
           AND e.school_date >= $5::date AND e.school_date < ($5::date + INTERVAL '1 month')
           AND (
             EXISTS (SELECT 1 FROM teacher_period_assignments a
                     JOIN class_periods p ON p.school_id=a.school_id AND p.period_id=a.period_id
                     WHERE a.school_id=e.school_id AND a.teacher_user_id=$2 AND p.period_id=e.period_id
                       AND p.grade_level=$3 AND p.section=$4)
             OR EXISTS (SELECT 1 FROM teacher_period_substitutions ts
                        JOIN class_periods p ON p.school_id=ts.school_id AND p.period_id=ts.period_id
                        WHERE ts.school_id=e.school_id AND ts.substitute_teacher_user_id=$2
                          AND ts.period_id=e.period_id AND ts.status='ACTIVE'
                          AND e.school_date BETWEEN ts.start_date AND ts.end_date
                          AND p.grade_level=$3 AND p.section=$4)
           )`,
        [req.auth.schoolId, req.auth.userId, gradeLevel, section, dateFrom]
      );
    } else {
      present = await pool.query(
        `SELECT DISTINCT e.student_id AS id,e.school_date::text AS date
         FROM attendance_events e
         JOIN students s ON s.school_id=e.school_id AND s.student_id=e.student_id
         LEFT JOIN LATERAL (SELECT en.grade_level,en.section FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1) active_enrollment ON TRUE
         WHERE e.school_id=$1 AND COALESCE(active_enrollment.grade_level,s.grade_level)=$2 AND COALESCE(active_enrollment.section,s.section)=$3
           AND e.attendance_scope IN ('CLASS','ADVISORY') AND e.event_type='TIME_IN'
           AND COALESCE(e.sync_status,'ACCEPTED')='ACCEPTED'
           AND e.school_date >= $4::date AND e.school_date < ($4::date + INTERVAL '1 month')`,
        [req.auth.schoolId, gradeLevel, section, dateFrom]
      );
    }


    // Teacher-confirmed manual marks are a second evidence source, not QR events.
    // Only positive marks establish daily presence. Negative period marks remain
    // evidence for adviser review and never independently mark a whole-day absence.
    const manual = await pool.query(
      `SELECT m.student_id AS id, m.school_date::text AS date, m.status,
              m.period_id AS "periodId", m.marked_by AS "markedBy"
       FROM manual_attendance_marks m
       JOIN students s ON s.school_id=m.school_id AND s.student_id=m.student_id
       LEFT JOIN LATERAL (
         SELECT en.grade_level,en.section FROM student_enrollments en
         JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id
         WHERE en.school_id=s.school_id AND en.student_id=s.student_id
           AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED'
         ORDER BY en.created_at DESC LIMIT 1
       ) active_enrollment ON TRUE
       WHERE m.school_id=$1
         AND COALESCE(active_enrollment.grade_level,s.grade_level)=$2
         AND COALESCE(active_enrollment.section,s.section)=$3
         AND m.school_date >= $4::date AND m.school_date < ($4::date + INTERVAL '1 month')
         AND (
           $5::boolean=FALSE
           OR m.marked_by=$6
         )`,
      [req.auth.schoolId,gradeLevel,section,dateFrom,access.mode==='PERSONAL',req.auth.userId]
    );
    // Detect QR Present vs Manual Absent for the SAME class period only.
    // A learner absent in one subject but present in another is not a contradiction.
    const periodQrConflicts = await pool.query(
      `SELECT DISTINCT m.student_id AS id, m.school_date::text AS date
       FROM manual_attendance_marks m
       JOIN class_periods p ON p.school_id=m.school_id AND p.period_id=m.period_id
       JOIN attendance_events e ON e.school_id=m.school_id
         AND e.student_id=m.student_id AND e.school_date=m.school_date AND e.period_id=m.period_id
       WHERE m.school_id=$1 AND p.grade_level=$2 AND p.section=$3
         AND m.school_date >= $4::date AND m.school_date < ($4::date + INTERVAL '1 month')
         AND m.status IN ('ABSENT','EXCUSED')
         AND e.attendance_scope='CLASS' AND e.event_type='TIME_IN'
         AND COALESCE(e.sync_status,'ACCEPTED')='ACCEPTED'
         AND ($5::boolean=FALSE OR m.marked_by=$6)`,
      [req.auth.schoolId,gradeLevel,section,dateFrom,access.mode==='PERSONAL',req.auth.userId]
    );

    let absent = { rows: [] };
    let tardy = { rows: [] };

    if (access.mode === 'OFFICIAL') {
      absent = await pool.query(
        `SELECT o.student_id AS id,o.school_date::text AS date,o.absence_type AS "absenceType"
         FROM sf2_daily_overrides o
         JOIN students s ON s.school_id=o.school_id AND s.student_id=o.student_id
         LEFT JOIN LATERAL (SELECT en.grade_level,en.section FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1) active_enrollment ON TRUE
         WHERE o.school_id=$1 AND COALESCE(active_enrollment.grade_level,s.grade_level)=$2 AND COALESCE(active_enrollment.section,s.section)=$3
           AND o.school_date >= $4::date AND o.school_date < ($4::date + INTERVAL '1 month')`,
        [req.auth.schoolId, gradeLevel, section, dateFrom]
      );

      tardy = await pool.query(
        `SELECT e.student_id AS id,COUNT(DISTINCT e.school_date)::int AS count
         FROM attendance_events e
         JOIN students s ON s.school_id=e.school_id AND s.student_id=e.student_id
         LEFT JOIN LATERAL (SELECT en.grade_level,en.section FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED' ORDER BY en.created_at DESC LIMIT 1) active_enrollment ON TRUE
         WHERE e.school_id=$1 AND COALESCE(active_enrollment.grade_level,s.grade_level)=$2 AND COALESCE(active_enrollment.section,s.section)=$3
           AND e.attendance_scope='SCHOOL'
           AND e.event_type='TIME_IN'
           AND e.late=TRUE
           AND e.sync_status='ACCEPTED'
           AND e.school_date >= $4::date
           AND e.school_date < ($4::date + INTERVAL '1 month')
         GROUP BY e.student_id`,
        [req.auth.schoolId, gradeLevel, section, dateFrom]
      );
    }

    const dates = datesFor(month);
    const presentSet = new Set(present.rows.map(row => `${row.id}|${String(row.date).slice(0, 10)}`));
    const manualPresentSet = new Set(manual.rows.filter(row => ['PRESENT','LATE'].includes(row.status))
      .map(row => `${row.id}|${String(row.date).slice(0, 10)}`));
    for (const key of manualPresentSet) presentSet.add(key);
    const manualConflictSet = new Set(periodQrConflicts.rows.map(row => `${row.id}|${String(row.date).slice(0, 10)}`));
    const qrPresentSet = new Set(present.rows.map(row => `${row.id}|${String(row.date).slice(0, 10)}`));
    const sourceByDay = new Map();
    for (const row of present.rows) {
      const key = `${row.id}|${String(row.date).slice(0, 10)}`;
      if (!sourceByDay.has(key)) sourceByDay.set(key,new Set());
      sourceByDay.get(key).add('QR');
    }
    for (const row of manual.rows) {
      const key = `${row.id}|${String(row.date).slice(0, 10)}`;
      if (!sourceByDay.has(key)) sourceByDay.set(key,new Set());
      sourceByDay.get(key).add('MANUAL_'+row.status);
    }
    const absentMap = new Map(absent.rows.map(row => [`${row.id}|${String(row.date).slice(0, 10)}`, row.absenceType]));
    const tardyMap = new Map(tardy.rows.map(row => [row.id, Number(row.count) || 0]));

    const conflictSet = new Set([
      ...[...presentSet].filter(key => absentMap.has(key)),
      ...manualConflictSet
    ]);

    const rows = students.rows.map(student => ({
      ...student,
      tardyCount: tardyMap.get(student.id) || 0,
      sources: dates.map(date => [...(sourceByDay.get(`${student.id}|${date}`) || [])].sort()),
      days: dates.map(date => {
        const key = `${student.id}|${date}`;
        if (conflictSet.has(key)) return 'CONFLICT';
        if (presentSet.has(key)) return 'PRESENT';
        if (access.mode === 'PERSONAL') return 'NO_RECORD';
        if (absentMap.has(`${student.id}|${date}`)) return 'ABSENT';
        return 'PENDING';
      })
    }));

    return {
      dates,
      students: rows,
      summary: {
        manualPresentDays: new Set([...manualPresentSet]).size,
        qrPresentDays: new Set([...qrPresentSet]).size,
        present: rows.reduce((count, row) => count + row.days.filter(status => status === 'PRESENT').length, 0),
        absent: rows.reduce((count, row) => count + row.days.filter(status => status === 'ABSENT').length, 0),
        pending: rows.reduce((count, row) => count + row.days.filter(status => status === 'PENDING').length, 0),
        conflicts: rows.reduce((count, row) => count + row.days.filter(status => status === 'CONFLICT').length, 0),
        noRecord: rows.reduce((count, row) => count + row.days.filter(status => status === 'NO_RECORD').length, 0),
        missingSex: rows.filter(row => !['MALE', 'FEMALE'].includes(String(row.sex || '').toUpperCase())).length
      }
    };
  }

  function firstFridayInJune(year) {
    const juneFirst = new Date(Date.UTC(year, 5, 1));
    juneFirst.setUTCDate(1 + (5 - juneFirst.getUTCDay() + 7) % 7);
    return juneFirst.toISOString().slice(0, 10);
  }

  function fiveConsecutiveAbsences(days) {
    let sequence = 0;
    for (const status of days) {
      sequence = status === 'ABSENT' ? sequence + 1 : 0;
      if (sequence >= 5) return true;
    }
    return false;
  }

  async function getMonthlySf2Summary(req, month, gradeLevel, section, data) {
    const [year, monthNumber] = month.split('-').map(Number);
    const firstDay = month + '-01';
    const nextMonth = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
    const schoolYear = await pool.query(
      "SELECT start_date FROM school_years WHERE school_id=$1 AND status='ACTIVE' ORDER BY start_date DESC LIMIT 1",
      [req.auth.schoolId]
    );
    const schoolYearStart = schoolYear.rowCount
      ? Number(new Date(schoolYear.rows[0].start_date).getUTCFullYear())
      : (monthNumber < 6 ? year - 1 : year);
    const cutoff = firstFridayInJune(schoolYearStart);
    const enrollments = await pool.query(
      'SELECT s.sex,e.student_id,e.enrollment_date AS "enrollmentDate" ' +
      'FROM student_enrollments e JOIN school_years sy ON sy.school_id=e.school_id AND sy.school_year_id=e.school_year_id ' +
      'JOIN students s ON s.school_id=e.school_id AND s.student_id=e.student_id ' +
      "WHERE e.school_id=$1 AND sy.status='ACTIVE' AND e.grade_level=$2 AND e.section=$3",
      [req.auth.schoolId, gradeLevel, section]
    );
    const movements = await pool.query(
      'SELECT s.sex,m.movement_type AS type,COUNT(DISTINCT m.student_id)::int AS count ' +
      'FROM student_movements m JOIN students s ON s.school_id=m.school_id AND s.student_id=m.student_id ' +
      'WHERE m.school_id=$1 AND m.effective_date >= $2::date AND m.effective_date < $3::date ' +
      "AND ((m.movement_type IN ('TRANSFER_OUT','DROPOUT') AND m.from_grade_level=$4 AND m.from_section=$5) " +
      "OR (m.movement_type='TRANSFER_IN' AND m.to_grade_level=$4 AND m.to_section=$5)) " +
      'GROUP BY s.sex,m.movement_type',
      [req.auth.schoolId, firstDay, nextMonth, gradeLevel, section]
    );
    const bySex = sex => {
      const learners = data.students.filter(student => String(student.sex || '').toUpperCase() === sex);
      const early = enrollments.rows.filter(row =>
        String(row.sex || '').toUpperCase() === sex && new Date(row.enrollmentDate).toISOString().slice(0,10) <= cutoff
      ).length;
      const late = enrollments.rows.filter(row => {
        if (String(row.sex || '').toUpperCase() !== sex) return false;
        const date = new Date(row.enrollmentDate).toISOString().slice(0,10);
        return date > cutoff && date >= firstDay && date < nextMonth;
      }).length;
      const presentDays = learners.reduce((count, learner) =>
        count + learner.days.filter(day => day === 'PRESENT').length, 0);
      const registered = learners.length;
      const countMoves = type => movements.rows
        .filter(item => String(item.sex || '').toUpperCase() === sex && item.type === type)
        .reduce((count, item) => count + Number(item.count || 0), 0);
      return {
        early, late, registered, presentDays,
        consecutive: learners.filter(learner => fiveConsecutiveAbsences(learner.days)).length,
        dropout: countMoves('DROPOUT'),
        transferOut: countMoves('TRANSFER_OUT'),
        transferIn: countMoves('TRANSFER_IN')
      };
    };
    return {male:bySex('MALE'),female:bySex('FEMALE'),days:data.dates.length};
  }

  async function buildOfficialWorkbook(req, month, gradeLevel, section, data, personalCopy = false) {
    try {
      await fs.access(TEMPLATE);
    } catch {
      const error = new Error('Official DepEd SF2 template is missing.');
      error.status = 500;
      throw error;
    }

    if (data.dates.length > 25) {
      const error = new Error('The selected month has more than 25 weekdays; confirm the school calendar before exporting.');
      error.status = 409;
      throw error;
    }
    if (!personalCopy && data.summary.conflicts) {
      const error = new Error(`${data.summary.conflicts} learner-day record(s) have conflicting attendance: an accepted check-in and a confirmed absence exist for the same date. A Class Adviser must resolve these conflicts before official SF2 generation.`);
      error.status = 409;
      throw error;
    }
    if (!personalCopy && data.summary.pending) {
      const error = new Error(`${data.summary.pending} learner-day record(s) are unresolved. A Class Adviser must review the full subject attendance before confirming an absence.`);
      error.status = 409;
      throw error;
    }
    if (data.summary.missingSex) {
      const error = new Error(`${data.summary.missingSex} learner(s) need Male/Female classification before official SF2 generation.`);
      error.status = 409;
      throw error;
    }

    const boys = data.students.filter(student => String(student.sex).toUpperCase() === 'MALE');
    const girls = data.students.filter(student => String(student.sex).toUpperCase() === 'FEMALE');

    if (boys.length > 21 || girls.length > 25) {
      const error = new Error(`The official SF2 template supports 21 male learners and 25 female learners. Current section: ${boys.length} male, ${girls.length} female.`);
      error.status = 409;
      throw error;
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(TEMPLATE);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      const error = new Error('The official SF2 workbook does not contain a worksheet.');
      error.status = 500;
      throw error;
    }

    const [year, monthNumber] = month.split('-').map(Number);
    const school = await pool.query(
      `SELECT setting_key,setting_value FROM school_settings
       WHERE school_id=$1 AND setting_key IN ('school_name','school_id','school_year')`,
      [req.auth.schoolId]
    );

    const config = Object.fromEntries(school.rows.map(row => [row.setting_key, row.setting_value]));
    const setting = key => {
      const value = config[key];
      return typeof value === 'string' ? value : (value?.value || value?.name || '');
    };

    // Official template header fields: write only to merged-cell anchors.
    worksheet.getCell('C6').value = setting('school_id') || String(req.auth.schoolId);
    worksheet.getCell('K6').value = setting('school_year') || `${year}-${year + 1}`;
    worksheet.getCell('X6').value = MONTHS[monthNumber - 1];
    worksheet.getCell('C8').value = personalCopy
      ? `UNOFFICIAL SUBJECT COPY — ${setting('school_name') || 'SCHOOL NAME'}`
      : (setting('school_name') || 'SCHOOL NAME');
    if (personalCopy) {
      worksheet.getCell('C8').alignment = { ...worksheet.getCell('C8').alignment, shrinkToFit: true, vertical: 'middle' };
      worksheet.name = 'SF2 Subject Copy';
    }
    worksheet.getCell('X8').value = gradeLevel;
    worksheet.getCell('AC8').value = section;

    // Row 10 is a merged instruction cell and must remain untouched.
    // Dates go in row 11; weekday abbreviations go in row 12.
    for (let dayIndex = 0; dayIndex < 25; dayIndex++) {
      const column = 4 + dayIndex;
      worksheet.getCell(11, column).value = null;
      worksheet.getCell(12, column).value = null;
    }

    data.dates.forEach((date, index) => {
      const day = new Date(`${date}T00:00:00Z`);
      const column = 4 + index;
      worksheet.getCell(11, column).value = day;
      worksheet.getCell(11, column).numFmt = 'd';
      worksheet.getCell(12, column).value = ['', 'M', 'T', 'W', 'TH', 'F', ''][day.getUTCDay()];
    });

    const fillGroup = (students, firstRow, capacity, totalRow) => {
      const dailyPresent = Array(data.dates.length).fill(0);

      for (let index = 0; index < capacity; index++) {
        const row = firstRow + index;
        const student = students[index];

        worksheet.getCell(row, 1).value = student ? index + 1 : null;
        worksheet.getCell(row, 2).value = student ? student.name : null;

        for (let dayIndex = 0; dayIndex < 25; dayIndex++) {
          const column = 4 + dayIndex;
          const cell = worksheet.getCell(row, column);
          cell.value = null;

          if (!student || dayIndex >= data.dates.length) continue;

          const status = student.days[dayIndex];
          if (status === 'ABSENT') {
            cell.value = 'X';
            cell.alignment = { ...cell.alignment, horizontal: 'center', vertical: 'middle' };
          } else if (status === 'PRESENT') {
            dailyPresent[dayIndex]++;
            if (personalCopy) {
              cell.value = 'P';
              cell.font = { ...cell.font, size: 9 };
              cell.alignment = { ...cell.alignment, horizontal: 'center', vertical: 'middle' };
            }
          } else if (personalCopy && status === 'NO_RECORD') {
            cell.value = 'NR';
            cell.font = { ...cell.font, size: 8 };
            cell.alignment = { ...cell.alignment, horizontal: 'center', vertical: 'middle', shrinkToFit: true };
          }
        }

        const absenceCell = worksheet.getCell(row, 29);
        const tardyCell = worksheet.getCell(row, 30);
        absenceCell.value = student && !personalCopy ? student.days.filter(status => status === 'ABSENT').length : null;
        tardyCell.value = student && !personalCopy ? (Number(student.tardyCount) || 0) : null;
        for (const cell of [absenceCell, tardyCell]) {
          cell.alignment = { ...cell.alignment, horizontal: 'center', vertical: 'middle' };
        }
      }

      data.dates.forEach((date, index) => {
        worksheet.getCell(totalRow, 4 + index).value = dailyPresent[index];
      });

      return dailyPresent;
    };

    const maleDaily = fillGroup(boys, 14, 21, 35);
    const femaleDaily = fillGroup(girls, 36, 25, 61);

    data.dates.forEach((date, index) => {
      worksheet.getCell(62, 4 + index).value = maleDaily[index] + femaleDaily[index];
    });

    // The official SF2 template's summary panel occupies columns AH (M),
    // AI (F), AJ (TOTAL); row headings run from 66 through 83.
    // Write the numeric merged-cell anchors without altering template styles.
    const summary = personalCopy ? null : await getMonthlySf2Summary(req, month, gradeLevel, section, data);
    const m = summary?.male || {}, f = summary?.female || {};
    const total = field => Number(m[field] || 0) + Number(f[field] || 0);
    const rate = (numerator, denominator) => denominator ? numerator / denominator : null;
    const average = (presentDays) => summary?.days ? presentDays / summary.days : null;
    const metrics = [
      [66, m.early, f.early, total('early'), '0'],
      [68, m.late, f.late, total('late'), '0'],
      [70, m.registered, f.registered, total('registered'), '0'],
      [72, rate(m.registered,m.early), rate(f.registered,f.early), rate(total('registered'),total('early')), '0.00%'],
      [74, average(m.presentDays), average(f.presentDays), average(total('presentDays')), '0.00'],
      [75, rate(m.presentDays,m.registered * (summary?.days || 0)), rate(f.presentDays,f.registered * (summary?.days || 0)),
        rate(total('presentDays'), total('registered') * (summary?.days || 0)), '0.00%'],
      [77, m.consecutive, f.consecutive, total('consecutive'), '0'],
      [79, m.dropout, f.dropout, total('dropout'), '0'],
      [81, m.transferOut, f.transferOut, total('transferOut'), '0'],
      [83, m.transferIn, f.transferIn, total('transferIn'), '0']
    ];
    for (const [row, male, female, combined, format] of metrics) {
      for (const [col, value] of [[34,male],[35,female],[36,combined]]) {
        const cell = worksheet.getCell(row,col);
        const target = cell.isMerged ? cell.master : cell;
        // Never represent subject-specific missing scans as official SF2 monthly attendance.
        // Text percentages avoid ##### and 1 instead of 100% on narrow merged cells in iPad Excel.
        target.value = personalCopy ? null :
          (format === '0.00%' ? (value == null ? 'N/A' : `${(Number(value) * 100).toFixed(1)}%`) : value);
        target.numFmt = personalCopy ? 'General' : (format === '0.00%' ? '@' : format);
        target.alignment = { ...target.alignment, horizontal:'center', vertical:'middle', shrinkToFit: true };
        if (format === '0.00%') target.font = { ...target.font, size: 9 };
      }
    }
    worksheet.getCell('AB65').value = MONTHS[monthNumber - 1];
    worksheet.getCell('AB65').alignment = { ...worksheet.getCell('AB65').alignment, horizontal: 'center', vertical: 'middle', shrinkToFit: true };
    worksheet.getCell('AB65').font = { ...worksheet.getCell('AB65').font, size: 10 };
    worksheet.getCell('AE65').value = personalCopy ? data.dates.length : summary.days;
    worksheet.getCell('AE65').alignment = { ...worksheet.getCell('AE65').alignment, horizontal: 'center', vertical: 'middle' };
    // Learner names are left-aligned for readability. Number and date columns
    // retain the DepEd template's existing alignment.
    for (const row of [...Array.from({length:21}, (_,i) => i+14), ...Array.from({length:25}, (_,i) => i+36)]) {
      const cell = worksheet.getCell(row,2);
      cell.alignment = { ...cell.alignment, horizontal:'left', vertical:'middle', indent:1 };
    }

    if (personalCopy) {
      const notes = workbook.addWorksheet('READ ME - Unofficial');
      notes.getColumn('A').width = 110;
      notes.getCell('A1').value = 'UNOFFICIAL SUBJECT TEACHER ATTENDANCE COPY';
      notes.getCell('A1').font = { bold: true, size: 16 };
      notes.getCell('A3').value = 'This workbook uses the same DepEd SF2 worksheet template for familiarity but is NOT an official School Form 2.';
      notes.getCell('A4').value = 'P = at least one accepted subject/class time-in recorded by this teacher for this learner and date.';
      notes.getCell('A5').value = 'NR = NO RECORD from this teacher; it does NOT mean the learner was absent from school.';
      notes.getCell('A6').value = 'Absences, tardiness, and official school-wide monthly summary figures are deliberately left blank.';
      notes.getCell('A7').value = 'Only the designated Class Adviser/School Admin may produce the official SF2 after resolving pending attendance.';
      notes.getCell('A9').value = `Report: ${month} | Grade: ${gradeLevel} | Section: ${section}`;
      for (const row of [3,4,5,6,7,9]) notes.getCell('A'+row).alignment = { wrapText: true };
      notes.getRow(3).height = 30;
      notes.getRow(6).height = 30;
    }
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async function buildPersonalCopyWorkbook(req, month, gradeLevel, section, data) {
    return buildOfficialWorkbook(req, month, gradeLevel, section, data, true);
  }

  async function getAccessAndData(req, month, gradeLevel, section, requestedMode = '') {
    if (!validMonth(month) || !gradeLevel || !section) {
      const error = new Error('Select a reporting month, grade level, and section.');
      error.status = 400;
      throw error;
    }
    if (requestedMode && !['OFFICIAL', 'PERSONAL'].includes(requestedMode)) {
      const error = new Error('Choose a valid official or personal SF2 report mode.');
      error.status = 400;
      throw error;
    }
    const access = await getSectionAccess(req, gradeLevel, section, requestedMode);
    if (!access.allowed) {
      const error = new Error('This section is not assigned to your account.');
      error.status = 403;
      throw error;
    }
    const data = await getReportData(req, month, gradeLevel, section, access);
    return { access, data };
  }

  app.get('/api/sf2/options', authenticateSchoolClient, requireSchoolUser, async (req, res) => {
    try {
      await migration;
      let sections = [];
      if (['SCHOOL_ADMIN', 'DEPARTMENT_HEAD'].includes(req.auth.role)) {
        const result = await pool.query(
          `SELECT DISTINCT COALESCE(en.grade_level,s.grade_level) AS "gradeLevel",COALESCE(en.section,s.section) AS section
           FROM students s
           LEFT JOIN LATERAL (SELECT e.grade_level,e.section FROM student_enrollments e JOIN school_years sy ON sy.school_id=e.school_id AND sy.school_year_id=e.school_year_id WHERE e.school_id=s.school_id AND e.student_id=s.student_id AND sy.status='ACTIVE' AND e.enrollment_status='ENROLLED' ORDER BY e.created_at DESC LIMIT 1) en ON TRUE
           WHERE s.school_id=$1 AND s.active=TRUE
           ORDER BY "gradeLevel",section`, [req.auth.schoolId]
        );
        sections = result.rows.map(row => ({ ...row, mode: 'OFFICIAL' }));
      } else if (req.auth.role === 'TEACHER') {
        const sectionMap = new Map();
        if (teacherHas(req, 'CLASS_ADVISER')) {
          const adviser = await pool.query(
            `SELECT grade_level AS "gradeLevel",section FROM class_adviser_assignments
             WHERE school_id=$1 AND adviser_user_id=$2 ORDER BY grade_level,section`,
            [req.auth.schoolId, req.auth.userId]
          );
          for (const row of adviser.rows) sectionMap.set(`${row.gradeLevel}|${row.section}`, { ...row, modes: ['OFFICIAL'] });
        }
        if (teacherHas(req, 'SUBJECT_TEACHER')) {
          const assigned = await pool.query(
            `SELECT DISTINCT p.grade_level AS "gradeLevel",p.section
             FROM teacher_period_assignments a JOIN class_periods p
               ON p.school_id=a.school_id AND p.period_id=a.period_id
             WHERE a.school_id=$1 AND a.teacher_user_id=$2 AND p.active=TRUE AND p.section IS NOT NULL
             UNION
             SELECT DISTINCT p.grade_level AS "gradeLevel",p.section
             FROM teacher_period_substitutions ts JOIN class_periods p
               ON p.school_id=ts.school_id AND p.period_id=ts.period_id
             WHERE ts.school_id=$1 AND ts.substitute_teacher_user_id=$2 AND p.active=TRUE AND p.section IS NOT NULL
               AND ts.status='ACTIVE' AND ts.end_date >= (NOW() AT TIME ZONE 'Asia/Manila')::date
             ORDER BY 1,2`, [req.auth.schoolId, req.auth.userId]
          );
          for (const row of assigned.rows) {
            const key = `${row.gradeLevel}|${row.section}`;
            const existing = sectionMap.get(key);
            if (existing) existing.modes.push('PERSONAL');
            else sectionMap.set(key, { ...row, modes: ['PERSONAL'] });
          }
        }
        sections = [...sectionMap.values()];
      }
      sections.sort((a, b) => String(a.gradeLevel).localeCompare(String(b.gradeLevel)) || String(a.section).localeCompare(String(b.section)));
      return res.json({ sections });
    } catch (err) {
      console.error('SF2 options failed:', err);
      return res.status(500).json({ error: 'Could not load SF2 sections.' });
    }
  });

  app.get('/api/sf2/students', authenticateSchoolClient, requireSchoolUser, async (req, res) => {
    try {
      await migration;
      const result = await pool.query(
        `SELECT s.student_id AS "studentId",s.full_name AS "fullName",COALESCE(en.grade_level,s.grade_level) AS "gradeLevel",COALESCE(en.section,s.section) AS section,s.sex
         FROM students s
         LEFT JOIN LATERAL (SELECT e.grade_level,e.section FROM student_enrollments e JOIN school_years sy ON sy.school_id=e.school_id AND sy.school_year_id=e.school_year_id WHERE e.school_id=s.school_id AND e.student_id=s.student_id AND sy.status='ACTIVE' AND e.enrollment_status='ENROLLED' ORDER BY e.created_at DESC LIMIT 1) en ON TRUE
         WHERE s.school_id=$1 AND s.active=TRUE ORDER BY "gradeLevel",section,"fullName"`,
        [req.auth.schoolId]
      );
      const visible = [];
      for (const student of result.rows) {
        const access = await getSectionAccess(req, student.gradeLevel, student.section);
        if (access.allowed && access.canEditSex) visible.push(student);
      }
      return res.json({ students: visible });
    } catch (err) {
      console.error('SF2 students', err);
      return res.status(500).json({ error: 'Could not load SF2 learner list.' });
    }
  });

  app.get('/api/sf2/preview', authenticateSchoolClient, requireSchoolUser, async (req, res) => {
    const { month, gradeLevel, section } = req.query;
    try {
      await migration;
      const { access, data } = await getAccessAndData(req, month, gradeLevel, section, String(req.query.mode || '').toUpperCase());
      return res.json({
        ...data,
        mode: access.mode,
        readOnly: Boolean(access.readOnly),
        canEditSex: Boolean(access.canEditSex),
        canConfirmAbsence: Boolean(access.canConfirmAbsence),
        canSubmit: Boolean(access.canSubmit),
        note: access.mode === 'PERSONAL'
          ? 'Personal subject-teacher copy: NR means this teacher has no accepted subject time-in record for that learner/date. NR is not an absence.'
          : 'Official daily SF2 view: accepted QR time-ins and teacher-confirmed manual Present/Late marks count as presence. Manual Absent/Excused marks do not independently establish whole-day absence. Conflicts require adviser review.',
        calendarNote: 'The current report includes weekdays only. School holidays, suspensions, and special non-class days are not yet connected to a school calendar.'
      });
    } catch (err) {
      console.error('SF2 preview', err);
      return res.status(err.status || 500).json({ error: err.message || 'Could not prepare SF2 preview.' });
    }
  });

  app.put('/api/sf2/absence', authenticateSchoolClient, requireSchoolUser, async (req, res) => {
    const { studentId, date, absenceType = 'UNEXCUSED', note = '' } = req.body || {};
    if (!studentId || !/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !['EXCUSED', 'UNEXCUSED'].includes(absenceType)) {
      return res.status(400).json({ error: 'Provide a learner, date, and valid absence type.' });
    }
    try {
      await migration;
      const student = await pool.query(
        `SELECT COALESCE(en.grade_level,s.grade_level) AS "gradeLevel",COALESCE(en.section,s.section) AS section
         FROM students s
         LEFT JOIN LATERAL (SELECT e.grade_level,e.section FROM student_enrollments e JOIN school_years sy ON sy.school_id=e.school_id AND sy.school_year_id=e.school_year_id WHERE e.school_id=s.school_id AND e.student_id=s.student_id AND sy.status='ACTIVE' AND e.enrollment_status='ENROLLED' ORDER BY e.created_at DESC LIMIT 1) en ON TRUE
         WHERE s.school_id=$1 AND s.student_id=$2 AND s.active=TRUE`,
        [req.auth.schoolId, studentId]
      );
      if (!student.rowCount) return res.status(404).json({ error: 'Learner not found.' });
      const access = await getSectionAccess(req, student.rows[0].gradeLevel, student.rows[0].section);
      if (!access.allowed || !access.canConfirmAbsence) return res.status(403).json({ error: 'Only the School Administrator or assigned Class Adviser may confirm a daily SF2 absence.' });
      const hasPresent = await pool.query(
        `SELECT 1 FROM attendance_events WHERE school_id=$1 AND student_id=$2 AND school_date=$3
           AND attendance_scope IN ('CLASS','ADVISORY') AND event_type='TIME_IN'
           AND COALESCE(sync_status,'ACCEPTED')='ACCEPTED'
         UNION ALL
         SELECT 1 FROM manual_attendance_marks WHERE school_id=$1 AND student_id=$2 AND school_date=$3
           AND status IN ('PRESENT','LATE')
         LIMIT 1`,
        [req.auth.schoolId, studentId, date]
      );
      if (hasPresent.rowCount) return res.status(409).json({ error: 'A verified QR or manual presence record exists on this date. Review the evidence before confirming a whole-day absence.' });
      const savedNote = String(note || 'Class Adviser/Admin confirmed that all scheduled subject attendance was reviewed.').slice(0, 500);
      await pool.query(
        `INSERT INTO sf2_daily_overrides(school_id,student_id,school_date,status,absence_type,note,recorded_by_user_id)
         VALUES($1,$2,$3,'ABSENT',$4,$5,$6)
         ON CONFLICT(school_id,student_id,school_date) DO UPDATE
         SET absence_type=EXCLUDED.absence_type,note=EXCLUDED.note,
             recorded_by_user_id=EXCLUDED.recorded_by_user_id,created_at=NOW()`,
        [req.auth.schoolId, studentId, date, absenceType, savedNote, req.auth.userId]
      );
      return res.json({ ok: true });
    } catch (err) {
      console.error('SF2 absence confirmation failed:', err);
      return res.status(500).json({ error: 'Could not save confirmed absence.' });
    }
  });

  app.delete('/api/sf2/absence', authenticateSchoolClient, requireSchoolUser, async (req, res) => {
    const { studentId, date } = req.body || {};
    try {
      await migration;
      const student = await pool.query(
        `SELECT grade_level AS "gradeLevel",section FROM students WHERE school_id=$1 AND student_id=$2 AND active=TRUE`,
        [req.auth.schoolId, studentId]
      );
      if (!student.rowCount) return res.status(404).json({ error: 'Learner not found.' });
      const access = await getSectionAccess(req, student.rows[0].gradeLevel, student.rows[0].section);
      if (!access.allowed || !access.canConfirmAbsence) return res.status(403).json({ error: 'Only the School Administrator or assigned Class Adviser may remove an absence confirmation.' });
      await pool.query('DELETE FROM sf2_daily_overrides WHERE school_id=$1 AND student_id=$2 AND school_date=$3', [req.auth.schoolId, studentId, date]);
      return res.json({ ok: true });
    } catch (err) {
      console.error('SF2 absence removal failed:', err);
      return res.status(500).json({ error: 'Could not remove absence confirmation.' });
    }
  });

  app.get('/api/sf2/export', authenticateSchoolClient, requireSchoolUser, async (req, res) => {
    const { month, gradeLevel, section } = req.query;
    try {
      await migration;
      const { access, data } = await getAccessAndData(req, month, gradeLevel, section, String(req.query.mode || '').toUpperCase());
      if (req.auth.role === 'DEPARTMENT_HEAD' || (access.readOnly && access.mode !== 'PERSONAL')) return res.status(403).json({ error: 'Department Head access is view-only. The School Administrator collects official SF2 submissions.' });
      let buffer;
      let filename;
      if (access.mode === 'PERSONAL') {
        buffer = await buildPersonalCopyWorkbook(req, month, gradeLevel, section, data);
        filename = `SF2-Personal-Copy-${safePart(gradeLevel)}-${safePart(section)}-${month}.xlsx`;
      } else {
        buffer = await buildOfficialWorkbook(req, month, gradeLevel, section, data);
        filename = `SF2-${safePart(gradeLevel)}-${safePart(section)}-${month}.xlsx`;
      }
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', String(buffer.length));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.end(buffer);
    } catch (err) {
      console.error('SF2 export failed:', err);
      return res.status(err.status || 500).json({ error: err.message || 'SF2 generation failed. Check server logs.' });
    }
  });

  app.post('/api/sf2/submissions', authenticateSchoolClient, requireSchoolUser, async (req, res) => {
    const { month, gradeLevel, section } = req.body || {};
    if (req.auth.role !== 'TEACHER' || !teacherHas(req, 'CLASS_ADVISER')) {
      return res.status(403).json({ error: 'Only a designated Class Adviser may submit the official monthly SF2 for an assigned section.' });
    }
    const client = await pool.connect();
    try {
      await migration;
      const { access, data } = await getAccessAndData(req, month, gradeLevel, section, 'OFFICIAL');
      if (!access.canSubmit || access.mode !== 'OFFICIAL') return res.status(403).json({ error: 'This section is not assigned to you as Class Adviser.' });
      const buffer = await buildOfficialWorkbook(req, month, gradeLevel, section, data);
      const safeFilename = `SF2-${safePart(gradeLevel)}-${safePart(section)}-${month}`;
      if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_OFFICIAL_SF2_BYTES)
        return res.status(413).json({error:'The official SF2 file is empty or exceeds the 8 MB submission limit.'});
      const fileSha256 = crypto.createHash('sha256').update(buffer).digest('hex');

      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [String(req.auth.schoolId), `${month}|${gradeLevel}|${section}`]);
      const revisionResult = await client.query(
        `SELECT COALESCE(MAX(revision),0)::int AS revision FROM sf2_submissions
         WHERE school_id=$1 AND reporting_month=$2::date AND grade_level=$3 AND section=$4`,
        [req.auth.schoolId, `${month}-01`, gradeLevel, section]
      );
      const revision = revisionResult.rows[0].revision + 1;
      const filename = `${safeFilename}-REV${revision}.xlsx`;
      await client.query(
        `UPDATE sf2_submissions SET is_current=FALSE
         WHERE school_id=$1 AND reporting_month=$2::date AND grade_level=$3 AND section=$4 AND is_current=TRUE`,
        [req.auth.schoolId, `${month}-01`, gradeLevel, section]
      );
      const inserted = await client.query(
        `INSERT INTO sf2_submissions
          (school_id,reporting_month,grade_level,section,revision,status,is_current,file_name,file_path,submitted_by_user_id,summary,file_bytes,file_sha256,file_size)
         VALUES($1,$2::date,$3,$4,$5,'SUBMITTED',TRUE,$6,'db:sf2',$7,$8::jsonb,$9,$10,$11)
         RETURNING submission_id AS "submissionId",revision,status,submitted_at AS "submittedAt"`,
        [req.auth.schoolId, `${month}-01`, gradeLevel, section, revision, filename, req.auth.userId, JSON.stringify(data.summary),buffer,fileSha256,buffer.length]
      );
      await client.query(
        `INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
         VALUES($1,'SCHOOL',$2,'CLASS_ADVISER_SUBMIT_SF2','sf2_submission',$3,$4::jsonb)`,
        [req.auth.schoolId, req.auth.userId, inserted.rows[0].submissionId,
         JSON.stringify({ month, gradeLevel, section, revision, summary: data.summary })]
      );
      await client.query('COMMIT');
      return res.status(201).json({ ok: true, submission: inserted.rows[0] });
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch {}
       console.error('Official SF2 submission failed:', err);
      return res.status(err.status || 500).json({ error: err.message || 'Could not submit the official SF2.' });
    } finally {
      client.release();
    }
  });

  app.get('/api/sf2/submissions', authenticateSchoolClient, requireSchoolAdminOrDepartmentHead, async (req, res) => {
    try {
      await migration;
      const result = await pool.query(
        `SELECT sub.submission_id AS "submissionId",sub.reporting_month AS month,
                sub.grade_level AS "gradeLevel",sub.section,sub.revision,sub.status,
                sub.file_name AS "fileName",sub.submitted_at AS "submittedAt",
                sub.collected_at AS "collectedAt",su.display_name AS "submittedBy",
                sub.summary
         FROM sf2_submissions sub
         JOIN school_users su ON su.school_id=sub.school_id AND su.user_id=sub.submitted_by_user_id
         WHERE sub.school_id=$1 AND sub.is_current=TRUE
         ORDER BY sub.reporting_month DESC,sub.grade_level,sub.section`,
        [req.auth.schoolId]
      );
      return res.json({ submissions: result.rows });
    } catch (err) {
      console.error('SF2 submissions list failed:', err);
      return res.status(500).json({ error: 'Could not load submitted SF2 reports.' });
    }
  });

  app.patch('/api/sf2/submissions/:submissionId/collect', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
    try {
      await migration;
      const result = await pool.query(
        `UPDATE sf2_submissions
         SET status='COLLECTED',collected_by_user_id=$3,collected_at=NOW()
         WHERE school_id=$1 AND submission_id=$2 AND is_current=TRUE AND status='SUBMITTED'
         RETURNING submission_id AS "submissionId",status,collected_at AS "collectedAt"`,
        [req.auth.schoolId, req.params.submissionId, req.auth.userId]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'Current submitted SF2 was not found or has already been collected.' });
      await pool.query(
        `INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
         VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_COLLECT_SF2','sf2_submission',$3,'{}'::jsonb)`,
        [req.auth.schoolId, req.auth.userId, req.params.submissionId]
      );
      return res.json({ ok: true, submission: result.rows[0] });
    } catch (err) {
      console.error('SF2 collection failed:', err);
      return res.status(500).json({ error: 'Could not mark the SF2 as collected.' });
    }
  });

  app.get('/api/sf2/submissions/:submissionId/download', authenticateSchoolClient, requireSchoolUser, async (req, res) => {
    try {
      await migration;
      const result = await pool.query(
        `SELECT file_name AS "fileName",file_path AS "filePath",submitted_by_user_id AS "submittedByUserId",
                file_bytes AS "fileBytes",file_sha256 AS "fileSha256",file_size AS "fileSize"
         FROM sf2_submissions WHERE school_id=$1 AND submission_id=$2 AND is_current=TRUE`,
        [req.auth.schoolId, req.params.submissionId]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'Submitted SF2 file not found.' });
      if (!['SCHOOL_ADMIN', 'DEPARTMENT_HEAD'].includes(req.auth.role) && String(result.rows[0].submittedByUserId) !== String(req.auth.userId)) return res.status(403).json({ error: 'You may download only the SF2 reports you submitted.' });
      if (result.rows[0].fileBytes) {
        const {fileBytes,fileSha256,fileSize}=result.rows[0];
        const verified=Buffer.isBuffer(fileBytes)&&fileBytes.length===fileSize&&
          crypto.createHash('sha256').update(fileBytes).digest('hex')===fileSha256;
        if (!verified) return res.status(503).json({error:'Stored SF2 file failed integrity validation. Contact the School Administrator.'});
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${result.rows[0].fileName.replace(/"/g, '')}"`);
        res.setHeader('Cache-Control','private, no-store');
        return res.end(fileBytes);
      }
      if (result.rows[0].filePath === 'db:sf2') {
        return res.status(503).json({error:'Official SF2 content is temporarily unavailable. Contact the School Administrator.'});
      }
      // Compatibility only for submissions created before the durable-storage release.
      const storageRoot = path.resolve(SF2_STORAGE) + path.sep;
      const fullPath = path.resolve(__dirname, result.rows[0].filePath);
      if (!fullPath.startsWith(storageRoot)) return res.status(400).json({ error: 'Invalid stored report path.' });
      await fs.access(fullPath);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${result.rows[0].fileName.replace(/"/g, '')}"`);
      return res.sendFile(fullPath);
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'Stored SF2 file is missing from the server.' });
      console.error('SF2 submitted file download failed:', err);
      return res.status(500).json({ error: 'Could not download the submitted SF2 file.' });
    }
  });
}

module.exports = registerSf2Routes;
