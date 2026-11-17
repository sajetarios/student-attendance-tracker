'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('department schedule has a role-specific scope message and admin-only grace control', () => {
  const html = read('public/portal.html');
  const js = read('public/portal.js');
  const form = html.split('<form id="scheduleForm"')[1].split('</form>')[0];
  for (const id of ['scheduleFormRoleIntro','departmentScheduleScopeNote','scheduleGraceGroup',
    'graceMinutes','scheduleWeekdayChoices','periodClassroom','scheduleReviewSummary']) {
    assert.equal((form.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, id);
  }
  assert.match(js, /function updateSchedulingFormRole\(\)/);
  assert.match(js, /form\.dataset\.scheduleRole = departmentHead \? 'DEPARTMENT_HEAD' : 'SCHOOL_ADMIN'/);
  assert.match(js, /scheduleGraceGroup'\)\.hidden = departmentHead/);
  assert.match(js, /updateSchedulingFormRole\(\);\s*resetScheduleTimeSelection\(\);/);
  assert.match(js, /user\.role === 'SCHOOL_ADMIN' \? \{ graceMinutes:/);
});

test('weekday selection remains native, accessible, and compact instead of stretched checkboxes', () => {
  const html = read('public/portal.html');
  const css = read('public/schedule-form-layout.css');
  const week = html.match(/<div class="schedule-weekday-options" id="scheduleWeekdayChoices">([\s\S]*?)<\/div>/);
  assert.ok(week, 'original weekday choices must remain available');
  assert.equal((week[1].match(/type="checkbox"/g) || []).length, 7);
  assert.match(css, /#scheduleForm #scheduleWeekdayChoices > label input\[type="checkbox"\]/);
  assert.match(css, /#scheduleForm #scheduleWeekdayChoices > label input\[type="checkbox"\]:checked \+ span/);
  assert.match(css, /#scheduleForm #scheduleWeekdayChoices > label input\[type="checkbox"\]:focus-visible \+ span/);
  assert.match(css, /#scheduleForm\[data-schedule-role="DEPARTMENT_HEAD"\] \.schedule-review-section/);
});

test('Department Heads are server-restricted to their department and cannot set grace via API', () => {
  const server = read('server.js');
  assert.match(server, /app\.post\('\/api\/periods', authenticateSchoolClient, requireSchoolRoles\('SCHOOL_ADMIN', 'DEPARTMENT_HEAD'\)/);
  assert.match(server, /const graceMinutes = isDepartmentHead \? 5 : \(req\.body\?\.graceMinutes \?\? 0\);/);
  assert.match(server, /isDepartmentHead &&[\s\S]*?String\(departmentId\) !== String\(req\.auth\.departmentId\)/);
  assert.match(server, /String\(teacher\.rows\[0\]\.departmentId\) !== String\(departmentId\)/);
});
