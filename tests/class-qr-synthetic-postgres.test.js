'use strict';
// Synthetic integration coverage: creates TEMPORARY tables on an isolated local test DB.
// No production database credentials are accepted, and no live attendance is modified.
const test=require('node:test');
const assert=require('node:assert/strict');
const {Client}=require('pg');
const {registerClassQrRoutes,localDate,dayOfWeek}=require('../class-qr-routes');

function isolatedDatabase() {
 try {
  const url=new URL(process.env.DATABASE_URL||'');
  return ['localhost','127.0.0.1','::1'].includes(url.hostname) &&
    /(?:^|_)test(?:_|$)/i.test(decodeURIComponent(url.pathname).slice(1));
 } catch {return false;}
}

const SCHOOL_A='11111111-1111-4111-8111-111111111111';
const SCHOOL_B='22222222-2222-4222-8222-222222222222';
const TEACHER_A='33333333-3333-4333-8333-333333333333';
const TEACHER_B='44444444-4444-4444-8444-444444444444';
const ADMIN_A='55555555-5555-4555-8555-555555555555';
const A_ENGLISH='aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const A_MATH='aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const A_SCIENCE='aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const B_ENGLISH='bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const S_A1='aaaaaaa4-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const S_A2='aaaaaaa5-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
const S_B1='bbbbbbb4-bbbb-4bbb-8bbb-bbbbbbbbbbb4';

function mountRoutes(database) {
 const handlers=new Map();
 const app={
  get(path,...middlewares){handlers.set('GET '+path,middlewares);},
  post(path,...middlewares){handlers.set('POST '+path,middlewares);}
 };
 const auth=(_req,_res,next)=>next();
 const requireSchoolRoles=(...allowed)=>(req,res,next)=>
  allowed.includes(req.auth?.role)?next():res.status(403).json({error:'Role denied'});
 const pool={
  query:(sql,params)=>database.query(sql,params),
  connect:async()=>({query:(sql,params)=>database.query(sql,params),release(){}})
 };
 registerClassQrRoutes(app,pool,{authenticateSchoolClient:auth,requireSchoolRoles});
 return async function hit(method,path,authInfo,opts={}) {
  const group=handlers.get(method+' '+path);
  assert.ok(group,'Registered path '+method+' '+path);
  const req={auth:authInfo,body:opts.body||{},params:opts.params||{},query:opts.query||{},ip:'127.0.0.1'};
  const res={
   statusCode:200,headers:{},
   set(name,value){this.headers[name]=value;return this;},
   status(code){this.statusCode=code;return this;},
   sendStatus(code){this.statusCode=code;return this;},
   json(body){this.body=body;return this;},
   end(){return this;}
  };
  for(const middleware of group){
   let called=false;
   await middleware(req,res,()=>{called=true;});
   if(!called) break;
  }
  return res;
 };
}

