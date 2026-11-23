'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {summarizePersonalAttendance}=require('../personal-attendance-insights');
const {assertCachedAsset,assertCacheRevisionAtLeast}=require('./support/asset-contract');
const date='2026-11-23';
const schedule={workdays:[1,2,3,4,5],
 regularHours:{AM_IN:'07:30',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'17:00'},
 saturdayHours:{}};
const gate=(eventType,time,schoolDate=date)=>({eventType,schoolDate,occurredAt:schoolDate+'T'+time+':00+08:00'});
const dtr=(slot,time)=>({slot,schoolDate:date,occurredAt:date+'T'+time+':00+08:00'});
function run(values={}){
 return summarizePersonalAttendance({from:date,to:date,schedule,calendar:[],...values});
}
test('suggestions remain review only and never replace an official verified slot',()=>{
 const official=[dtr('AM_IN','07:20')],movements=[
  gate('TIME_IN','07:25'),gate('TIME_OUT','11:55'),
  gate('TIME_IN','12:50'),gate('TIME_OUT','17:05')
 ];
 const original=JSON.stringify({official,movements});
 const result=run({dtrEvents:official,gateEvents:movements});
 assert.equal(result.length,1);
 const item=result[0];
 assert.equal(item.existingSlots.AM_IN,'07:20');
 assert.equal(item.suggestions.AM_IN,undefined);
 assert.equal(item.suggestions.AM_OUT.time,'11:55');
 assert.equal(item.suggestions.PM_IN.time,'12:50');
 assert.equal(item.suggestions.PM_OUT.time,'17:05');
 assert.ok(item.review.includes('SLOT_ALREADY_VERIFIED'));
 assert.equal(item.safeToApply,false);
 assert.equal(JSON.stringify({official,movements}),original);
});
test('late OB return and later departure never become DTR clock punches',()=>{
 const data=run({gateEvents:[
  gate('TIME_IN','07:25'),gate('TIME_OUT','09:00'),
  gate('TIME_IN','18:00'),gate('TIME_OUT','18:15')
 ],approvedOb:[{startsAt:date+'T09:00:00+08:00',endsAt:date+'T17:00:00+08:00'}]})[0];
 assert.ok(data.review.includes('OB_RETURN_AFTER_APPROVED_END_REVIEW'));
 assert.ok(data.review.includes('POST_OB_RETURN_MOVEMENT_REVIEW'));
 assert.equal(data.suggestions.PM_IN,undefined);
 assert.equal(data.suggestions.PM_OUT,undefined);
 assert.equal(data.approvedObCount,1);
 assert.equal(data.safeToApply,false);
});
test('calendar closures, unavailable calendar, and unconfigured schedules fail closed',()=>{
 const movements=[gate('TIME_IN','07:25')];
 const closed=run({gateEvents:movements,calendar:[{schoolDate:date,exception_type:'CLOSED'}]})[0];
 const unknownCalendar=run({gateEvents:movements,calendar:null})[0];
 const noSchedule=run({gateEvents:movements,schedule:null})[0];
 for(const result of [closed,unknownCalendar,noSchedule]){
  assert.deepEqual(result.suggestions,{});
  assert.equal(result.safeToApply,false);
 }
 assert.deepEqual(closed.review,['CALENDAR_EXCEPTION_REQUIRES_REVIEW']);
 assert.deepEqual(unknownCalendar.review,['CALENDAR_UNAVAILABLE']);
 assert.deepEqual(noSchedule.review,['SCHEDULE_UNAVAILABLE']);
});
test('mismatched school date and cross-midnight OB are not classified as regular punches',()=>{
 const wrongDate=run({gateEvents:[{
  schoolDate:date,eventType:'TIME_IN',occurredAt:'2026-11-24T07:25:00+08:00'
 }]})[0];
 assert.ok(wrongDate.review.includes('GATE_HISTORY_AMBIGUOUS'));
 assert.deepEqual(wrongDate.suggestions,{});
 const overnight=run({gateEvents:[gate('TIME_IN','07:25')],
  approvedOb:[{startsAt:'2026-11-22T23:00:00+08:00',endsAt:date+'T09:30:00+08:00'}]})[0];
 assert.ok(overnight.review.includes('OB_INTERVAL_AMBIGUOUS'));
 assert.deepEqual(overnight.suggestions,{});
});
test('unrecorded days never imply a verified absence or manufacture blank DTR events',()=>{
 assert.deepEqual(run(),[]);
 const outOfRange=run({gateEvents:[gate('TIME_IN','07:25','2026-11-24')]});
 assert.deepEqual(outOfRange,[]);
});
test('personal history endpoint is read-only and only evaluates signed-in school user',()=>{
 const route=fs.readFileSync('staff-gate-dtr-routes.js','utf8');
 const start=route.indexOf("app.get('/api/staff-attendance/my/dtr-history'");
 const end=route.indexOf('// School Admin only:',start);
 assert.ok(start>0&&end>start);
 const block=route.slice(start,end);
 assert.match(block,/requireSchoolRoles\('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN','PRINCIPAL'\)/);
 assert.match(block,/req\.auth\.schoolId,req\.auth\.userId,from,to/);
 assert.match(block,/summarizePersonalAttendance/);
 assert.match(block,/Promise\.allSettled/);
 assert.doesNotMatch(block,/req\.query\?\.staffUserId|req\.body\?\.staffUserId/);
 assert.doesNotMatch(block,/INSERT INTO|UPDATE\s+staff_attendance_events|DELETE FROM/);
});
test('personal daily review assets are versioned, responsive and no record-edit action exists',()=>{
 const html=fs.readFileSync('public/portal.html','utf8');
 const sw=fs.readFileSync('public/sw.js','utf8');
 const ui=fs.readFileSync('public/portal.js','utf8');
 const css=fs.readFileSync('public/my-gate-insights.css','utf8');
 assertCachedAsset(html,sw,'my-gate-insights.css',{minimumVersion:1});
 assertCachedAsset(html,sw,'portal.js',{minimumVersion:217});
 assertCacheRevisionAtLeast(sw,271);
 assert.match(ui,/myGateReviewReasons/);
 assert.match(ui,/myGateRequestRevision/);
 assert.match(ui,/my-gate-insight/);
 assert.match(ui,/gate scan only; this is not an official DTR time/);
 assert.match(ui,/Your official DTR and OB records have not been changed/);
 assert.match(css,/@media\(max-width:760px\)/);
});
