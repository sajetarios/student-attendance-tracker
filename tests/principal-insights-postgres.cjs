'use strict';
// Disposable PostgreSQL integration test. No production URLs accepted.
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const express=require('express');
const crypto=require('node:crypto');
const {registerPrincipalInsightsRoutes}=require('../principal-insights-routes');
const {manilaDate}=require('../staff-lunch-routes');
async function main(){
 const url=process.env.DATABASE_URL;
 assert.ok(url&&new URL(url).pathname==='/school_attendance_test',
  'Refusing principal integration against non-disposable database');
 const pool=new Pool({connectionString:url,max:6,connectionTimeoutMillis:5000});
 let server;
 const label=crypto.randomBytes(4).toString('hex');
 async function school(suffix){
  const schoolId=(await pool.query('INSERT INTO schools(school_code,school_name) VALUES($1,$2) RETURNING school_id',
   ['PI_'+suffix+label,'Principal Insights CI School'])).rows[0].school_id;
  const departmentId=(await pool.query(
   'INSERT INTO school_departments(school_id,department_code,department_name) VALUES($1,$2,$3) RETURNING department_id',
   [schoolId,'ENG','English Department'])).rows[0].department_id;
  return {schoolId,departmentId};
 }
 async function staff(tenant,role,name){
  return (await pool.query(`INSERT INTO school_users
   (school_id,department_id,username,display_name,password_hash,role,teacher_designations)
   VALUES($1,$2,$3,$4,'synthetic-test-only',$5,
    CASE WHEN $5='TEACHER' THEN ARRAY['SUBJECT_TEACHER']::text[] ELSE ARRAY[]::text[] END)
    RETURNING user_id`,
   [tenant.schoolId,tenant.departmentId,name+label,name,role])).rows[0].user_id;
 }
 try{
  const a=await school('a'),b=await school('b');
  const admin=await staff(a,'SCHOOL_ADMIN','pi-admin'),
   teacher=await staff(a,'TEACHER','pi-teacher');
  const otherAdmin=await staff(b,'SCHOOL_ADMIN','pi-other-admin');
  const today=manilaDate();
  const events=[
   {school:a.schoolId,teacher,actor:admin,status:'VERIFIED',slot:'AM_IN',method:'ROTATING_QR'},
   {school:a.schoolId,teacher,actor:admin,status:'PENDING_VERIFICATION',slot:'AM_OUT',method:null},
   {school:b.schoolId,teacher:otherAdmin,actor:otherAdmin,status:'VERIFIED',slot:'AM_IN',method:'MANUAL_REVIEW'}
  ];
  for(const item of events)await pool.query(`INSERT INTO staff_attendance_events
   (school_id,staff_user_id,event_kind,dtr_slot,school_date,occurred_at,source,
    verification_status,verification_method,actor_user_id,client_event_key)
   VALUES($1,$2,'DTR_SLOT',$3,$4::date,NOW(),'SELF_SERVICE',$5,$6,$7,$8)`,
   [item.school,item.teacher,item.slot,today,item.status,item.method,item.actor,crypto.randomUUID()]);
  const studentId='PI-STUDENT-'+label;
  await pool.query(`INSERT INTO students
   (school_id,student_id,full_name,grade_level,section,parent_mobile)
   VALUES($1,$2,'Fictional Test Learner','Grade 8','TEST','000000')`,[a.schoolId,studentId]);
  await pool.query(`INSERT INTO attendance_events
   (event_id,school_id,device_id,student_id,attendance_scope,
   event_type,occurred_at_device,school_date,sync_status)
   VALUES($1,$2,'CI-DEVICE',$3,'SCHOOL','TIME_IN',NOW(),$4::date,'ACCEPTED')`,
   [crypto.randomUUID(),a.schoolId,studentId,today]);
  await pool.query(`INSERT INTO staff_leave_requests
   (school_id,staff_user_id,department_id,leave_type,credit_account,start_date,end_date,
    reason,status)
   VALUES($1,$2,$3,'VACATION','NONE',$4::date,$4::date,'Fictional test request','PENDING_ADMIN')`,
   [a.schoolId,teacher,a.departmentId,today]);
  await pool.query(`INSERT INTO staff_official_business_requests
   (school_id,staff_user_id,department_id,purpose,destination,starts_at,ends_at,status)
   VALUES($1,$2,$3,'Fictional official activity','Test venue',NOW(),NOW()+INTERVAL '2 hours','PENDING_ADMIN')`,
   [a.schoolId,teacher,a.departmentId]);
  const app=express();
  const auth=(req,_res,next)=>{
   req.auth={type:'SCHOOL_USER',schoolId:req.get('x-test-school')==='other'?b.schoolId:a.schoolId,
    role:req.get('x-test-role')||'SCHOOL_ADMIN',userId:admin};
   next();
  };
  const roles=(...allowed)=>(req,res,next)=>allowed.includes(req.auth.role)?next():
   res.status(403).json({error:'Forbidden'});
  registerPrincipalInsightsRoutes(app,pool,{authenticateSchoolClient:auth,requireSchoolRoles:roles});
  server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
  const base='http://127.0.0.1:'+server.address().port;
  const allowed=await fetch(base+'/api/principal/insights?days=1');
  assert.equal(allowed.status,200,await allowed.text().catch(()=>'')); // text() on success is never read here
  const output=await allowed.json();
  assert.equal(output.staff.verifiedSlots,1);
  assert.equal(output.staff.pendingSlots,1);
  assert.equal(output.staff.staffWithVerifiedSlot,1);
  assert.equal(output.students.uniqueLearnersScanned,1);
  assert.equal(output.approvals.leave.school,1);
  assert.equal(output.approvals.ob.school,1);
  assert.ok(output.departments.some(x=>x.name==='English Department'&&x.pendingSlots===1));
  assert.equal(output.trend.at(-1).date,today);
  const filtered=await fetch(base+'/api/principal/insights?days=1&departmentId='+a.departmentId);
  assert.equal(filtered.status,200);
  assert.equal((await filtered.json()).staff.pendingSlots,1);
  const alien=await fetch(base+'/api/principal/insights?departmentId='+b.departmentId);
  assert.equal(alien.status,404,'Foreign school department cannot be inspected');
  const noTeacher=await fetch(base+'/api/principal/insights',{headers:{'x-test-role':'TEACHER'}});
  assert.equal(noTeacher.status,403,'Principal preview is not available to teachers');
  const other=await fetch(base+'/api/principal/insights?days=1',{headers:{'x-test-school':'other'}});
  assert.equal(other.status,200);
  const otherData=await other.json();
  assert.equal(otherData.staff.verifiedSlots,1);
  assert.equal(otherData.staff.pendingSlots,0);
  assert.equal(otherData.students.uniqueLearnersScanned,0);
  console.log('Principal Insights PostgreSQL smoke passed: verified DTR, unverified QR, student scans, leave, OB, tenant and role isolation.');
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  await pool.end();
 }
}
main().catch(err=>{console.error(err);process.exitCode=1;});
