'use strict';
// Exact production routes and real opaque sessions against disposable CI only.
// Do not use a live or staging school for synthetic attendance or leave charges.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const express=require('express');
const {Pool}=require('pg');
const {createOpaqueToken,hashToken}=require('../auth-security');
const {createAuthMiddleware}=require('../auth-middleware');
const {registerStaffLeaveRoutes}=require('../staff-leave-routes');
const {registerStaffLeaveInboxRoutes}=require('../staff-leave-inbox-routes');
const {registerForm48ReviewRoutes}=require('../form48-review-routes');
const {partialDutySlotAllowed}=require('../staff-leave-sessions');
const {registerGateOfflineRoutes,manilaSchoolDate}=require('../gate-offline-routes');
async function main(){
 const url=new URL(process.env.DATABASE_URL||'postgres://invalid/invalid');
 assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.pathname==='/school_attendance_test',
  'Refusing leave integration tests outside disposable CI PostgreSQL');
 const pool=new Pool({connectionString:url.toString(),max:8,connectionTimeoutMillis:5000});
 let server;
 try{
  const suffix=crypto.randomBytes(5).toString('hex');
  async function school(prefix){
   const id=(await pool.query('INSERT INTO schools(school_code,school_name) VALUES($1,$2) RETURNING school_id',
    [prefix+suffix,'Synthetic leave regression only'])).rows[0].school_id;
   const dep=(await pool.query("INSERT INTO school_departments(school_id,department_code,department_name) VALUES($1,'TEST','Test Department') RETURNING department_id",[id])).rows[0].department_id;
   return {id,dep};
  }
  async function staff(s,role,name){
   const id=(await pool.query(`INSERT INTO school_users(school_id,department_id,username,display_name,password_hash,role,teacher_designations)
    VALUES($1,$2,$3,$4,'synthetic-no-password-login',$5,CASE WHEN $5='TEACHER' THEN ARRAY['SUBJECT_TEACHER']::text[] ELSE ARRAY[]::text[] END) RETURNING user_id`,
    [s.id,s.dep,name+suffix,name,role])).rows[0].user_id;
   const token=createOpaqueToken();
   await pool.query("INSERT INTO user_sessions(token_hash,principal_type,school_id,school_user_id,expires_at) VALUES($1,'SCHOOL',$2,$3,NOW()+INTERVAL '10 minutes')",
    [hashToken(token),s.id,id]);
   return {id,token};
  }
  const a=await school('LEAVE_A_'),b=await school('LEAVE_B_');
  const teacher=await staff(a,'TEACHER','teacher'),head=await staff(a,'DEPARTMENT_HEAD','head'),principal=await staff(a,'PRINCIPAL','principal'),admin=await staff(a,'SCHOOL_ADMIN','admin'),outsider=await staff(b,'PRINCIPAL','outsider');
  const hours={AM_IN:'08:00',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'17:00'};
  await pool.query("INSERT INTO staff_form48_school_defaults(school_id,workdays,regular_hours,saturday_hours,updated_by_user_id) VALUES($1,ARRAY[0,1,2,3,4,5,6]::smallint[],$2::jsonb,$2::jsonb,$3)",[a.id,JSON.stringify(hours),admin.id]);
  await pool.query("INSERT INTO staff_leave_credit_schemes(school_id,staff_user_id,leave_scheme,hr_reference,certified_by_user_id) VALUES($1,$2,'TEACHING_VSC','TEST-HR',$3)",[a.id,teacher.id,admin.id]);
  await pool.query("INSERT INTO staff_leave_credit_entries(school_id,staff_user_id,credit_account,entry_kind,signed_days,status,entered_by_user_id,verified_by_user_id,verified_at,approval_reference) VALUES($1,$2,'VSC','OPENING',10,'VERIFIED',$3,$3,NOW(),'TEST-OPENING')",[a.id,teacher.id,admin.id]);
  const app=express();app.use(express.json());
  const auth=createAuthMiddleware(pool);
  registerStaffLeaveRoutes(app,pool,auth);registerStaffLeaveInboxRoutes(app,pool,auth);registerForm48ReviewRoutes(app,pool,auth);registerGateOfflineRoutes(app,pool,auth);
  server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.on('error',reject);});
  const root='http://127.0.0.1:'+server.address().port;
  const leave='/api/staff-leave/requests';
  async function call(actor,path,method='GET',body=null,extra={}){
   const headers={Authorization:'Bearer '+actor.token,...extra};
   if(body!==null&&!Buffer.isBuffer(body))headers['Content-Type']='application/json';
   const r=await fetch(root+path,{method,headers,body:body===null?undefined:Buffer.isBuffer(body)?body:JSON.stringify(body)});
   return {code:r.status,body:await r.json().catch(()=>({}))};
  }
  function expect(r,code){assert.equal(r.code,code,JSON.stringify(r.body));return r.body;}
  async function balance(){return Number((await pool.query("SELECT SUM(signed_days) AS n FROM staff_leave_credit_entries WHERE school_id=$1 AND staff_user_id=$2 AND credit_account='VSC' AND status='VERIFIED'",[a.id,teacher.id])).rows[0].n);}
  async function record(id){return (await pool.query("SELECT status,revision,certified_working_days,end_date::text,form48_leave_id FROM staff_leave_requests WHERE school_id=$1 AND request_id=$2",[a.id,id])).rows[0];}
  async function upload(actor,id,kind){
   return expect(await call(actor,leave+'/'+id+'/documents','POST',Buffer.from('%PDF-1.4\nSynthetic CI fixture, not an official document\n%%EOF'),{'Content-Type':'application/pdf','X-Document-Kind':kind,'X-Filename':'synthetic-ci.pdf'}),201).documentId;
  }
  const approval={decision:'APPROVE',approvalReference:'TEST-SIGNED-APPROVAL',approverName:'Synthetic Principal',approverPosition:'Principal',approvedOn:'2026-11-26'};
  const base={leaveType:'VSC',creditAccount:'VSC',reason:'Synthetic integration fixture only'};
  async function submit(startDate,endDate,leaveSession){
   const result=expect(await call(teacher,leave,'POST',{...base,startDate,endDate,leaveSession}),201);
   assert.equal(result.status,'PENDING_HEAD');
   expect(await call(head,leave+'/'+result.requestId+'/recommend','POST',{decision:'FORWARD',note:'Synthetic recommendation'}),200);
   await upload(principal,result.requestId,'APPROVAL');
   return result.requestId;
  }
  const date='2026-11-25',month=date.slice(0,7);
  const id=await submit(date,date,'AM');
  expect(await call(outsider,leave+'/'+id+'/external-decision','POST',{...approval,certifiedWorkingDays:0.5}),404);
  expect(await call(teacher,leave+'/'+id+'/external-decision','POST',{...approval,certifiedWorkingDays:0.5}),403);
  expect(await call(principal,leave+'/'+id+'/external-decision','POST',{...approval,certifiedWorkingDays:1}),409);
  assert.equal(await balance(),10);
  expect(await call(principal,leave+'/'+id+'/external-decision','POST',{...approval,certifiedWorkingDays:0.5}),200);
  assert.equal(await balance(),9.5);
  const original=await record(id);
  const saved=(await pool.query("SELECT leave_session,session_start::text,session_end::text FROM staff_form48_approved_leaves WHERE school_id=$1 AND leave_id=$2",[a.id,original.form48_leave_id])).rows[0];
  assert.equal(saved.leave_session,'AM');assert.equal(saved.session_start,'08:00:00');assert.equal(saved.session_end,'12:00:00');
  assert.equal(await partialDutySlotAllowed(pool,a.id,teacher.id,date,'PM_IN',new Date(date+'T13:10:00+08:00')),true);
  assert.equal(await partialDutySlotAllowed(pool,a.id,teacher.id,date,'AM_IN',new Date(date+'T08:00:00+08:00')),false);
  for(const [slot,time] of [['PM_IN','13:10'],['PM_OUT','17:00']]){
   await pool.query("INSERT INTO staff_attendance_events(school_id,staff_user_id,event_kind,dtr_slot,school_date,occurred_at,source,verification_status,verification_method,actor_user_id,client_event_key) VALUES($1,$2,'DTR_SLOT',$3,$4::date,($4::date+$5::time) AT TIME ZONE 'Asia/Manila','AUTHORIZED_CORRECTION','VERIFIED','MANUAL_REVIEW',$6,$7)",
    [a.id,teacher.id,slot,date,time,head.id,crypto.randomUUID()]);
  }
  const reportPath='/api/staff-attendance/admin/form48/analysis?staffUserId='+teacher.id+'&month='+month;
  const report=expect(await call(admin,reportPath),200);
  const assessment=report.assessments.find(x=>x.date===date);
  assert.equal(assessment.status,'PARTIAL_APPROVED_LEAVE');assert.equal(assessment.lateMinutes,10);
  assert.equal(report.summary.approvedLeaveDays,0.5);assert.equal(report.summary.daysPresent,0.5);
  assert.match(report.approvedLeaveRemarks[0].text,/AM half-day/);
  const doc=await upload(principal,id,'REVISION');
  const revise={decision:'CANCEL',approvalReference:'TEST-SIGNED-CANCEL',reason:'Synthetic cancellation',documentId:doc,revision:original.revision,approvedOn:'2026-11-26',approverName:'Synthetic Principal',approverPosition:'Principal',evidenceVerified:true};
  expect(await call(head,leave+'/'+id+'/revision','POST',revise),403);
  const results=await Promise.all([call(principal,leave+'/'+id+'/revision','POST',revise),call(principal,leave+'/'+id+'/revision','POST',revise)]);
  assert.equal(results.filter(x=>x.code===200).length,1,JSON.stringify(results));
  assert.ok(results.some(x=>x.code===403||x.code===409));
  assert.equal(results.find(x=>x.code===200).body.restoredDays,0.5);
  assert.equal(await balance(),10);
  assert.equal((await record(id)).status,'CANCELLED');
  assert.equal(Number((await pool.query('SELECT count(*) AS n FROM staff_leave_revisions WHERE school_id=$1 AND request_id=$2',[a.id,id])).rows[0].n),1);
  const postCancel=expect(await call(admin,reportPath),200);
  assert.equal(postCancel.summary.approvedLeaveDays,0);
  assert.equal(postCancel.assessments.find(x=>x.date===date).verifiedCount,2);
  const full=await submit('2026-11-16','2026-11-20','FULL');
  expect(await call(principal,leave+'/'+full+'/external-decision','POST',{...approval,certifiedWorkingDays:5}),200);
  assert.equal(await balance(),5);
  const before=await record(full),revisionDoc=await upload(principal,full,'REVISION');
  const shorten={...revise,decision:'SHORTEN',approvalReference:'TEST-SIGNED-SHORTEN',reason:'Synthetic early return',documentId:revisionDoc,revision:before.revision,endDate:'2026-11-18',certifiedWorkingDays:3};
  expect(await call(principal,leave+'/'+full+'/revision','POST',{...shorten,endDate:'2026-11-21'}),409);
  assert.equal(await balance(),5);
  const shortened=expect(await call(principal,leave+'/'+full+'/revision','POST',shorten),200);
  assert.equal(shortened.restoredDays,2);assert.equal(await balance(),7);
  const after=await record(full);assert.equal(after.end_date,'2026-11-18');assert.equal(Number(after.certified_working_days),3);assert.notEqual(after.form48_leave_id,before.form48_leave_id);
  const old=(await pool.query('SELECT revoked_at FROM staff_form48_approved_leaves WHERE school_id=$1 AND leave_id=$2',[a.id,before.form48_leave_id])).rows[0];assert.ok(old.revoked_at);
  expect(await call(principal,leave+'/'+full+'/revision','POST',{...shorten,revision:after.revision,endDate:'2026-11-17',certifiedWorkingDays:2}),409);
  assert.equal(await balance(),7);
  assert.equal(Number((await pool.query("SELECT count(*) AS n FROM staff_attendance_events WHERE school_id=$1 AND staff_user_id=$2 AND event_kind='DTR_SLOT'",[a.id,teacher.id])).rows[0].n),2);
  console.log('Authenticated leave approval, half-day duty and DTR, cancellation race, shortening, tenant scope and immutable evidence: PASS');
  // Actual authenticated offline intake, duplicate reconciliation, queue review
  // and Form 48 projection on a disposable PostgreSQL database, never a live school.
  const keeper=await staff(a,'GATE_KEEPER','gatekeeper');
  const otherKeeper=await staff(b,'GATE_KEEPER','otherkeeper');
  const otherAdmin=await staff(b,'SCHOOL_ADMIN','otheradmin');
  const badge=crypto.randomUUID();
  await pool.query('UPDATE school_users SET teacher_qr_token=$3 WHERE school_id=$1 AND user_id=$2',[a.id,teacher.id,badge]);
  const yesterday=new Date(Date.now()-86400000);
  const localDay=manilaSchoolDate(yesterday);
  const captured=new Date(localDay+'T08:00:00+08:00').toISOString();
  const monthOfCapture=localDay.slice(0,7);
  const analysisPath='/api/staff-attendance/admin/form48/analysis?staffUserId='+teacher.id+'&month='+monthOfCapture;
  const baseline=expect(await call(admin,analysisPath),200);
  const beforeDay=baseline.assessments.find(x=>x.date===localDay);
  assert.equal(beforeDay.offlineReview,false);
  const eventId=crypto.randomUUID(),event={eventId,qr:'TCH:'+badge,capturedAtDevice:captured};
  const reconcile='/api/gate/offline/reconcile',review='/api/gate/offline/review';
  expect(await call(teacher,reconcile,'POST',{events:[event]}),403);
  const copies=await Promise.all([call(keeper,reconcile,'POST',{events:[event]}),call(keeper,reconcile,'POST',{events:[event]})]);
  for(const copy of copies)expect(copy,200);
  assert.deepEqual(copies.map(x=>x.body.results[0].status).sort(),['ALREADY_RECEIVED','REVIEW_REQUIRED']);
  assert.ok(copies.every(x=>x.body.officialAttendance===false));
  expect(await call(otherKeeper,reconcile,'POST',{events:[event]}),409);
  expect(await call(keeper,reconcile,'POST',{events:[{...event,capturedAtDevice:new Date(Date.parse(captured)+60000).toISOString()}]}),409);
  const observation=expect(await call(admin,review),200).items.find(x=>x.eventId===eventId);
  assert.equal(observation.deviceSchoolDate,localDay);
  assert.equal(observation.direction,'UNKNOWN');
  assert.equal(observation.sameDateVerifiedSlots,beforeDay.verifiedCount);
  assert.match(observation.clockWarning,/different Manila school date/);
  assert.ok(!expect(await call(otherAdmin,review),200).items.some(x=>x.eventId===eventId));
  const pending=expect(await call(admin,analysisPath),200);
  const pendingDay=pending.assessments.find(x=>x.date===localDay);
  assert.equal(pendingDay.offlineReview,true);
  assert.equal(pendingDay.needsReview,true);
  assert.equal(pendingDay.verifiedCount,beforeDay.verifiedCount);
  for(const key of ['daysPresent','approvedLeaveDays','tardyMinutes','undertimeMinutes'])assert.equal(pending.summary[key],baseline.summary[key],key);
  assert.equal(pending.summary.offlineReviewDays,baseline.summary.offlineReviewDays+1);
  const outcome={status:'CLOSED_REVIEWED',note:'Synthetic logbook comparison; no new official punch'};
  expect(await call(keeper,review+'/'+eventId,'POST',outcome),403);
  expect(await call(otherAdmin,review+'/'+eventId,'POST',outcome),409);
  expect(await call(admin,review+'/'+eventId,'POST',outcome),200);
  expect(await call(admin,review+'/'+eventId,'POST',outcome),409);
  const closed=expect(await call(admin,analysisPath),200);
  assert.equal(closed.assessments.find(x=>x.date===localDay).offlineReview,false);
  assert.equal(closed.assessments.find(x=>x.date===localDay).verifiedCount,beforeDay.verifiedCount);
  assert.deepEqual(closed.summary,baseline.summary);
  assert.equal(Number((await pool.query('SELECT count(*) AS n FROM offline_gate_observations WHERE school_id=$1 AND event_id=$2',[a.id,eventId])).rows[0].n),1);
  assert.equal(Number((await pool.query("SELECT count(*) AS n FROM staff_attendance_events WHERE school_id=$1 AND staff_user_id=$2 AND event_kind='DTR_SLOT'",[a.id,teacher.id])).rows[0].n),2);
  assert.equal(await balance(),7);
  console.log('Authenticated offline-to-Form48 simulation: next-day date, concurrent retries, altered replay, tenant and role isolation, review flag closure, unchanged punches and credits: PASS');

 }finally{if(server)await new Promise(resolve=>server.close(resolve));await pool.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
