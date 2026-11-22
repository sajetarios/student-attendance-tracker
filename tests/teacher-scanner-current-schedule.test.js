'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {schoolNow,resolve}=require('../public/teacher-scanner-schedule');
const {assertCachedAsset}=require('./support/asset-contract');
const read=f=>fs.readFileSync('public/'+f,'utf8');
const monday='2026-11-23T00:30:00.000Z'; // 08:30 on Monday in Manila
const teacherUserId='teacher-a';
const one={periodId:'period-a',periodName:'Period 1',subjectName:'Mathematics 8',gradeLevel:'Grade 8',
 section:'A',assignedTeacherUserId:teacherUserId,startTime:'08:00',endTime:'09:00',weekdays:[1],
 effectiveFrom:'2026-06-01',effectiveTo:'2027-03-31',scheduleType:'CLASS'};
const second={...one,periodId:'period-b',subjectName:'Journalism 8',startTime:'09:00',endTime:'10:00'};
const input=(overrides={})=>({periods:[one],adjustments:[],exceptions:[],operatingDays:[
 {weekday:1,isOperatingDay:true},{weekday:0,isOperatingDay:false}],teacherUserId,now:monday,...overrides});

test('Philippine school clock identifies Monday morning independently of browser timezone',()=>{
 assert.deepEqual(schoolNow(monday),{date:'2026-11-23',time:'08:30',weekday:1});
 assert.deepEqual(schoolNow('2026-11-22T15:15:00Z'),{date:'2026-11-22',time:'23:15',weekday:0});
 assert.equal(schoolNow('invalid'),null);
});
test('exactly one running assigned subject class is automatically detected',()=>{
 const matched=resolve(input());
 assert.equal(matched.status,'MATCH');
 assert.equal(matched.active[0].periodId,'period-a');
 assert.equal(matched.today.length,1);
 assert.equal(matched.active[0].subjectName,'Mathematics 8');
});
test('class intervals use inclusive start and exclusive end for safe rollover',()=>{
 assert.equal(resolve(input({now:'2026-11-23T00:00:00Z'})).status,'MATCH');
 assert.equal(resolve(input({now:'2026-11-23T01:00:00Z'})).status,'NO_ACTIVE');
 const next=resolve(input({periods:[one,second],now:'2026-11-23T01:00:00Z'}));
 assert.equal(next.status,'MATCH');
 assert.equal(next.active[0].periodId,'period-b');
});
test('breaks, next class and overlapping assigned classes never guess a single subject',()=>{
 assert.equal(resolve(input({periods:[one,second],now:'2026-11-23T02:00:00Z'})).status,'NO_ACTIVE');
 const overlap={...one,periodId:'period-c',startTime:'08:15',endTime:'08:45'};
 const ambiguous=resolve(input({periods:[one,overlap]}));
 assert.equal(ambiguous.status,'AMBIGUOUS');
 assert.equal(ambiguous.active.length,2);
});
test('only assigned subject classes on the active weekday and effective dates are eligible',()=>{
 assert.equal(resolve(input({periods:[{...one,assignedTeacherUserId:'some-other-teacher'}]})).status,'NO_CLASS');
 assert.equal(resolve(input({periods:[{...one,scheduleType:'ADVISORY'}]})).status,'NO_CLASS');
 assert.equal(resolve(input({periods:[{...one,weekdays:[2]}]})).status,'NO_CLASS');
 assert.equal(resolve(input({periods:[{...one,effectiveFrom:'2026-11-24'}]})).status,'NO_CLASS');
 assert.equal(resolve(input({periods:[{...one,effectiveTo:'2026-11-22'}]})).status,'NO_CLASS');
});
test('closed and non-operating days do not auto-assign class attendance',()=>{
 assert.equal(resolve(input({exceptions:[{date:'2026-11-23',type:'CLOSED'}]})).status,'CLOSED');
 assert.equal(resolve(input({operatingDays:[{weekday:1,isOperatingDay:false}]})).status,'NON_OPERATING');
 assert.equal(resolve(input({exceptions:[{date:'2026-11-23',type:'SHORTENED_DAY',dismissalTime:'08:00'}]})).status,'DISMISSED');
});
test('special calendar day allows only selected periods, including non-recurring weekdays',()=>{
 const saturday='2026-11-28T00:30:00Z';
 const special={date:'2026-11-28',type:'SPECIAL_CLASS',periodIds:['period-a']};
 const result=resolve(input({now:saturday,exceptions:[special],
  operatingDays:[{weekday:6,isOperatingDay:false}]}));
 assert.equal(result.status,'MATCH');
 assert.equal(resolve(input({now:saturday,exceptions:[{...special,periodIds:['other']}],
  operatingDays:[{weekday:6,isOperatingDay:false}]})).status,'NO_CLASS');
});
test('dated cancellation/reschedule/subject replacement are reflected before class selection',()=>{
 assert.equal(resolve(input({adjustments:[{periodId:'period-a',date:'2026-11-23',type:'CANCEL'}]})).status,'NO_CLASS');
 const moved=resolve(input({adjustments:[{periodId:'period-a',date:'2026-11-23',
  type:'RESCHEDULE',startTime:'08:20',endTime:'09:40'}]}));
 assert.equal(moved.status,'MATCH');assert.equal(moved.active[0].startTime,'08:20');
 const replaced=resolve(input({adjustments:[{periodId:'period-a',date:'2026-11-23',
  type:'REPLACE',subjectName:'Earth Science'}]}));
 assert.equal(replaced.active[0].subjectName,'Earth Science');
});
test('date-specific substitute is detected for the replacement teacher, never the original',()=>{
 const change=[{periodId:'period-a',date:'2026-11-23',type:'SUBSTITUTE',teacherUserId:'teacher-b'}];
 assert.equal(resolve(input({adjustments:change})).status,'NO_CLASS');
 const substituted=resolve(input({adjustments:change,teacherUserId:'teacher-b'}));
 assert.equal(substituted.status,'MATCH');
});
test('partial or invalid server timetable data never produces a false automatic match',()=>{
 assert.equal(resolve(input({adjustments:null})).status,'UNAVAILABLE');
 assert.equal(resolve(input({periods:[{...one,startTime:'not-a-time'}]})).status,'NO_CLASS');
 assert.equal(resolve(input({teacherUserId:''})).status,'UNAVAILABLE');
});
test('scanner UI checks live timetable plus calendar at open and defends period rollover on record',()=>{
 const portal=read('portal.js'),html=read('portal.html'),sw=read('sw.js');
 for(const url of ['/api/periods?weekDate=','/api/schedule-adjustments?from=',
  '/api/scheduling-config/calendar-exceptions?from=','/api/scheduling-config/operating-days'])
  assert.ok(portal.includes(url),'Missing live source '+url);
 assert.match(portal,/await detectCurrentScannerSchedule\(\)/);
 assert.match(portal,/if\(scope==='CLASS'&&scannerAutoDetected&&!scannerAutoClassStillCurrent\(\)\)/);
 assert.match(portal,/if\(user\.role==='TEACHER'&&scope==='CLASS'&&!scannerAutoClassStillCurrent\(\)\)/);
 assert.match(portal,/scannerAutoDetected=false;\s*\$\('scanSetupPeriodWrap'\)\.classList\.remove/);
 assert.match(portal,/lookup!==scannerLookupId\|\|\$\('studentScanSetupModal'\)\.hidden/);
 assert.match(html,/id="scanScheduleDetection"[^>]*role="status"/);
 assert.match(html,/teacher-scanner-schedule\.js\?v=1/);
 assertCachedAsset(html,sw,'teacher-scanner-schedule.js',{minimumVersion:1});
 assertCachedAsset(html,sw,'portal.js',{minimumVersion:231});
 assert.match(portal,/window\.AttendigoOffline\.record\(event, api\)/);
});
