'use strict';

const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs/promises');
const TEMPLATE = path.join(__dirname, 'templates', 'TUVERA SF2 (SY 2026-2027).xlsx');
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
      `SELECT student_id AS id,full_name AS name,grade_level AS "gradeLevel",section,sex
       FROM students WHERE school_id=$1 AND active=TRUE AND grade_level=$2 AND section=$3
       ORDER BY full_name`,
      [req.auth.schoolId, gradeLevel, section]
    );
    let present;
    if (access.mode === 'PERSONAL') {
      present = await pool.query(
        `SELECT DISTINCT e.student_id AS id,e.school_date::text AS date
         FROM attendance_events e
         JOIN students s ON s.school_id=e.school_id AND s.student_id=e.student_id
         WHERE e.school_id=$1 AND s.grade_level=$3 AND s.section=$4
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
         WHERE e.school_id=$1 AND s.grade_level=$2 AND s.section=$3
           AND e.attendance_scope='CLASS' AND e.event_type='TIME_IN'
           AND COALESCE(e.sync_status,'ACCEPTED')='ACCEPTED'
           AND e.school_date >= $4::date AND e.school_date < ($4::date + INTERVAL '1 month')`,
        [req.auth.schoolId, gradeLevel, section, dateFrom]
      );
    }

    let absent = { rows: [] };
    if (access.mode === 'OFFICIAL') {
      absent = await pool.query(
        `SELECT o.student_id AS id,o.school_date::text AS date,o.absence_type AS "absenceType"
         FROM sf2_daily_overrides o
         JOIN students s ON s.school_id=o.school_id AND s.student_id=o.student_id
         WHERE o.school_id=$1 AND s.grade_level=$2 AND s.section=$3
           AND o.school_date >= $4::date AND o.school_date < ($4::date + INTERVAL '1 month')`,
        [req.auth.schoolId, gradeLevel, section, dateFrom]
      );
    }

    const dates = datesFor(month);
    const presentSet = new Set(present.rows.map(row => `${row.id}|${String(row.date).slice(0, 10)}`));
    const absentMap = new Map(absent.rows.map(row => [`${row.id}|${String(row.date).slice(0, 10)}`, row.absenceType]));
    const rows = students.rows.map(student => ({
      ...student,
      days: dates.map(date => {
        if (presentSet.has(`${student.id}|${date}`)) return 'PRESENT';
        if (access.mode === 'PERSONAL') return 'NO_RECORD';
        if (absentMap.has(`${student.id}|${date}`)) return 'ABSENT';
        return 'PENDING';
      })
    }));
    return {
      dates,
      students: rows,
      summary: {
        present: rows.reduce((count, row) => count + row.days.filter(status => status === 'PRESENT').length, 0),
        absent: rows.reduce((count, row) => count + row.days.filter(status => status === 'ABSENT').length, 0),
        pending: rows.reduce((count, row) => count + row.days.filter(status => status === 'PENDING').length, 0),
        noRecord: rows.reduce((count, row) => count + row.days.filter(status => status === 'NO_RECORD').length, 0),
        missingSex: rows.filter(row => !['MALE', 'FEMALE'].includes(String(row.sex || '').toUpperCase())).length
      }
    };
  }

  async function buildOfficialWorkbook(req, month, gradeLevel, section, data) {
    try { await fs.access(TEMPLATE); } catch { const error = new Error('TUVERA SF2 template is missing.'); error.status = 500; throw error; }
    if (data.dates.length > 25) { const error = new Error('The selected month has more than 25 weekdays; confirm the school calendar before exporting.'); error.status = 409; throw error; }
    if (data.summary.pending) { const error = new Error(`${data.summary.pending} learner-day record(s) are unresolved. A Class Adviser must review the full subject attendance before confirming an absence.`); error.status = 409; throw error; }
    if (data.summary.missingSex) { const error = new Error(`${data.summary.missingSex} learner(s) need Male/Female classification before official SF2 generation.`); error.status = 409; throw error; }
    const boys = data.students.filter(student => String(student.sex).toUpperCase() === 'MALE');
    const girls = data.students.filter(student => String(student.sex).toUpperCase() === 'FEMALE');
    if (boys.length > 50 || girls.length > 50) { const error = new Error('Template supports up to 50 male and 50 female learners per section.'); error.status = 409; throw error; }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(TEMPLATE);
    const worksheet = workbook.getWorksheet('Copy') || workbook.worksheets[0];
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
    worksheet.getCell('G6').value = setting('school_id') || String(req.auth.schoolId);
    worksheet.getCell('G7').value = setting('school_name') || 'SCHOOL NAME';
    worksheet.getCell('N6').value = setting('school_year') || `${year}-${year + 1}`;
    worksheet.getCell('AA6').value = MONTHS[monthNumber - 1];
    worksheet.getCell('AA7').value = gradeLevel;
    worksheet.getCell('AF7').value = section;
    worksheet.getCell('AQ9').value = data.dates.length;
    for (let column = 7; column <= 31; column++) {
      worksheet.getCell(10, column).value = null;
      worksheet.getCell(11, column).value = null;
    }
    data.dates.forEach((date, index) => {
      const day = new Date(`${date}T00:00:00Z`);
      const column = 7 + index;
      worksheet.getCell(10, column).value = day;
      worksheet.getCell(10, column).numFmt = 'd';
      worksheet.getCell(11, column).value = ['', 'M', 'T', 'W', 'TH', 'F', ''][day.getUTCDay()];
    });
    const present = new Set();
    const absent = new Set();
    data.students.forEach(student => student.days.forEach((status, index) => {
      const key = `${student.id}|${data.dates[index]}`;
      if (status === 'PRESENT') present.add(key);
      if (status === 'ABSENT') absent.add(key);
    }));
    const fill = (students, startRow) => {
      for (let index = 0; index < 50; index++) {
        const row = startRow + index;
        const student = students[index];
        worksheet.getCell(row, 1).value = student ? index + 1 : null;
        worksheet.getCell(row, 2).value = student ? student.name : null;
        for (let dayIndex = 0; dayIndex < 25; dayIndex++) {
          const cell = worksheet.getCell(row, 7 + dayIndex);
          cell.value = null;
          if (student && data.dates[dayIndex] && absent.has(`${student.id}|${data.dates[dayIndex]}`)) cell.value = 'X';
        }
      }
    };
    fill(boys, 13);
    fill(girls, 64);
    worksheet.getCell('AJ117').value = data.dates.length;
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async function buildPersonalCopyWorkbook(month, gradeLevel, section, data) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Student Attendance Tracker';
    workbook.subject = 'Subject Teacher personal attendance copy';
    const worksheet = workbook.addWorksheet('Personal SF2 Copy', { views: [{ state: 'frozen', ySplit: 5, xSplit: 3 }] });
    const headers = ['No.', 'Learner ID', 'Learner Name', 'Sex', ...data.dates.map(date => Number(date.slice(-2)))];
    const lastColumn = headers.length;
    worksheet.mergeCells(1, 1, 1, lastColumn);
    worksheet.getCell(1, 1).value = 'SUBJECT TEACHER MONTHLY SF2 COPY — NOT OFFICIAL SF2';
    worksheet.getCell(1, 1).font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
    worksheet.getCell(1, 1).alignment = { horizontal: 'center' };
    worksheet.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    worksheet.mergeCells(2, 1, 2, lastColumn);
    worksheet.getCell(2, 1).value = `Month: ${month}   Grade: ${gradeLevel}   Section: ${section}`;
    worksheet.getCell(3, 1).value = 'P = at least one accepted subject time-in recorded by this teacher. NR = no record by this teacher; NR does NOT mean Absent.';
    worksheet.mergeCells(3, 1, 3, lastColumn);
    worksheet.getCell(3, 1).alignment = { wrapText: true };
    worksheet.getRow(3).height = 30;
    worksheet.addRow([]);
    worksheet.addRow(headers);
    const headerRow = worksheet.getRow(5);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    data.students.forEach((student, index) => {
      worksheet.addRow([
        index + 1, student.id, student.name, student.sex || '',
        ...student.days.map(status => status === 'PRESENT' ? 'P' : 'NR')
      ]);
    });
    worksheet.columns = [
      { width: 6 }, { width: 18 }, { width: 32 }, { width: 12 },
      ...data.dates.map(() => ({ width: 5 }))
    ];
    worksheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + data.students.length, column: lastColumn } };
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber >= 6) row.alignment = { vertical: 'middle', horizontal: rowNumber === 5 ? 'center' : 'left' };
    });
    return Buffer.from(await workbook.xlsx.writeBuffer());
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
          `SELECT DISTINCT grade_level AS "gradeLevel",section
           FROM students WHERE school_id=$1 AND active=TRUE
           ORDER BY grade_level,section`, [req.auth.schoolId]
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
        `SELECT student_id AS "studentId",full_name AS "fullName",grade_level AS "gradeLevel",section,sex
         FROM students WHERE school_id=$1 AND active=TRUE ORDER BY grade_level,section,full_name`,
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

  app.patch('/api/sf2/students/:studentId/sex', authenticateSchoolClient, requireSchoolUser, async (req, res) => {
    const sex = String(req.body?.sex || '').toUpperCase();
    const studentId = String(req.params.studentId || '');
    if (!['MALE', 'FEMALE'].includes(sex)) return res.status(400).json({ error: 'Select Male or Female.' });
    try {
      await migration;
      const student = await pool.query(
        `SELECT grade_level AS "gradeLevel",section FROM students
         WHERE school_id=$1 AND student_id=$2 AND active=TRUE`,
        [req.auth.schoolId, studentId]
      );
      if (!student.rowCount) return res.status(404).json({ error: 'Learner not found.' });
      const access = await getSectionAccess(req, student.rows[0].gradeLevel, student.rows[0].section);
      if (!access.allowed || !access.canEditSex) return res.status(403).json({ error: 'Only the School Administrator or assigned Class Adviser may update this SF2 learner detail.' });
      await pool.query(
        'UPDATE students SET sex=$3,updated_at=NOW() WHERE school_id=$1 AND student_id=$2 AND active=TRUE',
        [req.auth.schoolId, studentId, sex]
      );
      return res.json({ ok: true });
    } catch (err) {
      console.error('SF2 sex update failed:', err);
      return res.status(500).json({ error: 'Could not save learner sex.' });
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
          : 'Official daily SF2 view: a learner is Present if at least one accepted subject time-in exists. A missing record stays Pending until the assigned Class Adviser reviews all scheduled subjects and confirms the absence.',
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
        `SELECT grade_level AS "gradeLevel",section FROM students
         WHERE school_id=$1 AND student_id=$2 AND active=TRUE`,
        [req.auth.schoolId, studentId]
      );
      if (!student.rowCount) return res.status(404).json({ error: 'Learner not found.' });
      const access = await getSectionAccess(req, student.rows[0].gradeLevel, student.rows[0].section);
      if (!access.allowed || !access.canConfirmAbsence) return res.status(403).json({ error: 'Only the School Administrator or assigned Class Adviser may confirm a daily SF2 absence.' });
      const hasPresent = await pool.query(
        `SELECT 1 FROM attendance_events WHERE school_id=$1 AND student_id=$2 AND school_date=$3
           AND attendance_scope='CLASS' AND event_type='TIME_IN'
           AND COALESCE(sync_status,'ACCEPTED')='ACCEPTED' LIMIT 1`,
        [req.auth.schoolId, studentId, date]
      );
      if (hasPresent.rowCount) return res.status(409).json({ error: 'This learner has a confirmed subject check-in on this date and must be Present in SF2.' });
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
        buffer = await buildPersonalCopyWorkbook(month, gradeLevel, section, data);
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
    let savedPath = null;
    const client = await pool.connect();
    try {
      await migration;
      const { access, data } = await getAccessAndData(req, month, gradeLevel, section, 'OFFICIAL');
      if (!access.canSubmit || access.mode !== 'OFFICIAL') return res.status(403).json({ error: 'This section is not assigned to you as Class Adviser.' });
      const buffer = await buildOfficialWorkbook(req, month, gradeLevel, section, data);
      const safeFilename = `SF2-${safePart(gradeLevel)}-${safePart(section)}-${month}`;
      const schoolDir = path.join(SF2_STORAGE, String(req.auth.schoolId), month);
      await fs.mkdir(schoolDir, { recursive: true });

      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [String(req.auth.schoolId), `${month}|${gradeLevel}|${section}`]);
      const revisionResult = await client.query(
        `SELECT COALESCE(MAX(revision),0)::int AS revision FROM sf2_submissions
         WHERE school_id=$1 AND reporting_month=$2::date AND grade_level=$3 AND section=$4`,
        [req.auth.schoolId, `${month}-01`, gradeLevel, section]
      );
      const revision = revisionResult.rows[0].revision + 1;
      const filename = `${safeFilename}-REV${revision}.xlsx`;
      const fullPath = path.join(schoolDir, filename);
      await fs.writeFile(fullPath, buffer, { flag: 'wx' });
      savedPath = fullPath;
      const relativePath = path.relative(__dirname, fullPath);
      await client.query(
        `UPDATE sf2_submissions SET is_current=FALSE
         WHERE school_id=$1 AND reporting_month=$2::date AND grade_level=$3 AND section=$4 AND is_current=TRUE`,
        [req.auth.schoolId, `${month}-01`, gradeLevel, section]
      );
      const inserted = await client.query(
        `INSERT INTO sf2_submissions
          (school_id,reporting_month,grade_level,section,revision,status,is_current,file_name,file_path,submitted_by_user_id,summary)
         VALUES($1,$2::date,$3,$4,$5,'SUBMITTED',TRUE,$6,$7,$8,$9::jsonb)
         RETURNING submission_id AS "submissionId",revision,status,submitted_at AS "submittedAt"`,
        [req.auth.schoolId, `${month}-01`, gradeLevel, section, revision, filename, relativePath, req.auth.userId, JSON.stringify(data.summary)]
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
      if (savedPath) await fs.unlink(savedPath).catch(() => {});
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
        `SELECT file_name AS "fileName",file_path AS "filePath",submitted_by_user_id AS "submittedByUserId"
         FROM sf2_submissions WHERE school_id=$1 AND submission_id=$2 AND is_current=TRUE`,
        [req.auth.schoolId, req.params.submissionId]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'Submitted SF2 file not found.' });
      if (!['SCHOOL_ADMIN', 'DEPARTMENT_HEAD'].includes(req.auth.role) && String(result.rows[0].submittedByUserId) !== String(req.auth.userId)) return res.status(403).json({ error: 'You may download only the SF2 reports you submitted.' });
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
