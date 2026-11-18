'use strict';
const {randomUUID}=require('node:crypto');
const {manilaDate}=require('./staff-lunch-routes');
const DTR_SLOTS=Object.freeze(['AM_IN','AM_OUT','PM_IN','PM_OUT']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function registerStaffGateDtrRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 // Physical gate movements are maintained separately by existing Gatekeeper
 // endpoints; this endpoint is solely a verified Form-48 DTR fallback.
 app.post('/api/staff-attendance/gatekeeper/dtr',authenticateSchoolClient,
   requireSchoolRoles('GATE_KEEPER'),async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  const qrToken=String(req.body?.teacherQrToken||'').trim();
  const slot=String(req.body?.slot||'');
  if(!UUID.test(qrToken)||!DTR_SLOTS.includes(slot)||req.body?.photoVerified!==true)
   return res.status(400).json({error:'A valid teacher badge, DTR slot, and confirmed photo match are required.'});
  if(req.auth?.type!=='SCHOOL_USER'||req.auth.role!=='GATE_KEEPER')
   return res.status(403).json({error:'Gatekeeper authentication required.'});
  const schoolId=req.auth.schoolId,keeperId=req.auth.userId,schoolDate=manilaDate();
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const forbidden=await client.query(
    `SELECT 1 FROM school_calendar_exceptions
      WHERE school_id=$1 AND calendar_date=$2::date AND exception_type='CLOSED'
      LIMIT 1`,[schoolId,schoolDate]);
   if(forbidden.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'The school is closed on this date.'});}
   const teacher=await client.query(
    `SELECT user_id,display_name
     FROM school_users
     WHERE school_id=$1 AND teacher_qr_token=$2 AND role='TEACHER'
       AND active=TRUE AND teacher_photo_path IS NOT NULL
     FOR SHARE`,[schoolId,qrToken]);
   if(!teacher.rowCount){
    await client.query('ROLLBACK');
    return res.status(404).json({error:'An active teacher and registered photo are required.'});
   }
   const teacherId=teacher.rows[0].user_id,eventId=randomUUID();
   const recorded=await client.query(
    `INSERT INTO staff_attendance_events
      (event_id,school_id,staff_user_id,event_kind,dtr_slot,school_date,
       occurred_at,source,verification_status,verification_method,actor_user_id,client_event_key)
     VALUES($1,$2,$3,'DTR_SLOT',$4,$5,NOW(),'GATEKEEPER','VERIFIED','GUARD_PHOTO',$6,$7)
     ON CONFLICT DO NOTHING RETURNING event_id,occurred_at`,
    [eventId,schoolId,teacherId,slot,schoolDate,keeperId,randomUUID()]);
   if(!recorded.rowCount){
    await client.query('ROLLBACK');
    return res.status(409).json({error:'This teacher already has a verified DTR entry for that slot.',alreadyRecorded:true});
   }
   await client.query(
    `INSERT INTO staff_attendance_audit
      (school_id,actor_user_id,action,target_type,target_id,details)
     VALUES($1,$2,'GATEKEEPER_DTR_VERIFIED','STAFF_ATTENDANCE_EVENT',$3,$4::jsonb)`,
    [schoolId,keeperId,eventId,JSON.stringify({staffUserId:teacherId,slot,schoolDate,photoVerified:true})]);
   await client.query('COMMIT');
   return res.status(201).json({
     eventId,teacherName:teacher.rows[0].display_name,slot,schoolDate,
     occurredAt:recorded.rows[0].occurred_at,status:'VERIFIED'
   });
  }catch(err){
   await client.query('ROLLBACK').catch(()=>{});
   if(err.code==='23505')return res.status(409).json({error:'This DTR entry was already recorded.',alreadyRecorded:true});
   console.error('Gatekeeper DTR fallback:',err.message);
   return res.status(503).json({error:'Unable to record the gatekeeper-verified DTR.'});
  }finally{client.release();}
 });
 // Offline captures are evidence awaiting review, never verified attendance.
 app.post('/api/staff-attendance/my/dtr/offline-sync',authenticateSchoolClient,
  requireSchoolRoles('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN'),async(req,res)=>{
   res.set('Cache-Control','no-store, private');
   const key=String(req.body?.clientEventKey||'');
   const slot=String(req.body?.slot||'');
   const captured=String(req.body?.capturedAt||'');
   const timestamp=new Date(captured);
   const validDate=Number.isFinite(timestamp.getTime()) &&
    /^\d{4}-\d{2}-\d{2}T/.test(captured) && /(?:Z|[+-]\d{2}:\d{2})$/.test(captured);
   if(!UUID.test(key)||!DTR_SLOTS.includes(slot)||!validDate||
      timestamp.getTime()>Date.now()+300000||
      timestamp.getTime()<Date.now()-7*86400000)
    return res.status(400).json({error:'Valid offline event key, DTR slot and capture time within the last seven days required.'});
   const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(timestamp);
   const field=type=>parts.find(part=>part.type===type)?.value;
   const schoolDate=`${field('year')}-${field('month')}-${field('day')}`;
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    const existing=await client.query(
     `SELECT event_id,staff_user_id,dtr_slot,device_capture_at,verification_status
      FROM staff_attendance_events WHERE school_id=$1 AND client_event_key=$2 FOR UPDATE`,
     [req.auth.schoolId,key]);
    if(existing.rowCount){
     const row=existing.rows[0];
     if(row.staff_user_id!==req.auth.userId||row.dtr_slot!==slot||
       new Date(row.device_capture_at).getTime()!==timestamp.getTime()){
      await client.query('ROLLBACK');
      return res.status(409).json({error:'Offline event key already belongs to another capture.'});
     }
     await client.query('COMMIT');
     return res.json({eventId:row.event_id,status:row.verification_status,duplicate:true});
    }
    const id=randomUUID();
    await client.query(
     `INSERT INTO staff_attendance_events
      (event_id,school_id,staff_user_id,event_kind,dtr_slot,school_date,
       occurred_at,source,verification_status,actor_user_id,client_event_key,device_capture_at)
      VALUES($1,$2,$3,'DTR_SLOT',$4,$5,$6,'OFFLINE_SYNC','PENDING_VERIFICATION',$3,$7,$6)`,
     [id,req.auth.schoolId,req.auth.userId,slot,schoolDate,timestamp,key]);
    await client.query(
     `INSERT INTO staff_attendance_audit
       (school_id,actor_user_id,action,target_type,target_id,details)
       VALUES($1,$2,'STAFF_OFFLINE_DTR_PENDING','STAFF_ATTENDANCE_EVENT',$3,$4::jsonb)`,
     [req.auth.schoolId,req.auth.userId,id,JSON.stringify({slot,schoolDate,clientEventKey:key})]);
    await client.query('COMMIT');
    return res.status(202).json({eventId:id,schoolDate,slot,status:'PENDING_VERIFICATION'});
   }catch(err){
    await client.query('ROLLBACK').catch(()=>{});
    if(err.code==='23505')return res.status(409).json({error:'Duplicate offline capture. Retry with the same event key.'});
    console.error('Offline staff DTR sync:',err.message);
    return res.status(503).json({error:'Offline staff capture could not be queued.'});
   }finally{client.release();}
  });
 app.get('/api/staff-attendance/my/dtr/pending',authenticateSchoolClient,
  requireSchoolRoles('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN'),async(req,res)=>{
   res.set('Cache-Control','no-store, private');
   try{
    const result=await pool.query(
     `SELECT event_id AS "eventId",dtr_slot AS "slot",school_date AS "schoolDate",
       device_capture_at AS "capturedAt",verification_status AS "status"
       FROM staff_attendance_events
       WHERE school_id=$1 AND staff_user_id=$2 AND source='OFFLINE_SYNC'
       AND verification_status='PENDING_VERIFICATION'
       ORDER BY device_capture_at DESC LIMIT 100`,
     [req.auth.schoolId,req.auth.userId]);
    return res.json({pending:result.rows});
   }catch(err){console.error('Offline staff pending read:',err.message);
    return res.status(503).json({error:'Pending staff captures unavailable.'});}
  });
 // School Admin manually reviews unverified offline evidence; no automatic promotion.
 app.get('/api/staff-attendance/offline-review',authenticateSchoolClient,
  requireSchoolRoles('SCHOOL_ADMIN'),async(req,res)=>{
   res.set('Cache-Control','no-store, private');
   try{
    const result=await pool.query(
     `SELECT e.event_id AS "eventId",e.staff_user_id AS "staffUserId",
       u.display_name AS "staffName",e.dtr_slot AS "slot",
       e.school_date AS "schoolDate",e.device_capture_at AS "capturedAt"
       FROM staff_attendance_events e
       JOIN school_users u ON u.school_id=e.school_id AND u.user_id=e.staff_user_id
       WHERE e.school_id=$1 AND e.event_kind='DTR_SLOT'
       AND e.source='OFFLINE_SYNC' AND e.verification_status='PENDING_VERIFICATION'
       ORDER BY e.received_at ASC LIMIT 100`,[req.auth.schoolId]);
    return res.json({pending:result.rows});
   }catch(err){console.error('Offline DTR review list:',err.message);
    return res.status(503).json({error:'Offline review queue unavailable.'});}
  });
 app.post('/api/staff-attendance/offline-review/:eventId',authenticateSchoolClient,
  requireSchoolRoles('SCHOOL_ADMIN'),async(req,res)=>{
   res.set('Cache-Control','no-store, private');
   const id=String(req.params.eventId||'');
   const decision=String(req.body?.decision||'').toUpperCase();
   const note=String(req.body?.note||'').trim();
   if(!UUID.test(id)||!['VERIFY','REJECT'].includes(decision)||note.length<3||note.length>1000)
    return res.status(400).json({error:'Valid event, decision and review note (3–1000 characters) required.'});
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    const row=await client.query(
     `SELECT event_id,staff_user_id,dtr_slot,school_date FROM staff_attendance_events
       WHERE school_id=$1 AND event_id=$2 AND event_kind='DTR_SLOT'
       AND source='OFFLINE_SYNC' AND verification_status='PENDING_VERIFICATION'
       FOR UPDATE`,[req.auth.schoolId,id]);
    if(!row.rowCount){await client.query('ROLLBACK');
     return res.status(409).json({error:'Capture not pending review in this school.'});}
    if(row.rows[0].staff_user_id===req.auth.userId){await client.query('ROLLBACK');
     return res.status(403).json({error:'You cannot review your own attendance.'});}
    const status=decision==='VERIFY'?'VERIFIED':'REJECTED';
    await client.query(
     `UPDATE staff_attendance_events SET verification_status=$3,
       verification_method=CASE WHEN $3='VERIFIED' THEN 'MANUAL_REVIEW' ELSE NULL END,
       notes=$4 WHERE school_id=$1 AND event_id=$2`,
     [req.auth.schoolId,id,status,note]);
    await client.query(
     `INSERT INTO staff_attendance_audit
       (school_id,actor_user_id,action,target_type,target_id,details)
       VALUES($1,$2,$3,'STAFF_ATTENDANCE_EVENT',$4,$5::jsonb)`,
     [req.auth.schoolId,req.auth.userId,
      status==='VERIFIED'?'STAFF_OFFLINE_DTR_VERIFIED':'STAFF_OFFLINE_DTR_REJECTED',
      id,JSON.stringify({note,slot:row.rows[0].dtr_slot,schoolDate:row.rows[0].school_date})]);
    await client.query('COMMIT');
    return res.json({eventId:id,status});
   }catch(err){await client.query('ROLLBACK').catch(()=>{});
    if(err.code==='23505')return res.status(409).json({error:'A verified DTR already exists for this slot.'});
    console.error('Offline staff DTR review:',err.message);
    return res.status(503).json({error:'Unable to complete offline review.'});
   }finally{client.release();}
  });
 app.get('/api/staff-attendance/my/dtr',authenticateSchoolClient,
  requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER'),async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  const date=String(req.query?.date||manilaDate());
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date+'T00:00:00Z')))
   return res.status(400).json({error:'Invalid school date.'});
  try{
   const rows=await pool.query(
    `SELECT dtr_slot AS "slot",occurred_at AS "occurredAt",
       source,verification_method AS "verificationMethod"
     FROM staff_attendance_events WHERE school_id=$1 AND staff_user_id=$2
       AND school_date=$3::date AND event_kind='DTR_SLOT' AND verification_status='VERIFIED'
     ORDER BY occurred_at ASC`,[req.auth.schoolId,req.auth.userId,date]);
   return res.json({schoolDate:date,slots:DTR_SLOTS.map(slot=>{
    const match=rows.rows.find(x=>x.slot===slot);
    return {slot,status:match?'VERIFIED':'NOT_RECORDED',occurredAt:match?.occurredAt||null,
      source:match?.source||null,verificationMethod:match?.verificationMethod||null};
   })});
  }catch(err){console.error('Staff DTR personal read:',err.message);return res.status(503).json({error:'DTR records unavailable.'});}
 });
}
module.exports={registerStaffGateDtrRoutes,DTR_SLOTS};
