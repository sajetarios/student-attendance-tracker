'use strict';
// Uses fictional staff and an explicitly isolated PostgreSQL test database.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const express=require('express');
const {Pool}=require('pg');
const {createOpaqueToken,hashToken}=require('../auth-security');
const {createAuthMiddleware}=require('../auth-middleware');
const {registerMissingScanRoutes}=require('../missing-scan-routes');
const {manilaDate}=require('../staff-lunch-routes');
async function main(){
 const url=process.env.DATABASE_URL;
 assert.ok(url&&new URL(url).pathname==='/school_attendance_test',
  'Refusing to run missing-scan acceptance tests outside the disposable school_attendance_test database');
 const pool=new Pool({connectionString:url,max:8,connectionTimeoutMillis:5000});
 let server;
 try{
  const suffix=crypto.randomBytes(6).toString('hex');
  async function tenant(tag){
   const school=(await pool.query('INSERT INTO schools(school_code,school_name) VALUES($1,$2) RETURNING school_id',
    ['MSC_'+tag+'_'+suffix,'Fictional missing-scan school'])).rows[0].school_id;
   const dep=(await pool.query('INSERT INTO school_departments(school_id,department_code,department_name) VALUES($1,$2,$3) RETURNING department_id',
    [school,'TEST','Fictional Department'])).rows[0].department_id;
   return{school,dep};
  }
  async function staff(t,role,label){
   const id=(await pool.query("INSERT INTO school_users(school_id,department_id,username,display_name,password_hash,role,teacher_designations) "+
    "VALUES($1,$2,$3,$4,'synthetic-never-login',$5,CASE WHEN $5='TEACHER' THEN ARRAY['SUBJECT_TEACHER']::text[] ELSE ARRAY[]::text[] END) RETURNING user_id",
    [t.school,t.dep,'msc-'+label+suffix,label,role])).rows[0].user_id;
   const token=createOpaqueToken();
   await pool.query("INSERT INTO user_sessions(token_hash,principal_type,school_id,school_user_id,expires_at) VALUES($1,'SCHOOL',$2,$3,NOW()+INTERVAL '15 minutes')",
    [hashToken(token),t.school,id]);
   return {id,token};
  }
  const a=await tenant('A'),b=await tenant('B');
  const teacher=await staff(a,'TEACHER','teacher'),head=await staff(a,'DEPARTMENT_HEAD','head');
  const admin=await staff(a,'SCHOOL_ADMIN','admin'),other=await staff(a,'TEACHER','other');
  const second=await staff(a,'TEACHER','second');
  const outsider=await staff(b,'DEPARTMENT_HEAD','outsider'),outsideAdmin=await staff(b,'SCHOOL_ADMIN','outside-admin');
  // Use a completed school day, never today; avoid future scans during CI.
  const d=new Date(manilaDate()+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);
  const day=d.toISOString().slice(0,10);
  async function punches(employee){
   for(const [slot,time] of [['AM_IN','07:30'],['AM_OUT','12:00'],['PM_IN','13:00']]){
    await pool.query("INSERT INTO staff_attendance_events(event_id,school_id,staff_user_id,event_kind,dtr_slot,school_date,occurred_at,source,verification_status,verification_method,actor_user_id,client_event_key)"+
     "VALUES($1,$2,$3,'DTR_SLOT',$4,$5::date,($5::date+$6::time) AT TIME ZONE 'Asia/Manila','GATEKEEPER','VERIFIED','GUARD_PHOTO',$7,$8)",
     [crypto.randomUUID(),a.school,employee.id,slot,day,time,admin.id,crypto.randomUUID()]);
   }
  }
  await punches(teacher);await punches(second);
  const app=express();app.use(express.json({limit:'10mb'}));
  const {authenticateSchoolClient,requireSchoolRoles}=createAuthMiddleware(pool);
  registerMissingScanRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles});
  server=await new Promise((resolve,reject)=>{
   const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.on('error',reject);
  });
  const base='http://127.0.0.1:'+server.address().port;
  async function call(method,path,who,body,mime='application/json'){
   const response=await fetch(base+'/api/missing-scans'+path,{
    method,headers:{Authorization:'Bearer '+who.token,...(body===undefined?{}:{'Content-Type':mime})},
    ...(body===undefined?{}:{body:Buffer.isBuffer(body)?body:JSON.stringify(body)})
   });
   return {status:response.status,body:await response.json()};
  }
  const make=(time='17:03')=>({date:day,slot:'PM_OUT',claimedTime:time,
   explanation:'Forgot QR time-out but signed the department logbook before going home.'});
  const first=await call('POST','/requests',teacher,make());
  assert.equal(first.status,201,JSON.stringify(first));
  const id=first.body.requestId;
  const alerts=await pool.query("SELECT recipient_id,category,status FROM user_notifications WHERE school_id=$1 AND request_type='MISSING_SCAN' AND request_id=$2",[a.school,id]);
  assert.equal(alerts.rowCount,2,'Requester and assigned department head only');
  assert.ok(alerts.rows.some(x=>x.recipient_id===head.id&&x.category==='APPROVAL'&&x.status==='PENDING_HEAD'));
  assert.ok(alerts.rows.some(x=>x.recipient_id===teacher.id&&x.category==='REQUEST'));
  await pool.query('SELECT attendigo_missing_scan_pending($1,$2)',[a.school,id]);
  assert.equal((await pool.query("SELECT 1 FROM user_notifications WHERE school_id=$1 AND request_type='MISSING_SCAN' AND request_id=$2",[a.school,id])).rowCount,2,'Backfill cannot duplicate alerts');
  assert.equal((await call('POST','/requests',teacher,make())).status,409,'No duplicate open correction');
  assert.equal((await call('GET','/requests?view=inbox',teacher)).status,403);
  const outInbox=await call('GET','/requests?view=inbox',outsider);
  assert.equal(outInbox.body.requests.length,0,'Different school cannot list requests');
  assert.equal((await call('POST','/requests/'+id+'/head-decision',outsider,{
   decision:'VERIFY',comment:'Looked at printed register.',verifiedTime:'17:03',reference:'page 4'})).status,404,'Different school cannot review');
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(112,0)]);
  assert.equal((await call('POST','/requests/'+id+'/evidence',outsider,png,'image/png')).status,404);
  const evidence=await call('POST','/requests/'+id+'/evidence',head,png,'image/png');
  assert.equal(evidence.status,200,JSON.stringify(evidence));
  const headDecision=await call('POST','/requests/'+id+'/head-decision',head,{
   decision:'VERIFY',comment:'Verified the signed departure entry against the department logbook.',
   verifiedTime:'17:03',reference:'Department logbook page 4 entry 12'});
  assert.equal(headDecision.status,200,JSON.stringify(headDecision));
  assert.equal(headDecision.body.status,'DOCUMENTED');
  const closed=await pool.query("SELECT status,read_at FROM user_notifications WHERE school_id=$1 AND request_id=$2 AND category='APPROVAL' AND recipient_id=$3",[a.school,id,head.id]);
  assert.equal(closed.rows[0].status,'DOCUMENTED');assert.ok(closed.rows[0].read_at);
  const decisionAlert=await pool.query("SELECT 1 FROM user_notifications WHERE school_id=$1 AND request_id=$2 AND recipient_id=$3 AND status='DOCUMENTED' AND category='REQUEST'",[a.school,id,teacher.id]);
  assert.equal(decisionAlert.rowCount,1);
  assert.equal((await call('POST','/requests/'+id+'/admin-decision',outsideAdmin,{
   decision:'APPROVE',comment:'Other school should not approve.'})).status,403);
  const defaultPolicy=await call('GET','/policy',admin);
  assert.equal(defaultPolicy.body.mode,'DOCUMENT_EXCEPTION');
  assert.equal((await call('POST','/requests/'+id+'/admin-decision',admin,{decision:'APPROVE',comment:'Admin cannot finalize this request.'})).status,403);
  const blank=await pool.query("SELECT 1 FROM staff_attendance_events WHERE school_id=$1 AND staff_user_id=$2 AND school_date=$3::date AND dtr_slot='PM_OUT' AND event_kind='DTR_SLOT'",
   [a.school,teacher.id,day]);
  assert.equal(blank.rowCount,0,'Documented exception leaves official DTR blank');
  assert.equal((await call('POST','/requests/'+id+'/admin-decision',admin,{
   decision:'APPROVE',comment:'Replay approval should be blocked.'})).status,403);
  const setPolicy=await call('POST','/policy',admin,{mode:'DTR_CORRECTION'});
  assert.equal(setPolicy.status,200,JSON.stringify(setPolicy));
  const secondRequest=await call('POST','/requests',second,make('16:58'));
  assert.equal(secondRequest.status,201,JSON.stringify(secondRequest));
  const secondId=secondRequest.body.requestId;
  assert.equal((await call('POST','/requests/'+secondId+'/evidence',head,png,'image/png')).status,200);
  const corrected=await call('POST','/requests/'+secondId+'/head-decision',head,{
   decision:'VERIFY',comment:'Checked signed attendance register and recorded time.',
   verifiedTime:'16:58',reference:'Department logbook page 5 entry 8'});
  assert.equal(corrected.status,200,JSON.stringify(corrected));
  assert.equal(corrected.body.status,'DTR_CORRECTED');
  const pm=await pool.query("SELECT occurred_at,source,verification_method FROM staff_attendance_events WHERE school_id=$1 AND staff_user_id=$2 AND school_date=$3::date AND event_kind='DTR_SLOT' AND dtr_slot='PM_OUT' AND verification_status='VERIFIED'",
   [a.school,second.id,day]);
  assert.equal(pm.rowCount,1);
  assert.equal(pm.rows[0].source,'AUTHORIZED_CORRECTION');
  assert.equal(pm.rows[0].verification_method,'MANUAL_REVIEW');
  assert.equal(new Date(pm.rows[0].occurred_at).toISOString(),
   new Date(day+'T16:58:00+08:00').toISOString(),'Approved time reflects actual logged time, not current server time');
  const audit=await pool.query("SELECT action FROM staff_attendance_audit WHERE school_id=$1 AND target_id=$2",
   [a.school,secondId]);
  assert.ok(audit.rows.some(r=>r.action==='MISSING_SCAN_OFFICIAL_DTR_CORRECTED'));
  assert.equal((await call('POST','/requests/'+secondId+'/admin-decision',admin,{
   decision:'APPROVE',comment:'Duplicate final approval must be blocked.'})).status,403);
  assert.equal((await call('POST','/requests/'+secondId+'/head-decision',head,{decision:'VERIFY',comment:'Duplicate approval cannot be accepted.',verifiedTime:'16:58',reference:'page 5'})).status,403);
  const own=await call('GET','/requests?view=mine',teacher);
  assert.equal(own.status,200);
  assert.equal(own.body.requests.length,1);
  assert.equal(own.body.requests[0].status,'DOCUMENTED');
  console.log('PASS: missing scan departmental review, school isolation, logbook evidence, default blank DTR, audited authorized correction, duplicate prevention.');
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  await pool.end();
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
