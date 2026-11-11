'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const portal = fs.readFileSync(path.join(root, 'public', 'portal.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'portal.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

test('Department Head cannot navigate to or load the raw student roster', () => {
  assert.match(portal, /departmentHead && view === 'students'\) view = 'dashboard'/);
  assert.match(portal, /\$\('studentsNav'\)\.hidden = departmentHead \|\|/);
  assert.match(portal, /isDepartmentHead \? Promise\.resolve\(\{ students: \[\] \}\) : api\('\/api\/students'\)/);
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
  assert.match(portal, /Teacher monitoring/);
  assert.match(portal, /SF2 Monitoring/);
});

test('Department Head can assign substitute coverage without gaining account administration', () => {
  assert.match(server, /app\.post\('\/api\/teachers\/:userId\/substitutions', authenticateSchoolClient, requireSchoolAdminOrDepartmentHead/);
  assert.match(server, /app\.delete\('\/api\/teacher-substitutions\/:substitutionId', authenticateSchoolClient, requireSchoolAdminOrDepartmentHead/);
  assert.match(portal, /canAssignSubstitute = user\.role === 'DEPARTMENT_HEAD'/);
  assert.match(server, /app\.post\('\/api\/teachers\/:userId\/leave', authenticateSchoolClient, requireSchoolAdmin/);
  assert.match(server, /!\['SCHOOL_ADMIN', 'TEACHER'\]\.includes\(req\.auth\.role\)/);
  assert.match(server, /app\.post\('\/api\/periods', authenticateSchoolClient, requireSchoolAdminOrTeacher/);
  assert.match(server, /isTeacher && !req\.auth\.teacherDesignations\?\.includes\('SUBJECT_TEACHER'\)/);
});
