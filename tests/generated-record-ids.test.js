'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ids = require('../generated-record-ids');
const file = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

test('student ID and department code are human readable, distinct, stable formats', () => {
  assert.equal(ids.formatStudentId(1), 'STU-00000001');
  assert.equal(ids.formatStudentId('123456789'), 'STU-123456789');
  assert.equal(ids.formatDepartmentCode(1), 'DEP-001');
  assert.equal(ids.formatDepartmentCode('104'), 'DEP-104');
  assert.equal(ids.followingDepartmentCode('DEP-099'), 'DEP-100');
  assert.throws(() => ids.formatStudentId(0));
  assert.throws(() => ids.formatDepartmentCode('-1'));
});

test('student IDs are allocated atomically through a database sequence', async () => {
  const statements = [];
  const fakeClient = { query: async sql => {
    statements.push(sql);
    return { rows: [{ next_number: '47' }] };
  } };
  assert.equal(await ids.nextStudentId(fakeClient), 'STU-00000047');
  assert.match(statements[0], /nextval\('attendigo_student_id_seq'\)/);
});

test('department codes are allocated under a school-specific transaction lock', async () => {
  const statements = [];
  const fakeClient = { query: async (sql, values) => {
    statements.push({ sql, values });
    return sql.includes('MAX(') ? { rows: [{ last_number: '14' }] } : { rows: [] };
  } };
  assert.equal(await ids.nextDepartmentCode(fakeClient, 'school-A'), 'DEP-015');
  assert.equal(statements.length, 2);
  assert.match(statements[0].sql, /pg_advisory_xact_lock/);
  assert.deepEqual(statements[0].values, ['school-A']);
  assert.match(statements[1].sql, /WHERE school_id=\$1/);
  assert.deepEqual(statements[1].values, ['school-A']);
});

test('both create APIs support blank IDs while keeping manual IDs and tenant boundaries', () => {
  const student = file('server.js');
  const department = file('department-routes.js');
  const portal = file('public/portal.js');
  const html = file('public/portal.html');
  assert.match(student, /nextStudentId\(client\)/);
  assert.match(student, /ON CONFLICT\(student_id\) DO NOTHING/);
  assert.match(student, /req\.auth\.schoolId, cleanStudentId/);
  assert.match(department, /nextDepartmentCode\(client, req\.auth\.schoolId\)/);
  assert.match(department, /schoolAdmin/);
  assert.match(portal, /studentId: \$\('newStudentId'\)\.value\.trim\(\)/);
  assert.match(html, /id="newStudentId"[^>]*placeholder="Auto-generated/);
  assert.match(html, /id="departmentCode"[^>]*placeholder="Auto-generated/);
});

test('migration only adds a sequence and preserves existing student and department identities', () => {
  const sql = file('migrations/059_automatic_record_identifiers.sql');
  assert.match(sql, /CREATE SEQUENCE IF NOT EXISTS attendigo_student_id_seq/);
  assert.ok(sql.includes("FROM '^STU-([0-9]+)$'"));
  assert.ok(sql.includes("student_id ~ '^STU-[0-9]{1,16}$'"));
  assert.doesNotMatch(sql, /UPDATE\s+(students|school_departments)\b/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+(students|school_departments)\b/i);
  assert.match(file('scripts/migrate.js'), /059_automatic_record_identifiers\.sql/);
});
