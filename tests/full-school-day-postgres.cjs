'use strict';
// Integrated fictional school-day test. DISPOSABLE LOCAL CI DATABASE ONLY.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const express=require('express');
const {Pool}=require('pg');
const {createOpaqueToken,hashToken}=require('../auth-security');
const {createAuthMiddleware}=require('../auth-middleware');
const {registerStaffLunchRoutes}=require('../staff-lunch-routes');
const {registerStaffGateDtrRoutes}=require('../staff-gate-dtr-routes');
const {registerStaffObRoutes}=require('../staff-ob-routes');
const {receiveCloudOperation}=require('../cloud-mixed-operations');
const url=process.env.DATABASE_URL||'';
let parsed;try{parsed=new URL(url)}catch{throw Error('Disposable DATABASE_URL required')}
if(!['localhost','127.0.0.1','::1'].includes(parsed.hostname)||
 !/(^|_)test($|_)/i.test(decodeURIComponent(parsed.pathname).slice(1)))
 throw Error('Refusing to run integrated school-day simulation outside a local *_test database');
const uid=()=>crypto.randomUUID();
const localDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'});
function nextMonday(){
 const p=localDay.formatToParts(new Date());
 const kv=Object.fromEntries(p.map(x=>[x.type,x.value]));
 const current=new Date(Date.UTC(+kv.year,+kv.month-1,+kv.day));
 const shift=(8-current.getUTCDay())%7||7;
 current.setUTCDate(current.getUTCDate()+shift);
 return current.toISOString().slice(0,10);
}
async function main(){
 const pool=new Pool({connectionString:url,max:20,connectionTimeoutMillis:7000});
 let server;
 const prefix=crypto.randomBytes(5).toString('hex');
 const schoolDate=nextMonday(),yearId=uid();
 const schoolCode='SIM'+prefix;
 const users={},periods={};let school,dept;
 const count=async(sql,args)=>Number((await pool.query(sql,args)).rows[0].n);
 try{
  school=(await pool.query('INSERT INTO schools(school_code,school_name) VALUES($1,$2) RETURNING school_id',
   [schoolCode,'Fictional integrated JHS SHS acceptance school'])).rows[0].school_id;
  dept=(await pool.query('INSERT INTO school_departments(school_id,department_code,department_name) VALUES($1,$2,$3) RETURNING department_id',
   [school,'SHS','Fictional SHS department'])).rows[0].department_id;
  await pool.query("INSERT INTO school_academic_levels(school_id,level_mode) VALUES($1,'INTEGRATED')",[school]);
  await pool.query("INSERT INTO school_years(school_year_id,school_id,school_year_label,start_date,end_date,status) VALUES($1,$2,'2026-2027','2026-06-01','2027-03-31','ACTIVE')",[yearId,school]);
  await pool.query("INSERT INTO shs_year_curricula(school_id,school_year_id,grade_level,curriculum_version) VALUES($1,$2,'Grade 11','STRENGTHENED'),($1,$2,'Grade 12','LEGACY')",[school,yearId]);
  async function user(role,name){
   const id=(await pool.query(`INSERT INTO school_users(school_id,department_id,username,display_name,password_hash,role,teacher_designations)
    VALUES($1,$2,$3,$4,'synthetic-no-login',$5,CASE WHEN $5='TEACHER' THEN ARRAY['SUBJECT_TEACHER']::text[] ELSE ARRAY[]::text[] END) RETURNING user_id`,
    [school,dept,name+prefix,name,role])).rows[0].user_id;
   const token=createOpaqueToken();
   await pool.query("INSERT INTO user_sessions(token_hash,principal_type,school_id,school_user_id,expires_at) VALUES($1,'SCHOOL',$2,$3,NOW()+INTERVAL '30 minutes')",
    [hashToken(token),school,id]);return{id,token,name:name+prefix};
  }
  users.admin=await user('SCHOOL_ADMIN','admin');
  users.head=await user('DEPARTMENT_HEAD','head');
  users.t11=await user('TEACHER','teacher11');
  users.t12=await user('TEACHER','teacher12');
  users.guard=await user('GATE_KEEPER','gatekeeper');
  const roster={};
  for(const grade of [11,12]){
   const section=grade===11?'Mabini':'Rizal';
   roster[grade]=[];
   for(let i=0;i<12;i++){
    const student='SIM'+grade+prefix+i.toString().padStart(3,'0');
    roster[grade].push(student);
    await pool.query("INSERT INTO students(school_id,student_id,full_name,grade_level,section,parent_mobile) VALUES($1,$2,$3,$4,$5,'')",
     [school,student,'Fictional learner '+grade+'-'+i,'Grade '+grade,section]);
    await pool.query("INSERT INTO student_enrollments(school_id,student_id,school_year_id,grade_level,section,enrollment_date) VALUES($1,$2,$3,$4,$5,'2026-06-01')",
     [school,student,yearId,'Grade '+grade,section]);
   }
   const p=(await pool.query(`INSERT INTO class_periods(school_id,department_id,period_name,grade_level,section,subject_name,start_time,end_time)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING period_id`,
    [school,dept,'Period '+grade,'Grade '+grade,section,grade===11?'English':'Research',
     grade===11?'08:00':'10:00',grade===11?'09:00':'11:00'])).rows[0].period_id;
   periods[grade]=p;
   await pool.query('INSERT INTO class_period_days(school_id,period_id,weekday) VALUES($1,$2,1)',[school,p]);
   await pool.query('INSERT INTO teacher_period_assignments(school_id,teacher_user_id,period_id) VALUES($1,$2,$3)',
    [school,users['t'+grade].id,p]);
  }
  assert.equal(await count('SELECT count(*)::int AS n FROM students WHERE school_id=$1',[school]),24);
  assert.equal(await count('SELECT count(*)::int AS n FROM student_enrollments WHERE school_id=$1',[school]),24);

  const app=express();app.use(express.json());
  const auth=createAuthMiddleware(pool);
  registerStaffLunchRoutes(app,pool,auth);
  registerStaffGateDtrRoutes(app,pool,auth);
  registerStaffObRoutes(app,pool,auth);
  server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.on('error',reject)});
  const base='http://127.0.0.1:'+server.address().port;
  async function req(method,path,body,actor){
   const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+actor.token,'Content-Type':'application/json'},
    ...(body!==undefined?{body:JSON.stringify(body)}:{})});
   return {status:r.status,body:await r.json()};
  }
  const ob=await req('POST','/api/staff-attendance/official-business',
   {purpose:'Fictional division SHS training',destination:'Fictional training center',
    startsAt:schoolDate+'T00:30:00Z',endsAt:schoolDate+'T03:30:00Z'},users.t11);
  assert.equal(ob.status,201,JSON.stringify(ob));
  assert.equal((await req('POST','/api/staff-attendance/official-business/'+ob.body.requestId+'/recommend',
   {decision:'RECOMMEND',note:'Coverage required'},users.t11)).status,403);
  const recommended=await req('POST','/api/staff-attendance/official-business/'+ob.body.requestId+'/recommend',
   {decision:'RECOMMEND',note:'Official training verified'},users.head);
  assert.equal(recommended.status,200,JSON.stringify(recommended));
  const approved=await req('POST','/api/staff-attendance/official-business/'+ob.body.requestId+'/decide',
   {decision:'APPROVE',note:'Approved for simulation'},users.admin);
  assert.equal(approved.status,200,JSON.stringify(approved));
  assert.equal(approved.body.status,'APPROVED');
  assert.equal(await count("SELECT count(*)::int AS n FROM staff_ob_class_coverage WHERE school_id=$1 AND request_id=$2 AND status='NEEDS_COVERAGE'",
   [school,ob.body.requestId]),1,'OB should flag the affected Grade 11 class');
  assert.equal((await req('POST','/api/staff-attendance/official-business/'+ob.body.requestId+'/decide',
   {decision:'APPROVE'},users.admin)).status,409,'Repeated approval must be rejected');

  // Simultaneous student class registers with audit and sign-off; these are
  // real PostgreSQL transactions through the existing cloud attendance engine.
  async function register(grade){
   const client=await pool.connect();
   const period=periods[grade],students=roster[grade],teacher=users['t'+grade];
   try{
    await client.query('BEGIN');
    const op={operationId:uid(),type:'MANUAL_MARKS',date:schoolDate,actorUsername:teacher.name,
     period:{periodName:'Period '+grade,gradeLevel:'Grade '+grade,section:grade===11?'Mabini':'Rizal',
      subjectName:grade===11?'English':'Research',startTime:grade===11?'08:00':'10:00',endTime:grade===11?'09:00':'11:00'},
     marks:students.map((id,i)=>({studentId:id,status:i===0?'ABSENT':'PRESENT',
      note:i===0?'Fictional absence':'',expectedRevision:0,revision:1}))};
    const result=await receiveCloudOperation(client,school,op);
    assert.equal(result.status,'ACCEPTED',JSON.stringify(result));
    assert.equal((await receiveCloudOperation(client,school,op)).status,'ALREADY_SYNCED');
    const signed={...op,operationId:uid(),type:'REGISTER_SIGNOFF',action:'FINALIZE',rosterCount:students.length};
    delete signed.marks;
    assert.equal((await receiveCloudOperation(client,school,signed)).status,'ACCEPTED');
    await client.query('COMMIT');
    return period;
   }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
   finally{client.release()}
  }
  await Promise.all([register(11),register(12)]);
  assert.equal(await count('SELECT count(*)::int AS n FROM manual_attendance_marks WHERE school_id=$1',[school]),24);
  assert.equal(await count("SELECT count(*)::int AS n FROM manual_attendance_marks WHERE school_id=$1 AND status='ABSENT'",[school]),2);
  assert.equal(await count('SELECT count(*)::int AS n FROM class_attendance_finalizations WHERE school_id=$1 AND finalized=true',[school]),2);
  assert.equal(await count('SELECT count(*)::int AS n FROM manual_attendance_audit WHERE school_id=$1',[school]),24);

  // Real concurrent teacher QR redemption; exactly one verification.
  const assign=await req('PUT','/api/staff-attendance/lunch/presenter',
    {slot:'AM_OUT',presenterUserId:users.t12.id},users.admin);
  assert.equal(assign.status,201,JSON.stringify(assign));
  const qr=await req('POST','/api/staff-attendance/lunch/challenges',{slot:'AM_OUT'},users.t12);
  assert.equal(qr.status,201,JSON.stringify(qr));
  const challenge={challengeId:qr.body.challengeId,token:qr.body.token};
  const competing=await Promise.all(Array.from({length:10},()=>req('POST','/api/staff-attendance/lunch/redeem',challenge,users.t11)));
  assert.equal(competing.filter(x=>x.status===201).length,1,JSON.stringify(competing));
  assert.equal(competing.filter(x=>x.status===409).length,9,JSON.stringify(competing));

  const badge=uid();
  await pool.query('UPDATE school_users SET teacher_qr_token=$2,teacher_photo_path=$3 WHERE user_id=$1',
   [users.t11.id,badge,'fictional-test-photo.jpg']);
  const gate=await req('POST','/api/staff-attendance/gatekeeper/dtr',
   {teacherQrToken:badge,slot:'PM_OUT',photoVerified:true},users.guard);
  assert.equal(gate.status,201,JSON.stringify(gate));
  assert.equal((await req('POST','/api/staff-attendance/gatekeeper/dtr',
   {teacherQrToken:badge,slot:'PM_OUT',photoVerified:true},users.guard)).status,409);
  const dtr=await req('GET','/api/staff-attendance/my/dtr',undefined,users.t11);
  assert.equal(dtr.status,200,JSON.stringify(dtr));
  assert.equal(dtr.body.slots.find(x=>x.slot==='AM_OUT').status,'VERIFIED');
  assert.equal(dtr.body.slots.find(x=>x.slot==='PM_OUT').status,'VERIFIED');
  assert.equal(await count("SELECT count(*)::int AS n FROM staff_attendance_events WHERE school_id=$1 AND staff_user_id=$2 AND verification_status='VERIFIED'",[school,users.t11.id]),2);
  console.log(JSON.stringify({scenario:'fictional integrated school day',schoolDate,learners:24,teachers:2,
   finalizedClasses:2,marks:24,obStatus:'APPROVED',obAffectedClasses:1,
   competingQrRedemptions:10,acceptedQrRedemptions:1,verifiedDtrSlots:2,result:'PASS'}));
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  // Explicit synthetic-only cleanup, restricted to the randomized school ID.
  // This test runs in disposable GitHub Actions PostgreSQL, never against Render.
  await pool.end();
 }
}
main().catch(e=>{console.error('SCHOOL DAY SIMULATION FAILED:',e.stack||e.message);process.exitCode=1});
