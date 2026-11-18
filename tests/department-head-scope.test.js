'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const portal = fs.readFileSync(path.join(root, 'public', 'portal.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'portal.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

test('Department Head can view and export the school-wide student roster without student write controls', () => {
  assert.ok(portal.includes("if (role === 'DEPARTMENT_HEAD') return ['dashboard', 'planner', 'students', 'teachers', 'schedules', 'sf2', 'officialBusiness']"));
  assert.ok(portal.includes("$('studentsNav').hidden = !(admin || departmentHead || teacher || gateKeeper)"));
  assert.match(server, /requireSchoolPermission\('students\.view\.all'\)/);
  assert.ok(portal.includes("exportCsv('student-roster.csv'"));
  assert.ok(html.includes('id="exportStudentsButton"'));
  assert.ok(portal.includes("$('studentForm').hidden = gateKeeper || departmentHead"));
});
test('Department Head cannot see student QR scanning controls', () => {
  assert.match(portal, /studentScannerCard'\)\) \$\('studentScannerCard'\)\.hidden = !mayScan/);
  assert.match(portal, /dashboardScanCta'\)\) \$\('dashboardScanCta'\)\.hidden = !\(mayScan \|\| mayAddStudent\)/);
  assert.match(html, /id="studentScannerCard"/);
  assert.match(html, /id="dashboardScanCta"/);
});

test('Department Head workspace provides teacher coverage metrics and read-only monitoring copy', () => {
  assert.match(html, /id="departmentHeadOverview"/);
  assert.match(portal, /renderDepartmentHeadOverview/);
  assert.match(portal, /Teachers & Staff in Your Department/);
  assert.match(portal, /SF2 Monitoring/);
});

test('Department Head can assign substitute coverage without gaining account administration', () => {
  assert.match(server, /app\.post\('\/api\/teachers\/:userId\/substitutions', authenticateSchoolClient, requireSchoolRoles\('DEPARTMENT_HEAD'\)/);
  assert.match(server, /app\.delete\('\/api\/teacher-substitutions\/:substitutionId', authenticateSchoolClient, requireSchoolRoles\('DEPARTMENT_HEAD'\)/);
  assert.match(portal, /canAssignSubstitute = canManageDepartment && onLeave && assigned\.length > 0/);
  assert.match(portal, /const canManageRow = showingMyDepartment && row\.departmentScope === 'MY_DEPARTMENT'[\s\S]*?user\.role === 'DEPARTMENT_HEAD'/);
  assert.match(portal, /coverageOtherDepartmentsNotice/);
  assert.match(portal, /const rows = showingMyDepartment \? myRows : otherRows/);
  assert.match(server, /app\.post\('\/api\/teachers\/:userId\/leave', authenticateSchoolClient, requireSchoolAdmin/);
  assert.match(server, /app\.post\('\/api\/periods', authenticateSchoolClient, requireSchoolRoles\('SCHOOL_ADMIN', 'DEPARTMENT_HEAD'\)/);
});


test('Department Head sees all departments but schedule writes are restricted to their own department', () => {
  const departmentRoutes = fs.readFileSync(path.join(root, 'department-routes.js'), 'utf8');
  assert.match(departmentRoutes, /app\.get\('\/api\/departments', authenticateSchoolClient, schoolManagers/);
  assert.match(server, /app\.get\('\/api\/periods', authenticateSchoolClient, requireSchoolRoles\('SCHOOL_ADMIN',\s*'DEPARTMENT_HEAD',\s*'TEACHER'\)/);
  assert.match(server, /req\.auth\.role === 'DEPARTMENT_HEAD' && \(req\.auth\.departmentCode === 'UNASSIGNED' \|\| String\(period\.rows\[0\]\.department_id\) !== String\(req\.auth\.departmentId\)\)/);
  assert.match(server, /teacher\.rows\[0\]\.department_id\) !== String\(period\.rows\[0\]\.department_id\)/);
  assert.match(server, /app\.post\('\/api\/periods\/:periodId\/assignments', authenticateSchoolClient, requireSchoolRoles\('SCHOOL_ADMIN', 'DEPARTMENT_HEAD'\)/);
});

test('Class coverage monitor distinguishes unassigned classes, leave, and missing teacher time-in', () => {
  const departmentRoutes = fs.readFileSync(path.join(root, 'department-routes.js'), 'utf8');
  for (const status of ['NO_TEACHER','ON_LEAVE_UNCOVERED','CHECK_IN_NOT_RECORDED','COVERED']) {
    assert.match(departmentRoutes, new RegExp(status));
  }
  assert.match(departmentRoutes, /teacher_gate_events/);
  assert.match(departmentRoutes, /p\.start_time \+ make_interval\(mins => p\.grace_minutes\)/);
  assert.match(portal, /window\.setInterval\([\s\S]*?loadTeacherCoverage\(true\)[\s\S]*?60000/);
  assert.match(portal, /Notification\.requestPermission/);
});

test('Permanent teacher assignment requires matching department and rejects timetable overlap', () => {
  assert.match(server, /teacher\.rows\[0\]\.department_id\) !== String\(period\.rows\[0\]\.department_id\)/);
  assert.match(server, /const scheduleConflict = await client\.query/);
  assert.match(server, /requested\.start_time < p\.end_time/);
});
