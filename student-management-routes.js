'use strict';

const ExcelJS = require('exceljs');
const { Readable } = require('node:stream');

const validText = (value, max = 200) =>
  typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
const normalizeHeader = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const field = (row, aliases) => {
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  }
  return '';
};
const clean = value => value == null ? '' : String(value).trim();

async function readImportRows(fileName, fileBase64) {
  if (typeof fileBase64 !== 'string' || fileBase64.length > 9_000_000) {
    throw new Error('Choose a CSV or Excel file smaller than 6 MB.');
  }
  const buffer = Buffer.from(fileBase64, 'base64');
  const workbook = new ExcelJS.Workbook();
  if (/\.xlsx$/i.test(String(fileName || ''))) {
    await workbook.xlsx.load(buffer);
  } else if (/\.csv$/i.test(String(fileName || ''))) {
    await workbook.csv.read(Readable.from([buffer]));
  } else {
    throw new Error('Use an .xlsx or .csv file.');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) throw new Error('The file has no student rows.');
  const headers = sheet.getRow(1).values.slice(1).map(normalizeHeader);
  const rows = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const values = sheet.getRow(rowNumber).values.slice(1);
    if (!values.some(value => clean(value))) continue;
    const row = {};
    headers.forEach((header, index) => { if (header) row[header] = values[index] ?? ''; });
    rows.push({
      rowNumber,
      studentId: clean(field(row, ['Student ID', 'StudentID', 'ID'])),
      lrn: clean(field(row, ['LRN', 'Learner Reference Number'])) || null,
      fullName: clean(field(row, ['Full Name', 'Student Name', 'Learner Name'])),
      sex: clean(field(row, ['Sex', 'Gender'])).toUpperCase(),
      gradeLevel: clean(field(row, ['Grade Level', 'Grade'])),
      section: clean(field(row, ['Section', 'Class'])),
      parentName: clean(field(row, ['Parent Name', 'Parent Guardian', 'Guardian'])) || null,
      parentMobile: clean(field(row, ['Parent Mobile', 'Guardian Mobile', 'Mobile Number']))
    });
  }
  if (!rows.length) throw new Error('No student records were found below the header row.');
  if (rows.length > 2000) throw new Error('Import is limited to 2,000 students per batch.');
  return rows;
}

function registerStudentManagementRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles }) {
  const importRoles = requireSchoolRoles('SCHOOL_ADMIN', 'TEACHER');
  const adminOnly = requireSchoolRoles('SCHOOL_ADMIN');
  const studentBatchManagers = requireSchoolRoles('SCHOOL_ADMIN', 'TEACHER');

  app.post('/api/students/import/preview', authenticateSchoolClient, importRoles, async (req, res) => {
    try {
      const rows = await readImportRows(req.body?.fileName, req.body?.fileBase64);
      const isTeacher = req.auth.role === 'TEACHER';
      if (isTeacher && !req.auth.teacherDesignations?.includes('CLASS_ADVISER')) {
        return res.status(403).json({ error: 'Only Class Advisers may import students.' });
      }
      const ids = [...new Set(rows.map(row => row.studentId).filter(Boolean))];
      const existing = ids.length ? await pool.query(
        'SELECT student_id AS "studentId", lrn, full_name AS "fullName" FROM students WHERE school_id=$1 AND student_id=ANY($2::text[])',
        [req.auth.schoolId, ids]
      ) : { rows: [] };
      const existingById = new Map(existing.rows.map(row => [row.studentId, row]));
      const lrnValues = [...new Set(rows.map(row => row.lrn).filter(Boolean))];
      const existingLrns = lrnValues.length ? await pool.query(
        'SELECT student_id AS "studentId", lrn FROM students WHERE school_id=$1 AND lrn=ANY($2::text[])',
        [req.auth.schoolId, lrnValues]
      ) : { rows: [] };
      const lrnOwner = new Map(existingLrns.rows.map(row => [row.lrn, row.studentId]));
      const seenIds = new Set();
      const seenLrns = new Map();
      const preview = [];
      for (const row of rows) {
        const errors = [];
        if (!validText(row.studentId, 80)) errors.push('Student ID is required (max 80 characters).');
        if (!validText(row.fullName, 200)) errors.push('Full name is required (max 200 characters).');
        if (!['MALE', 'FEMALE'].includes(row.sex)) errors.push('Sex must be Male or Female.');
        if (!validText(row.gradeLevel, 40)) errors.push('Grade level is required.');
        if (!validText(row.section, 100)) errors.push('Section is required.');
        if (row.parentMobile.length > 30) errors.push('Parent mobile must be 30 characters or fewer.');
        if (row.lrn && row.lrn.length > 30) errors.push('LRN must be 30 characters or fewer.');
        if (row.studentId && seenIds.has(row.studentId)) errors.push('Duplicate Student ID within this file.');
        if (row.studentId) seenIds.add(row.studentId);
        if (row.lrn && seenLrns.has(row.lrn) && seenLrns.get(row.lrn) !== row.studentId) errors.push('Duplicate LRN within this file.');
        if (row.lrn) seenLrns.set(row.lrn, row.studentId);
        const existingStudent = existingById.get(row.studentId);
        const owner = row.lrn ? lrnOwner.get(row.lrn) : null;
        if (owner && owner !== row.studentId) errors.push('LRN is already assigned to a different student.');
        if (isTeacher && existingStudent) errors.push('This Student ID already exists. Existing master records are not overwritten by teacher imports.');
        if (isTeacher && !errors.length) {
          const assignment = await pool.query(
            'SELECT 1 FROM class_adviser_assignments WHERE school_id=$1 AND adviser_user_id=$2 AND grade_level=$3 AND section=$4',
            [req.auth.schoolId, req.auth.userId, row.gradeLevel, row.section]
          );
          if (!assignment.rowCount) errors.push('You are not assigned as Class Adviser to this grade and section.');
        }
        preview.push({ ...row, action: errors.length ? 'ERROR' : (existingStudent ? 'UPDATE' : 'CREATE'), errors });
      }
      return res.json({
        preview,
        summary: {
          total: preview.length,
          create: preview.filter(row => row.action === 'CREATE').length,
          update: preview.filter(row => row.action === 'UPDATE').length,
          errors: preview.filter(row => row.errors.length).length
        }
      });
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Could not read the import file.' });
    }
  });

  app.post('/api/students/import/commit', authenticateSchoolClient, importRoles, async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length || rows.length > 2000) return res.status(400).json({ error: 'Provide 1 to 2,000 validated student rows.' });
    const isTeacher = req.auth.role === 'TEACHER';
    const seenIds = new Set();
    const seenLrns = new Map();
    for (const row of rows) {
      const id = clean(row.studentId), lrn = clean(row.lrn);
      if (seenIds.has(id)) return res.status(400).json({ error: 'Duplicate Student ID in the submitted batch. Run Preview again.' });
      if (lrn && seenLrns.has(lrn) && seenLrns.get(lrn) !== id) return res.status(400).json({ error: 'Duplicate LRN in the submitted batch. Run Preview again.' });
      seenIds.add(id);
      if (lrn) seenLrns.set(lrn, id);
    }
    if (isTeacher && !req.auth.teacherDesignations?.includes('CLASS_ADVISER')) {
      return res.status(403).json({ error: 'Only Class Advisers may import students.' });
    }
    const client = await pool.connect();
    const results = [];
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        const studentId = clean(row.studentId), fullName = clean(row.fullName);
        const sex = clean(row.sex).toUpperCase(), gradeLevel = clean(row.gradeLevel), section = clean(row.section);
        const lrn = clean(row.lrn) || null, parentName = clean(row.parentName) || null;
        const parentMobile = clean(row.parentMobile);
        if (!validText(studentId, 80) || !validText(fullName, 200) ||
            !['MALE','FEMALE'].includes(sex) || !validText(gradeLevel, 40) ||
            !validText(section, 100) || parentMobile.length > 30) {
          throw new Error('Import data changed or contains invalid values. Run Preview again.');
        }
        if (isTeacher) {
          const assignment = await client.query(
            'SELECT 1 FROM class_adviser_assignments WHERE school_id=$1 AND adviser_user_id=$2 AND grade_level=$3 AND section=$4',
            [req.auth.schoolId, req.auth.userId, gradeLevel, section]
          );
          if (!assignment.rowCount) throw new Error('A row targets a section outside your Class Adviser assignments. No records were imported.');
        }
        const exists = await client.query(
          'SELECT 1 FROM students WHERE school_id=$1 AND student_id=$2 FOR UPDATE',
          [req.auth.schoolId, studentId]
        );
        if (exists.rowCount && isTeacher) {
          results.push({ studentId, status: 'SKIPPED_EXISTING' });
          continue;
        }
        if (exists.rowCount) {
          await client.query(
            `UPDATE students SET lrn=$3, full_name=$4, sex=$5, grade_level=$6, section=$7,
                    parent_name=$8, parent_mobile=$9, active=TRUE, archived_at=NULL, updated_at=NOW()
             WHERE school_id=$1 AND student_id=$2`,
            [req.auth.schoolId, studentId, lrn, fullName, sex, gradeLevel, section, parentName, parentMobile]
          );
          results.push({ studentId, status: 'UPDATED' });
        } else {
          await client.query(
            `INSERT INTO students(school_id, student_id, lrn, full_name, sex, grade_level, section,
                                  parent_name, parent_mobile, qr_token)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,gen_random_uuid())`,
            [req.auth.schoolId, studentId, lrn, fullName, sex, gradeLevel, section, parentName, parentMobile]
          );
          results.push({ studentId, status: 'CREATED' });
        }
      }
      await client.query(
        `INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
         VALUES($1,'SCHOOL',$2,'STUDENT_BULK_IMPORT','student_batch',$3,$4::jsonb)`,
        [req.auth.schoolId, req.auth.userId, String(results.length),
          JSON.stringify({ created: results.filter(row => row.status === 'CREATED').length,
            updated: results.filter(row => row.status === 'UPDATED').length,
            skipped: results.filter(row => row.status === 'SKIPPED_EXISTING').length })]
      );
      await client.query('COMMIT');
      return res.json({ ok: true, results, summary: {
        created: results.filter(row => row.status === 'CREATED').length,
        updated: results.filter(row => row.status === 'UPDATED').length,
        skipped: results.filter(row => row.status === 'SKIPPED_EXISTING').length
      }});
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') return res.status(409).json({ error: 'An LRN or Student ID conflicts with an existing master record. No rows were imported.' });
      return res.status(400).json({ error: error.message || 'Bulk import failed. No rows were imported.' });
    } finally {
      client.release();
    }
  });

  app.post('/api/students/bulk-actions', authenticateSchoolClient, studentBatchManagers, async (req, res) => {
    const ids = [...new Set((Array.isArray(req.body?.studentIds) ? req.body.studentIds : []).map(clean).filter(Boolean))];
    const action = String(req.body?.action || '').toUpperCase();
    if (!ids.length || ids.length > 1000) return res.status(400).json({ error: 'Select between 1 and 1,000 students.' });
    if (!['ACTIVATE','DEACTIVATE','ARCHIVE','ASSIGN_SECTION'].includes(action)) return res.status(400).json({ error: 'Choose a valid student batch action.' });
    const isTeacher = req.auth.role === 'TEACHER';
    if (isTeacher && (!req.auth.teacherDesignations?.includes('CLASS_ADVISER') || action !== 'ASSIGN_SECTION')) {
      return res.status(403).json({ error: 'Teachers may batch-assign placement only as an authorized Class Adviser.' });
    }
    try {
      if (action === 'ASSIGN_SECTION') {
        const gradeLevel = clean(req.body?.gradeLevel);
        const section = clean(req.body?.section);
        if (!validText(gradeLevel, 40) || !validText(section, 100)) {
          return res.status(400).json({ error: 'Choose a valid target grade level and section.' });
        }
        if (isTeacher) {
          const target = await pool.query(
            'SELECT 1 FROM class_adviser_assignments WHERE school_id=$1 AND adviser_user_id=$2 AND grade_level=$3 AND section=$4',
            [req.auth.schoolId, req.auth.userId, gradeLevel, section]
          );
          if (!target.rowCount) return res.status(403).json({ error: 'You may assign students only to a section assigned to you as Class Adviser.' });
          const outside = await pool.query(
            `SELECT s.student_id FROM students s
             WHERE s.school_id=$1 AND s.student_id=ANY($2::text[]) AND s.active=TRUE
               AND NOT EXISTS (
                 SELECT 1 FROM class_adviser_assignments ca
                 WHERE ca.school_id=s.school_id AND ca.adviser_user_id=$3
                   AND ca.grade_level=s.grade_level AND ca.section=s.section
               ) LIMIT 1`,
            [req.auth.schoolId, ids, req.auth.userId]
          );
          if (outside.rowCount) return res.status(403).json({ error: 'One or more selected learners are outside your assigned advisory sections.' });
        }
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const updated = await client.query(
            `UPDATE students SET grade_level=$3, section=$4, updated_at=NOW()
             WHERE school_id=$1 AND student_id=ANY($2::text[]) AND active=TRUE
             RETURNING student_id`,
            [req.auth.schoolId, ids, gradeLevel, section]
          );
          await client.query(
            `UPDATE student_enrollments en SET grade_level=$3, section=$4, updated_at=NOW()
             FROM school_years sy
             WHERE en.school_id=$1 AND en.student_id=ANY($2::text[])
               AND sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id
               AND sy.status='ACTIVE' AND en.enrollment_status='ENROLLED'`,
            [req.auth.schoolId, ids, gradeLevel, section]
          );
          await client.query(
            `INSERT INTO student_enrollments(school_id,student_id,school_year_id,grade_level,section,enrollment_date,enrollment_status,created_by_user_id)
             SELECT s.school_id,s.student_id,sy.school_year_id,$3,$4,
               CASE WHEN CURRENT_DATE<sy.start_date THEN sy.start_date WHEN CURRENT_DATE>sy.end_date THEN sy.end_date ELSE CURRENT_DATE END,
               'ENROLLED',$5
             FROM students s CROSS JOIN school_years sy
             WHERE s.school_id=$1 AND s.student_id=ANY($2::text[]) AND s.active=TRUE
               AND sy.school_id=s.school_id AND sy.status='ACTIVE'
               AND NOT EXISTS (SELECT 1 FROM student_enrollments en
                 WHERE en.school_id=s.school_id AND en.student_id=s.student_id AND en.school_year_id=sy.school_year_id)
             ON CONFLICT(school_id,student_id,school_year_id) DO NOTHING`,
            [req.auth.schoolId, ids, gradeLevel, section, req.auth.userId]
          );
          await client.query(
            `INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
             VALUES($1,'SCHOOL',$2,'STUDENT_BULK_ASSIGN_SECTION','student_batch',$3,$4::jsonb)`,
            [req.auth.schoolId, req.auth.userId, String(updated.rowCount), JSON.stringify({ studentIds: ids, gradeLevel, section })]
          );
          await client.query('COMMIT');
          return res.json({ ok: true, affected: updated.rowCount, action });
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally { client.release(); }
      }
      if (isTeacher) return res.status(403).json({ error: 'Only administrators may activate, deactivate, or archive student records.' });
      const active = action === 'ACTIVATE';
      const result = await pool.query(
        `UPDATE students SET active=$3,
            archived_at=CASE WHEN $4 THEN NOW() WHEN $3 THEN NULL ELSE archived_at END,
            updated_at=NOW()
         WHERE school_id=$1 AND student_id=ANY($2::text[])
         RETURNING student_id`,
        [req.auth.schoolId, ids, active, action === 'ARCHIVE']
      );
      await pool.query(
        `INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
         VALUES($1,'SCHOOL',$2,'STUDENT_BULK_STATUS','student_batch',$3,$4::jsonb)`,
        [req.auth.schoolId, req.auth.userId, String(result.rowCount), JSON.stringify({ action, studentIds: ids })]
      );
      return res.json({ ok: true, affected: result.rowCount, action });
    } catch (error) {
      console.error('Student bulk action failed:', error.message);
      return res.status(500).json({ error: 'Could not apply the student batch action.' });
    }
  });
}

module.exports = { registerStudentManagementRoutes, readImportRows };
