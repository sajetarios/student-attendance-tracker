'use strict';
const {randomUUID,createHash}=require('node:crypto');
const express=require('express');
const {parseRequest,positiveDays,dateOk,canView,nextStatus,allowReviewer}=require('./staff-leave-policy');
const {notifyLeaveTransition}=require('./staff-leave-inbox');
const {SCHEMES,manilaToday,sickFilingBasis,sickAccountForScheme,requiredSickEvidence}=
 require('./staff-leave-deped-sick');
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const ROLES=['TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN'];
const sqlErr=(res,error)=>{console.error('DepEd leave workflow:',error.message);return res.status(503).json({error:'Leave management is temporarily unavailable. No attendance record was modified.'});};
function registerStaffLeaveRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 const auth=[authenticateSchoolClient,requireSchoolRoles(...ROLES)];
 const audit=(c,req,action,id,details)=>c.query(
  'INSERT INTO staff_attendance_audit(school_id,actor_user_id,action,target_type,target_id,details) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
  [req.auth.schoolId,req.auth.userId,action,'STAFF_LEAVE_REQUEST',id,JSON.stringify(details)]);
 const rosterSql='SELECT r.*,u.role AS requester_role,u.display_name AS staff_name, u.teacher_position AS staff_position, u.department_id AS current_department_id, s.school_name, d.department_name '+
  'FROM staff_leave_requests r JOIN school_users u ON u.school_id=r.school_id AND u.user_id=r.staff_user_id '+
  'JOIN schools s ON s.school_id=r.school_id LEFT JOIN school_departments d ON d.school_id=r.school_id AND d.department_id=r.department_id ';
 const find=async(c,req,id,lock=false)=>{
  const q=await c.query(rosterSql+' WHERE r.school_id=$1 AND r.request_id=$2'+(lock?' FOR UPDATE OF r':''),
   [req.auth.schoolId,id]);
  return q.rows[0]||null;
 };
 async function getStaff(req,res,id,lock=false,c=pool){
  if(!UUID.test(id)){res.status(400).json({error:'Valid request ID required.'});return null;}
  const row=await find(c,req,id,lock);
  if(!row){res.status(404).json({error:'Leave request not found.'});return null;}
  if(!canView(req.auth.role,req.auth.userId,req.auth.departmentId,row) &&
     !(req.auth.role==='DEPARTMENT_HEAD'&&row.requester_role==='SCHOOL_ADMIN'&&row.status==='PENDING_EXTERNAL')){
   res.status(403).json({error:'Leave request is outside your permitted scope.'});return null;
  }
  return row;
 }
 const printable=r=>({
  requestId:r.request_id,staffUserId:r.staff_user_id,staffName:r.staff_name,staffRole:r.requester_role,
  staffPosition:r.staff_position||'',departmentName:r.department_name||'',schoolName:r.school_name,
  leaveType:r.leave_type,creditAccount:r.credit_account,startDate:r.start_date,
  endDate:r.end_date,reason:r.reason,details:r.details,commutation:r.commutation,
  status:r.status,filingBasis:r.filing_basis||'STANDARD',submittedAt:r.submitted_at,headNote:r.head_note||'',
  adminNote:r.admin_note||'',certifiedWorkingDays:r.certified_working_days,
  externalReference:r.external_reference||'',externalApprover:r.external_approver||'',
  externalApproverPosition:r.external_approver_position||'',externalApprovedOn:r.external_approved_on,
  headReviewedAt:r.head_decided_at,adminReviewedAt:r.admin_reviewed_at,
  verifiedAt:r.verified_at,revision:r.revision
 });
 app.get('/api/staff-leave/my/status',...auth,async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  try{
   const leave=await require('./staff-approved-leave-status').getStaffLeaveStatus(
    pool,req.auth.schoolId,req.auth.userId);
   return res.json({leave});
  }catch(error){return sqlErr(res,error);}
 });
 app.get('/api/staff-leave/requests',...auth,async(req,res)=>{
  try{
   let where='WHERE r.school_id=$1',args=[req.auth.schoolId];
   if(req.auth.role==='TEACHER'){where+=' AND r.staff_user_id=$2';args.push(req.auth.userId);}
   if(req.auth.role==='DEPARTMENT_HEAD'){
    where+=' AND (r.staff_user_id=$2 OR r.department_id=$3 OR (u.role=\'SCHOOL_ADMIN\' AND r.status=\'PENDING_EXTERNAL\'))';
    args.push(req.auth.userId,req.auth.departmentId||null);
   }
   const rows=await pool.query(rosterSql+' '+where+' ORDER BY r.submitted_at DESC LIMIT 200',args);
   res.json({requests:rows.rows.map(printable)});
  }catch(e){sqlErr(res,e);}
 });
 app.get('/api/staff-leave/overlaps',...auth,async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  if(req.auth.role!=='SCHOOL_ADMIN')
   return res.status(403).json({error:'Only the school administrator may review school-wide leave attendance overlaps.'});
  const date=String(req.query?.date||require('./staff-lunch-routes').manilaDate());
  if(!dateOk(date))return res.status(400).json({error:'Select a valid Philippine school date.'});
  try{
   // A physical visit during approved leave is an audit exception, not proof
   // of return to duty and never an automatic DTR time punch.
   const data=await pool.query(
    "WITH movement AS ("+
    " SELECT e.staff_user_id AS staff_id,e.occurred_at FROM staff_attendance_events e "+
    " WHERE e.school_id=$1 AND e.school_date=$2::date AND e.event_kind='GATE_MOVEMENT' "+
    "   AND e.verification_status='VERIFIED' "+
    " UNION ALL SELECT t.teacher_user_id,t.occurred_at FROM teacher_gate_events t "+
    " WHERE t.school_id=$1 AND t.school_date=$2::date AND t.photo_verified=TRUE "+
    "   AND NOT EXISTS (SELECT 1 FROM staff_attendance_events e WHERE e.school_id=t.school_id "+
    "    AND e.legacy_gate_event_id=t.event_id)) "+
    " SELECT m.staff_id AS \"staffUserId\",u.display_name AS \"staffName\", "+
    " COUNT(*)::int AS \"movementCount\", "+
    " to_char(MIN(m.occurred_at) AT TIME ZONE 'Asia/Manila','HH24:MI') AS \"firstMovement\", "+
    " to_char(MAX(m.occurred_at) AT TIME ZONE 'Asia/Manila','HH24:MI') AS \"lastMovement\" "+
    " FROM movement m JOIN school_users u ON u.school_id=$1 AND u.user_id=m.staff_id "+
    " WHERE EXISTS(SELECT 1 FROM staff_form48_approved_leaves l "+
    " WHERE l.school_id=$1 AND l.staff_user_id=m.staff_id AND l.revoked_at IS NULL "+
    " AND l.start_date<=$2::date AND l.end_date>=$2::date) "+
    " GROUP BY m.staff_id,u.display_name ORDER BY u.display_name LIMIT 100",
    [req.auth.schoolId,date]);
   return res.json({schoolDate:date,overlaps:data.rows,
    notice:'Read-only exception list. Original gate movements and approved leave remain unchanged.'});
  }catch(err){return sqlErr(res,err);}
 });
 app.get('/api/staff-leave/requests/:id/form6',...auth,async(req,res)=>{
  try{
   const row=await getStaff(req,res,req.params.id);
   if(!row)return;
   // This is a prefill dataset. Any missing salary, balances, or signatures remain blank.
   const credits=await pool.query('SELECT credit_account,COALESCE(SUM(signed_days) FILTER(WHERE status=\'VERIFIED\'),0) AS balance FROM staff_leave_credit_entries WHERE school_id=$1 AND staff_user_id=$2 GROUP BY credit_account',
    [req.auth.schoolId,row.staff_user_id]);
   const days=await pool.query(
    'SELECT COUNT(*)::int AS estimated FROM generate_series($2::date,$3::date,interval \'1 day\') AS dates(day) '+
    'LEFT JOIN school_operating_days op ON op.school_id=$1 AND op.weekday=EXTRACT(DOW FROM dates.day)::int '+
    'LEFT JOIN school_calendar_exceptions ce ON ce.school_id=$1 AND ce.calendar_date=dates.day::date '+
    "WHERE (COALESCE(op.is_operating_day,FALSE)=TRUE OR ce.exception_type IN ('OPEN','SPECIAL_CLASS','SHORTENED_DAY')) " +
    "AND ce.exception_type IS DISTINCT FROM 'CLOSED'",
    [req.auth.schoolId,row.start_date,row.end_date]);
   res.json({formVersion:'CS Form No. 6 Revised 2020',request:printable(row),estimatedSchoolWorkingDays:days.rows[0].estimated,
    credits:credits.rows,applicantSignature:null,certifyingOfficerSignature:null,
    recommendingOfficerSignature:null,approvingOfficerSignature:null,
    officialMonthlySalary:null});
  }catch(e){sqlErr(res,e);}
 });
 // The employee cannot self-certify a leave scheme. Roles such as TEACHER or
 // DEPARTMENT_HEAD do not prove a VSC entitlement or any reassignment.
 app.get('/api/staff-leave/my/credit-scheme',...auth,async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  try{
   const q=await pool.query('SELECT leave_scheme AS "leaveScheme",hr_reference AS "hrReference",certified_at AS "certifiedAt" FROM staff_leave_credit_schemes WHERE school_id=$1 AND staff_user_id=$2',
    [req.auth.schoolId,req.auth.userId]);
   res.json({leaveScheme:q.rows[0]?.leaveScheme||'UNVERIFIED',
    hrReference:q.rows[0]?.hrReference||null,certifiedAt:q.rows[0]?.certifiedAt||null});
  }catch(e){sqlErr(res,e);}
 });
 app.post('/api/staff-leave/staff/:id/credit-scheme',...auth,async(req,res)=>{
  if(req.auth.role!=='SCHOOL_ADMIN')return res.status(403).json({error:'Authorized School HR access required.'});
  const staffId=String(req.params.id||''),leaveScheme=String(req.body?.leaveScheme||''),
   hrReference=String(req.body?.hrReference||'').trim();
  if(!UUID.test(staffId)||!SCHEMES.includes(leaveScheme)||hrReference.length<3||hrReference.length>200)
   return res.status(400).json({error:'Select an HR-verified scheme and enter the official personnel document reference.'});
  if(staffId===req.auth.userId)
   return res.status(403).json({error:'An employee cannot certify their own leave entitlement. Ask another authorized officer.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const target=await client.query(
    "SELECT 1 FROM school_users WHERE school_id=$1 AND user_id=$2 AND active=TRUE AND role IN ('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN','GATE_KEEPER') FOR SHARE",
    [req.auth.schoolId,staffId]);
   if(!target.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Active staff member not found in this school.'});}
   await client.query('INSERT INTO staff_leave_credit_schemes(school_id,staff_user_id,leave_scheme,hr_reference,certified_by_user_id,certified_at) VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT(school_id,staff_user_id) DO UPDATE SET leave_scheme=EXCLUDED.leave_scheme,hr_reference=EXCLUDED.hr_reference,certified_by_user_id=EXCLUDED.certified_by_user_id,certified_at=now()',
    [req.auth.schoolId,staffId,leaveScheme,hrReference,req.auth.userId]);
   await audit(client,req,'LEAVE_CREDIT_SCHEME_CERTIFIED',staffId,{staffUserId:staffId,leaveScheme,hrReference});
   await client.query('COMMIT');
   res.json({leaveScheme,status:'HR_VERIFIED',notice:'Employee leave scheme certified. No leave credits or DTR punches were changed.'});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});sqlErr(res,e);}finally{client.release();}
 });
 app.post('/api/staff-leave/requests',...auth,async(req,res)=>{
  const input=parseRequest(req.body);
  if(!input)return res.status(400).json({error:'Enter a valid leave type, credit account, reason, and dates (up to 367 calendar days).'});
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.auth.schoolId+':leave:'+req.auth.userId]);
   const staff=await c.query('SELECT department_id,role,active FROM school_users WHERE school_id=$1 AND user_id=$2 FOR UPDATE',
    [req.auth.schoolId,req.auth.userId]);
   if(!staff.rowCount||!staff.rows[0].active){await c.query('ROLLBACK');return res.status(403).json({error:'An active school employee account is required.'});}
   const overlaps=await c.query('SELECT request_id FROM staff_leave_requests WHERE school_id=$1 AND staff_user_id=$2 AND status NOT IN (\'REJECTED\',\'CANCELLED\') AND start_date<=$4::date AND end_date>=$3::date LIMIT 1',
    [req.auth.schoolId,req.auth.userId,input.startDate,input.endDate]);
   const old=await c.query('SELECT leave_id FROM staff_form48_approved_leaves WHERE school_id=$1 AND staff_user_id=$2 AND revoked_at IS NULL AND start_date<=$4::date AND end_date>=$3::date LIMIT 1',
    [req.auth.schoolId,req.auth.userId,input.startDate,input.endDate]);
   if(overlaps.rowCount||old.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'An overlapping leave request or recorded approval already exists.'});}
   const heads=await c.query('SELECT 1 FROM school_users WHERE school_id=$1 AND department_id=$2 AND role=\'DEPARTMENT_HEAD\' AND user_id<>$3 AND active=TRUE LIMIT 1',
    [req.auth.schoolId,staff.rows[0].department_id,req.auth.userId]);
   const scheme=await c.query('SELECT leave_scheme AS "leaveScheme" FROM staff_leave_credit_schemes WHERE school_id=$1 AND staff_user_id=$2',
     [req.auth.schoolId,req.auth.userId]);
   const filingBasis=sickFilingBasis(input.leaveType,input.startDate,input.endDate,manilaToday());
   const creditAccount=input.leaveType==='SICK'
    ?(sickAccountForScheme(scheme.rows[0]?.leaveScheme)||'NONE'):input.creditAccount;
   const status=nextStatus(req.auth.role,heads.rowCount>0),id=randomUUID();
   await c.query('INSERT INTO staff_leave_requests(request_id,school_id,staff_user_id,department_id,leave_type,credit_account,start_date,end_date,reason,details,commutation,status,filing_basis) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
    [id,req.auth.schoolId,req.auth.userId,staff.rows[0].department_id,input.leaveType,creditAccount,
     input.startDate,input.endDate,input.reason,input.details,input.commutation,status,filingBasis]);
   await audit(c,req,'LEAVE_SUBMITTED',id,{status,dates:[input.startDate,input.endDate],creditAccount,filingBasis});
   await notifyLeaveTransition(c,{schoolId:req.auth.schoolId,requestId:id,staffUserId:req.auth.userId,
    departmentId:staff.rows[0].department_id,requesterRole:staff.rows[0].role,status});
   await c.query('COMMIT');
   res.status(201).json({requestId:id,status,creditAccount,filingBasis,
    notice:filingBasis==='POST_RETURN'
     ?'Sick leave filed upon return for earlier absence dates. HR and the authorized approving official must review the documents and credits. DTR remains pending.'
     :'Leave submitted for review. The DTR is unchanged until official approval is verified.'});
  }catch(e){await c.query('ROLLBACK').catch(()=>{});sqlErr(res,e);}
  finally{c.release();}
 });
 async function stagedDecision(req,res,step){
  const decision=String(req.body?.decision||'').toUpperCase(),note=String(req.body?.note||'').trim();
  if(!UUID.test(req.params.id)||!['FORWARD','REJECT'].includes(decision)||note.length>1000)
   return res.status(400).json({error:'Valid request, FORWARD/REJECT decision, and short note required.'});
  if(decision==='REJECT'&&note.length<3)return res.status(400).json({error:'Give a reason when recommending disapproval.'});
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   const row=await getStaff(req,res,req.params.id,true,c);
   if(!row){await c.query('ROLLBACK');return;}
   if(!allowReviewer(req.auth.role,req.auth.userId,req.auth.departmentId,row,step)){
    await c.query('ROLLBACK');return res.status(403).json({error:'This request cannot be reviewed at your level or by its applicant.'});
   }
   // Department and school HR recommendations are not final administrative decisions.
   const status=step==='HEAD'?'PENDING_ADMIN':'PENDING_EXTERNAL';
   const col=step==='HEAD'?'head_user_id=$4,head_decided_at=NOW(),head_note=$5':
    'admin_user_id=$4,admin_reviewed_at=NOW(),admin_note=$5';
   await c.query('UPDATE staff_leave_requests SET status=$3,'+col+',revision=revision+1 WHERE school_id=$1 AND request_id=$2',
    [req.auth.schoolId,req.params.id,status,req.auth.userId,note]);
   await audit(c,req,'LEAVE_'+step+'_REVIEWED',req.params.id,{decision,status});
   await notifyLeaveTransition(c,{schoolId:req.auth.schoolId,requestId:row.request_id,
    staffUserId:row.staff_user_id,departmentId:row.department_id,requesterRole:row.requester_role,status});
   await c.query('COMMIT');res.json({requestId:req.params.id,status});
  }catch(e){await c.query('ROLLBACK').catch(()=>{});sqlErr(res,e);}
  finally{c.release();}
 }
 app.post('/api/staff-leave/requests/:id/recommend',...auth,(req,res)=>stagedDecision(req,res,'HEAD'));
 app.post('/api/staff-leave/requests/:id/admin-review',...auth,(req,res)=>stagedDecision(req,res,'ADMIN'));
 app.post('/api/staff-leave/requests/:id/external-decision',...auth,async(req,res)=>{
  const decision=String(req.body?.decision||'').toUpperCase(),
   reference=String(req.body?.approvalReference||'').trim(),
   approver=String(req.body?.approverName||'').trim(),
   position=String(req.body?.approverPosition||'').trim(),
   approvedOn=String(req.body?.approvedOn||''),
   days=positiveDays(req.body?.certifiedWorkingDays),
   note=String(req.body?.note||'').trim();
  if(!UUID.test(req.params.id)||!['APPROVE','REJECT'].includes(decision)||
    reference.length<3||reference.length>120||approver.length<3||approver.length>120||
    position.length<3||position.length>120||!dateOk(approvedOn)||note.length>1000||
    (decision==='APPROVE'&&!days))
   return res.status(400).json({error:'Official decision, date, document reference, approving official/position, and certified working days are required.'});
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   const row=await getStaff(req,res,req.params.id,true,c);
   if(!row){await c.query('ROLLBACK');return;}
   if(!allowReviewer(req.auth.role,req.auth.userId,req.auth.departmentId,row,'EXTERNAL')){
    await c.query('ROLLBACK');return res.status(403).json({error:'External approval must be recorded by another authorized school officer.'});
   }
   if(decision==='REJECT'){
    await c.query('UPDATE staff_leave_requests SET status=\'REJECTED\',external_reference=$3,external_approver=$4,external_approver_position=$5,external_approved_on=$6,verified_by_user_id=$7,verified_at=now(),revision=revision+1 WHERE school_id=$1 AND request_id=$2',
     [req.auth.schoolId,row.request_id,reference,approver,position,approvedOn,req.auth.userId]);
    await audit(c,req,'LEAVE_EXTERNAL_DISAPPROVED',row.request_id,{approvalReference:reference});
    await notifyLeaveTransition(c,{schoolId:req.auth.schoolId,requestId:row.request_id,
     staffUserId:row.staff_user_id,departmentId:row.department_id,requesterRole:row.requester_role,status:'REJECTED'});
    await c.query('COMMIT');
    return res.json({status:'REJECTED',notice:'External disapproval recorded. Attendance remains unchanged.'});
   }
   // Sick leave may be submitted upon return. The final official decision,
   // not the applicant's proposal or dashboard role, establishes the charge.
   let chargeAccount=row.credit_account;
   if(row.leave_type==='SICK'){
    const verifiedScheme=await c.query('SELECT leave_scheme AS "leaveScheme" FROM staff_leave_credit_schemes WHERE school_id=$1 AND staff_user_id=$2',
     [req.auth.schoolId,row.staff_user_id]);
    chargeAccount=sickAccountForScheme(verifiedScheme.rows[0]?.leaveScheme);
    if(!chargeAccount){await c.query('ROLLBACK');
     return res.status(409).json({error:'HR must verify whether this employee uses teaching-personnel VSC or regular VL/SL before recording official sick-leave approval.'});}
    if(requiredSickEvidence(row.leave_type,row.filing_basis,row.start_date,row.end_date)){
     const supporting=await c.query("SELECT 1 FROM staff_leave_documents WHERE school_id=$1 AND request_id=$2 AND document_kind IN ('MEDICAL','AFFIDAVIT') LIMIT 1",
      [req.auth.schoolId,row.request_id]);
     if(!supporting.rowCount){await c.query('ROLLBACK');
      return res.status(409).json({error:'Advance-filed sick leave or illness exceeding five consecutive days requires a medical certificate, or an appropriate sworn affidavit where medical consultation was not obtained. HR must check the document.'});}
    }
   }
   const attachment=await c.query("SELECT 1 FROM staff_leave_documents WHERE school_id=$1 AND request_id=$2 AND document_kind='APPROVAL' LIMIT 1",[req.auth.schoolId,row.request_id]);
   if(!attachment.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'Attach the official signed approval (PDF/JPG/PNG) before certifying leave.'});}
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.auth.schoolId+':leave:'+row.staff_user_id]);
   const overlap=await c.query('SELECT 1 FROM staff_form48_approved_leaves WHERE school_id=$1 AND staff_user_id=$2 AND revoked_at IS NULL AND start_date<=$4::date AND end_date>=$3::date LIMIT 1',
    [req.auth.schoolId,row.staff_user_id,row.start_date,row.end_date]);
   if(overlap.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'Overlapping official leave exists. Reconcile before recording approval.'});}
   if(chargeAccount!=='NONE'){
    const balance=await c.query('SELECT COALESCE(SUM(signed_days),0)::numeric AS days FROM staff_leave_credit_entries WHERE school_id=$1 AND staff_user_id=$2 AND credit_account=$3 AND status=\'VERIFIED\'',
     [req.auth.schoolId,row.staff_user_id,chargeAccount]);
    if(Number(balance.rows[0].days)+1e-8<days){await c.query('ROLLBACK');return res.status(409).json({error:'Insufficient HR-certified '+chargeAccount+' balance. Verify entitlement and officially earned credits before approving.'});}
    await c.query('INSERT INTO staff_leave_credit_entries(school_id,staff_user_id,credit_account,entry_kind,signed_days,request_id,status,entered_by_user_id,verified_by_user_id,verified_at,approval_reference) VALUES($1,$2,$3,\'USED\',$4,$5,\'VERIFIED\',$6,$6,now(),$7)',
     [req.auth.schoolId,row.staff_user_id,chargeAccount,-days,row.request_id,req.auth.userId,reference]);
   }
   const form48id=randomUUID();
   await c.query('INSERT INTO staff_form48_approved_leaves(leave_id,school_id,staff_user_id,leave_type,start_date,end_date,approval_reference,recorded_by_user_id,credit_account) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [form48id,req.auth.schoolId,row.staff_user_id,row.leave_type,row.start_date,row.end_date,reference,req.auth.userId,chargeAccount]);
   await c.query('UPDATE staff_leave_requests SET status=\'APPROVED\',certified_working_days=$3,external_reference=$4,external_approver=$5,external_approver_position=$6,external_approved_on=$7,verified_by_user_id=$8,verified_at=now(),form48_leave_id=$9,credit_account=$10,revision=revision+1 WHERE school_id=$1 AND request_id=$2',
    [req.auth.schoolId,row.request_id,days,reference,approver,position,approvedOn,req.auth.userId,form48id,chargeAccount]);
   await audit(c,req,'LEAVE_EXTERNAL_APPROVED',row.request_id,{approvalReference:reference,chargedDays:days,creditAccount:chargeAccount,filingBasis:row.filing_basis,form48LeaveId:form48id});
   await notifyLeaveTransition(c,{schoolId:req.auth.schoolId,requestId:row.request_id,
    staffUserId:row.staff_user_id,departmentId:row.department_id,requesterRole:row.requester_role,status:'APPROVED'});
   await c.query('COMMIT');
   res.json({status:'APPROVED',creditAccount:chargeAccount,
    notice:chargeAccount==='VSC'&&row.leave_type==='SICK'
     ?'Documented sick leave approved; HR-certified VSC charged and VSCA Form 48 remarks recorded. Gate/DTR punches remain unchanged.'
     :'Documented leave approved and Form 48 annotation recorded. Original gate/DTR punches are unchanged.'});
  }catch(e){await c.query('ROLLBACK').catch(()=>{});sqlErr(res,e);}
  finally{c.release();}
 });
 app.get('/api/staff-leave/staff-roster',...auth,async(req,res)=>{
  if(req.auth.role!=='SCHOOL_ADMIN')return res.status(403).json({error:'Only school HR administrators may import staff credit balances.'});
  try{
   const q=await pool.query("SELECT u.user_id AS \"userId\",u.display_name AS \"displayName\",u.teacher_position AS \"position\",u.role,COALESCE(sc.leave_scheme,'UNVERIFIED') AS \"leaveScheme\",sc.hr_reference AS \"hrReference\" FROM school_users u LEFT JOIN staff_leave_credit_schemes sc ON sc.school_id=u.school_id AND sc.staff_user_id=u.user_id WHERE u.school_id=$1 AND u.active=TRUE AND u.role IN ('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER','GATE_KEEPER') ORDER BY u.display_name LIMIT 1000",[req.auth.schoolId]);
   res.json({staff:q.rows});
  }catch(e){sqlErr(res,e);}
 });
 app.post('/api/staff-leave/credits/opening',...auth,async(req,res)=>{
  if(req.auth.role!=='SCHOOL_ADMIN')return res.status(403).json({error:'School HR authorization required.'});
  const staffId=String(req.body?.staffUserId||''),account=String(req.body?.creditAccount||'').toUpperCase(),
   days=positiveDays(req.body?.openingDays),note=String(req.body?.notes||'').trim();
  if(!UUID.test(staffId)||!['VSC','VL','SL','CTO'].includes(account)||!days||note.length>500)
   return res.status(400).json({error:'Valid employee, account and certified opening days are required.'});
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   const staff=await c.query("SELECT 1 FROM school_users WHERE school_id=$1 AND user_id=$2 AND role IN ('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN','GATE_KEEPER')",[req.auth.schoolId,staffId]);
   if(!staff.rowCount){await c.query('ROLLBACK');return res.status(404).json({error:'Employee not found in this school.'});}
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.auth.schoolId+':credits:'+staffId+':'+account]);
   const duplicate=await c.query("SELECT 1 FROM staff_leave_credit_entries WHERE school_id=$1 AND staff_user_id=$2 AND credit_account=$3 AND entry_kind='OPENING' AND status<>'VOID' LIMIT 1",[req.auth.schoolId,staffId,account]);
   if(duplicate.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'An opening balance already exists for this employee/account. Use documented adjustments after verification.'});}
   const id=randomUUID();
   await c.query("INSERT INTO staff_leave_credit_entries(credit_entry_id,school_id,staff_user_id,credit_account,entry_kind,signed_days,activity_kind,status,entered_by_user_id,notes) VALUES($1,$2,$3,$4,'OPENING',$5,'OTHER','PROPOSED',$6,$7)",
    [id,req.auth.schoolId,staffId,account,days,req.auth.userId,note]);
   await audit(c,req,'LEAVE_OPENING_BALANCE_PROPOSED',id,{staffUserId:staffId,account,days});
   await c.query('COMMIT');res.status(201).json({entryId:id,status:'PROPOSED',notice:'Opening balance submitted for supporting certification and verification; it is not yet available.'});
  }catch(e){await c.query('ROLLBACK').catch(()=>{});sqlErr(res,e);}
  finally{c.release();}
 });
 app.get('/api/staff-leave/credits/pending',...auth,async(req,res)=>{
  if(!['SCHOOL_ADMIN','DEPARTMENT_HEAD'].includes(req.auth.role))
   return res.status(403).json({error:'School HR verification access required.'});
  try{
   // A department head can only review an administrator's credit claim,
   // consistent with /credits/:id/verify. No reviewer may see their own
   // claim in this approval queue or certify their own balance.
   const q=await pool.query('SELECT e.credit_entry_id AS "entryId",e.staff_user_id AS "staffUserId",u.display_name AS "staffName",e.credit_account AS "creditAccount",e.entry_kind AS "entryKind",e.signed_days AS "days",e.activity_kind AS "activityKind",e.activity_date AS "activityDate",e.status FROM staff_leave_credit_entries e JOIN school_users u ON u.school_id=e.school_id AND u.user_id=e.staff_user_id WHERE e.school_id=$1 AND e.status=\'PROPOSED\' AND e.staff_user_id<>$2 AND ($3::text=\'SCHOOL_ADMIN\' OR u.role=\'SCHOOL_ADMIN\') ORDER BY e.created_at DESC LIMIT 200',
    [req.auth.schoolId,req.auth.userId,req.auth.role]);
   res.json({entries:q.rows});
  }catch(e){sqlErr(res,e);}
 });
 app.get('/api/staff-leave/credits',...auth,async(req,res)=>{
  const wanted=String(req.query?.staffUserId||req.auth.userId);
  if(!UUID.test(wanted)||(wanted!==req.auth.userId&&req.auth.role!=='SCHOOL_ADMIN'))
   return res.status(403).json({error:'Only your own credits or school-admin verified records can be viewed.'});
  try{
   const entries=await pool.query('SELECT credit_entry_id AS "entryId",credit_account AS "creditAccount",entry_kind AS "entryKind",signed_days AS "days",activity_kind AS "activityKind",activity_date AS "activityDate",hours,policy_reference AS "policyReference",approval_reference AS "approvalReference",status,created_at AS "createdAt" FROM staff_leave_credit_entries WHERE school_id=$1 AND staff_user_id=$2 ORDER BY created_at DESC LIMIT 200',
    [req.auth.schoolId,wanted]);
   const balances=await pool.query('SELECT credit_account AS "creditAccount",COALESCE(SUM(signed_days) FILTER(WHERE status=\'VERIFIED\'),0) AS "available",COUNT(*) FILTER(WHERE status=\'VERIFIED\')>0 AS "isCertified" FROM staff_leave_credit_entries WHERE school_id=$1 AND staff_user_id=$2 GROUP BY credit_account',
    [req.auth.schoolId,wanted]);
   res.json({staffUserId:wanted,balances:balances.rows,entries:entries.rows});
  }catch(e){sqlErr(res,e);}
 });
 app.post('/api/staff-leave/credits',...auth,async(req,res)=>{
  const kind=String(req.body?.activityKind||'OTHER').toUpperCase(),
   account=String(req.body?.creditAccount||'VSC').toUpperCase(),
   days=positiveDays(req.body?.proposedDays),date=String(req.body?.activityDate||''),
   hours=req.body?.hours==null?null:Number(req.body.hours),
   policy=String(req.body?.policyReference||'').trim().slice(0,160),
   notes=String(req.body?.notes||'').trim();
  if(!['VSC','VL','SL','CTO'].includes(account)||!['SEMINAR','BRIGADA_ESKWELA','TEACHING_OVERLOAD','OTHER'].includes(kind)||
    !days||!dateOk(date)||(hours!==null&&(!Number.isFinite(hours)||hours<=0||hours>1000))||notes.length>1500)
   return res.status(400).json({error:'Valid credit account, documented activity date, hours and proposed credit days required.'});
  try{
   const id=randomUUID();
   await pool.query('INSERT INTO staff_leave_credit_entries(credit_entry_id,school_id,staff_user_id,credit_account,entry_kind,signed_days,activity_kind,activity_date,hours,policy_reference,notes,status,entered_by_user_id) VALUES($1,$2,$3,$4,\'EARNED\',$5,$6,$7,$8,$9,$10,\'PROPOSED\',$3)',
    [id,req.auth.schoolId,req.auth.userId,account,days,kind,date,hours,policy,notes]);
   res.status(201).json({entryId:id,status:'PROPOSED',notice:'Claim saved for validation. No credit is available until authorized verification.'});
  }catch(e){sqlErr(res,e);}
 });
 app.post('/api/staff-leave/credits/:id/verify',...auth,async(req,res)=>{
  if(!UUID.test(req.params.id))return res.status(400).json({error:'Valid claim required.'});
  const reference=String(req.body?.approvalReference||'').trim(),
   approvedDays=positiveDays(req.body?.approvedDays);
  if(reference.length<3||reference.length>120||!approvedDays)
   return res.status(400).json({error:'Enter officially approved days and the signed Special Order/certification reference.'});
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   const found=await c.query('SELECT e.*,u.role AS claimant_role FROM staff_leave_credit_entries e JOIN school_users u ON u.school_id=e.school_id AND u.user_id=e.staff_user_id WHERE e.school_id=$1 AND e.credit_entry_id=$2 FOR UPDATE OF e',
    [req.auth.schoolId,req.params.id]);
   const e=found.rows[0];
   if(!e){await c.query('ROLLBACK');return res.status(404).json({error:'Credit claim not found.'});}
   if(e.status!=='PROPOSED'||req.auth.userId===e.staff_user_id||
    !(req.auth.role==='SCHOOL_ADMIN'||(req.auth.role==='DEPARTMENT_HEAD'&&e.claimant_role==='SCHOOL_ADMIN'))){
    await c.query('ROLLBACK');return res.status(403).json({error:'A separate authorized verifier is required; only proposed claims can be certified.'});
   }
   const sourceDoc=await c.query("SELECT 1 FROM staff_leave_documents WHERE school_id=$1 AND credit_entry_id=$2 AND document_kind IN ('SPECIAL_ORDER','CERTIFICATION') LIMIT 1",[req.auth.schoolId,e.credit_entry_id]);
   if(!sourceDoc.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'Attach the signed Special Order or official HR credit certification before granting credits.'});}
   const existing=await c.query('SELECT 1 FROM staff_leave_credit_entries WHERE school_id=$1 AND staff_user_id=$2 AND credit_account=$3 AND activity_kind=$4 AND approval_reference=$5 AND status=\'VERIFIED\' AND entry_kind=\'EARNED\' LIMIT 1',
    [req.auth.schoolId,e.staff_user_id,e.credit_account,e.activity_kind,reference]);
   if(existing.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'This official reference is already credited for this employee/activity.'});}
   await c.query('UPDATE staff_leave_credit_entries SET signed_days=$3,status=\'VERIFIED\',approval_reference=$4,verified_by_user_id=$5,verified_at=now() WHERE school_id=$1 AND credit_entry_id=$2',
    [req.auth.schoolId,e.credit_entry_id,approvedDays,reference,req.auth.userId]);
   await audit(c,req,'LEAVE_CREDIT_CERTIFIED',e.credit_entry_id,{creditAccount:e.credit_account,approvedDays,approvalReference:reference});
   await c.query('COMMIT');
   res.json({entryId:e.credit_entry_id,status:'VERIFIED',approvedDays});
  }catch(e){await c.query('ROLLBACK').catch(()=>{});sqlErr(res,e);}
  finally{c.release();}
 });

 // Official supporting evidence is private, tenant-scoped, access-checked and never a public asset.
 const readDocument=express.raw({type:['application/pdf','image/png','image/jpeg'],limit:'4mb'});
 const cleanFilename=s=>String(s||'supporting-document').replace(/[^a-zA-Z0-9 ._()-]/g,'_').slice(0,120);
 const contentType=req=>String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
 async function saveDocument(req,res,kind){
  const id=String(req.params.id||''),mime=contentType(req),documentKind=String(req.headers['x-document-kind']||'').toUpperCase();
  if(!UUID.test(id)||!['application/pdf','image/png','image/jpeg'].includes(mime)||
   !['APPLICATION','MEDICAL','AFFIDAVIT','CERTIFICATION','APPROVAL','SPECIAL_ORDER','OTHER'].includes(documentKind)||
   !Buffer.isBuffer(req.body)||req.body.length<1||req.body.length>4194304)
   return res.status(400).json({error:'Provide a valid PDF, JPG or PNG file up to 4 MB.'});
  try{
   let query;
   if(kind==='REQUEST'){
    const row=await getStaff(req,res,id);
    if(!row)return;
    if(['APPROVED','REJECTED','CANCELLED'].includes(row.status))
     return res.status(409).json({error:'This leave decision is finalized.'});
   }else{
    query=await pool.query('SELECT e.staff_user_id,u.role AS claimant_role FROM staff_leave_credit_entries e JOIN school_users u ON u.school_id=e.school_id AND u.user_id=e.staff_user_id WHERE e.school_id=$1 AND e.credit_entry_id=$2 AND e.status=\'PROPOSED\'',
     [req.auth.schoolId,id]);
    if(!query.rowCount)return res.status(404).json({error:'Unverified credit claim not found.'});
    const claim=query.rows[0];
    if(req.auth.userId!==claim.staff_user_id&&req.auth.role!=='SCHOOL_ADMIN'&&
     !(req.auth.role==='DEPARTMENT_HEAD'&&claim.claimant_role==='SCHOOL_ADMIN'))
     return res.status(403).json({error:'You cannot attach evidence to this claim.'});
   }
   const sha=createHash('sha256').update(req.body).digest('hex');
   const name=cleanFilename(req.headers['x-filename']);
   const saved=await pool.query(
    'INSERT INTO staff_leave_documents(school_id,request_id,credit_entry_id,uploaded_by_user_id,document_kind,filename,content_type,content,sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING document_id AS "documentId"',
    [req.auth.schoolId,kind==='REQUEST'?id:null,kind==='CREDIT'?id:null,req.auth.userId,documentKind,name,mime,req.body,sha]);
   return res.status(201).json({documentId:saved.rows[0].documentId,documentKind,filename:name});
  }catch(e){return sqlErr(res,e);}
 }
 app.post('/api/staff-leave/requests/:id/documents',...auth,readDocument,(req,res)=>saveDocument(req,res,'REQUEST'));
 app.post('/api/staff-leave/credits/:id/documents',...auth,readDocument,(req,res)=>saveDocument(req,res,'CREDIT'));
 app.get('/api/staff-leave/documents/:id',...auth,async(req,res)=>{
  if(!UUID.test(req.params.id))return res.status(400).json({error:'Valid document ID required.'});
  try{
   const doc=await pool.query('SELECT d.*,r.staff_user_id AS leave_staff_id,r.department_id, c.staff_user_id AS credit_staff_id FROM staff_leave_documents d LEFT JOIN staff_leave_requests r ON r.school_id=d.school_id AND r.request_id=d.request_id LEFT JOIN staff_leave_credit_entries c ON c.school_id=d.school_id AND c.credit_entry_id=d.credit_entry_id WHERE d.school_id=$1 AND d.document_id=$2',
    [req.auth.schoolId,req.params.id]);
   if(!doc.rowCount)return res.status(404).json({error:'Document not found.'});
   const d=doc.rows[0],owner=d.leave_staff_id||d.credit_staff_id;
   if(req.auth.userId!==owner&&req.auth.role!=='SCHOOL_ADMIN'&&
    !(req.auth.role==='DEPARTMENT_HEAD'&&!['MEDICAL','AFFIDAVIT'].includes(d.document_kind)&&d.department_id===req.auth.departmentId))
    return res.status(403).json({error:'Document access denied.'});
   res.set('Cache-Control','no-store, private');
   res.set('Content-Type',d.content_type);
   res.set('Content-Disposition','attachment; filename="'+cleanFilename(d.filename)+'"');
   return res.send(d.content);
  }catch(e){sqlErr(res,e);}
 });
 app.get('/api/staff-leave/requests/:id/documents',...auth,async(req,res)=>{
  try{
   const row=await getStaff(req,res,req.params.id);if(!row)return;
   const q=await pool.query('SELECT document_id AS "documentId",document_kind AS "documentKind",filename,uploaded_at AS "uploadedAt" FROM staff_leave_documents WHERE school_id=$1 AND request_id=$2 ORDER BY uploaded_at DESC',[req.auth.schoolId,row.request_id]);
   res.json({documents:q.rows.filter(d=>!['MEDICAL','AFFIDAVIT'].includes(d.documentKind)||req.auth.role==='SCHOOL_ADMIN'||req.auth.userId===row.staff_user_id)});
  }catch(e){sqlErr(res,e);}
 });
 app.get('/api/staff-leave/credits/:id/documents',...auth,async(req,res)=>{
  if(!UUID.test(req.params.id))return res.status(400).json({error:'Valid claim ID required.'});
  try{
   const c=await pool.query('SELECT staff_user_id FROM staff_leave_credit_entries WHERE school_id=$1 AND credit_entry_id=$2',[req.auth.schoolId,req.params.id]);
   if(!c.rowCount)return res.status(404).json({error:'Credit claim not found.'});
   if(req.auth.userId!==c.rows[0].staff_user_id&&req.auth.role!=='SCHOOL_ADMIN')
    return res.status(403).json({error:'Access denied.'});
   const q=await pool.query('SELECT document_id AS "documentId",document_kind AS "documentKind",filename FROM staff_leave_documents WHERE school_id=$1 AND credit_entry_id=$2 ORDER BY uploaded_at DESC',[req.auth.schoolId,req.params.id]);
   res.json({documents:q.rows});
  }catch(e){sqlErr(res,e);}
 });
}
module.exports={registerStaffLeaveRoutes};
