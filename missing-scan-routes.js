'use strict';
const express = require('express');
const { randomUUID, createHash } = require('node:crypto');
const { manilaDate } = require('./staff-lunch-routes');

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SLOTS = ['AM_IN', 'AM_OUT', 'PM_IN', 'PM_OUT'];
const ROLES = ['TEACHER', 'DEPARTMENT_HEAD', 'SCHOOL_ADMIN', 'PRINCIPAL'];
const FINAL = ['DOCUMENTED', 'DTR_CORRECTED', 'HEAD_REJECTED', 'ADMIN_REJECTED'];
const timeOk = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const dateOk = value => {
 if(typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
 const d=new Date(value+'T00:00:00Z');
 return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10)===value;
};
const recentDate = (date,today=manilaDate()) =>
 dateOk(date) && date<=today && (Date.parse(today+'T00:00:00Z')-Date.parse(date+'T00:00:00Z')) <= 90*86400000;
const canHeadReview=(actor,request)=> actor.role==='DEPARTMENT_HEAD' &&
 String(actor.departmentId||'')===String(request.department_id) &&
 String(actor.userId)!==String(request.staff_user_id) && request.requester_role!=='DEPARTMENT_HEAD';
const canReview=(actor,request)=>canHeadReview(actor,request) || (actor.role==='PRINCIPAL' && request.requester_role==='DEPARTMENT_HEAD' && String(actor.userId)!==String(request.staff_user_id));
const canView=(actor,request)=> actor.role==='SCHOOL_ADMIN' ||
 String(actor.userId)===String(request.staff_user_id) || canReview(actor,request);
