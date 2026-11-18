'use strict';
const { createLunchChallenge, validateLunchSlot, hashLunchChallenge, isLunchChallengeRedeemable } = require('./staff-lunch-challenge');
const { randomUUID, timingSafeEqual } = require('node:crypto');
function manilaDate(now = new Date()) {
 const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Manila', year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(now);
 const p = Object.fromEntries(parts.map(x=>[x.type,x.value]));
 return p.year+'-'+p.month+'-'+p.day;
}
function registerStaffLunchRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}) {
 const presenter=requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER');

 // School Admin manages the rotating QR presenter. One active presenter per
 // school/date/slot; changes revoke any unexpired challenges from the old holder.
 app.get('/api/staff-attendance/lunch/presenter',authenticateSchoolClient,
  requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER'),async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  const date=manilaDate(),slot=String(req.query?.slot||'');
  if(!['AM_OUT','PM_IN'].includes(slot))return res.status(400).json({error:'Invalid lunch slot.'});
  try{
   const found=await pool.query(
    `SELECT a.presenter_user_id AS "presenterUserId",u.display_name AS "presenterName",
      a.assigned_at AS "assignedAt"
     FROM staff_lunch_presenter_assignments a
     JOIN school_users u ON u.school_id=a.school_id AND u.user_id=a.presenter_user_id
     WHERE a.school_id=$1 AND a.school_date=$2::date AND a.dtr_slot=$3
       AND a.revoked_at IS NULL AND u.active=TRUE LIMIT 1`,
    [req.auth.schoolId,date,slot]);
   const row=found.rows[0]||null;
   return res.json({schoolDate:date,slot,assigned:!!row,
    presenterName:row?.presenterName||null,
    // Other teachers need to know whether they are the assigned presenter,
    // not the assigned teacher's stable internal ID.
    isCurrentPresenter:!!row&&row.presenterUserId===req.auth.userId,
    ...(req.auth.role==='SCHOOL_ADMIN'?{presenterUserId:row?.presenterUserId||null}:{}),
    assignedAt:row?.assignedAt||null});
  }catch(error){console.error('Lunch presenter read failed:',error.message);return res.status(503).json({error:'Presenter unavailable.'});}
 });
 app.put('/api/staff-attendance/lunch/presenter',authenticateSchoolClient,
  requireSchoolRoles('SCHOOL_ADMIN'),async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  const slot=String(req.body?.slot||''),presenterId=String(req.body?.presenterUserId||'');
  const date=manilaDate();
  if(!['AM_OUT','PM_IN'].includes(slot)||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(presenterId))
   return res.status(400).json({error:'Valid presenter and lunch slot required.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   // Serialize assignment changes per school/slot/date without adding a new
   // migration or exposing a race in the partial unique index.
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',
    [String(req.auth.schoolId),date+':'+slot]);
   const teacher=await client.query(
    `SELECT user_id,display_name FROM school_users
     WHERE school_id=$1 AND user_id=$2 AND role='TEACHER' AND active=TRUE`,
    [req.auth.schoolId,presenterId]);
   if(!teacher.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Active teacher not found in this school.'});}
   const current=await client.query(
    `SELECT assignment_id,presenter_user_id FROM staff_lunch_presenter_assignments
     WHERE school_id=$1 AND school_date=$2::date AND dtr_slot=$3 AND revoked_at IS NULL FOR UPDATE`,
    [req.auth.schoolId,date,slot]);
   if(current.rows[0]?.presenter_user_id===presenterId){
    await client.query('COMMIT');
    return res.json({schoolDate:date,slot,presenterUserId:presenterId,
     presenterName:teacher.rows[0].display_name,unchanged:true});
   }
   if(current.rowCount){
    await client.query(`UPDATE staff_lunch_presenter_assignments SET revoked_at=NOW()
      WHERE assignment_id=$1`,[current.rows[0].assignment_id]);
    await client.query(`UPDATE staff_attendance_challenges SET revoked_at=NOW()
      WHERE school_id=$1 AND school_date=$2::date AND dtr_slot=$3
       AND presenter_user_id=$4 AND revoked_at IS NULL`,
      [req.auth.schoolId,date,slot,current.rows[0].presenter_user_id]);
   }
   const inserted=await client.query(
    `INSERT INTO staff_lunch_presenter_assignments
      (school_id,presenter_user_id,school_date,dtr_slot,assigned_by_user_id)
     VALUES($1,$2,$3,$4,$5) RETURNING assignment_id`,
    [req.auth.schoolId,presenterId,date,slot,req.auth.userId]);
   await client.query(`INSERT INTO staff_attendance_audit
    (school_id,actor_user_id,action,target_type,target_id,details)
    VALUES($1,$2,'LUNCH_PRESENTER_ASSIGNED','LUNCH_PRESENTER_ASSIGNMENT',$3,$4::jsonb)`,
    [req.auth.schoolId,req.auth.userId,inserted.rows[0].assignment_id,
     JSON.stringify({schoolDate:date,slot,presenterUserId:presenterId,
      previousPresenterUserId:current.rows[0]?.presenter_user_id||null})]);
   await client.query('COMMIT');
   return res.status(201).json({schoolDate:date,slot,presenterUserId:presenterId,
    presenterName:teacher.rows[0].display_name});
  }catch(error){
   await client.query('ROLLBACK').catch(()=>{});
   console.error('Lunch presenter assignment failed:',error.message);
   return res.status(503).json({error:'Unable to assign lunch QR presenter.'});
  }finally{client.release();}
 });
 app.delete('/api/staff-attendance/lunch/presenter',authenticateSchoolClient,
  requireSchoolRoles('SCHOOL_ADMIN'),async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  const slot=String(req.body?.slot||''),date=manilaDate();
  if(!['AM_OUT','PM_IN'].includes(slot))return res.status(400).json({error:'Invalid lunch slot.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',
    [String(req.auth.schoolId),date+':'+slot]);
   const old=await client.query(`UPDATE staff_lunch_presenter_assignments SET revoked_at=NOW()
    WHERE school_id=$1 AND school_date=$2::date AND dtr_slot=$3 AND revoked_at IS NULL
    RETURNING assignment_id,presenter_user_id`,[req.auth.schoolId,date,slot]);
   if(old.rowCount){
    await client.query(`UPDATE staff_attendance_challenges SET revoked_at=NOW()
     WHERE school_id=$1 AND school_date=$2::date AND dtr_slot=$3
       AND presenter_user_id=$4 AND revoked_at IS NULL`,
      [req.auth.schoolId,date,slot,old.rows[0].presenter_user_id]);
    await client.query(`INSERT INTO staff_attendance_audit
     (school_id,actor_user_id,action,target_type,target_id,details)
     VALUES($1,$2,'LUNCH_PRESENTER_REVOKED','LUNCH_PRESENTER_ASSIGNMENT',$3,$4::jsonb)`,
     [req.auth.schoolId,req.auth.userId,old.rows[0].assignment_id,
      JSON.stringify({schoolDate:date,slot,presenterUserId:old.rows[0].presenter_user_id})]);
   }
   await client.query('COMMIT');
   return res.json({schoolDate:date,slot,revoked:!!old.rowCount});
  }catch(error){await client.query('ROLLBACK').catch(()=>{});
   console.error('Lunch presenter revocation failed:',error.message);
   return res.status(503).json({error:'Unable to revoke lunch QR presenter.'});
  }finally{client.release();}
 });

 app.post('/api/staff-attendance/lunch/challenges',authenticateSchoolClient,presenter,async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  let slot;
  try { slot=validateLunchSlot(req.body?.slot); }
  catch { return res.status(400).json({error:'Only AM_OUT and PM_IN challenges are supported.'}); }
  if(req.auth?.type!=='SCHOOL_USER'||!req.auth.schoolId||!req.auth.userId)
   return res.status(403).json({error:'Authenticated school staff required.'});
  const client=await pool.connect();
  try {
   await client.query('BEGIN');
   // Serialize challenge issuance with presenter replacement/revocation.
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',
    [String(req.auth.schoolId),manilaDate()+':'+slot]);
   // The presenting teacher must be explicitly assigned by the school. This
   // endpoint intentionally fails closed until a separate authorization
   // workflow for rotating presenters is available.
   if(req.auth.role==='TEACHER') {
    const permission=await client.query(
     `SELECT 1 FROM staff_lunch_presenter_assignments
       WHERE school_id=$1 AND presenter_user_id=$2 AND school_date=$3::date
       AND dtr_slot=$4 AND revoked_at IS NULL LIMIT 1`,
     [req.auth.schoolId,req.auth.userId,manilaDate(),slot]
    );
    if(!permission.rowCount){await client.query('ROLLBACK');return res.status(403).json({error:'Not assigned to present the lunch QR.'});}
   }
   const challenge=createLunchChallenge({slot});
   const id=randomUUID(),date=manilaDate();
   await client.query(
    `INSERT INTO staff_attendance_challenges
     (challenge_id,school_id,presenter_user_id,dtr_slot,school_date,challenge_hash,issued_at,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id,req.auth.schoolId,req.auth.userId,slot,date,challenge.challengeHash,challenge.issuedAt,challenge.expiresAt]
   );
   await client.query(
    `INSERT INTO staff_attendance_audit(school_id,actor_user_id,action,target_type,target_id,details)
     VALUES($1,$2,'LUNCH_CHALLENGE_ISSUED','LUNCH_CHALLENGE',$3,$4::jsonb)`,
    [req.auth.schoolId,req.auth.userId,id,JSON.stringify({slot,date})]
   );
   await client.query('COMMIT');
   return res.status(201).json({challengeId:id,token:challenge.token,slot,schoolDate:date,expiresAt:challenge.expiresAt});
  } catch(error) {
   await client.query('ROLLBACK').catch(()=>{});
   console.error('Staff lunch challenge issue failed:',error.message);
   return res.status(503).json({error:'Lunch challenge unavailable.'});
  } finally {client.release();}
 });

 // The redeeming identity always comes from the authenticated session, never
 // from a submitted staff ID or a device-supplied timestamp.
 app.post('/api/staff-attendance/lunch/redeem',authenticateSchoolClient,
  requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER'),async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  const {challengeId,token}=req.body||{};
  if(req.auth?.type!=='SCHOOL_USER'||!req.auth.schoolId||!req.auth.userId)
   return res.status(403).json({error:'Authenticated school staff required.'});
  if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(challengeId||''))||
     typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))
   return res.status(400).json({error:'Invalid lunch QR challenge.'});
  const client=await pool.connect();
  try {
   await client.query('BEGIN');
   const found=await client.query(
    `SELECT challenge_id,dtr_slot,school_date::text AS school_date,challenge_hash,
       issued_at,expires_at,revoked_at
     FROM staff_attendance_challenges
     WHERE school_id=$1 AND challenge_id=$2
       AND issued_at<=NOW() AND expires_at>NOW() AND revoked_at IS NULL
     FOR UPDATE`,[req.auth.schoolId,challengeId]);
   const row=found.rows[0],today=manilaDate();
   if(!row||!isLunchChallengeRedeemable(row,{slot:row.dtr_slot,schoolDate:today})){
    await client.query('ROLLBACK');
    return res.status(410).json({error:'Lunch QR is expired or unavailable.'});
   }
   const expected=Buffer.from(row.challenge_hash,'hex');
   const received=Buffer.from(hashLunchChallenge(token),'hex');
   if(expected.length!==32||!timingSafeEqual(expected,received)){
    await client.query('ROLLBACK');
    return res.status(403).json({error:'Invalid lunch QR.'});
   }
   const eventId=randomUUID(),clientKey=randomUUID();
   const event=await client.query(
    `INSERT INTO staff_attendance_events
      (event_id,school_id,staff_user_id,event_kind,dtr_slot,school_date,
       occurred_at,source,verification_status,verification_method,actor_user_id,client_event_key)
     SELECT $1,$2,$3,'DTR_SLOT',$4,$5,NOW(),'SELF_SERVICE','VERIFIED','ROTATING_QR',$3,$6
     WHERE EXISTS (
       SELECT 1 FROM staff_attendance_challenges
       WHERE school_id=$2 AND challenge_id=$7
         AND school_date=$5::date AND dtr_slot=$4
         AND revoked_at IS NULL AND issued_at<=NOW() AND expires_at>NOW()
     )
     ON CONFLICT DO NOTHING RETURNING event_id,occurred_at`,
    [eventId,req.auth.schoolId,req.auth.userId,row.dtr_slot,today,clientKey,challengeId]);
   if(!event.rowCount){
    await client.query('ROLLBACK');
    return res.status(409).json({error:'QR expired or this DTR slot was already verified.',alreadyRecorded:false});
   }
   await client.query(
    `INSERT INTO staff_attendance_challenge_redemptions
      (school_id,challenge_id,staff_user_id,event_id)
     VALUES($1,$2,$3,$4)`,
    [req.auth.schoolId,challengeId,req.auth.userId,eventId]);
   await client.query(
    `INSERT INTO staff_attendance_audit
      (school_id,actor_user_id,action,target_type,target_id,details)
     VALUES($1,$2,'LUNCH_DTR_VERIFIED','STAFF_ATTENDANCE_EVENT',$3,$4::jsonb)`,
    [req.auth.schoolId,req.auth.userId,eventId,JSON.stringify({slot:row.dtr_slot,schoolDate:today,challengeId})]);
   await client.query('COMMIT');
   return res.status(201).json({eventId,slot:row.dtr_slot,schoolDate:today,occurredAt:event.rows[0].occurred_at,status:'VERIFIED'});
  }catch(error){
   await client.query('ROLLBACK').catch(()=>{});
   if(error.code==='23505')return res.status(409).json({error:'This DTR slot was already recorded.',alreadyRecorded:true});
   console.error('Staff lunch redemption failed:',error.message);
   return res.status(503).json({error:'Unable to verify lunch attendance.'});
  }finally{client.release();}
 });

}
module.exports={registerStaffLunchRoutes,manilaDate};
