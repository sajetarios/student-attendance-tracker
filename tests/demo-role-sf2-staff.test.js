'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

test('Filipino demo department head correction is scoped and preserves account secrets', () => {
  const sql = read('migrations/023_demo001_role_and_sf2_attendance.sql');
  const runner = read('scripts/migrate.js');
  assert.match(runner, /023_demo001_role_and_sf2_attendance\.sql/);
  assert.match(sql, /school_code='DEMO001'/);
  assert.match(sql, /username='FIL-DEP001'/);
  assert.match(sql, /role='DEPARTMENT_HEAD'/);
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM teacher_period_assignments/);
  assert.match(sql, /UPDATE user_sessions SET revoked_at=NOW\(\)/);
  assert.doesNotMatch(sql, /UPDATE\s+students\b/i);
  assert.doesNotMatch(sql, /password_hash\s*=/i);
});

test('SF2 synthetic data uses class attendance, respects absences and never touches real tenants', () => {
  const sql = read('migrations/023_demo001_role_and_sf2_attendance.sql');
  assert.match(sql, /DEMO-G8-/);
  assert.match(sql, /Rizal - DEMO/);
  assert.match(sql, /attendance_scope IN \('CLASS','ADVISORY'\)/);
  assert.match(sql, /'CLASS',cp\.period_id/);
  assert.match(sql, /'synthetic-sf2-preview'/);
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM sf2_daily_overrides/);
  assert.match(sql, /EXTRACT\(ISODOW FROM day_slot\.d\) BETWEEN 1 AND 5/);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+students/i);
});

test('admin-only demo student credentials are shown once through a dedicated action', () => {
  const api = read('student-routes.js');
  const html = read('public/portal.html');
  const portal = read('public/portal.js');
  assert.match(api, /post\('\/api\/admin\/demo-student-login', authenticateSchoolClient, requireSchoolAdmin/);
  assert.match(api, /crypto\.randomBytes\(18\)/);
  assert.match(api, /must_change_password\)\s*VALUES/);
  assert.match(api, /school_code='DEMO001'/);
  assert.match(html, /id="addSchoolStaffAccount"/);
  assert.match(html, /id="createDemoStudentLogin"/);
  assert.match(portal, /demoStudentLoginCard[\s\S]*?admin && user\?\.schoolCode/);
  assert.match(portal, /createDemoStudentLogin/);
  assert.match(portal, /newAccountRole'\)\.value = 'DEPARTMENT_HEAD'/);
  assert.match(portal, /user\?\.schoolCode === 'DEMO001'/);
});
