'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = name => fs.readFileSync(name, 'utf8');
const css = read('public/attendigo-sidebar-adaptive.css');
const portal = read('public/portal.js');
const html = read('public/portal.html');
const server = read('server.js');
const dtr = read('staff-gate-dtr-routes.js');
const photos = read('profile-photo-routes.js');

test('role-based hidden navigation wins against expanded and collapsed display overrides', () => {
  assert.match(css, /portal-layout:not\(\.sidebar-collapsed\) #sidebar\.sidebar \.side-nav \[hidden\]/);
  assert.match(css, /portal-layout\.sidebar-collapsed #sidebar\.sidebar \.side-nav \[hidden\]/);
  assert.match(css, /side-nav \[hidden\][\s\S]*?display:none!important/);
  assert.match(html, /attendigo-sidebar-adaptive\.css\?v=19/);
});

test('School Admin keeps administration menus, not the teacher-only class attendance or SF2', () => {
  assert.match(portal, /\$\('classAttendanceNav'\)\.hidden = !\(teacher && \(subjectTeacher \|\| classAdviser\)\)/);
  assert.match(portal, /\$\('sf2Nav'\)\.hidden = admin \|\| gateKeeper/);
  assert.match(portal, /\$\('myGateAttendanceNav'\)\.hidden = !\(teacher \|\| admin \|\| departmentHead\)/);
  assert.match(portal, /relocate\('myGateAttendanceNav', 'operations'\)/);
  assert.match(portal, /\$\('myGateAttendanceNav'\)\.querySelector\('\.nav-label'\)\.textContent = departmentHead \? 'My Attendance \/ DTR' : 'Gate Attendance & DTR'/);
  assert.match(portal, /role === 'SCHOOL_ADMIN'[\s\S]*?'myGateAttendance'/);
});

test('School Admin own attendance cannot read another staff identity', () => {
  assert.match(server, /app\.get\('\/api\/teacher\/my-gate-attendance', authenticateSchoolClient, requireSchoolRoles\('TEACHER', 'DEPARTMENT_HEAD', 'SCHOOL_ADMIN'\)/);
  const ownRoute=server.slice(server.indexOf("app.get('/api/teacher/my-gate-attendance'"),server.indexOf("// Own staff QR badge:"));
  assert.match(ownRoute,/WHERE school_id=\$1 AND staff_user_id=\$2/);
  assert.match(ownRoute,/WHERE school_id=\$1 AND teacher_user_id=\$2/);
  assert.doesNotMatch(ownRoute,/req\.query\.staffUserId|req\.query\.teacherUserId/);
  assert.match(server, /\[req\.auth\.schoolId, req\.auth\.userId, from, to\]/);
  assert.match(dtr, /requireSchoolRoles\('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER'\)/);
  assert.match(dtr, /WHERE school_id=\$1 AND staff_user_id=\$2/);
  assert.match(dtr, /\[req\.auth\.schoolId,req\.auth\.userId,date\]/);
});

test('admin badge is self-only and never creates attendance on login', () => {
  const start = server.indexOf("app.post('/api/staff-attendance/my/badge'");
  const end = server.indexOf("// Read-only teacher gate attendance history", start);
  assert.ok(start > 0 && end > start);
  const route = server.slice(start, end);
  assert.match(route, /requireSchoolRoles\('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN'\)/);
  assert.match(route, /role IN \('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN'\) AND active=TRUE/);
  assert.match(route, /\[req\.auth\.schoolId, req\.auth\.userId\]/);
  assert.match(route, /official_profile_photos/);
  assert.match(route, /QRCode\.toDataURL/);
  assert.doesNotMatch(route, /INSERT INTO (staff_attendance_events|teacher_gate_events)/);
  assert.match(html, /id="adminStaffBadgeCard" hidden/);
  assert.match(portal, /adminStaffBadgeShow'\)\?\.addEventListener\('click'/);
});

test('Gatekeeper photo verifies School Admin while keeping the four-slot DTR separate', () => {
  assert.match(server, /role IN \('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN'\)/);
  assert.match(server, /official_profile_photos/);
  assert.match(dtr, /requireSchoolRoles\('GATE_KEEPER'\)/);
  assert.match(dtr, /req\.body\?\.photoVerified!==true/);
  assert.match(dtr, /role IN \('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN'\)/);
  assert.match(dtr, /INSERT INTO staff_attendance_events/);
  assert.match(dtr, /ON CONFLICT DO NOTHING/);
  assert.match(photos, /WHERE school_id=\$1 AND user_id=\$2 AND role IN \('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN'\)/);
});
