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
  const app=express();app.use(express.json());
  const {authenticateSchoolClient,requireSchoolRoles}=createAuthMiddleware(pool);
  registerStaffLunchRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles});
  server=await new Promise((resolve,reject)=>{
   const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.on('error',reject);
  });
  const base='http://127.0.0.1:'+server.address().port;
  async function post(path,body,token){
   const r=await fetch(base+path,{method:'POST',
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
   return {status:r.status,body:await r.json()};
  }
  const issued=await post('/api/staff-attendance/lunch/challenges',{slot:'AM_OUT'},admin.token);
  assert.equal(issued.status,201,'School admin can issue a time-limited lunch QR: '+JSON.stringify(issued.body));
  const qr={challengeId:issued.body.challengeId,token:issued.body.token};
  const crossSchool=await post('/api/staff-attendance/lunch/redeem',qr,other.token);
  assert.equal(crossSchool.status,410,'Cross-school challenge cannot be redeemed');
  const invalid=await post('/api/staff-attendance/lunch/redeem',{...qr,token:crypto.randomBytes(32).toString('base64url')},teacher.token);
  assert.equal(invalid.status,403,'Forged token must be rejected');

  // Requests use different real PostgreSQL clients. Unique verified DTR slot
  // constraint serializes the conflict and exactly one transaction commits.
  const results=await Promise.all([
   post('/api/staff-attendance/lunch/redeem',qr,teacher.token),
   post('/api/staff-attendance/lunch/redeem',qr,teacher.token)
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
  const again=await post('/api/staff-attendance/lunch/redeem',qr,teacher.token);
  assert.equal(again.status,409,'Replay denied even after the first request committed');

  process.stdout.write('PASS: real PostgreSQL: authenticated issuance, tenant rejection, forged QR denial, concurrent duplicate prevention, immutable audit and replay.\\n');
 } finally{
  if(server) await new Promise(resolve=>server.close(resolve));
  await pool.end();
 }
}
main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
