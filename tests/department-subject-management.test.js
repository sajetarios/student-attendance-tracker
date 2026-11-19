'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'subject-management-routes.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'public/department-workspace.js'), 'utf8');
test('Subject updates require authenticated department head or school admin', () => {
  assert.match(api, /authenticateSchoolClient, requireSchoolRoles\('SCHOOL_ADMIN', 'DEPARTMENT_HEAD'\)/);
  assert.match(server, /registerSubjectManagementRoutes/);
});
test('Subject updates use session school and department scope, never client-supplied scope', () => {
  assert.match(api, /req\.auth\.schoolId/);
  assert.match(api, /req\.auth\.departmentId/);
  assert.match(api, /s\.department_id=\$4::uuid/);
  assert.doesNotMatch(api, /req\.body\.departmentId/);
});
test('Subject updates log old and new values in same transaction and preserve period snapshots', () => {
  assert.match(api, /BEGIN/);
  assert.match(api, /SUBJECT_RENAMED/);
  assert.match(api, /JSON\.stringify\(\{before,after:updated\.rows\[0\],activeSchedulesUpdated:schedules\.rowCount\}\)/);
  assert.match(api, /COMMIT/);
  assert.match(api, /UPDATE class_periods SET subject_name=\\$3/);
  assert.match(api, /subject_id=\\$2 AND active=TRUE/);
  assert.match(api, /activeSchedulesUpdated:schedules.rowCount/);
});
test('Department head has a mobile-friendly subject management interface', () => {
  assert.match(ui, /Manage Subjects/);
  assert.match(ui, /dhSubjectEditForm/);
  assert.match(ui, /dhSubjectAddForm/);
  assert.match(ui, /method: isAdd \? 'POST' : 'PATCH'/);
});
