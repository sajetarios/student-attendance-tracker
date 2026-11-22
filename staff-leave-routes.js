'use strict';
const {randomUUID,createHash}=require('node:crypto');
const express=require('express');
const {parseRequest,positiveDays,dateOk,canView,nextStatus,allowReviewer}=require('./staff-leave-policy');
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
  status:r.status,submittedAt:r.submitted_at,headNote:r.head_note||'',
  adminNote:r.admin_note||'',certifiedWorkingDays:r.certified_working_days,
  externalReference:r.external_reference||'',externalApprover:r.external_approver||'',
  externalApproverPosition:r.external_approver_position||'',externalApprovedOn:r.external_approved_on,
  headReviewedAt:r.head_decided_at,adminReviewedAt:r.admin_reviewed_at,
  verifiedAt:r.verified_at,revision:r.revision
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
 app.get('/api/staff-leave/requests/:id/form6',...auth,async(req,res)=>{
  try{
   const row=await getStaff(req,res,req.params.id);
   if(!row)return;
   // This is a prefill dataset. Any missing salary, balances, or signatures remain blank.
   const credits=await pool.query('SELECT credit_account,COALESCE(SUM(signed_days) FILTER(WHERE status=\'VERIFIED\'),0) AS balance FROM staff_leave_credit_entries WHERE school_id=$1 AND staff_user_id=$2 GROUP BY credit_account',
    [req.auth.schoolId,row.staff_user_id]);
   res.json({formVersion:'CS Form No. 6 Revised 2020',request:printable(row),
    credits:credits.rows,applicantSignature:null,certifyingOfficerSignature:null,
    recommendingOfficerSignature:null,approvingOfficerSignature:null,
    officialMonthlySalary:null});
  }catch(e){sqlErr(res,e);}
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
   const status=nextStatus(req.auth.role,heads.rowCount>0),id=randomUUID();
   await c.query('INSERT INTO staff_leave_requests(request_id,school_id,staff_user_id,department_id,leave_type,credit_account,start_date,end_date,reason,details,commutation,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [id,req.auth.schoolId,req.auth.userId,staff.rows[0].department_id,input.leaveType,input.creditAccount,
     input.startDate,input.endDate,input.reason,input.details,input.commutation,status]);
   await audit(c,req,'LEAVE_SUBMITTED',id,{status,dates:[input.startDate,input.endDate],creditAccount:input.creditAccount});
   await c.query('COMMIT');
   res.status(201).json({requestId:id,status,notice:'Leave submitted for review. The DTR is unchanged until official approval is verified.'});
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
   const status=decision==='REJECT'?'REJECTED':step==='HEAD'?'PENDING_ADMIN':'PENDING_EXTERNAL';
   const col=step==='HEAD'?'head_user_id=$4,head_decided_at=NOW(),head_note=$5':
    'admin_user_id=$4,admin_reviewed_at=NOW(),admin_note=$5';
   await c.query('UPDATE staff_leave_requests SET status=$3,'+col+',revision=revision+1 WHERE school_id=$1 AND request_id=$2',
    [req.auth.schoolId,req.params.id,status,req.auth.userId,note]);
   await audit(c,req,'LEAVE_'+step+'_REVIEWED',req.params.id,{decision,status});
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
    await c.query('COMMIT');
    return res.json({status:'REJECTED',notice:'External disapproval recorded. Attendance remains unchanged.'});
   }
   const attachment=await c.query("SELECT 1 FROM staff_leave_documents WHERE school_id=$1 AND request_id=$2 AND document_kind='APPROVAL' LIMIT 1",[req.auth.schoolId,row.request_id]);
   if(!attachment.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'Attach the official signed approval (PDF/JPG/PNG) before certifying leave.'});}
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.auth.schoolId+':leave:'+row.staff_user_id]);
   const overlap=await c.query('SELECT 1 FROM staff_form48_approved_leaves WHERE school_id=$1 AND staff_user_id=$2 AND revoked_at IS NULL AND start_date<=$4::date AND end_date>=$3::date LIMIT 1',
    [req.auth.schoolId,row.staff_user_id,row.start_date,row.end_date]);
   if(overlap.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'Overlapping official leave exists. Reconcile before recording approval.'});}
   if(row.credit_account!=='NONE'){
    const balance=await c.query('SELECT COALESCE(SUM(signed_days),0)::numeric AS days FROM staff_leave_credit_entries WHERE school_id=$1 AND staff_user_id=$2 AND credit_account=$3 AND status=\'VERIFIED\'',
     [req.auth.schoolId,row.staff_user_id,row.credit_account]);
    if(Number(balance.rows[0].days)+1e-8<days){await c.query('ROLLBACK');return res.status(409).json({error:'Insufficient certified '+row.credit_account+' credit balance. Verify opening and earned credits first.'});}
    await c.query('INSERT INTO staff_leave_credit_entries(school_id,staff_user_id,credit_account,entry_kind,signed_days,request_id,status,entered_by_user_id,verified_by_user_id,verified_at,approval_reference) VALUES($1,$2,$3,\'USED\',$4,$5,\'VERIFIED\',$6,$6,now(),$7)',
     [req.auth.schoolId,row.staff_user_id,row.credit_account,-days,row.request_id,req.auth.userId,reference]);
   }
   const form48id=randomUUID();
   await c.query('INSERT INTO staff_form48_approved_leaves(leave_id,school_id,staff_user_id,leave_type,start_date,end_date,approval_reference,recorded_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [form48id,req.auth.schoolId,row.staff_user_id,row.leave_type,row.start_date,row.end_date,reference,req.auth.userId]);
   await c.query('UPDATE staff_leave_requests SET status=\'APPROVED\',certified_working_days=$3,external_reference=$4,external_approver=$5,external_approver_position=$6,external_approved_on=$7,verified_by_user_id=$8,verified_at=now(),form48_leave_id=$9,revision=revision+1 WHERE school_id=$1 AND request_id=$2',
    [req.auth.schoolId,row.request_id,days,reference,approver,position,approvedOn,req.auth.userId,form48id]);
   await audit(c,req,'LEAVE_EXTERNAL_APPROVED',row.request_id,{approvalReference:reference,chargedDays:days,creditAccount:row.credit_account,form48LeaveId:form48id});
   await c.query('COMMIT');
   res.json({status:'APPROVED',notice:'Documented leave approved and Form 48 annotation recorded. Original gate/DTR punches are unchanged.'});
  }catch(e){await c.query('ROLLBACK').catch(()=>{});sqlErr(res,e);}
  finally{c.release();}
 });
 app.get('/api/staff-leave/credits/pending',...auth,async(req,res)=>{
  if(req.auth.role!=='SCHOOL_ADMIN')return res.status(403).json({error:'School HR verification access required.'});
  try{
   const q=await pool.query('SELECT e.credit_entry_id AS "entryId",e.staff_user_id AS "staffUserId",u.display_name AS "staffName",e.credit_account AS "creditAccount",e.entry_kind AS "entryKind",e.signed_days AS "days",e.activity_kind AS "activityKind",e.activity_date AS "activityDate",e.status FROM staff_leave_credit_entries e JOIN school_users u ON u.school_id=e.school_id AND u.user_id=e.staff_user_id WHERE e.school_id=$1 AND e.status=\'PROPOSED\' ORDER BY e.created_at DESC LIMIT 200',[req.auth.schoolId]);
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
   const balances=await pool.query('SELECT credit_account AS "creditAccount",COALESCE(SUM(signed_days) FILTER(WHERE status=\'VERIFIED\'),0) AS "available" FROM staff_leave_credit_entries WHERE school_id=$1 AND staff_user_id=$2 GROUP BY credit_account',
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
   const sourceDoc=await c.query("SELECT 1 FROM staff_leave_documents WHERE school_id=$1 AND credit_entry_id=$2 AND document_kind='SPECIAL_ORDER' LIMIT 1",[req.auth.schoolId,e.credit_entry_id]);
   if(!sourceDoc.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'Attach the signed Special Order or official credit certification before granting credits.'});}
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
   !['APPLICATION','MEDICAL','CERTIFICATION','APPROVAL','SPECIAL_ORDER','OTHER'].includes(documentKind)||
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
    !(req.auth.role==='DEPARTMENT_HEAD'&&d.document_kind!=='MEDICAL'&&d.department_id===req.auth.departmentId))
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
   res.json({documents:q.rows.filter(d=>d.documentKind!=='MEDICAL'||req.auth.role==='SCHOOL_ADMIN'||req.auth.userId===row.staff_user_id)});
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
