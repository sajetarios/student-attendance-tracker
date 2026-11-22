'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {assertCachedAsset}=require('./support/asset-contract');
const read=name=>fs.readFileSync('public/'+name,'utf8');

test('main admin/staff and standalone learner/guardian dashboards load shared responsive controls',()=>{
 const pages=['portal.html','student-portal.html','parent-portal.html','parent-admin.html'];
 for(const name of pages){
  const html=read(name);
  assert.match(html,/<meta name="viewport"/);
  assert.match(html,/role-controls-responsive\.css\?v=2/);
  assert.match(html,/<body class="portal-page(?:\s[^"]*)?"/);
 }
 assertCachedAsset(read('portal.html'),read('sw.js'),'role-controls-responsive.css',{minimumVersion:2});
});

test('school-date native iOS input and Refresh use separate grid rows at all widths',()=>{
 const html=read('portal.html');
 const css=read('smart-attendance-overview.css');
 const sw=read('sw.js');
 assert.match(html,/id="smartAttendanceDate" type="date"/);
 assert.match(html,/id="smartAttendanceRefresh"/);
 assert.match(html,/smart-attendance-overview\.css\?v=4/);
 assert.match(css,/#smartAttendanceOverview \.smart-attendance-date-control\{\s*box-sizing:border-box;\s*display:grid;\s*grid-template-columns:minmax\(0,1fr\);/);
 assert.match(css,/#smartAttendanceOverview \.smart-attendance-date-control label\{\s*display:grid;/);
 assert.match(css,/#smartAttendanceOverview #smartAttendanceDate\{/);
 assert.match(css,/#smartAttendanceOverview #smartAttendanceDate::-webkit-date-and-time-value/);
 assert.match(css,/#smartAttendanceOverview #smartAttendanceRefresh\{[\s\S]*?position:static!important;/);
 assert.match(css,/@media screen and \(max-width:940px\)\{/);
 assert.match(css,/#smartAttendanceOverview \.smart-attendance-date-control\{[\s\S]*?width:100%;/);
 assertCachedAsset(html,sw,'smart-attendance-overview.css',{minimumVersion:4});
});

test('shared controls keep buttons flexible, fields bounded and native select/date semantics',()=>{
 const css=read('role-controls-responsive.css');
 assert.match(css,/body\.portal-page :is\(\.primary-button,\.outline-button,\.secondary-button,/);
 assert.match(css,/body\.portal-page :is\(input\[type="date"\],input\[type="time"\],input\[type="month"\]\)::-webkit-date-and-time-value/);
 assert.match(css,/text-overflow:ellipsis/);
 assert.match(css,/white-space:normal/);
 assert.doesNotMatch(css,/pointer-events:\s*none|appearance:\s*none|visibility:\s*hidden/);
 assert.doesNotMatch(css,/@page|@media print|\.form48-print-document|#form48PrintArea/);
});

test('table wrappers scroll horizontally without hiding columns or changing table markup',()=>{
 const css=read('role-controls-responsive.css');
 const html=read('portal.html');
 assert.match(css,/\.table-scroll,\.table-wrap,\.manual-table-wrap,/);
 assert.match(css,/overflow-x:auto/);
 assert.match(css,/overscroll-behavior-inline:contain/);
 assert.doesNotMatch(css,/\.table-scroll[^}]*overflow-x:hidden/);
 assert.match(html,/id="platformSchoolRows"/);
 assert.match(html,/id="smartAttendanceOverview"/);
});

test('unrelated role permission and Form 48 isolated printing scripts remain loaded',()=>{
 const html=read('portal.html');
 const script=read('form48-report.js');
 assert.match(html,/portal\.js\?v=223/);
 assert.match(html,/form48-report\.js\?v=15/);
 assert.match(script,/function printDtrFromIsolatedPage\(output,status\)/);
 assert.match(script,/@page\{size:A4 portrait;margin:5mm\}/);
 assert.match(script,/Two copies on one page/);
});

test('layout CSS is fetched network-first to avoid stale iPad button rules after release',()=>{
 const worker=read('sw.js');
 const portal=read('portal.html');
 assert.match(worker,/attendigo-v288-ipad-action-layout/);
 assert.match(worker,/role-controls-responsive\.css/);
 assert.match(worker,/smart-attendance-overview\.css/);
 assert.match(worker,/cache: 'no-store'/);
 assert.match(portal,/role-controls-responsive\.css\?v=2/);
 assert.match(portal,/smart-attendance-overview\.css\?v=4/);
});
test('button updates do not override role navigation, scanner controls, or printable DTR',()=>{
 const css=read('role-controls-responsive.css');
 const smart=read('smart-attendance-overview.css');
 assert.doesNotMatch(css,/\.nav-item\s*\{|\.nav-group-toggle\s*\{|\.sidebar\s*\{/);
 assert.doesNotMatch(css,/@page|@media print|#form48PrintArea/);
 assert.doesNotMatch(smart,/@page/);
 assert.match(css,/\.student-row-actions,\.teacher-row-actions,\.coverage-action-controls,/);
 assert.match(css,/@media screen and \(max-width:940px\)/);
});
