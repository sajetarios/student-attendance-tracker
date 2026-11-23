'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assertCacheRevisionAtLeast}=require('./support/asset-contract');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'..','public',name),'utf8');
const js=read('department-workspace.js');
const css=read('department-monitor-refresh.css');
const html=read('portal.html');
const sw=read('sw.js');

test('Department monitoring module remains valid and scoped to Department Head',()=>{
  assert.doesNotThrow(()=>new vm.Script(js));
  assert.match(js,/user\?\.role !== 'DEPARTMENT_HEAD'/);
  assert.match(js,/const base = '\/api\/department-head'/);
  assert.match(js,/request\('\/overview'\)/);
  assert.match(js,/request\('\/announcements'\)/);
  assert.match(js,/credentials: 'same-origin'/);
});

test('Existing report IDs and functionality remain wired with no duplicate coverage ID',()=>{
  for(const id of ['dhInsightsRefresh','dhGateArrivals','dhPendingOb','dhUncoveredClassesReports','dhWorkloadRows','dhExportWorkload','dhAnnouncementForm','dhAnnouncements','dhNoticeStatus']){
    assert.match(js,new RegExp('id="'+id+'"'),id);
  }
  assert.equal((html.match(/id="dhUncoveredClasses"/g)||[]).length,1);
  assert.match(js,/dhUncoveredClassesReports'\)\.textContent/);
  assert.match(js,/csvCell/);
  assert.match(js,/method: 'POST'/);
  assert.match(js,/form\.reportValidity\(\)/);
});
test('Collapsible, search and sorting controls are wired and accessible',()=>{
  for(const id of ['dhToggleWorkload','dhWorkloadSearch','dhSortTeachers','dhNewNotice','dhToggleNotices']){
    assert.match(js,new RegExp('id="'+id+'"'),id);
  }
  assert.match(js,/aria-expanded="true"/);
  assert.match(js,/aria-controls="dhWorkloadBody"/);
  assert.match(js,/filterWorkloadTable\(\)/);
  assert.match(js,/updateNoticeVisibility\(\)/);
});
test('SARDO is reused rather than cloned or changing its attendance rules',()=>{
  assert.match(js,/const sardoPanel = \$\('sardoCard'\)/);
  assert.match(js,/panel\.append\(sardoPanel\)/);
  assert.match(html,/id="sardoCard"/);
  assert.equal((html.match(/id="sardoCard"/g)||[]).length,1);
  assert.match(html,/Five consecutive instructional days of adviser-confirmed unexcused absences/);
});
test('New visuals reuse brand tokens, support mobile and dark mode, and ship with updated cache',()=>{
  assert.match(css,/var\(--brand,/);
  assert.match(css,/var\(--ui-accent/);
  assert.match(css,/#departmentHeadOverview \.dh-insights/);
  assert.match(css,/@media\(max-width:760px\)/);
  assert.match(css,/html\[data-ui-theme="dark"\]/);
  assert.match(html,/department-monitor-refresh\.css\?v=1/);
  assert.match(html,/department-workspace\.js\?v=6/);
  assertCacheRevisionAtLeast(sw,249);
  assert.match(sw,/department-monitor-refresh\.css\?v=1/);
  assert.match(sw,/department-workspace\.js\?v=6/);
});
