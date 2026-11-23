'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=name=>fs.readFileSync('public/'+name,'utf8');

test('all four active dashboard families embed the same memo UI assets',()=>{
 const pages=['principal.html','portal.html','student-portal.html','parent-portal.html'];
 for(const p of pages){
  const s=read(p);
  assert.match(s,/\/school-memo-banner\.js\?v=3/,'shared memo JS in '+p);
  assert.match(s,/\/school-memo-banner\.css\?v=2/,'shared memo styling in '+p);
  assert.doesNotMatch(s,/href="\/school-memos\.html/,'no standalone memo link in '+p);
 }
});
test('memo reader remains inside current dashboard and previews attached documents inline',()=>{
 const s=read('school-memo-banner.js');
 assert.match(s,/document\.querySelector\('#schoolWorkspace'\)\|\|document\.querySelector\('main'\)/);
 assert.match(s,/host\.insertBefore\(panel,host\.firstChild\)/);
 assert.match(s,/panel\.hidden=false/);
 assert.match(s,/const frame=make\('iframe','attendigo-memo-frame'\)/);
 assert.match(s,/const uri='\/api\/school-memos\/'/);
 assert.match(s,/URL\.createObjectURL\(new Blob\(\[bytes\],\{type:kind\}\)\)/);
 assert.match(s,/URL\.revokeObjectURL/);
 assert.match(s,/\/acknowledge'/);
 assert.match(s,/window\.AttendigoSchoolMemos=\{open,refresh\}/);
 assert.doesNotMatch(s,/window\.open\(|window\.location\.assign\(|location\.replace\(/);
});
test('principal publication and inbox shortcuts open embedded memoranda',()=>{
 const js=read('principal-dashboard.js'),html=read('principal.html');
 assert.match(html,/data-school-memo-open/);
 assert.match(js,/window\.AttendigoSchoolMemos\?\.open\?\./);
 assert.match(js,/window\.AttendigoSchoolMemos\?\.refresh\?\./);
 assert.match(js,/requestType==='MEMORANDUM'/);
});
test('shared notification drawer opens memo without leaving the current portal',()=>{
 const js=read('universal-notifications.js');
 assert.match(js,/function isSchoolMemo\(item\)/);
 assert.match(js,/window\.AttendigoSchoolMemos\?\.open\?\.\(item\.requestId\)/);
 assert.match(js,/isSchoolMemo\(item\)\?'Read memorandum'/);
});
test('old memoranda URLs redirect to role-specific dashboards',()=>{
 const s=read('school-memos-redirect.js'),page=read('school-memos.html');
 assert.match(s,/role==='PRINCIPAL'\?'\/principal\.html'/);
 assert.match(s,/role==='PARENT'\?'\/parent-portal\.html'/);
 assert.match(s,/role==='STUDENT'\?'\/student-portal\.html'/);
 assert.match(s,/location\.replace\(path\+/);
 assert.match(page,/school-memos-redirect\.js\?v=1/);
});
test('PWA caches new memo UI and always fetches authenticated portal pages online',()=>{
 const s=read('sw.js');
 for(const file of ['/school-memo-banner.js?v=3','/school-memo-banner.css?v=2',
    '/school-memos-redirect.js?v=1'])assert.ok(s.includes(file),file);
 assert.match(s,/"\/portal\.html", "\/class-qr-monitor\.html", "\/principal\.html", "\/school-memos\.html"/);
 assert.match(s,/fetch\(request, \{ cache: "no-store" \}\)/);
});
