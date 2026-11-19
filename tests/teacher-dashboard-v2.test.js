'use strict';
const {assertCacheRevisionAtLeast}=require('./support/asset-contract');
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=n=>fs.readFileSync(path.join(__dirname,'..','public',n),'utf8');
const js=read('teacher-dashboard-v2.js'),css=read('teacher-dashboard-v2.css');
const html=read('portal.html'),sw=read('sw.js');
test('Teacher UI parses, is role scoped, and does not modify server calculations',()=>{
 assert.doesNotThrow(()=>new vm.Script(js));
 assert.match(js,/user\?\.role !== 'TEACHER'/);
 assert.match(js,/attendigoStaffIdentity\.then\(init\)/);
 assert.doesNotMatch(js,/fetch\s*\(|\/api\/|method\s*:\s*['"](?:POST|PATCH|DELETE|PUT)/);
});
test('Retains live learner metrics and existing authorized actions',()=>{
 for(const id of ['dashboardScanCta','statsGrid','learnerSummaryCard','learnerTotal','learnerPresent','learnerPending','learnerMonthDays','recentRows','quickActionsCard','plannerDashboardWidget']){
  assert.match(html,new RegExp('id="'+id+'"'),id);
 }
 assert.match(js,/teacher-v2-redundant-stats/);
 assert.match(js,/\[data-go="schedules"\]/);
 assert.match(js,/\[data-go="sf2"\]/);
 assert.match(js,/\[data-go="students"\]/);
 assert.doesNotMatch(js,/\.click\(\)/);
});
test('Collapsible planner and recent attendance preserve existing nodes and handlers',()=>{
 assert.match(js,/section\.insertBefore\(body,first\)/);
 assert.match(js,/body\.append\(el\)/);
 assert.match(js,/aria-expanded/);
 assert.match(js,/aria-controls/);
 assert.match(js,/body\.hidden=!open/);
});
test('Styles remain teacher-scoped, accessible, mobile and dark compatible',()=>{
 assert.match(css,/html\.attendigo-teacher-v2/);
 assert.match(css,/var\(--ui-accent/);
 assert.match(css,/@media\(max-width:680px\)/);
 assert.match(css,/html\[data-ui-theme="dark"\]/);
 assert.match(css,/focus-visible/);
});
test('Portal and offline shell include versioned teacher assets',()=>{
 for(const name of ['teacher-dashboard-v2.js?v=1','teacher-dashboard-v2.css?v=1']){
  assert.ok(html.includes(name),name+' portal');
  assert.ok(sw.includes(name),name+' sw');
 }
 assertCacheRevisionAtLeast(sw,252);
});
