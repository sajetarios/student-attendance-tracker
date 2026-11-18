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
  assert.match(student, /nextStudentId\(client, \{ year: registrationYear \}\)/);
  assert.match(student, /ON CONFLICT\(student_id\) DO NOTHING/);
  assert.match(student, /req\.auth\.schoolId, cleanStudentId/);
  assert.match(department, /nextDepartmentCode\(client, req\.auth\.schoolId\)/);
  assert.match(department, /schoolAdmin/);
  assert.match(portal, /studentId: \$\('newStudentId'\)\.value\.trim\(\)/);
  assert.match(html, /id="newStudentId"[^>]*placeholder="Auto-generated \(e.g. 26-00089\)/);
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

test('2026 Grade 10 registration IDs have three digits, preserve historical prefixes, and have a hard limit', () => {
  assert.equal(ids.parseGradeNumber('Grade 10'), 10);
  assert.equal(ids.parseGradeNumber('G7'), 7);
  assert.equal(ids.parseGradeNumber('Kinder'), null);
  assert.equal(ids.formatYearGradeStudentId(2026, 10, 89), '2026-G10-089');
  assert.equal(ids.formatYearGradeStudentId(2026, 10, 1), '2026-G10-001');
  assert.equal(ids.formatYearGradeStudentId(2027, 11, 999), '2027-G11-999');
  assert.throws(() => ids.formatYearGradeStudentId(2026, 10, 1000), /exhausted/);
});

test('legacy year-grade format remains readable for historical student records', () => {
  assert.equal(ids.formatYearGradeStudentId(2026, 10, 89), '2026-G10-089');
});

test('exhausted year/grade sequence fails clearly without reissuing an ID', async () => {
  const fakeClient = { query: async () => ({ rowCount: 0, rows: [] }) };
  await assert.rejects(
    ids.nextStudentId(fakeClient, {year: 2026, gradeLevel: 'G10'}),
    error => error.code === 'STUDENT_ID_SERIES_EXHAUSTED'
  );
});

test('new counter migration seeds manually supplied codes and never edits student identities', () => {
  const sql = file('migrations/060_year_grade_student_ids.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS attendigo_student_id_counters/);
  assert.match(sql, /last_number INTEGER NOT NULL CHECK \(last_number BETWEEN 1 AND 999\)/);
  assert.match(sql, /FROM students/);
  assert.doesNotMatch(sql, /UPDATE\s+students\b/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+students\b/i);
  assert.match(file('scripts/migrate.js'), /060_year_grade_student_ids\.sql/);
  assert.match(file('server.js'), /EXTRACT\(YEAR FROM start_date\)::int AS registration_year/);
});

test('short Student IDs are stable, grade-independent, and easy to remember', () => {
  assert.equal(ids.formatShortStudentId(2026, 89), '26-00089');
  assert.equal(ids.formatShortStudentId(2026, 1), '26-00001');
  assert.equal(ids.formatShortStudentId(2026, 99999), '26-99999');
  assert.equal(ids.formatShortStudentId(2031, 1234), '31-01234');
  assert.throws(() => ids.formatShortStudentId(2026, 100000), /exhausted/);
  assert.throws(() => ids.formatShortStudentId(2100, 1), /invalid/);
  assert.throws(() => ids.formatShortStudentId(2026, 0));
  assert.equal(ids.canonicalStudentLoginUsername('2600089'), '26-00089');
  assert.equal(ids.canonicalStudentLoginUsername(' 2600089 '), '26-00089');
  assert.equal(ids.canonicalStudentLoginUsername('26-00089'), '26-00089');
  assert.equal(ids.canonicalStudentLoginUsername('2026-G10-089'), '2026-G10-089');
  assert.equal(ids.canonicalStudentLoginUsername('customUser'), 'customUser');
  assert.equal(ids.canonicalStudentLoginUsername('12345678'), '12345678');
});

test('year-only ID allocation uses atomic PostgreSQL upsert with a 99,999 cap', async () => {
  const calls = [];
  const db = { query: async (sql, params) => {
    calls.push({sql,params});
    return { rowCount:1, rows:[{ last_number: '89' }] };
  } };
  assert.equal(await ids.nextStudentId(db, {year:2026,gradeLevel:'Grade 10'}), '26-00089');
  assert.deepEqual(calls[0].params,[2026]);
  assert.match(calls[0].sql,/INSERT INTO attendigo_student_short_id_counters/);
  assert.match(calls[0].sql,/ON CONFLICT\(registration_year\) DO UPDATE/);
  assert.match(calls[0].sql,/last_number < 99999/);
});

test('five-digit ID exhaustion does not reissue existing IDs', async () => {
  const db = { query: async () => ({rowCount:0,rows:[]}) };
  await assert.rejects(ids.nextStudentId(db,{year:2026}), err =>
    err.code === 'STUDENT_ID_SERIES_EXHAUSTED' && /99,999/.test(err.message));
});

test('short ID migration seeds all issued manual codes without rewriting existing records', () => {
  const sql = file('migrations/061_memorable_student_ids.sql');
  assert.match(sql,/CREATE TABLE IF NOT EXISTS attendigo_student_short_id_counters/);
  assert.match(sql,/last_number INTEGER NOT NULL CHECK \(last_number BETWEEN 1 AND 99999\)/);
  assert.match(sql,/FROM students/);
  assert.match(sql,/GREATEST\(/);
  assert.doesNotMatch(sql,/UPDATE\s+students\b/i);
  assert.doesNotMatch(sql,/DELETE\s+FROM\s+students\b/i);
  assert.match(file('scripts/migrate.js'),/061_memorable_student_ids\.sql/);
});

test('short ID login alias is limited to the Student portal and preserves exact username precedence', () => {
  const auth = file('auth-routes.js');
  const login = auth.slice(auth.indexOf("app.post('/api/auth/student/login'"));
  assert.match(login,/canonicalStudentLoginUsername\(username\)/);
  assert.match(login,/lower\(sa.username\)=lower\(\$3\)/);
  assert.match(login,/ORDER BY CASE WHEN lower\(sa.username\)=lower\(\$2\) THEN 0 ELSE 1 END/);
  assert.match(file('public/portal-login.js'),/26-00089 or 2600089/);
  assert.match(file('public/portal-login.html'),/portal-login\.js\?v=14/);
});
