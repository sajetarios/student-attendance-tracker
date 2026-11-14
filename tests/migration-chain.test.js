'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REQUIRED_MIGRATIONS, stripTransactionWrappers } = require('../scripts/migrate');

const migrationDir = path.join(__dirname, '..', 'migrations');

test('all seventeen database migrations are present and in order', () => {
  const files = fs.readdirSync(migrationDir).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/i.test(name)).sort();
  assert.deepEqual(files, REQUIRED_MIGRATIONS);
});

test('migration scripts leave transaction ownership to the migration runner', () => {
  for (const file of REQUIRED_MIGRATIONS) {
    const sql = fs.readFileSync(path.join(migrationDir, file), 'utf8');
    const stripped = stripTransactionWrappers(sql);
    assert.ok(stripped.length > 0, `${file} should not be empty`);
    assert.doesNotMatch(stripped, /^\s*BEGIN\s*;/im, `${file} has an embedded BEGIN`);
    assert.doesNotMatch(stripped, /^\s*COMMIT\s*;/im, `${file} has an embedded COMMIT`);
  }
});

test('core migration provides the exact composite keys required by later tenant-safe migrations', () => {
  const sql = fs.readFileSync(path.join(migrationDir, REQUIRED_MIGRATIONS[0]), 'utf8');
  assert.match(sql, /school_users_school_user_uk\s+UNIQUE\s*\(school_id,\s*user_id\)/i);
  assert.match(sql, /student_id TEXT PRIMARY KEY/i);
  assert.match(sql, /students_school_student_uk\s+UNIQUE\s*\(school_id,\s*student_id\)/i);
  assert.match(sql, /class_periods_school_period_uk\s+UNIQUE\s*\(school_id,\s*period_id\)/i);
  for (const table of ['schools', 'platform_users', 'school_users', 'students', 'class_periods', 'attendance_events', 'attendance_devices', 'school_settings']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`, 'i'), `missing core table ${table}`);
  }
});

test('teacher and device migration covers current server queries', () => {
  const sql = fs.readFileSync(path.join(migrationDir, REQUIRED_MIGRATIONS[2]), 'utf8');
  for (const name of ['teacher_status', 'leave_type', 'leave_start_date', 'expected_return_date', 'leave_auto_reactivate', 'teacher_period_substitutions', 'device_api_credentials', 'last_used_at', 'revoked_at']) {
    assert.match(sql, new RegExp(`\\b${name}\\b`, 'i'), `missing ${name}`);
  }
});


test('student portal migration creates isolated student logins and sessions', () => {
  const sql = fs.readFileSync(path.join(migrationDir, '007_student_portal_accounts.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS student_accounts/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS student_sessions/i);
  assert.match(sql, /FOREIGN KEY \(school_id, student_id\)/i);
  assert.match(sql, /must_change_password BOOLEAN NOT NULL DEFAULT TRUE/i);
});


test('teacher gate migration adds private teacher QR/photo fields and verified gate events', () => {
  const sql = fs.readFileSync(path.join(migrationDir, '008_teacher_gate_attendance.sql'), 'utf8');
  for (const name of ['teacher_qr_token', 'teacher_photo_path', 'teacher_gate_events', 'photo_verified', 'recorded_by_user_id']) {
    assert.match(sql, new RegExp(`\\b${name}\\b`, 'i'), `missing ${name}`);
  }
  assert.match(sql, /UNIQUE INDEX IF NOT EXISTS teacher_gate_one_event_per_type_day_uk/i);
});

test('department migration backfills existing users and schedules to a safe default department', () => {
  const sql = fs.readFileSync(path.join(migrationDir, '013_departments_and_classroom_assignment.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS school_departments/i);
  assert.match(sql, /department_code, department_name/i);
  assert.match(sql, /'UNASSIGNED', 'Unassigned'/i);
  assert.match(sql, /ALTER TABLE school_users ADD COLUMN IF NOT EXISTS department_id UUID/i);
  assert.match(sql, /ALTER TABLE class_periods ADD COLUMN IF NOT EXISTS department_id UUID/i);
  assert.match(sql, /ALTER TABLE class_periods ADD COLUMN IF NOT EXISTS classroom TEXT/i);
  assert.match(sql, /FOREIGN KEY \(school_id, department_id\)/i);
});

test('DEMO001 department correction is school-scoped, backed up, and preserves student/attendance identities', () => {
  const sql = fs.readFileSync(path.join(migrationDir, '017_demo001_subject_department_correction.sql'), 'utf8');
  assert.match(sql, /school_code='DEMO001'/i);
  assert.match(sql, /'ENG-2026'/);
  assert.match(sql, /'MATH2026'/);
  assert.match(sql, /'SCI-2026'/);
  assert.match(sql, /demo001_department_correction_backup/);
  assert.match(sql, /to_jsonb\(p\)/);
  assert.match(sql, /to_jsonb\(su\)/);
  assert.match(sql, /DELETE FROM teacher_period_assignments/);
  assert.match(sql, /'Class_Adviser001'/);
  assert.match(sql, /'Dowthii'/);
  assert.match(sql, /INSERT INTO audit_logs/);
  assert.doesNotMatch(sql, /UPDATE\s+students\b/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+students\b/i);
  assert.doesNotMatch(sql, /UPDATE\s+attendance_events\b/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+attendance_events\b/i);
});
