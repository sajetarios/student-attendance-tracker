'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {Pool}=require('pg');
(async()=>{
 if(!process.env.TEST_DATABASE_URL)throw Error('TEST_DATABASE_URL required; never run on the production database');
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,ssl:false});
 const q=s=>pool.query(s);
 try{
  await q('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await q('CREATE TABLE schools (school_id uuid primary key,school_name text)');
  await q('CREATE TABLE school_users (school_id uuid not null,user_id uuid not null,role text,display_name text,teacher_position text,active bool,department_id uuid,teacher_status text,leave_start_date date,expected_return_date date,primary key(school_id,user_id))');
  await q('CREATE TABLE school_departments (school_id uuid not null,department_id uuid not null,department_name text,primary key(school_id,department_id))');
  await q("CREATE TABLE staff_form48_approved_leaves(leave_id uuid primary key, school_id uuid,staff_user_id uuid,leave_type text CHECK(leave_type IN ('MATERNITY','PATERNITY','SICK','VACATION','OTHER')),start_date date,end_date date,approval_reference text,recorded_by_user_id uuid,revoked_at timestamptz)");
  await q(fs.readFileSync(path.join(__dirname,'../migrations/074_deped_leave_vsc_workflow.sql'),'utf8'));
  await q(fs.readFileSync(path.join(__dirname,'../migrations/075_department_optional_for_leave_applicant.sql'),'utf8'));
  const optionalDepartment=await q("SELECT is_nullable FROM information_schema.columns WHERE table_name='staff_leave_requests' AND column_name='department_id'");
  assert.equal(optionalDepartment.rows[0].is_nullable,'YES');
  await q("INSERT INTO schools VALUES('00000000-0000-4000-8000-000000000001','Test School')");
  await q("INSERT INTO school_departments VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','English')");
  await q("INSERT INTO school_users(school_id,user_id,role,display_name,teacher_position,active,department_id) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','TEACHER','Fictional Teacher','Teacher I',true,'00000000-0000-4000-8000-000000000002')");
  await q("INSERT INTO school_users(school_id,user_id,role,display_name,teacher_position,active,department_id) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004','SCHOOL_ADMIN','Fictional Administrator','Principal',true,'00000000-0000-4000-8000-000000000002')");
  await q("INSERT INTO staff_leave_requests(school_id,staff_user_id,department_id,leave_type,credit_account,start_date,end_date,reason) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','SICK','VSC','2026-11-23','2026-11-24','Documented sickness')");
  // Principal applicant may have no teaching department, but cannot approve their own request.
  await q("INSERT INTO school_users(school_id,user_id,role,display_name,teacher_position,active,department_id) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005','SCHOOL_ADMIN','Fictional Principal','Principal',true,NULL)");
  await q("INSERT INTO school_users(school_id,user_id,role,display_name,teacher_position,active,department_id) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000006','DEPARTMENT_HEAD','Fictional Head','Master Teacher',true,'00000000-0000-4000-8000-000000000002')");
  await q("INSERT INTO staff_leave_requests(school_id,staff_user_id,department_id,leave_type,credit_account,start_date,end_date,reason,status) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005',NULL,'VACATION','NONE','2026-11-25','2026-11-26','Authorized leave application','PENDING_EXTERNAL')");
  const principalCount=await q("SELECT COUNT(*)::int AS count FROM staff_leave_requests WHERE department_id IS NULL AND status='PENDING_EXTERNAL'");
  assert.equal(principalCount.rows[0].count,1,'principal leave with no department is supported');

  // Exercise reviewer-scoped SQL against actual temporary PostgreSQL (not mocks).
  const {registerStaffLeaveInboxRoutes}=require('../staff-leave-inbox-routes');
  let handler;
  const app={get:(route,...parts)=>{if(route==='/api/staff-leave/inbox')handler=parts.at(-1);}};
  registerStaffLeaveInboxRoutes(app,pool,{authenticateSchoolClient:()=>{},requireSchoolRoles:()=>()=>{}});
  assert.equal(typeof handler,'function');
  async function inbox(role,userId,dept,filter,qString){
   let code=200,reply;
   const req={auth:{role,schoolId:'00000000-0000-4000-8000-000000000001',userId,departmentId:dept},
    query:{filter,q:qString,limit:'10',offset:'0'}};
   const res={set:()=>res,status:n=>{code=n;return res;},json:x=>{reply=x;return res;}};
   await handler(req,res);
   return {code,reply};
  }
  const adminInbox=await inbox('SCHOOL_ADMIN','00000000-0000-4000-8000-000000000004',null,'ACTION','');
  assert.equal(adminInbox.code,200,JSON.stringify(adminInbox.reply));
  assert.equal(adminInbox.reply.counts.action,1,'separate principal request visible to authorized admin');
  assert.equal(adminInbox.reply.requests.length,1);
  assert.equal(adminInbox.reply.requests[0].actions.recordOfficialDecision,true);
  const headInbox=await inbox('DEPARTMENT_HEAD','00000000-0000-4000-8000-000000000006',
   '00000000-0000-4000-8000-000000000002','ACTION','Fictional');
  assert.equal(headInbox.code,200,JSON.stringify(headInbox.reply));
  assert.equal(headInbox.reply.counts.action,2);
  assert.equal(headInbox.reply.requests.length,2);
  assert.equal(headInbox.reply.requests[0].leaveType,null,'reviewer view excludes medical leave subtype');
  assert.equal(headInbox.reply.requests.some(x=>x.own),false);
  console.log('Principal without department, school-scoped inbox, role actions and SQL search: PASS');

  await assert.rejects(q("UPDATE staff_leave_requests SET status='APPROVED'"),/staff_leave_final_evidence/i);
  await assert.rejects(q("INSERT INTO staff_leave_credit_entries(school_id,staff_user_id,credit_account,entry_kind,signed_days,entered_by_user_id,status,verified_by_user_id,verified_at) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','VSC','EARNED',2,'00000000-0000-4000-8000-000000000004','VERIFIED','00000000-0000-4000-8000-000000000004',now())"),/staff_leave_credits_certified/i);
  await q("INSERT INTO staff_leave_credit_entries(school_id,staff_user_id,credit_account,entry_kind,signed_days,entered_by_user_id,status) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','VSC','EARNED',1.5,'00000000-0000-4000-8000-000000000003','PROPOSED')");
  const balance=await q("SELECT COALESCE(SUM(signed_days) FILTER(WHERE status='VERIFIED'),0)::numeric as days FROM staff_leave_credit_entries");
  assert.equal(Number(balance.rows[0].days),0,'proposed credits cannot enter the certified balance');
  const oldLeave=await q("INSERT INTO staff_form48_approved_leaves VALUES(gen_random_uuid(),'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','VSC','2026-11-23','2026-11-24','SO-100','00000000-0000-4000-8000-000000000004',NULL) RETURNING leave_type");
  assert.equal(oldLeave.rows[0].leave_type,'VSC','DTR annotation allows VSC without changing gate slots');
  // Exercise the exact live leave-status SQL in temporary PostgreSQL.
  const {getStaffLeaveStatus,gateVisibleLeave}=require('../staff-approved-leave-status');
  await q("INSERT INTO staff_form48_approved_leaves VALUES(gen_random_uuid(),'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','SICK',(now() AT TIME ZONE 'Asia/Manila')::date,(now() AT TIME ZONE 'Asia/Manila')::date,'TEST-TODAY','00000000-0000-4000-8000-000000000004',NULL)");
  const status=await getStaffLeaveStatus(pool,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003');
  assert.equal(status.status,'ACTIVE','approved leave must be recognized on local school date');
  assert.equal(gateVisibleLeave(status).leaveType,undefined,'Gatekeeper cannot inspect leave type');
  await q("UPDATE staff_form48_approved_leaves SET revoked_at=now() WHERE approval_reference='TEST-TODAY'");
  const after=await getStaffLeaveStatus(pool,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003');
  assert.notEqual(after.approvalReference,'TEST-TODAY','revoked records cannot appear');
  console.log('Read-only leave lookup and revoked-approval rules: PASS');
  console.log('Leave schema, evidence checks, unverified credit exclusion and Form48 VSC mapping: PASS');
 }finally{await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
