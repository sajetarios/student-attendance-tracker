'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const portalHtml = read('public/portal.html');
const portalJs = read('public/portal.js');
const parentHtml = read('public/parent-portal.html');
const parentJs = read('public/parent-portal.js');
const studentHtml = read('public/student-portal.html');
const studentJs = read('public/student-portal.js');
const sf2Routes = read('sf2-routes.js');
const server = read('server.js');
const permissions = read('role-permissions.js');

test('School Administrator dashboard includes learner, staff, schedule, and SF2 management shortcuts', () => {
  for (const view of ['students', 'teachers', 'schedules', 'sf2']) {
    assert.match(portalHtml, new RegExp(`data-go="${view}"`));
  }
  assert.match(portalJs, /if \(role === 'SCHOOL_ADMIN'\) return \['dashboard', 'students', 'teachers', 'schedules', 'sf2'\]/);
  assert.match(server, /app\.post\('\/api\/school-users', authenticateSchoolClient, requireSchoolAdmin/);
});

test('Department Head dashboard has school monitoring pages and read-only SF2 submission monitoring', () => {
  assert.match(portalJs, /if \(role === 'DEPARTMENT_HEAD'\) return \['dashboard', 'teachers', 'schedules', 'sf2'\]/);
  assert.match(portalJs, /sf2SubmissionsCard'\)\) \$\('sf2SubmissionsCard'\)\.hidden = !\(admin \|\| departmentHead\)/);
  assert.match(portalJs, /item\.status === 'SUBMITTED' && user\?\.role === 'SCHOOL_ADMIN'/);
  assert.match(sf2Routes, /app\.get\('\/api\/sf2\/submissions', authenticateSchoolClient, requireSchoolAdminOrDepartmentHead/);
  assert.match(sf2Routes, /app\.patch\('\/api\/sf2\/submissions\/:submissionId\/collect', authenticateSchoolClient, requireSchoolAdmin/);
  assert.match(server, /registerSf2Routes\(app, pool, \{ authenticateSchoolClient, requireSchoolUser, requireSchoolAdmin, requireSchoolAdminOrDepartmentHead \}\)/);
});

test('Teacher dashboard scope is derived from Subject Teacher and Class Adviser designations', () => {
  assert.match(portalJs, /if \(teacherHas\('SUBJECT_TEACHER'\) \|\| teacherHas\('CLASS_ADVISER'\)\) views\.push\('students'\)/);
  assert.match(portalJs, /if \(teacherHas\('SUBJECT_TEACHER'\)\) views\.push\('schedules'\)/);
  assert.match(portalJs, /if \(teacherHas\('SUBJECT_TEACHER'\) \|\| teacherHas\('CLASS_ADVISER'\)\) views\.push\('sf2'\)/);
  assert.match(portalJs, /Not an absence count|not an absence count/i);
});

test('Gate Keeper dashboard is scanner-only and does not load the full roster', () => {
  assert.match(portalJs, /if \(role === 'GATE_KEEPER'\) return \['students'\]/);
  assert.match(portalJs, /if \(role === 'GATE_KEEPER'\) \{[\s\S]*?students = \[\];[\s\S]*?return;/);
  assert.match(server, /app\.get\('\/api\/students',[\s\S]*?requireSchoolPermission\('students\.view\.all'\)/);
  assert.match(permissions, /GATE_KEEPER: Object\.freeze\(\['gate\.lookup', 'attendance\.gate\.record'\]\)/);
});

test('Parent dashboard aggregates only the parent account linked children', () => {
  assert.match(parentHtml, /id="parentChildCount"/);
  assert.match(parentHtml, /id="parentTodayTimeIns"/);
  assert.match(parentJs, /api\('\/api\/parent\/children'\)/);
  assert.match(parentJs, /api\(`\/api\/parent\/children\/\$\{encodeURIComponent\(b\.dataset\.history\)\}\/attendance`\)/);
});

test('Student dashboard is separate and reports only the signed-in student attendance', () => {
  assert.ok(fs.existsSync(path.join(root, 'public', 'student-portal.html')));
  assert.match(studentHtml, /id="studentAttendanceSummary"/);
  assert.match(studentHtml, /id="studentPasswordRequired"/);
  assert.match(studentJs, /api\('\/api\/student\/attendance'\)/);
  assert.match(studentJs, /role !== 'STUDENT'/);
  assert.match(studentJs, /studentAttendanceCard'\)\.hidden = Boolean\(currentUser\.mustChangePassword\)/);
});

test('Staff creation distinguishes Department Head and Gate Keeper from teacher designations', () => {
  assert.match(portalHtml, /id="newAccountRole"[\s\S]*?DEPARTMENT_HEAD[\s\S]*?GATE_KEEPER/);
  assert.match(portalHtml, /Subject Teacher/);
  assert.match(portalHtml, /Class Adviser/);
  assert.match(server, /const allowedRoles = \['TEACHER', 'DEPARTMENT_HEAD', 'GATE_KEEPER'\]/);
});

test('Platform Administrator workspace does not invent platform metrics', () => {
  assert.match(portalHtml, /Platform authentication verified/);
  assert.match(portalHtml, /does not display invented platform statistics/);
});

test('Department Head may view and download submitted SF2 reports but cannot collect them', () => {
  assert.match(sf2Routes, /app\.get\('\/api\/sf2\/submissions', authenticateSchoolClient, requireSchoolAdminOrDepartmentHead/);
  assert.match(sf2Routes, /!\['SCHOOL_ADMIN', 'DEPARTMENT_HEAD'\]\.includes\(req\.auth\.role\).*submittedByUserId/);
  assert.match(sf2Routes, /app\.patch\('\/api\/sf2\/submissions\/:submissionId\/collect', authenticateSchoolClient, requireSchoolAdmin/);
  assert.match(portalJs, /item\.status === 'SUBMITTED' && user\?\.role === 'SCHOOL_ADMIN'/);
});

test('Login screen clearly explains the School/Parent, Student, and Platform account types', () => {
  const loginHtml = read('public/portal-login.html');
  const loginJs = read('public/portal-login.js');
  assert.match(loginHtml, /Student account/);
  assert.match(loginHtml, /Platform admin/);
  assert.match(loginJs, /approved Parent\/Guardian accounts/);
  assert.match(loginJs, /Student account uses the school-issued student login/);
});
