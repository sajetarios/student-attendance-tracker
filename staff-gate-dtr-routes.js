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
   return res.status(400).json({error:'A valid staff badge, DTR slot, and confirmed photo match are required.'});
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
     WHERE school_id=$1 AND teacher_qr_token=$2 AND role IN ('TEACHER','SCHOOL_ADMIN')
       AND active=TRUE AND (teacher_photo_path IS NOT NULL OR EXISTS (
         SELECT 1 FROM official_profile_photos p WHERE p.school_id=school_users.school_id
           AND p.subject_kind='STAFF' AND p.subject_id=school_users.user_id::text))
     FOR SHARE`,[schoolId,qrToken]);
   if(!teacher.rowCount){
    await client.query('ROLLBACK');
    return res.status(404).json({error:'An active school staff member and registered photo are required.'});
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
    return res.status(409).json({error:'This staff member already has a verified DTR entry for that slot.',alreadyRecorded:true});
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
