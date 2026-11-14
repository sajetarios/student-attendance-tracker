'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('teacher designation editing is in the dedicated permissions panel and supports the three combinations', () => {
  const html = read('public/portal.html');
  const portal = read('public/portal.js');
  assert.match(html, /id="teacherPermissionsCard"/);
  assert.match(html, /id="teacherPermissionRows"/);
  assert.match(portal, /data-edit-teacher-permission/);
  assert.match(portal, /selectOptions:\s*\[/);
  assert.match(portal, /value: 'SUBJECT_TEACHER'/);
  assert.match(portal, /value: 'CLASS_ADVISER'/);
  assert.match(portal, /value: 'BOTH'/);
  assert.match(portal, /answer === 'BOTH' \? \['SUBJECT_TEACHER','CLASS_ADVISER'\]/);
  assert.match(portal, /\/designations/);
});
test('School Administrator has a department management table with edit actions', () => {
  const html = read('public/portal.html');
  const portal = read('public/portal.js');
  const routes = read('department-routes.js');
  assert.match(html, /department-management-table/);
  assert.match(html, /id="departmentList"/);
  assert.match(portal, /data-edit-department/);
  assert.match(portal, /api\('\/api\/departments\/' \+ encodeURIComponent\(department\.departmentId\)/);
  assert.ok(routes.includes("app.patch('/api/departments/:departmentId'"));
});

test('SF2 sex is read-only and uses the saved student master-record value', () => {
  const portal = read('public/portal.js');
  assert.match(portal, /const sexControl = esc\(student\.sex \|\| 'Not set'\)/);
  assert.doesNotMatch(portal, /data-sf2-sex/);
  assert.doesNotMatch(portal, /sf2Rows'\)\.addEventListener\('change'/);
  assert.doesNotMatch(portal, /\/api\/sf2\/students\//);
  const sf2Routes = read('sf2-routes.js');
  assert.equal(sf2Routes.includes("app.patch('/api/sf2/students/:studentId/sex'"), false);
  assert.match(portal, /Male\/Female set in Student Management/);
});

test('Class Advisers load the schedules assigned to their advisory section', () => {
  const portal = read('public/portal.js');
  const server = read('server.js');
  assert.match(portal, /role === 'TEACHER' && !\(teacherHas\('SUBJECT_TEACHER'\) \|\| teacherHas\('CLASS_ADVISER'\)\)/);
  assert.match(portal, /View every subject schedule assigned to your advisory section/);
  assert.match(portal, /teacherHas\('SUBJECT_TEACHER'\) \|\| teacherHas\('CLASS_ADVISER'\)\) views\.push\('schedules'\)/);
  const start = server.indexOf("app.get('/api/periods'");
  const end = server.indexOf("app.post('/api/periods'", start);
  const route = server.slice(start, end);
  assert.match(route, /class_adviser_assignments/);
  assert.match(route, /ca\.grade_level=p\.grade_level AND ca\.section=p\.section/);
  assert.match(route, /assignedTeacherName/);
});

test('Class Adviser import can explicitly map the file to an assigned section and keeps QR identity stable', () => {
  const html = read('public/portal.html');
  const portal = read('public/portal.js');
  const routes = read('student-management-routes.js');
  assert.match(html, /id="studentImportAdvisoryAssignment"/);
  assert.match(html, /<th>Grade<\/th><th>Section<\/th>/);
  assert.match(portal, /payload\.advisoryAssignmentId = select\.value/);
  assert.match(portal, /previewStudentImport/);
  assert.match(routes, /SELECT assignment_id AS "assignmentId",grade_level AS "gradeLevel",section FROM class_adviser_assignments/);
  assert.match(routes, /selectedScope\.gradeLevel/);
  assert.match(routes, /normalizeGradeLevel\(item\.gradeLevel\)/);
  assert.match(routes, /qr_token=COALESCE\(students\.qr_token,EXCLUDED\.qr_token\)/);
  assert.match(routes, /VALUES\(\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,gen_random_uuid\(\)\)/);
});
