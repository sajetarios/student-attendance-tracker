'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('class schedule form derives department from teacher and uses a canonical subject dropdown', () => {
  const html = read('public/portal.html');
  const portal = read('public/portal.js');
  const server = read('server.js');
  const migration = read('migrations/016_school_subject_catalog.sql');
  const formStart = html.indexOf('<form id="scheduleForm"');
  const formEnd = html.indexOf('</form>', formStart);
  const scheduleForm = html.slice(formStart, formEnd);
  assert.ok(formStart >= 0 && formEnd > formStart);
  assert.match(scheduleForm, /id="periodTeacher"/);
  assert.doesNotMatch(scheduleForm, /Department \(automatic\)|periodDepartmentDisplay/);
  assert.match(scheduleForm, /department and subject catalogue are loaded automatically from the staff profile/);
  assert.match(scheduleForm, /id="periodSubject"/);
  assert.match(scheduleForm, /id="periodSection"/);
  assert.doesNotMatch(scheduleForm, /<select[^>]+id="periodDepartment"/);
  assert.match(scheduleForm, /id="addScheduleSubject"/);
  assert.match(portal, /teacherUserId:\s*teacher\?\.userId/);
  assert.match(portal, /subjectId:\s*\$\('periodSubject'\)\.value/);
  assert.match(portal, /api\('\/api\/subjects'/);
  assert.match(portal, /api\('\/api\/sections\?gradeLevel=/);
  assert.ok(server.includes("app.get('/api/subjects'"));
  assert.ok(server.includes("app.post('/api/subjects'"));
  assert.ok(server.includes('subjectId'));
  assert.ok(server.includes('departmentId'));
  assert.match(migration, /CREATE TABLE IF NOT EXISTS school_subjects/);
  assert.match(migration, /class_periods[\s\S]*ADD COLUMN IF NOT EXISTS subject_id UUID/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS school_subjects_department_name_ci_uk/);
});

test('schedule creation derives department and rejects duplicate period labels and overlapping resources', () => {
  const server = read('server.js');
  const start = server.indexOf("app.post('/api/periods'");
  const end = server.indexOf("// Teacher attendance history", start);
  const route = server.slice(start, end);
  assert.match(route, /FROM school_users su JOIN school_departments/);
  assert.match(route, /school_subjects/);
  assert.match(route, /lower\(btrim\(grade_level\)\)/);
  assert.match(route, /upper\(btrim\(section\)\)/);
  assert.match(route, /FROM class_periods WHERE[\s\S]*start_time < \$5::time AND \$4::time < end_time/);
  assert.match(route, /teacher_period_assignments/);
  assert.match(route, /teacher_period_substitutions/);
  assert.match(route, /upper\(btrim\(classroom\)\)/);
  assert.match(route, /pg_advisory_xact_lock/);
  assert.match(route, /INSERT INTO teacher_period_assignments/);
  assert.doesNotMatch(route, /req\.body\?\.departmentId/);
  assert.doesNotMatch(route, /req\.body\?\.subjectName/);
});

test('student registration requires guardian details and stores them on the existing master record', () => {
  const html = read('public/portal.html');
  const portal = read('public/portal.js');
  const server = read('server.js');
  assert.match(html, /id="newParentName" required maxlength="160"/);
  assert.match(html, /id="newParentMobile" type="tel"[^>]*required maxlength="30"/);
  assert.match(html, /Parent\/guardian full name \*/);
  assert.match(html, /Parent\/guardian mobile number \*/);
  assert.match(html, /Guardian contact details update the existing student master record/);
  assert.match(html, /central student record/);
  const start = server.indexOf("app.post('/api/students'");
  const end = server.indexOf("app.patch('/api/students/:studentId'", start);
  const route = server.slice(start, end);
  assert.match(route, /cleanParentName/);
  assert.match(route, /cleanParentMobile/);
  assert.match(route, /!validText\(parentName\)/);
  assert.match(route, /parent_name, parent_mobile/);
  assert.match(route, /cleanParentName, cleanParentMobile/);
  assert.match(route, /ON CONFLICT\(student_id\)/);
  assert.match(route, /qr_token/);
  assert.match(portal, /parentName: \$\('newParentName'\)\.value\.trim\(\)/);
});

test('shared form styles are linked into the main and self-service workspaces', () => {
  for (const file of ['public/portal.html','public/parent-admin.html','public/parent-register.html','public/student-portal.html','public/portal-login.html','public/parent-portal.html']) {
    assert.ok(read(file).includes('/form-system.css?v=1'), file + ' should load the shared form system');
  }
  const css = read('public/form-system.css');
  assert.match(css, /\.field-group input:focus/);
  assert.match(css, /\.form-context-banner/);
  assert.doesNotMatch(css, /input:invalid:not\(:placeholder-shown\)/);
});

test('the refreshed PWA shell precaches the new schedule form script and shared form CSS', () => {
  const html = read('public/portal.html');
  const serviceWorker = read('public/sw.js');
  assert.ok(html.includes('/portal.js?v=0.9.18'));
  assert.ok(serviceWorker.includes('school-attendance-shell-v28-guardian-import'));
  assert.ok(serviceWorker.includes('/portal.js?v=0.9.18'));
  assert.ok(serviceWorker.includes('/form-system.css?v=1'));
});

test('bulk student imports require guardian details and cannot overwrite the master record with blanks', () => {
  const routes = read('student-management-routes.js');
  const html = read('public/portal.html');
  const portal = read('public/portal.js');
  assert.match(routes, /'parentName','parentMobile'/);
  assert.match(routes, /Parent\/guardian full name is required/);
  assert.match(routes, /Parent\/guardian mobile is required/);
  assert.match(routes, /r\.parentName,r\.parentMobile/);
  assert.doesNotMatch(routes, /r\.parentName\|\|null,r\.parentMobile\|\|''/);
  assert.match(html, /Parent\/guardian full name, and Parent\/guardian mobile/);
  assert.match(portal, /\$\('editParentName'\)\.required = !restrictedStudentEditor/);
  assert.match(portal, /\$\('editParentMobile'\)\.required = !restrictedStudentEditor/);
});

