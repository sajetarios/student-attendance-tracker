'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('Department Heads manage assignments without editing official schedules',()=>{
 const p=read('public/portal.js'),u=read('public/schedule-workspace-ui.js');
 assert.match(p,/showScheduleForm'\)\.hidden = !schoolAdminCanCreate/);
 assert.match(u,/scheduleAssignmentShortcut/);
 assert.match(u,/showScheduleForm'\)\.hidden=role!=='SCHOOL_ADMIN'/);
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

test('Only the School Admin can create edit or delete permanent schedules',()=>{
 const server=read('server.js');
 for(const m of ['post','patch','delete']){
  const uri=m==='post'?'/api/periods':'/api/periods/:periodId';
  assert.ok(server.includes("app."+m+"('"+uri+"', authenticateSchoolClient, requireSchoolRoles('SCHOOL_ADMIN')"));
 }
 assert.match(server,/app\.post\('\/api\/periods\/:periodId\/assignments', authenticateSchoolClient, requireSchoolRoles\('SCHOOL_ADMIN', 'DEPARTMENT_HEAD'\)/);
});
