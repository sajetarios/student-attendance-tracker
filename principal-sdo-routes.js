'use strict';
// Principal-specific external approval coordination. Authenticated school staff only.
// No direct write to physical gate events or Form 48 DTR slots.
const express=require('express');
const {randomUUID,createHash}=require('node:crypto');
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const MIME=new Set(['application/pdf','image/png','image/jpeg']);
const trim=(v,n=160)=>String(v||'').trim().slice(0,n+1);
function isFile(bytes,mime){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>4194304)return false;
 if(mime==='application/pdf')return bytes.subarray(0,5).toString()==='%PDF-';
 if(mime==='image/png')return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(mime==='image/jpeg')return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 return false;
}
function registerPrincipalSdoRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 const principal=[authenticateSchoolClient,requireSchoolRoles('PRINCIPAL')];
 const coordinator=[authenticateSchoolClient,requireSchoolRoles('SCHOOL_ADMIN')];
 const any=[authenticateSchoolClient,requireSchoolRoles('PRINCIPAL','SCHOOL_ADMIN')];
 const err=(res,e)=>{console.error('Principal external request:',e.message);return res.status(503).json({error:'School request service unavailable. No attendance was changed.'});};
 const audit=(c,req,action,id,details)=>c.query(
  "INSERT INTO staff_attendance_audit(school_id,actor_user_id,action,target_type,target_id,details) VALUES($1,$2,$3,'PRINCIPAL_SDO_REQUEST',$4,$5::jsonb)",
  [req.auth.schoolId,req.auth.userId,action,id,JSON.stringify(details)]);
 const look=async(c,req,kind,id,lock=false)=>{
  const table=kind==='LEAVE'?'staff_leave_requests':'staff_official_business_requests';
  const r=await c.query(`SELECT x.staff_user_id,x.status,u.role FROM ${table} x
   JOIN school_users u ON u.school_id=x.school_id AND u.user_id=x.staff_user_id
   WHERE x.school_id=$1 AND x.request_id=$2 AND u.role='PRINCIPAL' ${lock?'FOR UPDATE OF x':''}`,
   [req.auth.schoolId,id]);return r.rows[0]||null;
 };
 app.post('/api/principal/ob',...principal,async(req,res)=>{
  res.set('Cache-Control','no-store,private');
  const purpose=trim(req.body?.purpose,1000),destination=trim(req.body?.destination,300);
  const start=new Date(req.body?.startsAt),end=new Date(req.body?.endsAt);
  if(purpose.length<3||purpose.length>1000||destination.length<2||destination.length>300||
   !Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start||
   end-start>14*86400000||start.getTime()<Date.now()-86400000)
   return res.status(400).json({error:'Enter purpose, destination and valid OB start/end (within 14 days).'});
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.auth.schoolId+':principal-ob:'+req.auth.userId]);
   const overlaps=await c.query(`SELECT 1 FROM staff_official_business_requests
    WHERE school_id=$1 AND staff_user_id=$2 AND status NOT IN ('REJECTED','CANCELLED')
    AND starts_at<$4 AND ends_at>$3 LIMIT 1`,
    [req.auth.schoolId,req.auth.userId,start,end]);
   if(overlaps.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'An overlapping OB request already exists.'});}
   const id=randomUUID();
   await c.query(`INSERT INTO staff_official_business_requests
    (request_id,school_id,staff_user_id,department_id,purpose,destination,starts_at,ends_at,status)
    VALUES($1,$2,$3,NULL,$4,$5,$6,$7,'PENDING_ADMIN')`,
    [id,req.auth.schoolId,req.auth.userId,purpose,destination,start,end]);
   await c.query(`INSERT INTO principal_sdo_handoffs(school_id,kind,request_id,principal_user_id)
    VALUES($1,'OB',$2,$3)`,[req.auth.schoolId,id,req.auth.userId]);
   await audit(c,req,'PRINCIPAL_OB_FILED',id,{status:'AWAITING_SDO_HANDOFF',startsAt:start.toISOString(),endsAt:end.toISOString()});
   await c.query('COMMIT');
   return res.status(201).json({requestId:id,status:'AWAITING_SDO_HANDOFF',
    notice:'OB filed. School Admin must submit to the SDO; this is not an approved travel authority or DTR punch.'});
  }catch(e){await c.query('ROLLBACK').catch(()=>{});return err(res,e);}finally{c.release();}
 });
 app.get('/api/principal/sdo-requests',...any,async(req,res)=>{
  res.set('Cache-Control','no-store,private');
  try{
   const school=req.auth.schoolId,principalId=req.auth.role==='PRINCIPAL'?req.auth.userId:null;
   const [leave,ob]=await Promise.all([
    pool.query(`SELECT l.request_id AS "requestId",l.staff_user_id AS "principalUserId",u.display_name AS "principalName",
       'LEAVE' AS kind,l.status,l.leave_type AS "title",to_char(l.start_date,'YYYY-MM-DD') AS "startDate",
       to_char(l.end_date,'YYYY-MM-DD') AS "endDate",l.submitted_at AS "filedAt",
       h.submitted_at AS "sdoSubmittedAt",h.submission_reference AS "handoffReference",
       h.receiving_office AS "receivingOffice",h.submission_channel AS "channel"
       FROM staff_leave_requests l JOIN school_users u ON u.school_id=l.school_id AND u.user_id=l.staff_user_id
       LEFT JOIN principal_sdo_handoffs h ON h.school_id=l.school_id AND h.kind='LEAVE' AND h.request_id=l.request_id
       WHERE l.school_id=$1 AND u.role='PRINCIPAL' AND ($2::uuid IS NULL OR l.staff_user_id=$2::uuid)
       ORDER BY l.submitted_at DESC LIMIT 100`,[school,principalId]),
    pool.query(`SELECT o.request_id AS "requestId",o.staff_user_id AS "principalUserId",u.display_name AS "principalName",
      'OB' AS kind,o.status,o.purpose AS title,o.starts_at AS "startDate",
      o.ends_at AS "endDate",o.submitted_at AS "filedAt",h.submitted_at AS "sdoSubmittedAt",
      h.submission_reference AS "handoffReference",h.receiving_office AS "receivingOffice",
      h.submission_channel AS "channel",h.decision AS "externalDecision",
      h.decision_reference AS "decisionReference",h.signed_filename AS "signedFilename"
      FROM staff_official_business_requests o JOIN school_users u ON u.school_id=o.school_id AND u.user_id=o.staff_user_id
      LEFT JOIN principal_sdo_handoffs h ON h.school_id=o.school_id AND h.kind='OB' AND h.request_id=o.request_id
      WHERE o.school_id=$1 AND u.role='PRINCIPAL' AND ($2::uuid IS NULL OR o.staff_user_id=$2::uuid)
      ORDER BY o.submitted_at DESC LIMIT 100`,[school,principalId])
   ]);
   const requests=[...leave.rows,...ob.rows].sort((a,b)=>Date.parse(b.filedAt)-Date.parse(a.filedAt));
   return res.json({requests,coordinator:req.auth.role==='SCHOOL_ADMIN',
    guidance:'School Admin records SDO submission and a signed external decision. School Admin does not approve the principal.'});
  }catch(e){return err(res,e);}
 });
 app.post('/api/principal/sdo-requests/:kind/:id/handoff',...coordinator,async(req,res)=>{
  res.set('Cache-Control','no-store,private');
  const kind=String(req.params.kind||'').toUpperCase(),id=String(req.params.id||'');
  const channel=String(req.body?.channel||''),office=trim(req.body?.receivingOffice,180),
    reference=trim(req.body?.reference,160);
  if(!['LEAVE','OB'].includes(kind)||!UUID.test(id)||!['OFFICIAL_EMAIL','SDO_TRACKING','PHYSICAL','OTHER'].includes(channel)||
   office.length<3||office.length>180||reference.length<3||reference.length>160)
   return res.status(400).json({error:'Valid kind, SDO receiving office, submission channel and reference required.'});
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   const item=await look(c,req,kind,id,true);
   if(!item){await c.query('ROLLBACK');return res.status(404).json({error:'Principal request not found.'});}
   if(req.auth.userId===item.staff_user_id||!['PENDING_ADMIN','PENDING_EXTERNAL'].includes(item.status)){
    await c.query('ROLLBACK');return res.status(409).json({error:'Request is not awaiting SDO coordination.'});}
   const saved=await c.query(`INSERT INTO principal_sdo_handoffs
    (school_id,kind,request_id,principal_user_id,submitted_at,submitted_by_user_id,submission_channel,receiving_office,submission_reference)
    VALUES($1,$2,$3,$4,NOW(),$5,$6,$7,$8)
    ON CONFLICT(school_id,kind,request_id) DO UPDATE
     SET submitted_at=EXCLUDED.submitted_at,submitted_by_user_id=EXCLUDED.submitted_by_user_id,
       submission_channel=EXCLUDED.submission_channel,receiving_office=EXCLUDED.receiving_office,
       submission_reference=EXCLUDED.submission_reference
     WHERE principal_sdo_handoffs.submitted_at IS NULL
    RETURNING request_id`,[req.auth.schoolId,kind,id,item.staff_user_id,req.auth.userId,channel,office,reference]);
   if(!saved.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'SDO handoff already recorded and cannot be silently rewritten.'});}
   await audit(c,req,'PRINCIPAL_SDO_HANDOFF',id,{kind,channel,office,reference});
   await c.query('COMMIT');
   return res.json({requestId:id,kind,status:'SENT_TO_SDO',reference});
  }catch(e){await c.query('ROLLBACK').catch(()=>{});return err(res,e);}finally{c.release();}
 });
 const upload=express.raw({type:['application/pdf','image/png','image/jpeg'],limit:'4mb'});
 app.post('/api/principal/sdo-requests/ob/:id/decision',...coordinator,upload,async(req,res)=>{
  res.set('Cache-Control','no-store,private');
  const id=String(req.params.id||''),decision=String(req.headers['x-sdo-decision']||'').toUpperCase(),
    reference=trim(req.headers['x-sdo-reference'],120),approver=trim(req.headers['x-sdo-approver'],120),
    position=trim(req.headers['x-sdo-position'],120),approvedOn=trim(req.headers['x-sdo-date'],10),
    filename=trim(req.headers['x-filename'],120).replace(/[^a-zA-Z0-9 ._()-]/g,'_'),
    mime=String(req.headers['content-type']||'').split(';')[0].toLowerCase();
  if(!UUID.test(id)||!['APPROVED','REJECTED'].includes(decision)||reference.length<3||reference.length>120||
    approver.length<3||approver.length>120||position.length<3||position.length>120||
    !/^\d{4}-\d{2}-\d{2}$/.test(approvedOn)||Number.isNaN(Date.parse(approvedOn+'T00:00:00Z'))||
    new Date(approvedOn+'T00:00:00Z').toISOString().slice(0,10)!==approvedOn||
    !filename||!MIME.has(mime)||!isFile(req.body,mime))
   return res.status(400).json({error:'Attach an authentic signed PDF/JPG/PNG (max 4 MB) with external decision, reference, official, position and date.'});
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   const item=await look(c,req,'OB',id,true);
   if(!item||item.status!=='PENDING_ADMIN'||req.auth.userId===item.staff_user_id){
    await c.query('ROLLBACK');return res.status(409).json({error:'Principal OB is unavailable or already finalized.'});}
   const handoff=await c.query(`UPDATE principal_sdo_handoffs SET decision=$4,decision_reference=$5,
     approver_name=$6,approver_position=$7,decision_date=$8::date,
     decision_recorded_at=NOW(),decision_recorded_by=$9,signed_filename=$10,
     signed_content_type=$11,signed_document=$12
     WHERE school_id=$1 AND kind='OB' AND request_id=$2 AND principal_user_id=$3
       AND submitted_at IS NOT NULL AND decision IS NULL RETURNING request_id`,
    [req.auth.schoolId,id,item.staff_user_id,decision,reference,approver,position,approvedOn,req.auth.userId,filename,mime,req.body]);
   if(!handoff.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'Record the documented SDO handoff before recording the signed decision.'});}
   const updated=await c.query(`UPDATE staff_official_business_requests
     SET status=$3,admin_user_id=$4,admin_decided_at=NOW(),decision_note=$5
     WHERE school_id=$1 AND request_id=$2 AND status='PENDING_ADMIN' RETURNING request_id`,
    [req.auth.schoolId,id,decision,req.auth.userId,
     'Documented external decision ('+reference+') by '+approver+'; School Admin recorded evidence only.']);
   if(!updated.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'OB request changed during verification.'});}
   await audit(c,req,'PRINCIPAL_SDO_OB_DECISION_RECORDED',id,{decision,reference,approver,position,approvedOn,sha256:createHash('sha256').update(req.body).digest('hex')});
   await c.query('COMMIT');
   return res.json({requestId:id,status:decision,notice:'Documented external decision recorded; no gate scan or DTR slot was created.'});
  }catch(e){await c.query('ROLLBACK').catch(()=>{});return err(res,e);}finally{c.release();}
 });
 app.get('/api/principal/sdo-requests/ob/:id/document',...any,async(req,res)=>{
  if(!UUID.test(req.params.id))return res.status(400).json({error:'Valid request ID required.'});
  try{
   const q=await pool.query(`SELECT h.principal_user_id,h.signed_document,h.signed_content_type,h.signed_filename
    FROM principal_sdo_handoffs h WHERE h.school_id=$1 AND h.kind='OB' AND h.request_id=$2`,
    [req.auth.schoolId,req.params.id]);
   if(!q.rowCount||!q.rows[0].signed_document)return res.status(404).json({error:'No signed OB decision available.'});
   const doc=q.rows[0];
   if(req.auth.role==='PRINCIPAL'&&String(req.auth.userId)!==String(doc.principal_user_id))
    return res.status(403).json({error:'Document access denied.'});
   res.set('Cache-Control','private,no-store');
   res.set('Content-Type',doc.signed_content_type);
   res.set('Content-Disposition','attachment; filename="'+doc.signed_filename+'"');
   return res.send(doc.signed_document);
  }catch(e){return err(res,e);}
 });
}
module.exports={registerPrincipalSdoRoutes,isFile};
