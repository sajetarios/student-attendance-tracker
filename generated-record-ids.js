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

// The two-digit prefix is the start of the first school year of registration.
// The ID never changes on promotion. Counters are global because student_id
// is a globally unique primary key across schools.
function formatShortStudentId(year, value) {
  const fullYear = Number(year);
  const sequence = positiveNumber(value);
  if (!Number.isInteger(fullYear) || fullYear < 2000 || fullYear > 2099 ||
      sequence > 99999n) {
    throw new RangeError('The two-digit year or five-digit student ID series is invalid or exhausted.');
  }
  return String(fullYear - 2000).padStart(2, '0') + '-' + sequence.toString().padStart(5, '0');
}

// Accept exactly seven digits as a login alias (e.g. 2600089 => 26-00089).
// Preserve all other usernames, historical IDs, and custom student accounts.
function canonicalStudentLoginUsername(username) {
  const entered = String(username || '').trim();
  return /^[0-9]{7}$/.test(entered) ? entered.slice(0, 2) + '-' + entered.slice(2) : entered;
}

async function nextStudentId(client, { year } = {}) {
  if (year == null) {
    // Retained for old integrations. New student registrations always pass year.
    const legacy = await client.query("SELECT nextval('attendigo_student_id_seq') AS next_number");
    return formatStudentId(legacy.rows[0].next_number);
  }
  // Fail before querying to avoid allocating a counter against an invalid year.
  formatShortStudentId(year, 1);
  const result = await client.query(
    `INSERT INTO attendigo_student_short_id_counters(registration_year, last_number)
     VALUES ($1,1)
     ON CONFLICT(registration_year) DO UPDATE
       SET last_number = attendigo_student_short_id_counters.last_number + 1
       WHERE attendigo_student_short_id_counters.last_number < 99999
     RETURNING last_number`,
    [year]
  );
  if (!result.rowCount) {
    const error = new Error('The ' + year + ' five-digit student ID series has reached 99,999. Please contact the school administrator.');
    error.code = 'STUDENT_ID_SERIES_EXHAUSTED';
    throw error;
  }
  return formatShortStudentId(year, result.rows[0].last_number);
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

module.exports = { formatStudentId, formatShortStudentId, canonicalStudentLoginUsername, formatYearGradeStudentId, parseGradeNumber, formatDepartmentCode, nextStudentId, nextDepartmentCode, followingDepartmentCode };
