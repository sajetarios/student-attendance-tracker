'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..','public',name),'utf8');
const asset='/attendigo-experience.css?v=4';
test('shared experience is loaded once by all role and offline entry points and precached',()=>{
 for(const page of ["portal.html","principal.html","student-portal.html","parent-portal.html","portal-login.html","gate-offline.html","offline-sheet.html","student-qr-offline.html"]){
  const html=read(page).split('</head>')[0];
  assert.equal(html.split('href="'+asset+'"').length,2,page);
 }
 const sw=read('sw.js');
 assert.ok(sw.split('const SHELL')[0].includes(JSON.stringify(asset)));
 assert.ok(Number(sw.match(/attendigo-v(\d+)-/)?.[1])>=437);
});
test('experience styling is screen-scoped and retains reduced motion and keyboard focus',()=>{
 const css=read('attendigo-experience.css');
 assert.match(css,/@media screen/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(css,/:focus-visible/);
 assert.match(css,/safe-area-inset-left/);
 assert.doesNotMatch(css,/display\s*:\s*none|visibility\s*:\s*hidden|pointer-events\s*:\s*none/);
});

test('role navigation and chart refinement retains local targets and real reporting action',()=>{
 const staff=read('portal.html'),student=read('student-portal.html'),parent=read('parent-portal.html'),js=read('principal-dashboard.js');
 assert.equal((staff.match(/class="ax-icon"/g)||[]).length,9);
 for(const [html,targets] of [[student,['studentProfileCard','studentQrEntryTitle']],[parent,['parentOverview','parentChildrenHeading','subjectAttendance']]]){
  for(const id of targets){assert.ok(html.includes('href="#'+id+'"'));assert.equal(html.split('id="'+id+'"').length,2);}
 }
 assert.ok(js.includes("btn.setAttribute('aria-pressed',String(selected))"));
 assert.ok(js.includes("btn.title=day.date"));
 assert.ok(js.includes("$('reportDate').value=day.date"));
});
