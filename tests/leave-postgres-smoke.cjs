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
  await q('CREATE TABLE school_users (school_id uuid not null,user_id uuid not null,role text,display_name text,teacher_position text,active bool,department_id uuid,primary key(school_id,user_id))');
  await q('CREATE TABLE school_departments (school_id uuid not null,department_id uuid not null,department_name text,primary key(school_id,department_id))');
  await q("CREATE TABLE staff_form48_approved_leaves(leave_id uuid primary key, school_id uuid,staff_user_id uuid,leave_type text CHECK(leave_type IN ('MATERNITY','PATERNITY','SICK','VACATION','OTHER')),start_date date,end_date date,approval_reference text,recorded_by_user_id uuid,revoked_at timestamptz)");
  await q(fs.readFileSync(path.join(__dirname,'../migrations/074_deped_leave_vsc_workflow.sql'),'utf8'));
  await q("INSERT INTO schools VALUES('00000000-0000-4000-8000-000000000001','Test School')");
  await q("INSERT INTO school_departments VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','English')");
  await q("INSERT INTO school_users VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','TEACHER','Fictional Teacher','Teacher I',true,'00000000-0000-4000-8000-000000000002')");
  await q("INSERT INTO school_users VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004','SCHOOL_ADMIN','Fictional Administrator','Principal',true,'00000000-0000-4000-8000-000000000002')");
  await q("INSERT INTO staff_leave_requests(school_id,staff_user_id,department_id,leave_type,credit_account,start_date,end_date,reason) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','SICK','VSC','2026-11-23','2026-11-24','Documented sickness')");
  await assert.rejects(q("UPDATE staff_leave_requests SET status='APPROVED'"),/staff_leave_final_evidence/i);
  await assert.rejects(q("INSERT INTO staff_leave_credit_entries(school_id,staff_user_id,credit_account,entry_kind,signed_days,entered_by_user_id,status,verified_by_user_id,verified_at) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','VSC','EARNED',2,'00000000-0000-4000-8000-000000000004','VERIFIED','00000000-0000-4000-8000-000000000004',now())"),/staff_leave_credits_certified/i);
  await q("INSERT INTO staff_leave_credit_entries(school_id,staff_user_id,credit_account,entry_kind,signed_days,entered_by_user_id,status) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','VSC','EARNED',1.5,'00000000-0000-4000-8000-000000000003','PROPOSED')");
  const balance=await q("SELECT COALESCE(SUM(signed_days) FILTER(WHERE status='VERIFIED'),0)::numeric as days FROM staff_leave_credit_entries");
  assert.equal(Number(balance.rows[0].days),0,'proposed credits cannot enter the certified balance');
  const oldLeave=await q("INSERT INTO staff_form48_approved_leaves VALUES(gen_random_uuid(),'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','VSC','2026-11-23','2026-11-24','SO-100','00000000-0000-4000-8000-000000000004',NULL) RETURNING leave_type");
  assert.equal(oldLeave.rows[0].leave_type,'VSC','DTR annotation allows VSC without changing gate slots');
  console.log('Leave schema, evidence checks, unverified credit exclusion and Form48 VSC mapping: PASS');
 }finally{await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
