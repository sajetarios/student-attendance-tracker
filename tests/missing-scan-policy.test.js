'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {timeOk,dateOk,recentDate,canHeadReview,canView,evidenceFormat,chronological}=
 require('../missing-scan-routes');

test('validated Philippine time and calendar date; future and stale corrections are blocked',()=>{
 assert.equal(timeOk('17:03'),true);
 assert.equal(timeOk('24:00'),false);
 assert.equal(timeOk('17:99'),false);
 assert.equal(dateOk('2026-02-29'),false);
 assert.equal(dateOk('2028-02-29'),true);
 assert.equal(recentDate('2026-11-22','2026-11-23'),true);
 assert.equal(recentDate('2026-11-24','2026-11-23'),false);
 assert.equal(recentDate('2026-05-01','2026-11-23'),false);
});

test('department review never crosses department or allows self approval',()=>{
 const request={department_id:'dept-a',staff_user_id:'teacher-a'};
 assert.equal(canHeadReview({role:'DEPARTMENT_HEAD',departmentId:'dept-a',userId:'head-a'},request),true);
 assert.equal(canHeadReview({role:'DEPARTMENT_HEAD',departmentId:'dept-b',userId:'head-b'},request),false);
 assert.equal(canHeadReview({role:'DEPARTMENT_HEAD',departmentId:'dept-a',userId:'teacher-a'},request),false);
 assert.equal(canHeadReview({role:'TEACHER',departmentId:'dept-a',userId:'teacher-b'},request),false);
 assert.equal(canView({role:'TEACHER',userId:'teacher-a'},request),true);
 assert.equal(canView({role:'TEACHER',userId:'teacher-b'},request),false);
 assert.equal(canView({role:'SCHOOL_ADMIN',userId:'admin-a'},request),true);
});

test('evidence rejects wrong content, empty files and magic header mismatch',()=>{
 assert.equal(evidenceFormat('application/pdf',Buffer.concat([Buffer.from('%PDF-1.6'),Buffer.alloc(100)])),true);
 assert.equal(evidenceFormat('image/png',Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(100)])),true);
 assert.equal(evidenceFormat('image/jpeg',Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(100)])),true);
 assert.equal(evidenceFormat('application/pdf',Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(100)])),false);
 assert.equal(evidenceFormat('image/svg+xml',Buffer.alloc(100)),false);
 assert.equal(evidenceFormat('image/png',Buffer.alloc(4)),false);
 assert.equal(evidenceFormat('application/pdf',Buffer.alloc(3*1024*1024+1)),false);
});

test('corrected times must be chronologically consistent with verified slots',()=>{
 const slots={AM_IN:'07:30',AM_OUT:'12:00',PM_IN:'13:00'};
 assert.equal(chronological(slots,'PM_OUT','17:03'),true);
 assert.equal(chronological(slots,'PM_OUT','12:59'),false);
 assert.equal(chronological({AM_IN:'07:30',PM_IN:'13:00'},'AM_OUT','12:00'),true);
 assert.equal(chronological({AM_IN:'07:30',PM_IN:'13:00'},'AM_OUT','14:00'),false);
 assert.equal(chronological({PM_IN:'13:00',PM_OUT:'17:00'},'AM_IN','18:00'),false);
});


test('missing scan UI only offers unrecorded slots and keeps role review boundaries',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const read=name=>fs.readFileSync(path.join(__dirname,'../public',name),'utf8');
 const ui=read('missing-scan-ui.js'),css=read('missing-scan-ui.css');
 const portal=read('portal.html'),mobile=read('mobile-overflow-repair.css'),sw=read('sw.js');
 assert.doesNotThrow(()=>new vm.Script(ui),'missing scan UI must parse cleanly');
 assert.match(ui,/staff-attendance\/my\/dtr\?date=/,'check self-scoped verified DTR on date change');
 assert.match(ui,/new Set\(order\.filter\(slot=>slotData\.get\(slot\)\?\.status==='VERIFIED'\)\)/);
 assert.match(ui,/const available=order\.filter\(slot=>!verified\.has\(slot\)&&!blocked\.has\(slot\)\)/);
 assert.match(ui,/verified\.has\('PM_IN'\)/,'PM Time-Out suggestion needs PM Time-In evidence');
 assert.match(ui,/slotSelect\.value=suggestion/,'a suggestion must not replace claimed time');
 assert.match(ui,/slotSelect\.disabled=!available\.length/,'do not offer duplicate or recorded DTR slots');
 assert.doesNotMatch(ui,/claimedTime\.value\s*=/,'never fabricate the actual time');
 assert.match(ui,/isHead\|\|isAdmin\?'<nav/,'single-tab teacher navigation is hidden');
 assert.match(css,/ms-grid :is\(input,select,textarea\)/,'date and select controls must fit');
 assert.match(css,/ms-slot-status/);
 assert.match(css,/data-ui-theme="dark"/,'modal must honor portal dark mode');
 assert.match(mobile,/Portal-wide action and input containment/);
 for(const name of ['missing-scan-ui.js','missing-scan-ui.css','mobile-overflow-repair.css'])
  assert.match(portal,new RegExp(name.replaceAll('.','\\.')+'\\?v=2'));
 assert.ok(Number(sw.match(/attendigo-v(\d+)-/)?.[1])>=331,'PWA cache must include the new UI assets');
});
