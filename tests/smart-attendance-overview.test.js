'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {effectiveStaffSchedule,isConfiguredSchedule}=require('../staff-attendance-schedule');
const {buildSmartOverview}=require('../smart-attendance-overview');
const {assertCachedAsset,assertCacheRevisionAtLeast}=require('./support/asset-contract');

const school={workdays:[1,2,3,4,5],
 regularHours:{AM_IN:'07:30',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'17:00'},saturdayHours:{}};
const employee={workdays:[1,2,3,4,5,6],
 regularHours:school.regularHours,
 saturdayHours:{AM_IN:'08:00',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'16:00'}};
const staff=[
 {userId:'teacher1',displayName:'Teacher A',role:'TEACHER'},
 {userId:'teacher2',displayName:'Teacher B',role:'TEACHER'}
];
const gate=(staffUserId,eventType,time)=>({staffUserId,eventType,time});
const dtr=(staffUserId,slot,time)=>({staffUserId,slot,time});
const review=(extra={})=>buildSmartOverview({date:'2026-11-20',staff,defaults:school,
 schedules:[],gate:[],dtr:[],ob:[],calendarExceptions:[],...extra});

test('validated school defaults are inherited for staff without an override',()=>{
 assert.equal(isConfiguredSchedule(school),true);
 assert.equal(effectiveStaffSchedule(null,school).source,'SCHOOL');
 assert.equal(effectiveStaffSchedule(employee,school).source,'EMPLOYEE');
 assert.equal(effectiveStaffSchedule(employee,school).schedule.saturdayHours.PM_OUT,'16:00');
 assert.equal(effectiveStaffSchedule(null,null).source,'UNCONFIGURED');
 assert.equal(effectiveStaffSchedule({workdays:[1],regularHours:{}},school).schedule,null);
 assert.equal(effectiveStaffSchedule({workdays:[1],regularHours:{}},school).source,'INVALID_EMPLOYEE');
});
test('no scan does not create an attendance record, exception or absence',()=>{
 const result=review();
 assert.equal(result.verifiedGateEvents,0);
 assert.equal(result.reviewCount,0);
 assert.equal(result.pendingCount,0);
 assert.deepEqual(result.items,[]);
 assert.match(result.notEvaluated,/not treated as an absence/);
 assert.equal(result.safeToApply,false);
});
test('gate evidence without an official DTR is visible as pending verification',()=>{
 const result=review({gate:[gate('teacher1','TIME_IN','07:25')]});
 assert.equal(result.scannedStaff,1);
 assert.equal(result.verifiedGateEvents,1);
 assert.equal(result.pendingCount,1);
 assert.equal(result.items[0].status,'pending');
 assert.equal(result.items[0].dtrCount,0);
 assert.equal(result.items[0].suggestions,1);
});
test('fully recorded valid DTR plus scans is not a review queue item',()=>{
 const result=review({gate:[
  gate('teacher1','TIME_IN','07:25'),gate('teacher1','TIME_OUT','11:58'),
  gate('teacher1','TIME_IN','13:00'),gate('teacher1','TIME_OUT','17:05')
 ],dtr:[
  dtr('teacher1','AM_IN','07:25'),dtr('teacher1','AM_OUT','11:58'),
  dtr('teacher1','PM_IN','13:00'),dtr('teacher1','PM_OUT','17:05')
 ]});
 assert.equal(result.officialDtrStaff,1);
 assert.equal(result.reviewCount,0);
 assert.equal(result.pendingCount,0);
 assert.deepEqual(result.items,[]);
});
test('late OB return is flagged for review but never credited as DTR or overtime',()=>{
 const result=review({gate:[
  gate('teacher1','TIME_IN','07:25'),gate('teacher1','TIME_OUT','09:00'),
  gate('teacher1','TIME_IN','18:00'),gate('teacher1','TIME_OUT','18:15')
 ],ob:[{staffUserId:'teacher1',start:'09:00',end:'17:00',crossDay:false}]});
 assert.equal(result.reviewCount,1);
 assert.equal(result.items[0].status,'review');
 assert.ok(result.items[0].review.includes('OB_RETURN_AFTER_APPROVED_END_REVIEW'));
 assert.equal(result.items[0].dtrCount,0);
 assert.equal(result.safeToApply,false);
});
test('school closure and off-day scans are not assumed absences',()=>{
 const off=buildSmartOverview({date:'2026-11-21',staff,defaults:school,
  gate:[gate('teacher1','TIME_IN','17:54')],calendarExceptions:[]});
 assert.equal(off.infoCount,1);
 assert.equal(off.reviewCount,0);
 assert.ok(off.items[0].review.includes('NOT_SCHEDULED_WORKDAY'));
 const holiday=review({gate:[gate('teacher1','TIME_IN','07:25')],
  calendarExceptions:[{exception_type:'CLOSED'}]});
 assert.equal(holiday.reviewCount,1);
 assert.equal(holiday.items[0].dtrCount,0);
});
test('missing school defaults are one-time setup guidance, not per-day absences',()=>{
 const result=review({defaults:null,gate:[gate('teacher1','TIME_IN','07:25')]});
 assert.equal(result.schoolHoursConfigured,false);
 assert.equal(result.infoCount,1);
 assert.equal(result.reviewCount,0);
 assert.deepEqual(result.items[0].review,['SCHEDULE_UNAVAILABLE']);
});
test('admin endpoint is read-only and school-scoped; self-service still reads verified evidence',()=>{
 const src=fs.readFileSync('staff-gate-dtr-routes.js','utf8');
 const start=src.indexOf("app.get('/api/staff-attendance/admin/smart-overview'");
 const end=src.indexOf('// Physical gate movements',start);
 assert.ok(start>0&&end>start);
 const block=src.slice(start,end);
 assert.match(block,/requireSchoolRoles\('SCHOOL_ADMIN'\)/);
 assert.match(block,/school_id=\$1/);
 assert.match(block,/verification_status='VERIFIED'/);
 assert.match(block,/buildSmartOverview/);
 assert.match(block,/getSchoolForm48Defaults/);
 assert.doesNotMatch(block,/INSERT INTO|UPDATE\s+staff_attendance_events|DELETE FROM/);
 const preview=src.slice(src.indexOf("app.get('/api/staff-attendance/admin/dtr-reconciliation-preview'"),start);
 assert.match(preview,/effectiveStaffSchedule/);
 const personal=src.slice(src.indexOf("app.get('/api/staff-attendance/my/dtr-history'"),
  src.indexOf('// School Admin only:',src.indexOf("app.get('/api/staff-attendance/my/dtr-history'")));
 assert.match(personal,/getSchoolForm48Defaults/);
 assert.match(personal,/effectiveStaffSchedule/);
});
test('overview UI is accessible, responsive and uses versioned PWA assets',()=>{
 const html=fs.readFileSync('public/portal.html','utf8'),
  sw=fs.readFileSync('public/sw.js','utf8'),
  script=fs.readFileSync('public/smart-attendance-overview.js','utf8'),
  css=fs.readFileSync('public/smart-attendance-overview.css','utf8');
 for(const id of ['smartAttendanceOverview','smartAttendanceDate','smartAttendanceItems','smartAttendanceHours','smartHoursSave','form48GateIntelligence'])
  assert.ok(html.includes('id="'+id+'"'),id+' exists');
 assertCachedAsset(html,sw,'smart-attendance-overview.js',{minimumVersion:1});
 assertCachedAsset(html,sw,'smart-attendance-overview.css',{minimumVersion:1});
 assertCacheRevisionAtLeast(sw,274);
 assert.match(script,/user\?\.role!=='SCHOOL_ADMIN'/);
 assert.match(script,/method:'PUT'/);
 assert.match(script,/admin\/form48\/defaults/);
 assert.match(script,/window\.confirm/);
 assert.match(css,/@media\(max-width:540px\)/);
 assert.match(css,/@media print/);
});
