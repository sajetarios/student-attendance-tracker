'use strict';

// Generated identifiers are Attendigo internal identifiers, never DepEd LRNs.
// Student IDs are global because students.student_id is a database primary key.
function positiveNumber(value) {
  const asText = String(value);
  if (!/^\d+$/.test(asText) || BigInt(asText) < 1n) throw new Error('Invalid generated identifier sequence.');
  return BigInt(asText);
}

function formatStudentId(value) {
  return 'STU-' + positiveNumber(value).toString().padStart(8, '0');
}

function formatDepartmentCode(value) {
  const number = positiveNumber(value);
  if (number > 9999999999999999n) throw new Error('Department identifier space exhausted.');
  return 'DEP-' + number.toString().padStart(3, '0');
}

async function nextStudentId(client) {
  const result = await client.query("SELECT nextval('attendigo_student_id_seq') AS next_number");
  return formatStudentId(result.rows[0].next_number);
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

module.exports = { formatStudentId, formatDepartmentCode, nextStudentId, nextDepartmentCode, followingDepartmentCode };
