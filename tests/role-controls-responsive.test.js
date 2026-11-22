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
  assert.match(html,/role-controls-responsive\.css\?v=1/);
  assert.match(html,/<body class="portal-page(?:\s[^"]*)?"/);
 }
 assertCachedAsset(read('portal.html'),read('sw.js'),'role-controls-responsive.css',{minimumVersion:1});
});

test('school-date native iOS input and Refresh use non-overlapping grid tracks',()=>{
 const html=read('portal.html');
 const css=read('smart-attendance-overview.css');
 const sw=read('sw.js');
 assert.match(html,/id="smartAttendanceDate" type="date"/);
 assert.match(html,/id="smartAttendanceRefresh"/);
 assert.match(html,/smart-attendance-overview\.css\?v=3/);
 assert.match(css,/\.smart-attendance-date-control\{\s*display:grid;\s*grid-template-columns:minmax\(0,1fr\) max-content;/);
 assert.match(css,/\.smart-attendance-date-control label\{\s*min-width:0;width:100%/);
 assert.match(css,/\.smart-attendance-date-control input\[type="date"\]\{/);
 assert.match(css,/\.smart-attendance-date-control input\[type="date"\]::-webkit-date-and-time-value/);
 assert.match(css,/\.smart-attendance-date-control button\{\s*position:static/);
 assert.match(css,/@media screen and \(max-width:460px\)\{/);
 assert.match(css,/\.smart-attendance-date-control\{grid-template-columns:minmax\(0,1fr\)\}/);
 assertCachedAsset(html,sw,'smart-attendance-overview.css',{minimumVersion:3});
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
