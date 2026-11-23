'use strict';
// Isolated CI-only PostgreSQL integration test: real sessions, SQL constraints,
// two concurrent redemption requests, and cross-school isolation.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const express=require('express');
const {Pool}=require('pg');
const {createOpaqueToken,hashToken}=require('../auth-security');
const {createAuthMiddleware}=require('../auth-middleware');
const {registerStaffLunchRoutes}=require('../staff-lunch-routes');
const {registerStaffGateDtrRoutes}=require('../staff-gate-dtr-routes');

async function main(){
 const url=process.env.DATABASE_URL;
 assert.ok(url && new URL(url).pathname==='/school_attendance_test',
  'Refusing staff lunch integration tests outside disposable school_attendance_test');
 const pool=new Pool({connectionString:url,max:8,connectionTimeoutMillis:5000});
 let server;
 try{
  const label=crypto.randomBytes(5).toString('hex');
  async function makeSchool(code){
   const school=(await pool.query('INSERT INTO schools(school_code,school_name) VALUES($1,$2) RETURNING school_id',
    [code+label,'Lunch QR isolated integration test'])).rows[0].school_id;
   const dep=(await pool.query('INSERT INTO school_departments(school_id,department_code,department_name) VALUES($1,$2,$3) RETURNING department_id',
    [school,'TEST','Isolated Test Department'])).rows[0].department_id;
   return {school,dep};
  }
  async function makeUser(tenant,role,username){
   const user=(await pool.query(`INSERT INTO school_users(school_id,department_id,username,display_name,password_hash,role,teacher_designations)
    VALUES($1,$2,$3,$4,'synthetic-test-no-login',$5,
       CASE WHEN $5='TEACHER' THEN ARRAY['SUBJECT_TEACHER']::text[] ELSE ARRAY[]::text[] END) RETURNING user_id`,
    [tenant.school,tenant.dep,username+label,username,role])).rows[0].user_id;
   const token=createOpaqueToken();
   await pool.query(`INSERT INTO user_sessions(token_hash,principal_type,school_id,school_user_id,expires_at)
    VALUES($1,'SCHOOL',$2,$3,NOW()+INTERVAL '10 minutes')`,
    [hashToken(token),tenant.school,user]);
   return {id:user,token};
  }
  const a=await makeSchool('LUNCH_A_'),b=await makeSchool('LUNCH_B_');
  const admin=await makeUser(a,'SCHOOL_ADMIN','lunch-admin-');
  const teacher=await makeUser(a,'TEACHER','lunch-teacher-');
  const other=await makeUser(b,'TEACHER','lunch-other-');
  const keeper=await makeUser(a,'GATE_KEEPER','lunch-keeper-');
  const otherKeeper=await makeUser(b,'GATE_KEEPER','other-keeper-');
  const teacherQrToken=crypto.randomUUID();
  await pool.query('UPDATE school_users SET teacher_qr_token=$2,teacher_photo_path=$3 WHERE user_id=$1',
   [teacher.id,teacherQrToken,'isolated-test-photo.jpg']);
  const app=express();app.use(express.json());
  const {authenticateSchoolClient,requireSchoolRoles}=createAuthMiddleware(pool);
  registerStaffLunchRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles});
  registerStaffGateDtrRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles});
  server=await new Promise((resolve,reject)=>{
   const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.on('error',reject);
  });
  const base='http://127.0.0.1:'+server.address().port;
  async function post(path,body,token){
   const r=await fetch(base+path,{method:'POST',
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
   return {status:r.status,body:await r.json()};
  }
  const teacher2=await makeUser(a,'TEACHER','lunch-backup-');
  const teacherDenied=await post('/api/staff-attendance/lunch/challenges',{slot:'PM_IN'},teacher.token);
  assert.equal(teacherDenied.status,403,'Teacher cannot present lunch QR without school assignment');
  const assignPath='/api/staff-attendance/lunch/presenter';
  const assignment={slot:'PM_IN',presenterUserId:teacher.id};
  const teacherAssign=await fetch(base+assignPath,{method:'PUT',
   headers:{'Content-Type':'application/json',Authorization:'Bearer '+teacher.token},
   body:JSON.stringify(assignment)});
  assert.equal(teacherAssign.status,403,'Teachers cannot assign themselves');
  const crossAssign=await fetch(base+assignPath,{method:'PUT',
   headers:{'Content-Type':'application/json',Authorization:'Bearer '+admin.token},
   body:JSON.stringify({...assignment,presenterUserId:other.id})});
  assert.equal(crossAssign.status,404,'Admin cannot assign teacher from another school');
  async function presenterChange(method,body,token=admin.token){
   const response=await fetch(base+assignPath,{method,
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
    body:JSON.stringify(body)});
   return {status:response.status,body:await response.json()};
  }
  const assigned=await presenterChange('PUT',assignment);
  assert.equal(assigned.status,201,'School Admin can assign active teacher');
  const permitted=await post('/api/staff-attendance/lunch/challenges',{slot:'PM_IN'},teacher.token);
  assert.equal(permitted.status,201,'Assigned teacher may issue lunch QR');
  assert.match(permitted.body.qrImage,/^data:image\/png;base64,/,'Presenter receives real scannable PNG');
  const rapidQr=await post('/api/staff-attendance/lunch/challenges',{slot:'PM_IN'},teacher.token);
  assert.equal(rapidQr.status,429,'Presenter cannot flood QR issues within 20 seconds');
  const additional=await presenterChange('PUT',{slot:'PM_IN',presenterUserId:teacher2.id});
  assert.equal(additional.status,201,'School Admin may authorize another presenter for the same slot');
  const originalQr=await pool.query('SELECT revoked_at FROM staff_attendance_challenges WHERE challenge_id=$1',
   [permitted.body.challengeId]);
  assert.equal(originalQr.rowCount,1);
  assert.equal(originalQr.rows[0].revoked_at,null,"Adding a second presenter preserves the first presenter's QR");
  const firstPresenterAgain=permitted;
  assert.equal(firstPresenterAgain.status,201,'First presenter retains a still-valid QR during short rotation overlap');
  const newPresenter=await post('/api/staff-attendance/lunch/challenges',{slot:'PM_IN'},teacher2.token);
  assert.equal(newPresenter.status,201,'Second teacher can issue an independent lunch QR');
  const firstStillLive=await pool.query('SELECT revoked_at FROM staff_attendance_challenges WHERE challenge_id=$1',
   [firstPresenterAgain.body.challengeId]);
  assert.equal(firstStillLive.rows[0].revoked_at,null,"Second presenter's QR does not rotate the first");
  const removed=await presenterChange('DELETE',{slot:'PM_IN',presenterUserId:teacher2.id});
  assert.equal(removed.status,200);
  assert.equal(removed.body.revoked,true);
  assert.equal((await post('/api/staff-attendance/lunch/redeem',
   {challengeId:newPresenter.body.challengeId,token:newPresenter.body.token},teacher.token)).status,410,
   'Revoking the second presenter invalidates only their active QR');
  assert.equal((await post('/api/staff-attendance/lunch/challenges',{slot:'PM_IN'},teacher2.token)).status,403,
   'Revoked presenter cannot issue challenges');
  const independentQr=await pool.query('SELECT revoked_at FROM staff_attendance_challenges WHERE challenge_id=$1',
   [firstPresenterAgain.body.challengeId]);
  assert.equal(independentQr.rows[0].revoked_at,null,"Revoking another presenter preserves the first presenter's QR");
  const auditPresenter=await pool.query(`SELECT action FROM staff_attendance_audit
    WHERE school_id=$1 AND action IN ('LUNCH_PRESENTER_ASSIGNED','LUNCH_PRESENTER_REVOKED')`,
    [a.school]);
  assert.equal(auditPresenter.rowCount,3,'Two independent grants and one targeted revocation are audited');

  const issued=await post('/api/staff-attendance/lunch/challenges',{slot:'AM_OUT'},admin.token);
  assert.equal(issued.status,201,'School admin can issue a time-limited lunch QR: '+JSON.stringify(issued.body));
  const qr={challengeId:issued.body.challengeId,token:issued.body.token};
  // Location setup is an independent School Admin operation, not a teacher
  // browser setting. The test uses synthetic coordinates only.
  const setLocation=await fetch(base+'/api/staff-attendance/lunch/location',{
   method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+admin.token},
   body:JSON.stringify({departmentId:a.dep,latitude:9,longitude:125,accuracyMeters:10,radiusMeters:120})
  });
  assert.equal(setLocation.status,200,'School Admin can set the department scanning point');
  const presence={latitude:9,longitude:125,accuracyMeters:12,capturedAt:Date.now()};
  const verifiedQr={...qr,location:presence};
  const crossSchool=await post('/api/staff-attendance/lunch/redeem',qr,other.token);
  assert.equal(crossSchool.status,410,'Cross-school challenge cannot be redeemed');
  const invalid=await post('/api/staff-attendance/lunch/redeem',{...qr,token:crypto.randomBytes(32).toString('base64url')},teacher.token);
  assert.equal(invalid.status,403,'Forged token must be rejected');

  // Requests use different real PostgreSQL clients. Unique verified DTR slot
  // constraint serializes the conflict and exactly one transaction commits.
  const results=await Promise.all([
   post('/api/staff-attendance/lunch/redeem',verifiedQr,teacher.token),
   post('/api/staff-attendance/lunch/redeem',verifiedQr,teacher.token)
  ]);
  assert.deepEqual(results.map(x=>x.status).sort((x,y)=>x-y),[201,409],
   'Exactly one of two simultaneous redemptions must succeed: '+JSON.stringify(results));
  const events=await pool.query(`SELECT event_id,verification_status,verification_method
    FROM staff_attendance_events WHERE school_id=$1 AND staff_user_id=$2 AND school_date=$3
    AND dtr_slot='AM_OUT' AND verification_status='VERIFIED'`,
    [a.school,teacher.id,issued.body.schoolDate]);
  assert.equal(events.rowCount,1,'One verified DTR punch persisted');
  assert.equal(events.rows[0].verification_method,'ROTATING_QR');
  const redemption=await pool.query(`SELECT event_id FROM staff_attendance_challenge_redemptions
    WHERE school_id=$1 AND challenge_id=$2 AND staff_user_id=$3`,
    [a.school,qr.challengeId,teacher.id]);
  assert.equal(redemption.rowCount,1,'Exactly one redemption record persisted');
  assert.equal(redemption.rows[0].event_id,events.rows[0].event_id);
  const audit=await pool.query(`SELECT count(*)::int AS total FROM staff_attendance_audit
    WHERE school_id=$1 AND action='LUNCH_DTR_VERIFIED' AND target_id=$2`,
    [a.school,events.rows[0].event_id]);
  assert.equal(audit.rows[0].total,1,'One immutable verified DTR audit row persisted');
  const again=await post('/api/staff-attendance/lunch/redeem',verifiedQr,teacher.token);
  assert.equal(again.status,409,'Replay denied even after the first request committed');



  // A remote or inaccurate scan must NOT silently alter Form 48.
  const outside=await post('/api/staff-attendance/lunch/redeem',
   {...qr,location:{latitude:10,longitude:126,accuracyMeters:9,capturedAt:Date.now()}},teacher2.token);
  assert.equal(outside.status,201,'Uncertain but authentic QR can be recorded for review');
  assert.equal(outside.body.status,'PENDING_VERIFICATION');
  const pendingOnly=await pool.query(`SELECT verification_status FROM staff_attendance_events
    WHERE school_id=$1 AND staff_user_id=$2 AND dtr_slot='AM_OUT'`,
    [a.school,teacher2.id]);
  assert.equal(pendingOnly.rows[0].verification_status,'PENDING_VERIFICATION');
  const pendingList=await fetch(base+'/api/staff-attendance/lunch/pending',{
    headers:{Authorization:'Bearer '+admin.token}});
  assert.equal(pendingList.status,200);
  assert.ok((await pendingList.json()).items.some(row=>row.eventId===outside.body.eventId));
  const deniedReview=await post('/api/staff-attendance/lunch/review',
    {eventId:outside.body.eventId,decision:'VERIFY',note:'Independent evidence checked'},teacher2.token);
  assert.equal(deniedReview.status,403,'Teachers cannot self-approve pending QR scans');
  const reviewed=await post('/api/staff-attendance/lunch/review',
    {eventId:outside.body.eventId,decision:'VERIFY',note:'School Admin inspected independent on-site evidence'},admin.token);
  assert.equal(reviewed.status,200,'School Admin can verify only after explicit documented review');
  const reviewedRow=await pool.query(`SELECT verification_status,verification_method
     FROM staff_attendance_events WHERE event_id=$1`,[outside.body.eventId]);
  assert.equal(reviewedRow.rows[0].verification_status,'VERIFIED');
  assert.equal(reviewedRow.rows[0].verification_method,'MANUAL_REVIEW');

  const gatePath='/api/staff-attendance/gatekeeper/dtr';
  const gateBody={teacherQrToken,slot:'PM_OUT',photoVerified:true};
  assert.equal((await post(gatePath,gateBody,teacher.token)).status,403,
   'Teachers cannot use the Gatekeeper DTR scanner');
  assert.equal((await post(gatePath,{...gateBody,photoVerified:false},keeper.token)).status,400,
   'Gatekeeper must explicitly verify registered photo');
  assert.equal((await post(gatePath,gateBody,otherKeeper.token)).status,404,
   'Other school Gatekeeper cannot resolve teacher badge');
  const guarded=await post(gatePath,gateBody,keeper.token);
  assert.equal(guarded.status,201,'Authenticated Gatekeeper can verify teacher DTR: '+JSON.stringify(guarded.body));
  assert.equal((await post(gatePath,gateBody,keeper.token)).status,409,
   'Duplicate photo-verified slot cannot be recorded again');
  const gateEvent=await pool.query(`SELECT source,verification_method,actor_user_id
    FROM staff_attendance_events WHERE school_id=$1 AND event_id=$2 AND staff_user_id=$3`,
    [a.school,guarded.body.eventId,teacher.id]);
  assert.equal(gateEvent.rowCount,1);
  assert.equal(gateEvent.rows[0].source,'GATEKEEPER');
  assert.equal(gateEvent.rows[0].verification_method,'GUARD_PHOTO');
  assert.equal(gateEvent.rows[0].actor_user_id,keeper.id);
  const person=await fetch(base+'/api/staff-attendance/my/dtr',{
   headers:{Authorization:'Bearer '+teacher.token}
  });
  assert.equal(person.status,200);
  const dtr=await person.json();
  assert.equal(dtr.slots.find(x=>x.slot==='AM_OUT').status,'VERIFIED');
  assert.equal(dtr.slots.find(x=>x.slot==='PM_OUT').status,'VERIFIED');
  assert.equal(dtr.slots.find(x=>x.slot==='AM_IN').status,'NOT_RECORDED');

  process.stdout.write('PASS: real PostgreSQL: authenticated issuance, tenant rejection, forged QR denial, concurrent duplicate prevention, immutable audit and replay.\\n');
 } finally{
  if(server) await new Promise(resolve=>server.close(resolve));
  await pool.end();
 }
}
main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
