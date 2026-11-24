'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=f=>fs.readFileSync(f,'utf8');
const js=read('public/student-portal.js'),html=read('public/student-portal.html'),css=read('public/student-portal-refinement.css');
const source=js.slice(js.indexOf('  function formatDate('),js.indexOf('  function updateHistoryFilters('));
const {groupAttendance,filterAttendance}=vm.runInNewContext(source+'\n({groupAttendance,filterAttendance})',{Date,Map,Set});
const event=(id,date,subject,scope='CLASS',late=false)=>({eventId:id,schoolDate:date,scope,subjectName:subject,eventType:'TIME_IN',occurredAt:date+'T01:00:00Z',late,syncStatus:'ACCEPTED'});
const records=[event('1','2026-11-24','English'),event('2','2026-11-24','English','CLASS',true),event('3','2026-11-24','Math'),event('4','2026-11-24',null,'SCHOOL'),event('5','2026-11-23','English')];
test('attendance groups by day and subject without dropping or duplicating events',()=>{
 const grouped=groupAttendance(records);
 assert.equal(grouped.length,2);
 assert.equal(grouped[0].groups.length,3);
 assert.equal(grouped[0].groups.find(g=>g.name==='English').records.length,2);
 assert.equal(grouped[0].groups.find(g=>g.gate).records[0].eventId,'4');
 assert.equal(grouped.flatMap(d=>d.groups.flatMap(g=>g.records)).length,records.length);
});
test('date, subject, area and search filters combine without treating missing records as absences',()=>{
 assert.equal(filterAttendance(records).length,4);
 assert.equal(filterAttendance(records,{date:'ALL',subject:'English'}).length,3);
 assert.equal(filterAttendance(records,{date:'ALL',scope:'SCHOOL'}).length,1);
 assert.equal(filterAttendance(records,{date:'2026-11-23',subject:'Math'}).length,0);
 assert.equal(filterAttendance(records,{date:'ALL',search:'late'}).length,1);
 assert.equal(filterAttendance([]).length,0);
});
test('student history is compact, private and supports light/dark appearance',()=>{
 assert.doesNotMatch(html,/<table class="student-table">/);
 assert.match(html,/id="studentAttendanceCard" hidden/);
 assert.ok(html.indexOf('id="studentProfileCard"')<html.indexOf('id="studentQrEntryTitle"'));
 assert.ok(html.indexOf('id="studentQrEntryTitle"')<html.indexOf('id="studentAttendanceCard"'));
 assert.match(js,/<details class="student-history-group"/);
 assert.match(js,/HISTORY_DAYS_PER_PAGE = 5/);
 assert.match(html,/up to 200 latest accepted records/);
 assert.match(css,/minmax\(0,1fr\)/);
 assert.match(css,/html\[data-ui-theme=dark\] .student-history-status/);
 assert.match(js,/api\('\/api\/student\/attendance'\)/);
 const {assertCachedAsset}=require('./support/asset-contract');
 assertCachedAsset(html,read('public/sw.js'),'student-portal.js',{minimumVersion:27});
 assertCachedAsset(html,read('public/sw.js'),'student-portal-refinement.css',{minimumVersion:2});
});

test('profile photo is mounted in the first identity row and account settings are collapsed',()=>{
 assert.ok(html.indexOf('id="studentProfilePhoto"')<html.indexOf('id="studentIdValue"'));
 assert.match(html,/<details class="student-profile-settings" id="studentProfileSettings">[\s\S]*?id="attendancePinSetup"[\s\S]*?<\/details>/);
 assert.match(js,/container:'#studentProfilePhoto'/);
 assert.match(js,/currentUser = me.user;\s*mountStudentPhoto\(\)/);
 assert.match(js,/New photos require School Admin approval/);
 assert.match(css,/#studentProfileCard #studentProfilePhoto \.my-photo-widget\{display:flex;align-items:center;flex-direction:row/);
 assert.match(css,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});
