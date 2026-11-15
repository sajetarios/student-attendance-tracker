'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {registerFlexibleScheduleRoutes,effective,conflict,eachDate}=require('../flexible-schedule-routes');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

test('date range validation keeps a 31-day cap and rejects impossible dates',()=>{
 assert.deepEqual(eachDate('2027-01-01','2027-01-04'),['2027-01-01','2027-01-02','2027-01-03','2027-01-04']);
 assert.equal(eachDate('2027-02-29','2027-03-02'),null);
 assert.equal(eachDate('2027-03-05','2027-02-01'),null);
 assert.equal(eachDate('2027-01-01','2027-04-01'),null);
});

test('one-day changes replace only requested fields; regular class remains intact',()=>{
 const original={period_id:'period-a',grade_level:'Grade 8',section:'Rizal',
  subject_id:'english',subject_name:'English 8',start_time:'08:00:00',
  end_time:'09:00:00',classroom:'101',teacher_user_id:'teacher-a'};
 const substitute=effective(original,{adjustment_type:'SUBSTITUTE',teacher_user_id:'teacher-b'});
 assert.equal(substitute.teacherUserId,'teacher-b');
 assert.equal(substitute.subjectName,'English 8');
 assert.equal(original.teacher_user_id,'teacher-a');
 const changed=effective(original,{adjustment_type:'REPLACE',subject_id:'filipino',
  subject_name:'Filipino 8',teacher_user_id:'teacher-c'});
 assert.equal(changed.subjectName,'Filipino 8');
 assert.equal(changed.teacherUserId,'teacher-c');
 assert.equal(changed.startTime,'08:00');
 const rescheduled=effective(original,{adjustment_type:'RESCHEDULE',start_time:'09:30',end_time:'10:30'});
 assert.equal(rescheduled.startTime,'09:30');
 assert.equal(rescheduled.endTime,'10:30');
 assert.equal(rescheduled.teacherUserId,'teacher-a');
 assert.equal(effective(original,{adjustment_type:'CANCEL'}).cancelled,true);
});

test('conflicts detect section, teacher and room overlap, but allow non-overlapping slots and cancelled classes',()=>{
 const base={periodId:'a',gradeLevel:'Grade 8',section:'Rizal',startTime:'08:00',endTime:'09:00',teacherUserId:'teacher-a',classroom:'1'};
 const first={...base,periodId:'b',teacherUserId:'teacher-b',classroom:'2'};
 assert.equal(conflict(base,[first]).kind,'section');
 assert.equal(conflict(base,[{...first,gradeLevel:'Grade 9',section:'Different',teacherUserId:'teacher-a'}]).kind,'teacher');
 assert.equal(conflict(base,[{...first,gradeLevel:'Grade 9',section:'Different',classroom:'1'}]).kind,'room');
 assert.equal(conflict(base,[{...first,startTime:'09:00',endTime:'10:00'}]),null);
 assert.equal(conflict(base,[{...first,cancelled:true}]),null);
});

test('APIs require school roles, use date-specific attendance lock, and record audit trail',async()=>{
 const routes={};
 const app={
  get(name,...handlers){routes['GET '+name]={handlers};},
  post(name,...handlers){routes['POST '+name]={handlers};},
  delete(name,...handlers){routes['DELETE '+name]={handlers};}
 };
 const auth={
  authenticateSchoolClient:()=>{},
  requireSchoolRoles:(...roles)=>{const fn=()=>{};fn.allowedRoles=roles;return fn;}
 };
 registerFlexibleScheduleRoutes(app,{query:async()=>{},connect:async()=>{}},auth);
 const get=routes['GET /api/schedule-adjustments'];
 const post=routes['POST /api/schedule-adjustments'];
 const del=routes['DELETE /api/schedule-adjustments/:id'];
 assert.deepEqual(get.handlers[1].allowedRoles,['SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER']);
 assert.deepEqual(post.handlers[1].allowedRoles,['SCHOOL_ADMIN','DEPARTMENT_HEAD']);
 assert.deepEqual(del.handlers[1].allowedRoles,['SCHOOL_ADMIN','DEPARTMENT_HEAD']);
 let code=200,result;
 const res={status(v){code=v;return this},json(v){result=v;return this}};
 const act=post.handlers.at(-1);
 await act({auth:{schoolId:'school-a',role:'SCHOOL_ADMIN'},body:{
  periodId:'b0f94e15-1911-412a-a431-1f2f350c1c11',startDate:'2027-01-01',endDate:'2027-03-01',type:'CANCEL',reason:'SEMINAR'
 }},res);
 assert.equal(code,400);
 assert.match(result.error,/31 days/);
 const api=read('flexible-schedule-routes.js');
 assert.match(api,/school_id=\$1 AND period_id=\$2 AND school_date=\$3::date/);
 assert.match(api,/sync_status='ACCEPTED'/);
 assert.match(api,/SAVE_DATE_SPECIFIC_SCHEDULE/);
 assert.match(api,/RESTORE_REGULAR_SCHEDULE/);
 assert.match(api,/pg_advisory_xact_lock/);
});

test('UI shows dated changes and exact weekdays rather than one repeated timeless timetable',()=>{
 const html=read('public/portal.html');
 const js=read('public/portal.js');
 const server=read('server.js');
 const migration=read('migrations/024_flexible_class_schedule_adjustments.sql');
 const runner=read('scripts/migrate.js');
 for(const input of ['adjustmentType','adjustmentStartDate','adjustmentEndDate',
  'adjustmentTeacher','adjustmentSubject','adjustmentDepartment','datedScheduleList'])
  assert.match(html,new RegExp('id="'+input+'"'));
 assert.match(js,/scheduleWeekDates\(/);
 assert.match(js,/scheduleOnDay\(/);
 assert.match(js,/loadScheduleAdjustments\(/);
 assert.match(js,/data-open-adjustment/);
 assert.match(js,/REPLACE/);
 assert.match(server,/registerFlexibleScheduleRoutes\(app, pool/);
 assert.match(server,/schedule_day_adjustments/);
 assert.match(server,/adjustment_type==='CANCEL'/);
 assert.match(migration,/UNIQUE \(school_id,period_id,school_date\)/);
 assert.match(runner,/'024_flexible_class_schedule_adjustments\.sql'/);
 assert.doesNotMatch(migration,/DROP TABLE|TRUNCATE|DELETE FROM students|DELETE FROM attendance_events/i);
});
