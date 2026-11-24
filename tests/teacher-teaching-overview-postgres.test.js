'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Client}=require('pg');
const {registerFlexibleScheduleRoutes}=require('../flexible-schedule-routes');

// Never run integration fixtures against school/production databases.
const testDB=/^postgres(?:ql)?:\/\/[^@]+@(?:localhost|127\.0\.0\.1):5432\/school_attendance_test(?:\?|$)/.test(process.env.DATABASE_URL||'');
test('Teacher teaching-day summary is safe and accurate on isolated PostgreSQL', {
 skip: !testDB && 'requires isolated CI PostgreSQL test database'
}, async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 const school='11111111-1111-4111-8111-111111111111';
 const teacher='22222222-2222-4222-8222-222222222222';
 const other='33333333-3333-4333-8333-333333333333';
 const p1='44444444-4444-4444-8444-444444444444';
 const p2='55555555-5555-4555-8555-555555555555';
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const month=today.slice(0,7)+'-01';
 const weekday=new Date(today+'T00:00:00Z').getUTCDay();
 const localTime=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hourCycle:'h23',hour:'2-digit',minute:'2-digit'}).format(new Date());
 await db.connect();
 try{
  await db.query('BEGIN');
  const ddl=[
   'CREATE TEMP TABLE class_periods (school_id uuid,period_id uuid,grade_level text,section text,classroom text,start_time time,end_time time,subject_id uuid,subject_name text,active boolean,effective_from date,effective_to date) ON COMMIT DROP',
   'CREATE TEMP TABLE class_period_days (school_id uuid,period_id uuid,weekday int) ON COMMIT DROP',
   'CREATE TEMP TABLE teacher_period_assignments (school_id uuid,period_id uuid,teacher_user_id uuid,assignment_id uuid) ON COMMIT DROP',
   'CREATE TEMP TABLE teacher_period_substitutions (school_id uuid,period_id uuid,original_teacher_user_id uuid,substitute_teacher_user_id uuid,status text,start_date date,end_date date,created_at timestamptz) ON COMMIT DROP',
   'CREATE TEMP TABLE schedule_day_adjustments (school_id uuid,period_id uuid,school_date date,adjustment_type text,teacher_user_id uuid,subject_id uuid,start_time time,end_time time,classroom text) ON COMMIT DROP',
   'CREATE TEMP TABLE school_subjects (school_id uuid,subject_id uuid,subject_name text) ON COMMIT DROP',
   'CREATE TEMP TABLE school_calendar_exceptions (exception_id uuid,school_id uuid,calendar_date date,exception_type text,title text,dismissal_time time,suspension_time time) ON COMMIT DROP',
   'CREATE TEMP TABLE school_calendar_exception_periods (school_id uuid,exception_id uuid,period_id uuid) ON COMMIT DROP',
   'CREATE TEMP TABLE manual_attendance_marks (school_id uuid,period_id uuid,student_id text,school_date date,status text) ON COMMIT DROP',
   'CREATE TEMP TABLE attendance_events (school_id uuid,period_id uuid,student_id text,school_date date,attendance_scope text,event_type text,sync_status text) ON COMMIT DROP',
   'CREATE TEMP TABLE class_adviser_assignments (school_id uuid,adviser_user_id uuid,grade_level text,section text) ON COMMIT DROP',
   'CREATE TEMP TABLE sf2_submissions (school_id uuid,grade_level text,section text,reporting_month date,status text,is_current boolean) ON COMMIT DROP',
   'CREATE TEMP TABLE class_attendance_finalizations (school_id uuid,period_id uuid,school_date date,finalized boolean) ON COMMIT DROP'
  ];
  for(const q of ddl)await db.query(q);
  await db.query('INSERT INTO class_periods VALUES ($1,$2,\'9\',\'Rizal\',\'A\',\'00:00\',\'00:01\',NULL,\'Mathematics\',true,NULL,NULL),($1,$3,\'10\',\'Bonifacio\',\'B\',\'23:00\',\'23:59\',NULL,\'Science\',true,NULL,NULL)',[school,p1,p2]);
  await db.query('INSERT INTO class_period_days VALUES ($1,$2,$4),($1,$3,$4)',[school,p1,p2,weekday]);
  await db.query('INSERT INTO teacher_period_assignments VALUES ($1,$2,$4,$5),($1,$3,$4,$6)',[school,p1,p2,teacher,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']);
  await db.query('INSERT INTO manual_attendance_marks VALUES ($1,$2,\'LRN-A\',$3,\'ABSENT\')',[school,p1,today]);
  await db.query('INSERT INTO attendance_events VALUES ($1,$2,\'LRN-A\',$3,\'CLASS\',\'TIME_IN\',\'ACCEPTED\'),($1,$2,\'LRN-A\',$3,\'SCHOOL\',\'TIME_IN\',\'ACCEPTED\')',[school,p1,today]);
  await db.query('INSERT INTO class_adviser_assignments VALUES ($1,$2,\'9\',\'Rizal\'),($1,$2,\'10\',\'Bonifacio\')',[school,teacher]);
  await db.query('INSERT INTO sf2_submissions VALUES ($1,\'9\',\'Rizal\',$2,\'SUBMITTED\',true)',[school,month]);
  let route;
  const app={get(path,...handlers){if(path==='/api/teacher/today-overview')route=handlers.at(-1);},post(){},delete(){}};
  registerFlexibleScheduleRoutes(app,db,{
   authenticateSchoolClient:(_req,_res,next)=>next(),
   requireSchoolRoles:()=> (_req,_res,next)=>next()
  });
  assert.equal(typeof route,'function');
  const run=async()=>{
   let code=200,body;
   const res={status(value){code=value;return this;},json(v){body=v;return this;}};
   await route({auth:{role:'TEACHER',schoolId:school,userId:teacher}},res);
   return {code,body};
  };
  const first=await run();
  assert.equal(first.code,200,first.body?.error);
  assert.equal(first.body.attendance.verifiedConflictsToday,1,'school/gate event must not duplicate accepted CLASS conflict');
  assert.equal(first.body.sf2.sections,2);
  assert.equal(first.body.sf2.submitted,1);
  assert.equal(first.body.sf2.notSubmitted,1);
  if(localTime>'00:01')assert.equal(first.body.attendance.completedUnsignedToday,1);
  if(localTime<'23:59')assert.equal(first.body.nextClass?.periodId,p2);
  const exceptionId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  await db.query('INSERT INTO school_calendar_exceptions VALUES ($1,$2,$3,\'CLOSED\',\'Closure\',NULL,NULL)',[exceptionId,school,today]);
  const closed=await run();
  assert.equal(closed.code,200,closed.body?.error);
  assert.equal(closed.body.nextClass,null);
  assert.equal(closed.body.attendance.completedUnsignedToday,0);
  assert.match(closed.body.scheduleMessage,/closure/i);
  await db.query('DELETE FROM school_calendar_exceptions');
  // A temporary substitute owns the class, not the original teacher.
  await db.query('INSERT INTO teacher_period_substitutions VALUES ($1,$2,$3,$4,\'ACTIVE\',$5,$5,NOW())',[school,p1,teacher,other,today]);
  const substituted=await run();
  assert.equal(substituted.code,200,substituted.body?.error);
  if(localTime>'00:01')assert.equal(substituted.body.attendance.completedUnsignedToday,0);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
});