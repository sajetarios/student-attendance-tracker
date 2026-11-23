'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto'),express=require('express');
const {Pool}=require('pg');
const {createOpaqueToken,hashToken}=require('../auth-security');
const {createAuthMiddleware}=require('../auth-middleware');
const {registerPrincipalRoutes}=require('../principal-overview-routes');
const {manilaDate}=require('../staff-lunch-routes');
async function main(){
 const url=process.env.DATABASE_URL;
 assert.ok(url&&new URL(url).pathname==='/school_attendance_test',
  'Refusing Principal integration tests outside disposable school_attendance_test database');
 const pool=new Pool({connectionString:url,max:8,connectionTimeoutMillis:5000});
 let server;
 try{
  const suffix=crypto.randomBytes(5).toString('hex'),today=manilaDate();
  async function school(name){
   const id=(await pool.query('INSERT INTO schools(school_code,school_name) VALUES($1,$2) RETURNING school_id',
     ['P'+suffix+name,'Principal integration '+name])).rows[0].school_id;
   const dep=(await pool.query("INSERT INTO school_departments(school_id,department_code,department_name) VALUES($1,'ENG','English Department') RETURNING department_id",[id])).rows[0].department_id;
   return {id,dep};
  }
  async function staff(s,role,name){
   const teacher=role==='TEACHER';
   const id=(await pool.query(`INSERT INTO school_users
    (school_id,department_id,username,display_name,password_hash,role,teacher_designations)
    VALUES($1,$2,$3,$4,'test-only-hash',$5,$6) RETURNING user_id`,
    [s.id,teacher?s.dep:null,name+suffix,name,role,teacher?['SUBJECT_TEACHER']:[]])).rows[0].user_id;
   const token=createOpaqueToken();
   await pool.query(`INSERT INTO user_sessions(token_hash,principal_type,school_id,school_user_id,expires_at)
     VALUES($1,'SCHOOL',$2,$3,NOW()+INTERVAL '10 minutes')`,[hashToken(token),s.id,id]);
   return {id,token};
  }
  const a=await school('A'),b=await school('B');
  const principal=await staff(a,'PRINCIPAL','principal-alpha');
  const admin=await staff(a,'SCHOOL_ADMIN','admin-alpha');
  const teacher=await staff(a,'TEACHER','teacher-alpha');
  const outsider=await staff(b,'PRINCIPAL','principal-beta');
  const teacherB=await staff(b,'TEACHER','teacher-beta');
  async function event(s,u,status,slot){
   await pool.query(`INSERT INTO staff_attendance_events
     (school_id,staff_user_id,event_kind,dtr_slot,school_date,occurred_at,
      source,verification_status,verification_method,actor_user_id,client_event_key)
     VALUES($1,$2,'DTR_SLOT',$3,$4::date,NOW(),'SELF_SERVICE',$5,$6,$2,$7)`,
    [s.id,u.id,slot,today,status,status==='VERIFIED'?'ROTATING_QR':null,crypto.randomUUID()]);
  }
  await event(a,teacher,'VERIFIED','AM_IN');
  await event(a,teacher,'PENDING_VERIFICATION','AM_OUT');
  await event(b,teacherB,'VERIFIED','AM_IN');
  const app=express();app.use(express.json());
  const {authenticateSchoolClient,requireSchoolRoles}=createAuthMiddleware(pool);
  registerPrincipalRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles});
  server=await new Promise((resolve,reject)=>{
   const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));instance.on('error',reject);
  });
  const base='http://127.0.0.1:'+server.address().port;
  async function overview(token,query=''){
   const response=await fetch(base+'/api/principal/overview'+query,
    {headers:{Authorization:'Bearer '+token},cache:'no-store'});
   return {status:response.status,body:await response.json()};
  }
  const first=await overview(principal.token);
  assert.equal(first.status,200,'Principal dashboard API must load: '+JSON.stringify(first.body));
  assert.equal(first.body.school.schoolCode,'P'+suffix+'A');
  assert.equal(first.body.metrics.trackedStaff,2,'School Admin and Teacher have distinct DTR scopes');
  assert.equal(first.body.metrics.withVerifiedPunch,1,'Only verified employee has a verified punch');
  assert.equal(first.body.metrics.withPendingPunch,1);
  assert.equal(first.body.metrics.verifiedDtrSlots,1,'Cross-school event must never count');
  assert.equal(first.body.metrics.pendingDtrSlots,1);
  assert.equal(first.body.schoolDate,today);
  assert.equal(first.body.staffRows.find(r=>r.staffUserId===teacher.id).verifiedSlots,1);
  assert.ok(first.body.definitions.withVerifiedPunch.includes('Not a presence or punctuality rate'));
  const scoped=await overview(principal.token,'?departmentId='+a.dep+'&days=14');
  assert.equal(scoped.status,200);
  assert.equal(scoped.body.metrics.trackedStaff,1,'Department filters must scope staff metrics');
  assert.equal(scoped.body.trends.length,14);
  assert.equal(scoped.body.metrics.verifiedDtrSlots,1);
  const foreign=await overview(principal.token,'?departmentId='+b.dep);
  assert.equal(foreign.status,404,'Cross-school department cannot be accessed');
  const invalid=await overview(principal.token,'?date=2020-01-01');
  assert.equal(invalid.status,400);
  const preview=await overview(admin.token);
  assert.equal(preview.status,200,'School Admin can preview only its own school leadership dashboard');
  const outside=await overview(outsider.token);
  assert.equal(outside.status,200);
  assert.equal(outside.body.metrics.verifiedDtrSlots,1,'Other tenant sees only its own event');
  const teacherAccess=await overview(teacher.token);
  assert.equal(teacherAccess.status,403,'Regular teachers cannot access Principal school-wide records');
  const forbidden=await fetch(base+'/api/principal/overview',{method:'POST',
   headers:{Authorization:'Bearer '+principal.token}});
  assert.equal(forbidden.status,404,'Principal endpoint has no write action');
  console.log('Principal leadership tests passed: tenant isolation, staff verification, filters, read-only boundaries.');
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  await pool.end();
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
