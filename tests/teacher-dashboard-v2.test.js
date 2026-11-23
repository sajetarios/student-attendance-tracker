'use strict';
const {assertCacheRevisionAtLeast}=require('./support/asset-contract');
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=n=>fs.readFileSync(path.join(__dirname,'..','public',n),'utf8');
const ui=read('teacher-dashboard-v3.js'),css=read('teacher-dashboard-v2.css');
const html=read('portal.html'),sw=read('sw.js');

test('Teacher V2 and V3 share one runtime controller without editing secure attendance data',()=>{
 assert.doesNotThrow(()=>new vm.Script(ui));
 assert.match(ui,/user\?\.role!=='TEACHER'/);
 assert.match(ui,/attendigoStaffIdentity\.then\(init\)/);
 assert.match(ui,/attendigo-teacher-v2','layout styling stays enabled');
 assert.match(ui,/attendigo-teacher-v3/);
 assert.doesNotMatch(ui,/fetch\s*\(|\/api\/|method\s*:\s*['"](?:POST|PATCH|DELETE|PUT)/);
 assert.doesNotMatch(html,/src="\/teacher-dashboard-v2\.js/);
 assert.doesNotMatch(sw,/"\/teacher-dashboard-v2\.js/);
 assert.equal((html.match(/src="\/teacher-dashboard-v3\.js/g)||[]).length,1);
});
test('Keeps live learner totals, role-aware shortcuts and no extra metric calculations',()=>{
 for(const id of ['dashboardScanCta','statsGrid','learnerSummaryCard','learnerTotal','learnerPresent',
  'learnerPending','learnerMonthDays','recentRows','quickActionsCard','plannerDashboardWidget']){
  assert.match(html,new RegExp('id="'+id+'"'),id);
 }
 assert.match(ui,/teacher-v2-redundant-stats/);
 assert.match(ui,/teacherDesignations/);
 assert.match(ui,/isSubject/);
 assert.match(ui,/isAdviser/);
 assert.match(ui,/Personal SF2 copy/);
 assert.match(ui,/Official section SF2/);
 assert.match(ui,/\[data-go="schedules"\]/);
 assert.match(ui,/\[data-go="sf2"\]/);
 assert.match(ui,/\[data-go="students"\]/);
});
test('Collapsible planner and recent activity keep original elements and event handlers',()=>{
 assert.match(ui,/section\.insertBefore\(body,first\)/);
 assert.match(ui,/body\.append\(element\)/);
 assert.match(ui,/aria-expanded/);
 assert.match(ui,/aria-controls/);
 assert.match(ui,/body\.hidden=!open/);
 assert.match(ui,/addCollapse\(recent,/);
 assert.match(ui,/addCollapse\(planner,/);
});
test('Retained V2 stylesheet remains teacher-scoped, responsive and dark-mode compatible',()=>{
 assert.match(css,/html\.attendigo-teacher-v2/);
 assert.match(css,/var\(--ui-accent/);
 assert.match(css,/@media\(max-width:680px\)/);
 assert.match(css,/html\[data-ui-theme="dark"\]/);
 assert.match(css,/focus-visible/);
});
test('Legacy styling is retained but its controller is retired from the portal and offline shell',()=>{
 assert.ok(html.includes('teacher-dashboard-v2.css?v=1'));
 assert.ok(sw.includes('teacher-dashboard-v2.css?v=1'));
 assert.ok(html.includes('teacher-dashboard-v3.js?v=2'));
 assert.ok(sw.includes('teacher-dashboard-v3.js?v=2'));
 assertCacheRevisionAtLeast(sw,328);
});
