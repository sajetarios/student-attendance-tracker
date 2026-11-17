'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('class schedule form shows the Department Head scope and uses a canonical subject dropdown', () => {
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
  assert.match(scheduleForm, /Fixed to your Department Head account/);
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

test('schedule creation derives department and rejects overlapping resources without treating labels as unique', () => {
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
  assert.doesNotMatch(route, /duplicateLabel/);
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
  assert.match(html, /Parent \/ guardian full name \*/);
  assert.match(html, /Parent \/ guardian mobile number \*/);
  assert.match(html, /Guardian contact details update the existing student master record/);
  assert.match(html, /central student record/);
  const start = server.indexOf("app.post('/api/students'");
  const end = server.indexOf("app.patch('/api/students/:studentId'", start);
  const route = server.slice(start, end);
  assert.match(route, /cleanParentName/);
  assert.match(route, /cleanParentMobile/);
  const updateStart = server.indexOf("app.patch('/api/students/:studentId'");
  const updateRoute = server.slice(updateStart);
  assert.match(updateRoute, /!validText\(parentName\)/);
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
  for (const asset of ['schedule-workspace-ui.js', 'form-system.css']) {
    const url = html.split('"').find(value => value.startsWith(`/${asset}?v=`));
    assert.ok(url && serviceWorker.includes(JSON.stringify(url)), `Missing cached ${asset}`);
  }
});

test('bulk student imports preserve saved guardian details when input cells are blank', () => {
  const routes = read('student-management-routes.js');
  const html = read('public/portal.html');
  const portal = read('public/portal.js');
  assert.match(routes, /'parentName','parentMobile'/);
  assert.match(routes, /parent_name=COALESCE\(NULLIF\(EXCLUDED\.parent_name,''\),students\.parent_name\)/);
  assert.match(routes, /parent_mobile=COALESCE\(NULLIF\(EXCLUDED\.parent_mobile,''\),students\.parent_mobile\)/);
  assert.match(portal, /\$\('editParentName'\)\.required = !restrictedStudentEditor/);
  assert.match(portal, /\$\('editParentMobile'\)\.required = !restrictedStudentEditor/);
});


test('manager schedule workspace provides a responsive weekly timetable with filters and direct unassigned teacher assignment', () => {
  const html = read('public/portal.html');
  const portal = read('public/portal.js');
  const css = read('public/portal.css');
  assert.match(html, /id="weeklyTimetableBoard"/);
  assert.match(html, /id="weeklyGradeFilter"/);
  assert.match(html, /id="weeklySectionFilter"/);
  assert.match(html, /data-schedule-display="weekly"/);
  assert.match(portal, /schoolOperatingDays\.filter\(day => day\.isOperatingDay\)/);
  assert.match(portal, /api\('\/api\/periods\/' \+ encodeURIComponent\(periodId\) \+ '\/assignments'/);
  assert.match(portal, /data-weekly-assign/);
  assert.match(portal, /!p\.assignedTeacherUserId && !p\.assignedTeacherName/);
  const server = read('server.js');
  assert.match(server, /const sharesDay = \(p\.weekdays \|\| \[\]\)\.some/);
  assert.match(server, /requested_day\.weekday=existing_day\.weekday/);
  assert.match(server, /daterange\(COALESCE\(p\.effective_from/);
  assert.match(server, /const datesOverlap =/);
  assert.match(server, /class_period_days a[\s\S]*b\.weekday=a\.weekday/);
  assert.match(server, /Substitute coverage dates must fall within the class schedule effective dates/);
  assert.match(css, /\.weekly-timetable-board/);
  assert.match(css, /@media\(max-width:420px\)/);
});
