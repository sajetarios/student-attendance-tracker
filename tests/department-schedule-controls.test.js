'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('Department Head form has actual departmental create and edit controls',()=>{
 const js=read('public/portal.js'),html=read('public/portal.html');
 assert.match(js,/canCreate = user\.role==='SCHOOL_ADMIN'/);
 assert.match(js,/editApprovedTemplate/);
 assert.match(html,/id="scheduleDepartmentGroup"/);
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

test('Department Heads may create/edit/delete within their own department',()=>{
 const s=read('server.js');
 assert.match(s,/app\.post\('\/api\/periods', authenticateSchoolClient, requireSchoolRoles\('SCHOOL_ADMIN', 'DEPARTMENT_HEAD'\)/);
 assert.match(s,/app\.patch\('\/api\/periods\/:periodId', authenticateSchoolClient, requireSchoolRoles\('SCHOOL_ADMIN', 'DEPARTMENT_HEAD'\)/);
 assert.match(s,/app\.delete\('\/api\/periods\/:periodId', authenticateSchoolClient, requireSchoolRoles\('SCHOOL_ADMIN', 'DEPARTMENT_HEAD'\)/);
 assert.match(s,/You can delete schedules only within your own department/);
});
