'use strict';
const { createLunchChallenge, validateLunchSlot } = require('./staff-lunch-challenge');
const { randomUUID } = require('node:crypto');
function manilaDate(now = new Date()) {
 const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Manila', year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(now);
 const p = Object.fromEntries(parts.map(x=>[x.type,x.value]));
 return p.year+'-'+p.month+'-'+p.day;
}
function registerStaffLunchRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}) {
 const presenter=requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER');
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
}
module.exports={registerStaffLunchRoutes,manilaDate};
