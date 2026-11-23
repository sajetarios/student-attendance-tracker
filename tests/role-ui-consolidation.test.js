'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const html=read('public/portal.html');
const principal=read('public/principal.html');
const parent=read('public/parent-dashboard.js');
const teacher=read('public/teacher-dashboard-v3.js');
const dh=read('public/department-dashboard-v2.js');
const workspace=read('public/department-workspace.js');
const sw=read('public/sw.js');

test('Teacher dashboard has one presentation controller and role-aware labels',()=>{
 assert.doesNotThrow(()=>new vm.Script(teacher));
 assert.equal((html.match(/src="\/teacher-dashboard-v3\.js/g)||[]).length,1);
 assert.doesNotMatch(html,/src="\/teacher-dashboard-v2\.js/);
 assert.doesNotMatch(sw,/"\/teacher-dashboard-v2\.js/);
 assert.ok(html.includes('src="/teacher-dashboard-v3.js?v=2"'));
 assert.ok(sw.includes('"/teacher-dashboard-v3.js?v=2"'));
 assert.match(teacher,/teacherDesignations/);
 assert.match(teacher,/isSubject/);
 assert.match(teacher,/isAdviser/);
 assert.match(teacher,/Official section SF2/);
 assert.match(teacher,/Personal SF2 copy/);
 for(const restricted of [/\bfetch\s*\(/,/\/api\//,/\bmethod\s*:\s*['"](?:POST|PATCH|PUT|DELETE)/]){
  assert.doesNotMatch(teacher,restricted,'presentation controller must not change API data');
 }
});

test('Parent management uses status tabs as the only status filter',()=>{
 assert.doesNotThrow(()=>new vm.Script(parent));
 assert.match(html,/class="parent-tabs"/);
 assert.match(html,/data-tab="pending"/);
 assert.match(html,/data-tab="verified"/);
 assert.match(html,/data-tab="inactive"/);
 assert.doesNotMatch(html,/id="parentStatusFilter"/);
 assert.doesNotMatch(parent,/parentStatusFilter/);
 assert.match(parent,/currentTab==='verified'/);
 assert.match(parent,/currentTab==='inactive'/);
 assert.match(parent,/parentSearch/);
});

test('Principal keeps existing priority data bindings but secondary stages are collapsible',()=>{
 for(const id of ['principalBriefing','briefingActions','attentionList','priorityBreakdown','principalClassOverviewHeading']){
  assert.equal((principal.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id+' must remain unique');
 }
 assert.match(principal,/School priorities · selected date/);
 assert.match(principal,/data-section="priorities"/);
 assert.match(principal,/<details class="principal-workflow-details">[\s\S]*?id="attentionList"[\s\S]*?<\/details>/);
 assert.match(principal,/Decisions belong in the authorized approval workflow/);
});

test('Department Head explicitly separates school-wide coverage and approved department OB',()=>{
 assert.doesNotThrow(()=>new vm.Script(dh));
 assert.doesNotThrow(()=>new vm.Script(workspace));
 assert.match(html,/id="dhUncoveredClasses"/);
 assert.match(html,/School-wide uncovered classes/);
 assert.match(dh,/School-wide uncovered classes/);
 assert.match(workspace,/Approved OB needing coverage/);
 assert.match(workspace,/My department only · approved OB/);
 assert.match(workspace,/dhUncoveredClassesReports/);
 assert.match(workspace,/\/api\/department-head/);
 assert.doesNotMatch(dh,/fetch\s*\(|\/api\//);
});

test('All changed assets are versioned consistently and only presentation files changed',()=>{
 for(const asset of ['parent-dashboard.js?v=4','department-workspace.js?v=6',
  'department-dashboard-v2.js?v=3','teacher-dashboard-v3.js?v=2']){
  assert.ok(html.includes(asset),'Portal missing '+asset);
  assert.ok(sw.includes(asset),'Offline shell missing '+asset);
 }
 assert.match(sw,/attendigo-v329-role-ui-consolidation/);
});
