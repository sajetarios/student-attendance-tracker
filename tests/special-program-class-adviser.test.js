'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const server = read('server.js');
const portal = read('public/portal.js');
const html = read('public/portal.html');

function routeBlock(start, end) {
  const from = server.indexOf(start);
  assert.ok(from >= 0, 'Missing route: ' + start);
  const to = server.indexOf(end, from);
  assert.ok(to >= 0, 'Missing route end: ' + end);
  return server.slice(from, to);
}

test('Department Heads can list advisory-only sections without a subject period', () => {
  const route = routeBlock(
    "app.get('/api/class-adviser-assignments'",
    "app.post('/api/class-adviser-assignments'"
  );
  assert.match(route, /adviser\.department_id=\$2/);
  assert.doesNotMatch(route, /FROM class_periods/);
  assert.match(route, /ca\.adviser_user_id/);
});

test('Department Heads can assign an adviser to an enrolled special-program section', () => {
  const route = routeBlock(
    "app.post('/api/class-adviser-assignments'",
    "app.patch('/api/class-adviser-assignments/:assignmentId'"
  );
  assert.match(route, /role='TEACHER' AND active=TRUE AND 'CLASS_ADVISER'=ANY\(teacher_designations\)/);
  assert.match(route, /department_id\) !== String\(req\.auth\.departmentId\)/);
  assert.match(route, /FROM students s/);
  assert.match(route, /student_enrollments en/);
  assert.match(route, /sy\.status='ACTIVE' AND en\.enrollment_status='ENROLLED'/);
  assert.match(route, /s\.active=TRUE AND s\.archived_at IS NULL/);
  assert.doesNotMatch(route, /FROM class_periods/);
});

test('Department Heads can edit or remove special-program adviser assignments within their own department', () => {
  const patch = routeBlock(
    "app.patch('/api/class-adviser-assignments/:assignmentId'",
    "app.delete('/api/class-adviser-assignments/:assignmentId'"
  );
  assert.match(patch, /current_adviser\.department_id=\$3/);
  assert.match(patch, /FROM students s/);
  assert.match(patch, /student_enrollments en/);
  assert.doesNotMatch(patch, /FROM class_periods/);

  const remove = routeBlock(
    "app.delete('/api/class-adviser-assignments/:assignmentId'",
    "app.patch('/api/teachers/:userId/designations'"
  );
  assert.match(remove, /adviser\.department_id=\$3/);
  assert.doesNotMatch(remove, /FROM class_periods/);
});

test('Teacher roster scope includes the exact assigned advisory grade and section', () => {
  const start = server.indexOf('const TEACHER_STUDENT_SCOPE');
  const end = server.indexOf('\n\nasync function isTeacherAssigned', start);
  assert.ok(start >= 0 && end > start, 'Teacher scope SQL block should exist');
  const scope = server.slice(start, end);
  assert.match(scope, /FROM class_adviser_assignments ca/);
  assert.match(scope, /ca\.adviser_user_id=\$2/);
  assert.match(scope, /ca\.grade_level=/);
  assert.match(scope, /ca\.section=/);
});

test('Department Head interface explains that SPJ does not need a subject-period schedule', () => {
  assert.match(html, /Special-program sections such as SPJ are included, even without subject schedules/);
  assert.match(portal, /Special-program sections such as SPJ are included/);
});


test('Advisory and subject attendance validate against the active school-year enrollment', () => {
  const start = server.indexOf("app.post('/api/sync/events'");
  assert.ok(start >= 0, 'Attendance ingestion route should exist');
  const route = server.slice(start, start + 18000);
  assert.match(route, /LEFT JOIN LATERAL \([\s\S]*?FROM student_enrollments en[\s\S]*?sy\.status='ACTIVE'[\s\S]*?en\.enrollment_status='ENROLLED'/);
  assert.match(route, /COALESCE\(active_enrollment\.grade_level, s\.grade_level\) AS grade_level/);
  assert.match(route, /COALESCE\(active_enrollment\.section, s\.section\) AS section/);
  assert.match(route, /period\.grade_level !== student\.rows\[0\]\.grade_level/);
  assert.match(route, /student\.rows\[0\]\.grade_level, student\.rows\[0\]\.section/);
});

test('A dual-designated Class Adviser defaults the scanner to an assigned advisory section', () => {
  assert.match(portal, /scopeSelect\.value = hasAdviserRole && adviserAssignments\.length\s*\? 'ADVISORY'/);
  assert.match(portal, /function showScanErrorModal\(/);
  assert.match(portal, /showScanErrorModal\(error\.message/);
});
