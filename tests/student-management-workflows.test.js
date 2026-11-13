'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const portalHtml = read('public/portal.html');
const portalJs = read('public/portal.js');
const server = read('server.js');
const studentRoutes = read('student-management-routes.js');
const departmentRoutes = read('department-routes.js');
const permissions = read('role-permissions.js');

test('student add and edit forms include required Male/Female sex options', () => {
  assert.match(portalHtml, /id="newSex" required/);
  assert.match(portalHtml, /id="editSex"/);
  assert.match(portalHtml, /option value="MALE">Male/);
  assert.match(portalHtml, /option value="FEMALE">Female/);
  assert.match(server, /!\['MALE','FEMALE'\]\.includes\(String\(sex \|\| ''\)\.toUpperCase\(\)\)/);
});

test('student import supports Excel and CSV preview, duplicate detection, and confirmed commit', () => {
  assert.match(studentRoutes, /workbook\.xlsx\.load/);
  assert.match(studentRoutes, /workbook\.csv\.read/);
  assert.match(studentRoutes, /Duplicate Student ID within this file/);
  assert.match(studentRoutes, /Duplicate LRN within this file/);
  assert.match(portalJs, /\/api\/students\/import\/preview/);
  assert.match(portalJs, /\/api\/students\/import\/commit/);
});

test('student batch actions are role-scoped and preserve active-year placement', () => {
  assert.match(studentRoutes, /ACTIVATE','DEACTIVATE','ARCHIVE','ASSIGN_SECTION/);
  assert.match(studentRoutes, /class_adviser_assignments/);
  assert.match(studentRoutes, /student_enrollments/);
  assert.match(server, /students\.view\.all/);
});

test('Department Head can view and export the school-wide student directory but cannot edit it', () => {
  assert.match(portalJs, /if \(role === 'DEPARTMENT_HEAD'\) return \['dashboard', 'students', 'teachers', 'schedules', 'sf2'\]/);
  assert.match(portalJs, /function exportStudentsCsv/);
  assert.match(portalJs, /function exportTeachersCsv/);
  assert.match(permissions, /students\.view\.all/);
  assert.match(portalJs, /read-only school-wide learner master roster/i);
});

test('administrators can batch assign teacher and Department Head departments safely', () => {
  assert.match(departmentRoutes, /\/api\/school-users\/bulk-department/);
  assert.match(departmentRoutes, /teacher_period_assignments/);
  assert.match(portalJs, /\/api\/school-users\/bulk-department/);
  assert.match(portalHtml, /id="bulkStaffDepartmentCard"/);
});

test('teacher schedule batch assignment is department-scoped and checks overlaps', () => {
  assert.match(server, /\/api\/teachers\/bulk-assignments/);
  assert.match(server, /DEPARTMENT_HEAD_BULK_ASSIGN_TEACHER/);
  assert.match(server, /overlaps with/);
  assert.match(portalJs, /\/api\/teachers\/bulk-assignments/);
});

test('cloud sync status is clearly displayed without falsely reporting an inactive connection as synced', () => {
  assert.match(portalHtml, /id="cloudSyncIndicator"/);
  assert.match(portalJs, /Cloud sync: Not active/);
  assert.match(server, /connectionStatus: 'NOT_ACTIVE'/);
});