const evidenceFormat=(mime,bytes)=>{
 if(!Buffer.isBuffer(bytes) || bytes.length<32 || bytes.length>3*1024*1024)return false;
 if(mime==='application/pdf')return bytes.subarray(0,5).toString('ascii')==='%PDF-';
 if(mime==='image/png')return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(mime==='image/jpeg')return bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
 return false;
};
const minutes=t=> Number(String(t).slice(0,2))*60+Number(String(t).slice(3,5));
function chronological(slots,proposedSlot,proposedTime){
 const index=SLOTS.indexOf(proposedSlot),time=minutes(proposedTime);
 return Object.entries(slots).every(([slot,value])=>{
  const otherIndex=SLOTS.indexOf(slot);
  return otherIndex<0 || otherIndex===index ||
   (otherIndex<index?minutes(value)<time:minutes(value)>time);
 });
}
function registerMissingScanRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 const auth=[authenticateSchoolClient,requireSchoolRoles(...ROLES)];
 const admin=[authenticateSchoolClient,requireSchoolRoles('SCHOOL_ADMIN')];
 const head=[authenticateSchoolClient,requireSchoolRoles('DEPARTMENT_HEAD','PRINCIPAL')];
 const audit=(c,req,action,id,details)=>c.query(
  'INSERT INTO staff_attendance_audit (school_id,actor_user_id,action,target_type,target_id,details) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
  [req.auth.schoolId,req.auth.userId,action,'MISSING_SCAN_REQUEST',id,JSON.stringify(details)]);
 const error=(res,e)=>{
  if(e.code==='23505')return res.status(409).json({error:'An active or completed correction already exists for this staff member, date and DTR slot.'});
  console.error('Missing scan review:',e.code||e.message);
  return res.status(503).json({error:'Missing-scan service is temporarily unavailable; no correction was confirmed.'});
 };
 const select='SELECT r.request_id AS "requestId",r.school_date::text AS date,r.slot,'+
  'to_char(r.claimed_time,\'HH24:MI\') AS "claimedTime",r.explanation,r.status,'+
  'r.staff_user_id AS "staffUserId",u.display_name AS "staffName",r.department_id AS "departmentId",'+
  'd.department_name AS "departmentName",r.created_at AS "createdAt",r.updated_at AS "updatedAt",'+
  'r.head_user_id AS "headUserId",r.head_note AS "headNote",'+
  'to_char(r.verified_time,\'HH24:MI\') AS "verifiedTime",r.head_reviewed_at AS "headReviewedAt",'+
  'r.evidence_reference AS "evidenceReference",r.evidence_type AS "evidenceType",'+
  '(r.evidence_bytes IS NOT NULL) AS "hasEvidence",'+
  'r.admin_user_id AS "adminUserId",r.admin_note AS "adminNote",'+
  'r.admin_reviewed_at AS "adminReviewedAt",r.correction_event_id AS "correctionEventId" '+
  'FROM staff_missing_scan_requests r JOIN school_users u ON u.school_id=r.school_id AND u.user_id=r.staff_user_id '+
  'JOIN school_departments d ON d.school_id=r.school_id AND d.department_id=r.department_id';
 async function getRow(c,req,id,lock=false){
  if(!UUID.test(id))return null;
  const q=await c.query('SELECT r.*,u.role AS requester_role FROM staff_missing_scan_requests r JOIN school_users u ON u.school_id=r.school_id AND u.user_id=r.staff_user_id WHERE r.school_id=$1 AND r.request_id=$2'+(lock?' FOR UPDATE OF r':''),
   [req.auth.schoolId,id]);
  return q.rows[0]||null;
 }
 async function verifiedSlot(c,school,staff,date,slot){
  const q=await c.query('SELECT 1 FROM staff_attendance_events WHERE school_id=$1 AND staff_user_id=$2 AND school_date=$3::date AND event_kind=\'DTR_SLOT\' AND dtr_slot=$4 AND verification_status=\'VERIFIED\' LIMIT 1',
   [school,staff,date,slot]);
  return !!q.rowCount;
 }
 async function policy(c,school){
  const q=await c.query('SELECT mode FROM staff_missing_scan_policies WHERE school_id=$1',[school]);
  return q.rows[0]?.mode||'DOCUMENT_EXCEPTION';
 }
 app.get('/api/missing-scans/policy',...auth,async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  try{return res.json({mode:await policy(pool,req.auth.schoolId)});}
  catch(e){return error(res,e);}
 });
 app.post('/api/missing-scans/policy',...admin,async(req,res)=>{
  const mode=String(req.body?.mode||'');
  if(!['DOCUMENT_EXCEPTION','DTR_CORRECTION'].includes(mode))
   return res.status(400).json({error:'Choose documented exception or authorized DTR correction.'});
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   await c.query('INSERT INTO staff_missing_scan_policies(school_id,mode,configured_by) VALUES($1,$2,$3) '+
    'ON CONFLICT(school_id) DO UPDATE SET mode=$2,configured_by=$3,updated_at=NOW()',
    [req.auth.schoolId,mode,req.auth.userId]);
   await audit(c,req,'MISSING_SCAN_SCHOOL_POLICY_CHANGED',req.auth.schoolId,{mode});
   await c.query('COMMIT');return res.json({mode});
  }catch(e){await c.query('ROLLBACK').catch(()=>{});return error(res,e);}finally{c.release();}
 });
 app.get('/api/missing-scans/requests',...auth,async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  const view=String(req.query?.view||'mine');
  if(!['mine','inbox'].includes(view))return res.status(400).json({error:'Invalid view.'});
  if(view==='inbox'&&req.auth.role==='TEACHER')return res.status(403).json({error:'Review queue access denied.'});
  const params=[req.auth.schoolId];
  let where='WHERE r.school_id=$1';
  if(view==='mine'){params.push(req.auth.userId);where+=' AND r.staff_user_id=$2';}
  else if(req.auth.role==='DEPARTMENT_HEAD'){
   params.push(req.auth.departmentId||null,req.auth.userId);
   where+=" AND r.department_id=$2 AND r.staff_user_id<>$3 AND u.role<>'DEPARTMENT_HEAD'";
  }else if(req.auth.role==='PRINCIPAL'){
   params.push(req.auth.userId);where+=" AND u.role='DEPARTMENT_HEAD' AND r.staff_user_id<>$2";
  }
  try{
   const q=await pool.query(select+' '+where+' ORDER BY r.created_at DESC LIMIT 200',params);
   return res.json({requests:q.rows});
  }catch(e){return error(res,e);}
 });
 app.post('/api/missing-scans/requests',...auth,async(req,res)=>{
  if(req.auth.role==='PRINCIPAL')return res.status(403).json({error:'Principal personal corrections require a separate authorized reviewer.'});
  const date=String(req.body?.date||''),slot=String(req.body?.slot||''),
   claimedTime=String(req.body?.claimedTime||''),explanation=String(req.body?.explanation||'').trim();
  if(!recentDate(date)||!SLOTS.includes(slot)||!timeOk(claimedTime)||explanation.length<10||explanation.length>1000)
   return res.status(400).json({error:'Choose a valid past/current date (within 90 days), DTR slot, claimed time and an explanation (10–1000 characters).'});
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   const staff=await c.query('SELECT u.department_id,d.department_code FROM school_users u JOIN school_departments d ON d.school_id=u.school_id AND d.department_id=u.department_id WHERE u.school_id=$1 AND u.user_id=$2 AND u.active=TRUE',
    [req.auth.schoolId,req.auth.userId]);
   if(!staff.rowCount||staff.rows[0].department_code==='UNASSIGNED'){
    await c.query('ROLLBACK');return res.status(409).json({error:'Ask School Admin to assign you to an active department before filing a missing scan.'});
   }
   if(await verifiedSlot(c,req.auth.schoolId,req.auth.userId,date,slot)){
    await c.query('ROLLBACK');return res.status(409).json({error:'That DTR slot already has a verified time; no missing-scan request is needed.'});
   }
   const id=randomUUID(),dept=staff.rows[0].department_id;
   await c.query('INSERT INTO staff_missing_scan_requests(request_id,school_id,staff_user_id,department_id,school_date,slot,claimed_time,explanation) VALUES($1,$2,$3,$4,$5::date,$6,$7::time,$8)',
    [id,req.auth.schoolId,req.auth.userId,dept,date,slot,claimedTime,explanation]);
   await audit(c,req,'MISSING_SCAN_REQUESTED',id,{date,slot,claimedTime,departmentId:dept});
   await c.query('COMMIT');return res.status(201).json({requestId:id,status:'PENDING_HEAD'});
  }catch(e){await c.query('ROLLBACK').catch(()=>{});return error(res,e);}finally{c.release();}
 });
 app.post('/api/missing-scans/requests/:id/resubmit',...auth,async(req,res)=>{
  const claimedTime=String(req.body?.claimedTime||''),
   explanation=String(req.body?.explanation||'').trim();
  if(!timeOk(claimedTime)||explanation.length<10||explanation.length>1000)
   return res.status(400).json({error:'Provide a valid time and explanation (10–1000 characters).'});
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   const row=await getRow(c,req,req.params.id,true);
   if(!row){await c.query('ROLLBACK');return res.status(404).json({error:'Request not found.'});}
   if(String(row.staff_user_id)!==String(req.auth.userId)||row.status!=='NEEDS_EVIDENCE'){
    await c.query('ROLLBACK');return res.status(403).json({error:'Only the requester can supply clarification for a request awaiting evidence.'});
   }
   await c.query('UPDATE staff_missing_scan_requests SET claimed_time=$3::time,explanation=$4,status=\'PENDING_HEAD\',evidence_bytes=NULL,evidence_type=NULL,evidence_reference=NULL,evidence_uploaded_at=NULL,evidence_uploaded_by=NULL,head_note=NULL,head_user_id=NULL,head_reviewed_at=NULL,verified_time=NULL,updated_at=NOW() WHERE school_id=$1 AND request_id=$2',
    [req.auth.schoolId,row.request_id,claimedTime,explanation]);
   await audit(c,req,'MISSING_SCAN_CLARIFIED',row.request_id,{claimedTime});
   await c.query('COMMIT');return res.json({status:'PENDING_HEAD'});
  }catch(e){await c.query('ROLLBACK').catch(()=>{});return error(res,e);}finally{c.release();}
 });
 app.post('/api/missing-scans/requests/:id/evidence',...head,
  express.raw({type:['image/jpeg','image/png','application/pdf'],limit:'3mb'}),async(req,res)=>{
   const mime=String(req.headers['content-type']||'').split(';')[0].trim();
   if(!evidenceFormat(mime,req.body))
    return res.status(400).json({error:'Attach a legible JPG, PNG or PDF logbook excerpt (32 bytes–3 MB). Crop or redact other employees.'});
   const c=await pool.connect();
   try{
    await c.query('BEGIN');
    const row=await getRow(c,req,req.params.id,true);
    if(!row){await c.query('ROLLBACK');return res.status(404).json({error:'Request not found.'});}
    if(!canReview(req.auth,row)||!['PENDING_HEAD','NEEDS_EVIDENCE','HEAD_VERIFIED'].includes(row.status)){
     await c.query('ROLLBACK');return res.status(403).json({error:'Not authorized to upload evidence for this pending department request.'});
    }
    await c.query('UPDATE staff_missing_scan_requests SET evidence_bytes=$3,evidence_type=$4,evidence_uploaded_by=$5,evidence_uploaded_at=NOW(),updated_at=NOW() WHERE school_id=$1 AND request_id=$2',
     [req.auth.schoolId,row.request_id,req.body,mime,req.auth.userId]);
    await audit(c,req,'MISSING_SCAN_LOGBOOK_ATTACHED',row.request_id,
     {mime,bytes:req.body.length,sha256:createHash('sha256').update(req.body).digest('hex')});
    await c.query('COMMIT');return res.json({attached:true});
   }catch(e){await c.query('ROLLBACK').catch(()=>{});return error(res,e);}finally{c.release();}
  });
 app.get('/api/missing-scans/requests/:id/evidence',...auth,async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  res.set('X-Content-Type-Options','nosniff');
  try{
   const row=await getRow(pool,req,req.params.id);
   if(!row)return res.status(404).json({error:'Request not found.'});
   if(!canView(req.auth,row))return res.status(403).json({error:'Evidence belongs to a different department or employee.'});
   if(!row.evidence_bytes)return res.status(404).json({error:'Logbook evidence has not been attached.'});
   res.type(row.evidence_type);
   res.set('Content-Disposition','attachment; filename="department-logbook-evidence.'+
     (row.evidence_type==='application/pdf'?'pdf':row.evidence_type==='image/png'?'png':'jpg')+'"');
   return res.send(row.evidence_bytes);
  }catch(e){return error(res,e);}
 });
 app.post('/api/missing-scans/requests/:id/head-decision',...head,async(req,res)=>{
  const decision=String(req.body?.decision||'');
  const comment=String(req.body?.comment||'').trim(),reference=String(req.body?.reference||'').trim();
  const verifiedTime=String(req.body?.verifiedTime||'');
  if(!['VERIFY','REJECT','MORE_EVIDENCE'].includes(decision)||comment.length<10||comment.length>1000||
     (decision==='VERIFY' && (!timeOk(verifiedTime)||reference.length<2||reference.length>180)))
   return res.status(400).json({error:'Provide a decision and comment (10–1000 characters); verification also needs the actual logged time and logbook reference.'});
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   const row=await getRow(c,req,req.params.id,true);
   if(!row){await c.query('ROLLBACK');return res.status(404).json({error:'Request not found.'});}
   if(!canReview(req.auth,row)||!['PENDING_HEAD','NEEDS_EVIDENCE','HEAD_VERIFIED'].includes(row.status)){
    await c.query('ROLLBACK');return res.status(403).json({error:'You cannot review this request or its status has already changed.'});
   }
   if(decision==='VERIFY' && (!row.evidence_bytes || row.evidence_uploaded_by!==req.auth.userId)){
    await c.query('ROLLBACK');return res.status(409).json({error:'Upload your department logbook evidence before verification.'});
   }
   if(decision==='VERIFY' && (typeof row.school_date==='string'?row.school_date:row.school_date.toISOString().slice(0,10))===manilaDate() && minutes(verifiedTime)>minutes(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()))){
    await c.query('ROLLBACK');return res.status(409).json({error:'The verified departure/arrival time cannot be in the future.'});
   }
   if(decision==='VERIFY' && await verifiedSlot(c,req.auth.schoolId,row.staff_user_id,
     typeof row.school_date==='string'?row.school_date:row.school_date.toISOString().slice(0,10),row.slot)){
    await c.query('ROLLBACK');return res.status(409).json({error:'An official DTR time is already recorded. A second correction is not allowed.'});
   }
   const schoolDate=typeof row.school_date==='string'?row.school_date:row.school_date.toISOString().slice(0,10);
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',
    [String(req.auth.schoolId),String(row.staff_user_id)+':'+schoolDate+':'+row.slot]);
   const mode=await policy(c,req.auth.schoolId);
   let status=decision==='REJECT'?'HEAD_REJECTED':'NEEDS_EVIDENCE',eventId=null;
   if(decision==='VERIFY'){
    if(!row.evidence_bytes||!verifiedTime||!reference){
     await c.query('ROLLBACK');return res.status(409).json({error:'Missing Department Head evidence or logbook verification.'});
    }
    if(await verifiedSlot(c,req.auth.schoolId,row.staff_user_id,schoolDate,row.slot)){
     await c.query('ROLLBACK');return res.status(409).json({error:'Official DTR slot was filled since this request was submitted. No duplicate correction was made.'});
    }
    if(mode==='DOCUMENT_EXCEPTION')status='DOCUMENTED';
    else{
     const [dtr,leave,ob,calendar]=await Promise.all([
      c.query('SELECT dtr_slot AS slot,to_char(occurred_at AT TIME ZONE \'Asia/Manila\',\'HH24:MI\') AS time FROM staff_attendance_events WHERE school_id=$1 AND staff_user_id=$2 AND school_date=$3::date AND event_kind=\'DTR_SLOT\' AND verification_status=\'VERIFIED\'',
       [req.auth.schoolId,row.staff_user_id,schoolDate]),
      c.query('SELECT 1 FROM staff_form48_approved_leaves WHERE school_id=$1 AND staff_user_id=$2 AND revoked_at IS NULL AND start_date<=$3::date AND end_date>=$3::date LIMIT 1',
       [req.auth.schoolId,row.staff_user_id,schoolDate]),
      c.query('SELECT 1 FROM staff_official_business_requests WHERE school_id=$1 AND staff_user_id=$2 AND status=\'APPROVED\' AND starts_at<(($3::date+INTERVAL \'1 day\') AT TIME ZONE \'Asia/Manila\') AND ends_at>($3::date::timestamp AT TIME ZONE \'Asia/Manila\') LIMIT 1',
       [req.auth.schoolId,row.staff_user_id,schoolDate]),
      c.query('SELECT 1 FROM school_calendar_exceptions WHERE school_id=$1 AND calendar_date=$2::date LIMIT 1',
       [req.auth.schoolId,schoolDate])
     ]);
     if(leave.rowCount||ob.rowCount||calendar.rowCount){
      await c.query('ROLLBACK');return res.status(409).json({error:'Approved leave, OB or a calendar exception requires separate reconciliation. Use documented-exception policy; no official time was created.'});
     }
     const other=Object.fromEntries(dtr.rows.map(x=>[x.slot,x.time]));
     const verified=verifiedTime;
     if(!chronological(other,row.slot,verified)){
      await c.query('ROLLBACK');return res.status(409).json({error:'Logbook time conflicts with another verified AM/PM slot. Review the evidence; no time was created.'});
     }
     eventId=randomUUID();
     const inserted=await c.query(
      'INSERT INTO staff_attendance_events(event_id,school_id,staff_user_id,event_kind,dtr_slot,school_date,occurred_at,source,verification_status,verification_method,actor_user_id,client_event_key,notes) '+
      'VALUES($1,$2,$3,\'DTR_SLOT\',$4,$5::date,($5::date+$6::time) AT TIME ZONE \'Asia/Manila\',\'AUTHORIZED_CORRECTION\',\'VERIFIED\',\'MANUAL_REVIEW\',$7,$8,$9) '+
      'ON CONFLICT DO NOTHING RETURNING event_id',
      [eventId,req.auth.schoolId,row.staff_user_id,row.slot,schoolDate,verified,req.auth.userId,randomUUID(),'DEPARTMENT_LOGBOOK_MISSING_SCAN_REQUEST:'+row.request_id]);
     if(!inserted.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'Another verified DTR entry exists. No duplicate correction was created.'});}
     await audit(c,req,'MISSING_SCAN_OFFICIAL_DTR_CORRECTED',row.request_id,
      {eventId,slot:row.slot,date:schoolDate,verifiedTime:verified,evidenceReference:reference,reviewerUserId:req.auth.userId,reviewerRole:req.auth.role});
     status='DTR_CORRECTED';
    }
   }
   await c.query('UPDATE staff_missing_scan_requests SET status=$3,head_user_id=$4,head_note=$5,'+
    'head_reviewed_at=NOW(),verified_time=$6::time,evidence_reference=$7,correction_event_id=$8,updated_at=NOW() '+
    'WHERE school_id=$1 AND request_id=$2',
    [req.auth.schoolId,row.request_id,status,req.auth.userId,comment,decision==='VERIFY'?verifiedTime:null,decision==='VERIFY'?reference:null,eventId]);
   await audit(c,req,'MISSING_SCAN_HEAD_'+decision,row.request_id,{comment,reference:decision==='VERIFY'?reference:null,verifiedTime:decision==='VERIFY'?verifiedTime:null,mode,status,eventId,reviewerRole:req.auth.role});
   await c.query('COMMIT');return res.json({status,mode,correctionEventId:eventId});
  }catch(e){await c.query('ROLLBACK').catch(()=>{});return error(res,e);}finally{c.release();}
 });
 // Retain a clear denial for stale clients; School Admin retains configuration and read-only history.
 app.post('/api/missing-scans/requests/:id/admin-decision',...admin,(_req,res)=>
  res.status(403).json({error:'Missing scan decisions are now finalized by the authorized department reviewer. School Admin has audit and policy access only.'}));
}
module.exports={registerMissingScanRoutes,timeOk,dateOk,recentDate,canHeadReview,canReview,canView,evidenceFormat,chronological};
