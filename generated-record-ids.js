'use strict';

// Generated identifiers are Attendigo internal identifiers, never DepEd LRNs.
// Student IDs are global because students.student_id is a database primary key.
function positiveNumber(value) {
  const asText = String(value);
  if (!/^\d+$/.test(asText) || BigInt(asText) < 1n) throw new Error('Invalid generated identifier sequence.');
  return BigInt(asText);
}

// This is an immutable registration identifier: year and grade capture the
// learner's enrollment context at creation, not their current grade.
function parseGradeNumber(gradeLevel) {
  const match = /^(?:Grade\s*|G\s*)(\d{1,2})$/i.exec(String(gradeLevel || '').trim());
  const grade = match ? Number(match[1]) : null;
  return Number.isInteger(grade) && grade >= 1 && grade <= 12 ? grade : null;
}

function formatYearGradeStudentId(year, grade, value) {
  const number = positiveNumber(value);
  const firstYear = Number(year);
  const gradeNumber = Number(grade);
  if (!Number.isInteger(firstYear) || firstYear < 2000 || firstYear > 9999 ||
      !Number.isInteger(gradeNumber) || gradeNumber < 1 || gradeNumber > 12 ||
      number > 999n) throw new RangeError('The year, grade, or 3-digit student ID series is invalid or exhausted.');
  return firstYear + '-G' + gradeNumber + '-' + number.toString().padStart(3, '0');
}

// Historical STU IDs remain valid and can still be allocated for non-numeric
// grade levels; existing students must never have their primary key changed.
function formatStudentId(value) {
  return 'STU-' + positiveNumber(value).toString().padStart(8, '0');
}

function formatDepartmentCode(value) {
  const number = positiveNumber(value);
  if (number > 9999999999999999n) throw new Error('Department identifier space exhausted.');
  return 'DEP-' + number.toString().padStart(3, '0');
}

async function nextStudentId(client, { year, gradeLevel } = {}) {
  const grade = parseGradeNumber(gradeLevel);
  if (grade === null) {
    // Preserve existing custom-grade registration behavior.
    const legacy = await client.query("SELECT nextval('attendigo_student_id_seq') AS next_number");
    return formatStudentId(legacy.rows[0].next_number);
  }
  const result = await client.query(
    `INSERT INTO attendigo_student_id_counters(registration_year, registration_grade, last_number)
     VALUES ($1,$2,1)
     ON CONFLICT(registration_year, registration_grade) DO UPDATE
       SET last_number = attendigo_student_id_counters.last_number + 1
       WHERE attendigo_student_id_counters.last_number < 999
     RETURNING last_number`,
    [year, grade]
  );
  if (!result.rowCount) {
    const error = new Error('The ' + year + ' Grade ' + grade + ' three-digit student ID series has reached 999. Please contact the school administrator.');
    error.code = 'STUDENT_ID_SERIES_EXHAUSTED';
    throw error;
  }
  return formatYearGradeStudentId(year, grade, result.rows[0].last_number);
}

// The transaction-scoped lock serializes automatic department creation per school.
// It never trusts a school_id or department code supplied by the client.
async function nextDepartmentCode(client, schoolId) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text), 29715)', [schoolId]);
  const result = await client.query(
    `SELECT COALESCE(MAX(substring(department_code FROM '^DEP-([0-9]+)$')::bigint),0) AS last_number
       FROM school_departments
      WHERE school_id=$1 AND department_code ~ '^DEP-[0-9]+$'`,
    [schoolId]
  );
  return formatDepartmentCode(BigInt(result.rows[0].last_number) + 1n);
}

function followingDepartmentCode(code) {
  if (!/^DEP-[0-9]+$/.test(code)) throw new Error('Invalid department code to increment.');
  return formatDepartmentCode(BigInt(code.slice(4)) + 1n);
}

module.exports = { formatStudentId, formatYearGradeStudentId, parseGradeNumber, formatDepartmentCode, nextStudentId, nextDepartmentCode, followingDepartmentCode };
