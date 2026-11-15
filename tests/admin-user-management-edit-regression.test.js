'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('multi-field edit dialogs validate and return named values without replacing prompt behavior', () => {
  const dialog = read('public/app-dialog.js');
  assert.match(dialog, /const isForm = config\.kind === 'form'/);
  assert.match(dialog, /fieldControls\.push\(\{ config: fieldConfig, field: control, error: fieldError \}\)/);
  assert.match(dialog, /values\[item\.config\.name\] = value/);
  assert.match(dialog, /form\(message, fields, options = \{\}\)/);
  assert.match(dialog, /prompt\(message, defaultValue = '', options = \{\}\)/);
});

test('department editor updates code, name, description, and active status with referential safeguards', () => {
  const html = read('public/portal.html');
  const portal = read('public/portal.js');
  const routes = read('department-routes.js');
  assert.match(html, /data-admin-management-tab="departments"/);
  assert.match(portal, /name: 'code', label: 'Department code'/);
  assert.match(portal, /name: 'name', label: 'Department name'/);
  assert.match(portal, /name: 'description', label: 'Description', inputType: 'textarea'/);
  assert.match(portal, /name: 'active', label: 'Status'/);
  const start = routes.indexOf("app.patch('/api/departments/:departmentId'");
  const end = routes.indexOf("app.post('/api/school-users/bulk-department'", start);
  const route = routes.slice(start, end);
  assert.match(route, /department_code=\$3, department_name=\$4, description=\$5, active=\$6/);
  assert.match(route, /hasActiveStaff/);
  assert.match(route, /hasActiveSchedules/);
  assert.match(route, /SCHOOL_ADMIN_UPDATE_DEPARTMENT/);
  assert.match(route, /department_code<>'UNASSIGNED'/);
});

test('Class Adviser assignments have edit and remove controls with duplicate-section protection', () => {
  const html = read('public/portal.html');
  const portal = read('public/portal.js');
  const server = read('server.js');
  assert.match(html, /id="adviserAssignmentForm"/);
  assert.match(portal, /data-edit-adviser=/);
  assert.match(portal, /data-remove-adviser=/);
  assert.match(portal, /name: 'adviserUserId', label: 'Class Adviser'/);
  assert.match(portal, /name: 'gradeLevel', label: 'Grade level'/);
  assert.match(portal, /name: 'section', label: 'Section'/);
  const start = server.indexOf("app.patch('/api/class-adviser-assignments/:assignmentId'");
  const end = server.indexOf("app.delete('/api/class-adviser-assignments/:assignmentId'", start);
  const route = server.slice(start, end);
  assert.match(route, /CLASS_ADVISER/);
  assert.match(route, /assignment_id<>\$2/);
  assert.match(route, /SCHOOL_ADMIN_UPDATE_CLASS_ADVISER/);
});

test('School Administrator user management separates accounts, permissions, and departments', () => {
  const html = read('public/portal.html');
  const portal = read('public/portal.js');
  assert.match(html, /data-admin-management-tab="accounts"/);
  assert.match(html, /data-admin-management-tab="permissions"/);
  assert.match(html, /data-admin-management-tab="departments"/);
  assert.match(html, /id="teacherPermissionsCard"/);
  assert.match(html, /id="staffAccountsTable"[\s\S]*<th>Account action<\/th>/);
  assert.match(portal, /function setAdminManagementTab/);
  assert.match(portal, /const isAdmin = user\?\.role === 'SCHOOL_ADMIN'/);
  assert.match(portal, /function renderTeacherPermissions/);
  assert.match(portal, /data-edit-teacher-permission/);
  assert.match(portal, /data-edit-staff-profile/);
  assert.match(portal, /data-edit-teacher-profile/);
  assert.match(portal, /departments\.filter\(item => item\.active \|\| String\(item\.departmentId\) === String\(teacher\.departmentId\)\)/);
  assert.match(portal, /departments\.filter\(item => item\.active \|\| String\(item\.departmentId\) === String\(account\.departmentId\)\)/);
  const menuStart = portal.indexOf('const accountActions =');
  const menuEnd = portal.indexOf('const designationLabels =', menuStart);
  const adminActions = portal.slice(menuStart, menuEnd);
  assert.doesNotMatch(adminActions, /data-manage-permanent/);
});

test('staff profile editing is school-scoped, audited, and disables sessions rather than deleting history', () => {
  const server = read('server.js');
  const start = server.indexOf("app.patch('/api/school-users/:userId/profile'");
  const end = server.indexOf('// Gate Keeper monitoring', start);
  const route = server.slice(start, end);
  assert.match(route, /role IN \('DEPARTMENT_HEAD','GATE_KEEPER'\)/);
  assert.match(route, /session_version=CASE WHEN \$4 IS FALSE/);
  assert.match(route, /UPDATE user_sessions SET revoked_at=NOW\(\)/);
  assert.match(route, /SCHOOL_ADMIN_UPDATE_STAFF_ACCOUNT/);
  assert.doesNotMatch(route, /DELETE FROM school_users/);
});
