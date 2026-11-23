'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const css=fs.readFileSync('public/recent-class-attendance.css','utf8');
const html=fs.readFileSync('public/portal.html','utf8');
const sw=fs.readFileSync('public/sw.js','utf8');
const ui=fs.readFileSync('public/portal.js','utf8');

test('teacher attendance activity remains bounded and independently scrollable in a narrow card',()=>{
 const compact=css.slice(css.lastIndexOf('@container (max-width:710px)'));
 assert.match(compact,/#recentActivityCard \.table-scroll/);
 assert.match(compact,/max-height:clamp\(260px,40vh,380px\)/);
 assert.match(compact,/overflow-y:auto/);
 assert.match(compact,/overflow-x:hidden/);
 assert.doesNotMatch(compact,/max-height:none|overflow:visible/);
 assert.match(css,/\-webkit-overflow-scrolling:touch/);
 assert.match(css,/#recentActivityCard \.table-scroll:focus-visible/);
});

test('compact card keeps all six reconciled attendance fields in balanced three-row layout',()=>{
 const compact=css.slice(css.lastIndexOf('@container (max-width:710px)'));
 assert.match(compact,/grid-template-areas:\s*"learner status"\s*"class date"\s*"source time"/);
 for(const area of ['learner','class','date','status','source','time'])
  assert.match(compact,new RegExp('grid-area:'+area+';'));
 assert.match(compact,/grid-template-columns:minmax\(0,1fr\) minmax\(96px,36%\)/);
 assert.match(ui,/data-label="Learner"/);
 for(const label of ['Class','Date','Status','Source','Recorded time'])
  assert.ok(ui.includes('data-label="'+label+'"'));
 assert.match(ui,/recent-conflict-note/);
});

test('teacher dashboard retains two balanced columns on desktop and stacks at tablet width',()=>{
 assert.match(css,/@media \(min-width:1001px\)/);
 assert.match(css,/grid-template-columns:minmax\(0,1\.35fr\) minmax\(265px,\.95fr\)/);
 const v3=fs.readFileSync('public/teacher-dashboard-v3.css','utf8');
 assert.match(v3,/@media\(max-width:1000px\)[\s\S]*?#dashboardView>\.dashboard-columns\{grid-template-columns:1fr\}/);
});

test('attendance CSS version is consistent across portal, PWA and existing unified regression',()=>{
 const expect='/recent-class-attendance.css?v=2';
 assert.ok(html.includes(expect));
 assert.ok(sw.includes(expect));
 assert.match(sw,/const CACHE = "attendigo-[^"]+-compact-recent"/);
});

test('read-only changes leave unified attendance reconciliation and six columns intact',()=>{
 const sql=fs.readFileSync('recent-class-attendance.js','utf8');
 assert.match(sql,/COALESCE\(m\.status, q\.status\)/);
 assert.match(sql,/sync_status = 'ACCEPTED'/);
 assert.match(sql,/ROW_NUMBER\(/i);
 const table=html.slice(html.indexOf('id="recentActivityCard"'),html.indexOf('id="quickActionsCard"'));
 for(const label of ['Learner','Class','Date','Status','Source','Recorded time'])
  assert.ok(table.includes('<th>'+label+'</th>'));
});
