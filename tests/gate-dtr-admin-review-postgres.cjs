'use strict';
// Disposable PostgreSQL acceptance test; never points at production school data.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const express=require('express');
const {Pool}=require('pg');
const {createOpaqueToken,hashToken}=require('../auth-security');
const {createAuthMiddleware}=require('../auth-middleware');
const {registerGateDtrReviewRoutes}=require('../staff-gate-dtr-review-routes');
const {manilaDate}=require('../staff-lunch-routes');
async function main(){
 const url=process.env.DATABASE_URL;
 assert.ok(url&&new URL(url).pathname==='/school_attendance_test',
  'Refusing gate DTR approval test outside disposable school_attendance_test');
 const pool=new Pool({connectionString:url,max:6,connectionTimeoutMillis:5000});
 let server;
 try{
  const tag=crypto.randomBytes(5).toString('hex');
  async function tenant(prefix){
   const school=(await pool.query('INSERT INTO schools(school_code,school_name) VALUES($1,$2) RETURNING school_id',
    ['GDR_'+prefix+'_'+tag,'Gate DTR approval isolated test'])).rows[0].school_id;
   const dep=(await pool.query('INSERT INTO school_departments(school_id,department_code,department_name) VALUES($1,$2,$3) RETURNING department_id',
    [school,'TEST','Synthetic School Department'])).rows[0].department_id;
   return {school,dep};
  }
  async function user(t,role,username){
   const id=(await pool.query("INSERT INTO school_users(school_id,department_id,username,display_name,password_hash,role,teacher_designations) "+
    "VALUES($1,$2,$3,$4,'synthetic-test-no-login',$5,"+
    "CASE WHEN $5='TEACHER' THEN ARRAY['SUBJECT_TEACHER']::text[] ELSE ARRAY[]::text[] END) RETURNING user_id",
    [t.school,t.dep,username+tag,username,role])).rows[0].user_id;
   const token=createOpaqueToken();
   await pool.query("INSERT INTO user_sessions(token_hash,principal_type,school_id,school_user_id,expires_at) "+
    "VALUES($1,'SCHOOL',$2,$3,NOW()+INTERVAL '10 minutes')",
    [hashToken(token),t.school,id]);
   return{id,token};
  }
  const a=await tenant('A'),b=await tenant('B');
  const admin=await user(a,'SCHOOL_ADMIN','gdr-admin-');
  const keeper=await user(a,'GATE_KEEPER','gdr-keeper-');
  const teacher=await user(a,'TEACHER','gdr-teacher-');
  const otherAdmin=await user(b,'SCHOOL_ADMIN','gdr-other-');
  const date=new Date(manilaDate()+'T12:00:00Z');
  // Use latest Monday-Friday date so the test works even on weekends.
  while(![1,2,3,4,5].includes(date.getUTCDay()))date.setUTCDate(date.getUTCDate()-1);
  const day=date.toISOString().slice(0,10);
  const instant=day+'T06:30:00+08:00';
  const hours={AM_IN:'07:00',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'16:00'};
  await pool.query('INSERT INTO staff_form48_school_defaults(school_id,workdays,regular_hours,saturday_hours,updated_by_user_id) VALUES($1,$2,$3::jsonb,$4::jsonb,$5)',
   [a.school,[1,2,3,4,5],JSON.stringify(hours),'{}',admin.id]);
  const gateId=crypto.randomUUID();
  await pool.query("INSERT INTO staff_attendance_events("+
   "event_id,school_id,staff_user_id,event_kind,gate_direction,school_date,occurred_at,source,"+
   "verification_status,verification_method,actor_user_id,client_event_key) "+
   "VALUES($1,$2,$3,'GATE_MOVEMENT','IN',$4::date,$5::timestamptz,'GATEKEEPER','VERIFIED','GUARD_PHOTO',$6,$7)",
   [gateId,a.school,teacher.id,day,instant,keeper.id,crypto.randomUUID()]);
  const app=express();app.use(express.json());
  const {authenticateSchoolClient,requireSchoolRoles}=createAuthMiddleware(pool);
  registerGateDtrReviewRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles});
  server=await new Promise((resolve,reject)=>{
   const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.on('error',reject);
  });
  const root='http://127.0.0.1:'+server.address().port;
  async function request(method,path,token,body){
   const res=await fetch(root+path,{method,
    headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
   return {status:res.status,body:await res.json()};
  }
  const input={staffUserId:teacher.id,date:day,slot:'AM_IN',gateEventId:gateId,
   reason:'Reviewed verified original gate entry and checked the official schedule.',
   occurredAt:'2000-01-01T00:00:00Z'};
  const urlQuery='/api/staff-attendance/admin/dtr-review-options?'+new URLSearchParams({
   staffUserId:teacher.id,date:day});
  const approval='/api/staff-attendance/admin/dtr-review-apply';
  const options=await request('GET',urlQuery,admin.token);
  assert.equal(options.status,200,JSON.stringify(options.body));
  assert.equal(options.body.status,'ELIGIBLE',JSON.stringify(options.body));
  assert.deepEqual(options.body.candidates.map(x=>x.slot),['AM_IN']);
  assert.equal((await request('POST',approval,teacher.token,input)).status,403,'Teacher cannot approve own scan');
  assert.equal((await request('POST',approval,keeper.token,input)).status,403,'Guard cannot approve historic scan');
  const outsider=await request('POST',approval,otherAdmin.token,input);
  assert.equal(outsider.status,409,'Another school cannot verify the staff event');
  assert.equal((await request('POST',approval,admin.token,{...input,reason:'short'})).status,400);
  const accepted=await request('POST',approval,admin.token,input);
  assert.equal(accepted.status,201,JSON.stringify(accepted.body));
  assert.equal(accepted.body.status,'VERIFIED');
  const dtr=await pool.query("SELECT dtr_slot,occurred_at,source,verification_method,actor_user_id "+
   "FROM staff_attendance_events WHERE school_id=$1 AND staff_user_id=$2 "+
   "AND school_date=$3::date AND event_kind='DTR_SLOT' AND verification_status='VERIFIED'",
   [a.school,teacher.id,day]);
  assert.equal(dtr.rowCount,1);
  assert.equal(dtr.rows[0].dtr_slot,'AM_IN');
  assert.equal(new Date(dtr.rows[0].occurred_at).toISOString(),new Date(instant).toISOString(),
   'The recorded time is the original trusted gate scan, not the submitted browser time');
  assert.equal(dtr.rows[0].source,'AUTHORIZED_CORRECTION');
  assert.equal(dtr.rows[0].verification_method,'MANUAL_REVIEW');
  assert.equal(String(dtr.rows[0].actor_user_id),String(admin.id));
  const audit=await pool.query("SELECT details FROM staff_attendance_audit WHERE school_id=$1 "+
   "AND action='ADMIN_GATE_TO_DTR_VERIFIED' AND target_id=$2",[a.school,accepted.body.eventId]);
  assert.equal(audit.rowCount,1);
  assert.equal(audit.rows[0].details.sourceGateEventId,gateId);
  assert.equal(audit.rows[0].details.reviewReason,input.reason);
  assert.equal((await request('POST',approval,admin.token,input)).status,409,
   'Duplicate approvals cannot produce a second verified punch');
  const after=await pool.query("SELECT count(*)::int AS total FROM staff_attendance_events "+
   "WHERE school_id=$1 AND staff_user_id=$2 AND event_kind='DTR_SLOT' AND school_date=$3::date",
   [a.school,teacher.id,day]);
  assert.equal(after.rows[0].total,1);
  const obTeacher=await user(a,'TEACHER','gdr-ob-teacher-');
  const obGate=crypto.randomUUID();
  await pool.query("INSERT INTO staff_attendance_events(event_id,school_id,staff_user_id,event_kind,gate_direction,school_date,occurred_at,source,verification_status,verification_method,actor_user_id,client_event_key) "+
   "VALUES($1,$2,$3,'GATE_MOVEMENT','IN',$4::date,$5::timestamptz,'GATEKEEPER','VERIFIED','GUARD_PHOTO',$6,$7)",
   [obGate,a.school,obTeacher.id,day,instant,keeper.id,crypto.randomUUID()]);
  await pool.query("INSERT INTO staff_official_business_requests(request_id,school_id,staff_user_id,department_id,purpose,destination,starts_at,ends_at,status) "+
   "VALUES($1,$2,$3,$4,'Synthetic training','Training room',$5::timestamptz,$6::timestamptz,'APPROVED')",
   [crypto.randomUUID(),a.school,obTeacher.id,a.dep,day+'T09:00:00+08:00',day+'T12:00:00+08:00']);
  const blocked=await request('POST',approval,admin.token,{
   ...input,staffUserId:obTeacher.id,gateEventId:obGate});
  assert.equal(blocked.status,409,'Approved OB must not be casually converted into a DTR punch');
  const obRecords=await pool.query("SELECT count(*)::int AS total FROM staff_attendance_events WHERE school_id=$1 AND staff_user_id=$2 AND event_kind='DTR_SLOT'",
   [a.school,obTeacher.id]);
  assert.equal(obRecords.rows[0].total,0);
  console.log('Gate DTR admin approval: original time, school isolation, audit, duplicate and OB safeguards passed.');
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  await pool.end();
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