test('Class monitoring works on realistic synthetic class and check-in data, with school isolation and transactional audit', {
 skip:!isolatedDatabase() && 'Requires an explicitly local *_test PostgreSQL database; never uses production records'
},async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});
 await db.connect();
 try{
  // All fixtures reside in PostgreSQL temporary tables. Closing this connection deletes them.
  await db.query([
   'CREATE TEMP TABLE class_periods (school_id uuid,period_id uuid PRIMARY KEY,grade_level text,section text,subject_name text,start_time time,end_time time,active boolean,effective_from date,effective_to date)',
   'CREATE TEMP TABLE teacher_period_assignments (school_id uuid,period_id uuid,teacher_user_id uuid,assignment_id bigint)',
   'CREATE TEMP TABLE teacher_period_substitutions (school_id uuid,period_id uuid,original_teacher_user_id uuid,substitute_teacher_user_id uuid,status text,start_date date,end_date date,created_at timestamptz)',
   'CREATE TEMP TABLE schedule_day_adjustments (school_id uuid,period_id uuid,school_date date,teacher_user_id uuid,start_time time,end_time time,subject_id uuid,adjustment_type text)',
   'CREATE TEMP TABLE school_subjects (school_id uuid,subject_id uuid,subject_name text)',
   'CREATE TEMP TABLE class_period_days (school_id uuid,period_id uuid,weekday int)',
   'CREATE TEMP TABLE school_calendar_exceptions (school_id uuid,calendar_date date,exception_type text)',
   'CREATE TEMP TABLE class_qr_sessions (session_id uuid PRIMARY KEY,school_id uuid,period_id uuid,school_date date,teacher_user_id uuid,grade_level text,section text,subject_name text,starts_at timestamptz,ends_at timestamptz,closes_at timestamptz,closed_at timestamptz,secret text)',
   'CREATE TEMP TABLE class_qr_checkins (checkin_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,session_id uuid,school_id uuid,student_id text,attendance_status text)',
   'CREATE TEMP TABLE audit_logs (school_id uuid,actor_type text,actor_user_id uuid,action text,entity_type text,entity_id text,details jsonb)'
  ].join(';')+';');
  const date=localDate(),weekday=dayOfWeek(date);
  for (const [sch,period,grade,section,subject,teacher,start,end] of [
   [SCHOOL_A,A_ENGLISH,'8','A','English',TEACHER_A,'08:00','09:00'],
   [SCHOOL_A,A_MATH,'8','A','Mathematics',TEACHER_A,'09:00','10:00'],
   [SCHOOL_A,A_SCIENCE,'8','B','Science',TEACHER_B,'10:00','11:00'],
   [SCHOOL_B,B_ENGLISH,'9','C','English',TEACHER_B,'08:00','09:00']
  ]) {
   await db.query('INSERT INTO class_periods VALUES($1,$2,$3,$4,$5,$6,$7,TRUE,NULL,NULL)',[sch,period,grade,section,subject,start,end]);
   await db.query('INSERT INTO class_period_days VALUES($1,$2,$3)',[sch,period,weekday]);
   await db.query('INSERT INTO teacher_period_assignments VALUES($1,$2,$3,1)',[sch,period,teacher]);
  }
  for(const [id,sch,period,teacher,grade,section,subject,closed] of [
   [S_A1,SCHOOL_A,A_ENGLISH,TEACHER_A,'8','A','English',false],
   [S_A2,SCHOOL_A,A_MATH,TEACHER_A,'8','A','Mathematics',true],
   [S_B1,SCHOOL_B,B_ENGLISH,TEACHER_B,'9','C','English',false]
  ]) {
   await db.query("INSERT INTO class_qr_sessions VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW()-INTERVAL '5 minutes',NOW()+INTERVAL '55 minutes',NOW()+INTERVAL '50 minutes',$9,'never-send-this-secret')",
    [id,sch,period,date,teacher,grade,section,subject,closed?new Date():null]);
  }
  for(const [sessionId,schoolId,studentId,status] of [
   [S_A1,SCHOOL_A,'TEST-A01','PRESENT'],
   [S_A1,SCHOOL_A,'TEST-A02','PRESENT'],
   [S_A1,SCHOOL_A,'TEST-A03','LATE'],
   [S_A2,SCHOOL_A,'TEST-A04','PRESENT'],
   [S_B1,SCHOOL_B,'TEST-B01','PRESENT'],
   [S_B1,SCHOOL_B,'TEST-B02','LATE']
  ])await db.query('INSERT INTO class_qr_checkins(session_id,school_id,student_id,attendance_status) VALUES($1,$2,$3,$4)',[sessionId,schoolId,studentId,status]);

  const hit=mountRoutes(db), admin={role:'SCHOOL_ADMIN',schoolId:SCHOOL_A,userId:ADMIN_A},
   teacher={role:'TEACHER',schoolId:SCHOOL_A,userId:TEACHER_A},
   department={role:'DEPARTMENT_HEAD',schoolId:SCHOOL_A,userId:TEACHER_B},
   student={role:'STUDENT',schoolId:SCHOOL_A,userId:TEACHER_B};
  const monitoring=await hit('GET','/api/class-qr/monitor',admin);
  assert.equal(monitoring.statusCode,200);
  assert.equal(monitoring.headers['Cache-Control'],'no-store, private');
  assert.equal(monitoring.body.sessions.length,2,'Foreign-school session must not appear');
  const english=monitoring.body.sessions.find(s=>s.sessionId===S_A1);
  assert.deepEqual([english.checkedIn,english.present,english.late],[3,2,1]);
  const math=monitoring.body.sessions.find(s=>s.sessionId===S_A2);
  assert.deepEqual([math.checkedIn,math.present,math.late],[1,1,0]);
  assert.ok(!JSON.stringify(monitoring.body).includes('never-send-this-secret'),'Never expose QR signing secrets');
  assert.ok(!JSON.stringify(monitoring.body).includes('TEST-A01'),'Monitor is aggregated, not a pupil identity export');

  const schedule=await hit('GET','/api/class-qr/today',admin);
  assert.equal(schedule.statusCode,200);
  assert.equal(schedule.body.classes.length,3,'A scheduled class without a QR session remains visible');
  const teacherSchedule=await hit('GET','/api/class-qr/today',teacher);
  assert.equal(teacherSchedule.statusCode,200);
  assert.equal(teacherSchedule.body.classes.length,2,'Teacher sees only assigned subjects');
  for(const role of [teacher,department,student]) {
   assert.equal((await hit('GET','/api/class-qr/monitor',role)).statusCode,403);
  }
  for(const [method,path] of [
   ['POST','/api/class-qr/sessions'],['GET','/api/class-qr/sessions/:id/qr'],
   ['POST','/api/class-qr/sessions/:id/manual'],['POST','/api/class-qr/sessions/:id/close']
  ])assert.equal((await hit(method,path,admin,{params:{id:S_A1},body:{periodId:A_ENGLISH,studentId:'TEST-A01',reason:'Correction documented'}})).statusCode,403);

  const override='/api/class-qr/admin-override/sessions/:id/close';
  assert.equal((await hit('POST',override,teacher,{params:{id:S_A1},body:{reason:'Emergency QR misuse'}})).statusCode,403);
  assert.equal((await hit('POST',override,admin,{params:{id:S_A1},body:{reason:'short'}})).statusCode,400);
  assert.equal((await hit('POST',override,admin,{params:{id:S_B1},body:{reason:'Cross-school closure must fail'}})).statusCode,404);
  // A failed audit insert must ROLLBACK the session closure in the same transaction.
  await db.query("CREATE FUNCTION pg_temp.reject_qr_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Synthetic audit insertion error'; END$$;");
  await db.query('CREATE TRIGGER temp_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_qr_audit()');
  assert.equal((await hit('POST',override,admin,{params:{id:S_A1},body:{reason:'Emergency QR code accidentally shared'}})).statusCode,500);
  assert.equal((await db.query('SELECT closed_at FROM class_qr_sessions WHERE session_id=$1',[S_A1])).rows[0].closed_at,null,'Close rolls back when audit fails');
  await db.query('DROP TRIGGER temp_audit_failure ON audit_logs');

  assert.equal((await hit('POST',override,admin,{params:{id:S_A1},body:{reason:'Emergency QR code accidentally shared'}})).statusCode,200);
  const saved=(await db.query('SELECT action,actor_user_id,details FROM audit_logs WHERE entity_id=$1',[S_A1])).rows;
  assert.equal(saved.length,1);
  assert.equal(saved[0].action,'CLASS_QR_ADMIN_EMERGENCY_CLOSE');
  assert.equal(saved[0].actor_user_id,ADMIN_A);
  assert.equal(saved[0].details.reason,'Emergency QR code accidentally shared');
  assert.equal((await hit('POST',override,admin,{params:{id:S_A1},body:{reason:'Repeated emergency closure request'}})).statusCode,409);
  assert.equal((await db.query('SELECT COUNT(*)::int AS total FROM class_qr_checkins WHERE school_id=$1',[SCHOOL_A])).rows[0].total,4,'Existing check-ins survive closure unchanged');
  assert.equal((await db.query('SELECT closed_at FROM class_qr_sessions WHERE session_id=$1',[S_B1])).rows[0].closed_at,null,'Foreign-school session not touched');
 } finally {await db.end();}
});
// Guard the staff portal's offline asset version against stale cached mobile code.
test('staff mobile header script matches the pre-cached version',()=>{
 const fs=require('node:fs');
 const html=fs.readFileSync('public/portal.html','utf8');
 const worker=fs.readFileSync('public/sw.js','utf8');
 const asset=html.match(/src="([^"]*smart-mobile-header[^"]*)"/)?.[1];
 assert.ok(asset,'Staff mobile header asset must be versioned');
 assert.ok(worker.includes(JSON.stringify(asset)),'Service worker must cache the live mobile header version');
});
