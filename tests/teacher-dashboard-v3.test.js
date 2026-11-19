'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=n=>fs.readFileSync(path.join(__dirname,'..','public',n),'utf8');
const js=read('teacher-dashboard-v3.js'),css=read('teacher-dashboard-v3.css'),html=read('portal.html'),sw=read('sw.js');
test('V3 is a teacher-only, read-only presentation layer',()=>{
 assert.doesNotThrow(()=>new vm.Script(js));
 assert.match(js,/user\?\.role!=='TEACHER'/);
 assert.match(js,/attendigoStaffIdentity\.then\(init\)/);
 assert.doesNotMatch(js,/fetch\s*\(|\/api\/|method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)/);
});
test('No fabricated schedule data; uses existing permission-controlled timetable shortcut',()=>{
 assert.match(js,/\[data-go="schedules"\]/);
 assert.match(js,/timetableAction\.click\(\)/);
 assert.match(js,/timetableButton\.disabled=true/);
 assert.match(js,/Actual class times are shown in My Timetable/);
});
test('Attendance figures are read from existing learner metrics without changing their calculations',()=>{
 for(const id of ['learnerPresent','learnerTotal','learnerSummaryCard','dashboardScanCta','quickActionsCard','recentActivityCard'])assert.match(js,new RegExp(id));
 assert.match(js,/MutationObserver/);
 assert.match(js,/aria-valuenow/);
 assert.match(js,/Pending is not absent/);
 assert.doesNotMatch(js,/textContent\s*=\s*\d+|localStorage\.setItem/);
});
test('V3 design is branded, responsive and dark mode compatible',()=>{
 assert.match(css,/html\.attendigo-teacher-v3/);
 assert.match(css,/@media\(max-width:700px\)/);
 assert.match(css,/html\[data-ui-theme="dark"\]/);
 assert.match(css,/prefers-reduced-motion/);
 assert.match(css,/focus-visible/);
});
test('PWA and portal load versioned V3 assets after V2',()=>{
 for(const name of ['teacher-dashboard-v3.css?v=1','teacher-dashboard-v3.js?v=1']){
  assert.ok(html.includes(name));
  assert.ok(sw.includes(name));
 }
 assert.ok(html.indexOf('teacher-dashboard-v3.js?v=1')>html.indexOf('teacher-dashboard-v2.js?v=1'));
 assert.match(sw,/attendigo-v253-teacher-dashboard-v3/);
});
