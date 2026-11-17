'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('teachers with both designations receive one unified page with teaching and advisory schedule sections', () => {
  const html = read('public/portal.html');
  const portal = read('public/portal.js');
  assert.match(html, /id="teacherScheduleOverview"/);
  assert.match(html, /id="myTeachingScheduleCard"/);
  assert.match(html, /id="myAdvisoryScheduleCard"/);
  assert.match(portal, /const teachingPeriods = periods\.filter\(period =>[\s\S]*?assignedTeacherUserId/);
  assert.match(portal, /const advisoryPeriods = periods\.filter\(period =>[\s\S]*?adviserAssignments\.some/);
  assert.match(portal, /hasTeachingRole && hasAdviserRole/);
  assert.match(portal, /String\(period\.assignedTeacherUserId \|\| ''\) === String\(user\.userId \|\| ''\) \? 'You'/);
});

test('Class Adviser-only accounts can open My Schedule and see the advisory timetable', () => {
  const portal = read('public/portal.js');
  assert.match(portal, /teacher && !\(subjectTeacher \|\| classAdviser\)/);
  assert.match(portal, /if \(teacherHas\('SUBJECT_TEACHER'\) \|\| teacherHas\('CLASS_ADVISER'\)\) views\.push\('schedules'\)/);
  assert.match(portal, /hasAdviserRole\s*\? 'View every subject schedule assigned to your advisory section/);
});

test('only School Administrators and Department Heads can create or assign class schedules', () => {
  const portal = read('public/portal.js');
  const server = read('server.js');
  assert.match(portal, /\$\('showScheduleForm'\)\.hidden = !canCreate/);
  assert.match(server, /app\.post\('\/api\/periods', authenticateSchoolClient, requireSchoolRoles\('SCHOOL_ADMIN', 'DEPARTMENT_HEAD'\)/);
});
