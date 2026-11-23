'use strict';
const { createLunchChallenge, validateLunchSlot, hashLunchChallenge, isLunchChallengeRedeemable } = require('./staff-lunch-challenge');
const { randomUUID, timingSafeEqual } = require('node:crypto');
const QRCode=require('qrcode');
const {validateDepartmentPoint,classifyDepartmentPresence}=require('./staff-lunch-location');
const UUID=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const LATE_DELIVERY_GRACE_MS=90_000;
const MIN_ROTATION_MS=20_000;
const MAX_ACTIVE_QR_MS=60_000;
const locationKey=departmentId=>'staff_lunch_geo_'+departmentId;

function manilaDate(now = new Date()) {
 const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Manila', year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(now);
 const p = Object.fromEntries(parts.map(x=>[x.type,x.value]));
 return p.year+'-'+p.month+'-'+p.day;
}
function registerStaffLunchRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}) {
 const presenter=requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER');

 // School Admin may authorize multiple teachers from every department.
 // Each presenter's challenges rotate independently and grants are audited.
 app.get('/api/staff-attendance/lunch/presenter',authenticateSchoolClient,
  requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER'),async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  const date=manilaDate(),slot=String(req.query?.slot||'');
  if(!['AM_OUT','PM_IN'].includes(slot))return res.status(400).json({error:'Invalid lunch slot.'});
  try{
   const found=await pool.query(
    `SELECT a.presenter_user_id AS "presenterUserId",u.display_name AS "presenterName",
      a.assigned_at AS "assignedAt",u.department_id AS "departmentId",d.department_name AS "departmentName"
     FROM staff_lunch_presenter_assignments a
     JOIN school_users u ON u.school_id=a.school_id AND u.user_id=a.presenter_user_id
     LEFT JOIN school_departments d ON d.school_id=u.school_id AND d.department_id=u.department_id
     WHERE a.school_id=$1 AND a.school_date=$2::date AND a.dtr_slot=$3
       AND a.revoked_at IS NULL AND u.active=TRUE ORDER BY d.department_name NULLS LAST,u.display_name`,
    [req.auth.schoolId,date,slot]);
   const presenters=found.rows||[],row=presenters[0]||null;
   return res.json({schoolDate:date,slot,assigned:presenters.length>0,
    presenterName:row?.presenterName||null,
    // Other teachers need to know whether they are the assigned presenter,
    // not the assigned teacher's stable internal ID.
    isCurrentPresenter:presenters.some(p=>p.presenterUserId===req.auth.userId),
    ...(req.auth.role==='SCHOOL_ADMIN'?{presenterUserId:row?.presenterUserId||null,presenters}:{}),
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
    `SELECT user_id,display_name,department_id FROM school_users
     WHERE school_id=$1 AND user_id=$2 AND role='TEACHER' AND active=TRUE`,
    [req.auth.schoolId,presenterId]);
   if(!teacher.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Active teacher not found in this school.'});}
   const current=await client.query(
    `SELECT assignment_id,presenter_user_id FROM staff_lunch_presenter_assignments
     WHERE school_id=$1 AND school_date=$2::date AND dtr_slot=$3 AND presenter_user_id=$4 AND revoked_at IS NULL FOR UPDATE`,
    [req.auth.schoolId,date,slot,presenterId]);
   if(current.rows[0]?.presenter_user_id===presenterId){
    await client.query('COMMIT');
    return res.json({schoolDate:date,slot,presenterUserId:presenterId,
     presenterName:teacher.rows[0].display_name,unchanged:true});
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
      departmentId:teacher.rows[0].department_id||null})]);
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
  const slot=String(req.body?.slot||''),date=manilaDate(),presenterId=String(req.body?.presenterUserId||'');
  if(!['AM_OUT','PM_IN'].includes(slot)||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(presenterId))
   return res.status(400).json({error:'Select a presenter and valid lunch slot.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',
    [String(req.auth.schoolId),date+':'+slot]);
   const old=await client.query(`UPDATE staff_lunch_presenter_assignments SET revoked_at=NOW()
    WHERE school_id=$1 AND school_date=$2::date AND dtr_slot=$3 AND presenter_user_id=$4 AND revoked_at IS NULL
    RETURNING assignment_id,presenter_user_id`,[req.auth.schoolId,date,slot,presenterId]);
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
   if(req.auth.role!=='SCHOOL_ADMIN') {
    const permission=await client.query(
     `SELECT 1 FROM staff_lunch_presenter_assignments
       WHERE school_id=$1 AND presenter_user_id=$2 AND school_date=$3::date
       AND dtr_slot=$4 AND revoked_at IS NULL LIMIT 1`,
     [req.auth.schoolId,req.auth.userId,manilaDate(),slot]
    );
    if(!permission.rowCount){await client.query('ROLLBACK');return res.status(403).json({error:'Not assigned to present the lunch QR.'});}
   }
   // At most one new QR every 20 seconds per presenter. Overlapping challenges
   // let a slow browser submit the previously displayed QR without trusting
   // a device-supplied clock. Tokens remain valid for only 60 seconds.
   const recent=await client.query(`SELECT issued_at FROM staff_attendance_challenges
      WHERE school_id=$1 AND school_date=$2::date AND dtr_slot=$3
        AND presenter_user_id=$4 ORDER BY issued_at DESC LIMIT 1`,
     [req.auth.schoolId,manilaDate(),slot,req.auth.userId]);
   if(recent.rows[0] && Date.now()-Date.parse(recent.rows[0].issued_at)<MIN_ROTATION_MS){
    await client.query('ROLLBACK');
    return res.status(429).json({error:'QR is already rotating. Try again in a few seconds.'});
   }
   const challenge=createLunchChallenge({slot,ttlMs:MAX_ACTIVE_QR_MS});
   const id=randomUUID(),date=manilaDate();
   // The bearer QR token lives solely in the QR image and presenter response.
   // A fragment prevents it being sent in HTTP URLs, proxies and referrers.
   const scanUrl='https://attendigo.tech/staff-lunch-checkin.html#'+
     new URLSearchParams({id,token:challenge.token}).toString();
   const qrImage=await QRCode.toDataURL(scanUrl,{
     width:360,margin:2,errorCorrectionLevel:'M'
   });
   // Preserve unexpired previous rotations for slow networks. Revocation of
   // the actual presenter assignment still immediately revokes every QR.
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
   // Remaining TTL is computed on the server; presenter device clocks are not trusted.
   const remainingMs=Math.max(0,challenge.expiresAt.getTime()-Date.now());
   return res.status(201).json({challengeId:id,token:challenge.token,qrImage,slot,schoolDate:date,expiresAt:challenge.expiresAt,remainingMs});
  } catch(error) {
   await client.query('ROLLBACK').catch(()=>{});
   console.error('Staff lunch challenge issue failed:',error.message);
   return res.status(503).json({error:'Lunch challenge unavailable.'});
  } finally {client.release();}
 });


 // Department points are deliberately configured by the School Admin on-site.
 // Use existing school_settings (JSONB) and append-only staff audit records.
 // Department Heads collect site coordinates in person. An independent School
 // Admin approves them. No client role can directly write approved coordinates.
 // Existing approved locations stay active until an approved replacement.
 const proposalKey=departmentId=>'staff_lunch_geo_proposal_'+departmentId;
 app.get('/api/staff-attendance/lunch/location',authenticateSchoolClient,
  requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD'),async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  const admin=req.auth.role==='SCHOOL_ADMIN';
  const departmentId=admin?String(req.query?.departmentId||''):String(req.auth.departmentId||'');
  if(!UUID.test(departmentId))return res.status(400).json({error:'A valid assigned department is required.'});
  try{
   const result=await pool.query(`SELECT d.department_name AS "departmentName",
     approved.setting_value AS approved,approved.updated_at AS "approvedAt",
     proposed.setting_value AS proposal
     FROM school_departments d
     LEFT JOIN school_settings approved ON approved.school_id=d.school_id AND approved.setting_key=$3
     LEFT JOIN school_settings proposed ON proposed.school_id=d.school_id AND proposed.setting_key=$4
     WHERE d.school_id=$1 AND d.department_id=$2 AND d.active=TRUE`,
    [req.auth.schoolId,departmentId,locationKey(departmentId),proposalKey(departmentId)]);
   if(!result.rowCount)return res.status(404).json({error:'Department not found or inactive.'});
   const row=result.rows[0],proposal=row.proposal;
   return res.json({departmentId,departmentName:row.departmentName,
    configured:!!row.approved,radiusMeters:row.approved?.radiusMeters||null,
    approvedAt:row.approvedAt||null,
    proposalStatus:proposal?.status||'NONE',
    proposedAt:proposal?.proposedAt||null,
    proposedByOwnAccount:proposal?.proposedBy===req.auth.userId,
    ...(admin&&proposal?.status==='PENDING'?{candidate:{
      latitude:proposal.point?.latitude,longitude:proposal.point?.longitude,
      radiusMeters:proposal.point?.radiusMeters,accuracyMeters:proposal.accuracyMeters
    }}:{})});
  }catch(error){
   console.error('Department lunch location read failed:',error.message);
   return res.status(503).json({error:'Department location unavailable.'});
  }
 });
 app.post('/api/staff-attendance/lunch/location/propose',authenticateSchoolClient,
  requireSchoolRoles('DEPARTMENT_HEAD'),async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  const departmentId=String(req.auth.departmentId||'');
  if(!UUID.test(departmentId)||req.body?.departmentId!==departmentId)
   return res.status(403).json({error:'You may submit only your assigned department location.'});
  let point;
  try{point=validateDepartmentPoint(req.body);}
  catch(error){return res.status(400).json({error:error.message});}
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const dept=await client.query(`SELECT department_id FROM school_departments
    WHERE school_id=$1 AND department_id=$2 AND active=TRUE AND department_code<>'UNASSIGNED'
    FOR SHARE`,[req.auth.schoolId,departmentId]);
   if(!dept.rowCount){await client.query('ROLLBACK');
    return res.status(403).json({error:'A valid active department assignment is required.'});}
   const proposal={status:'PENDING',proposedBy:req.auth.userId,
    proposedAt:new Date().toISOString(),point,accuracyMeters:req.body.accuracyMeters};
   await client.query(`INSERT INTO school_settings(school_id,setting_key,setting_value,updated_at)
    VALUES($1,$2,$3::jsonb,NOW()) ON CONFLICT(school_id,setting_key)
    DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=NOW()`,
    [req.auth.schoolId,proposalKey(departmentId),JSON.stringify(proposal)]);
   await client.query(`INSERT INTO staff_attendance_audit
    (school_id,actor_user_id,action,target_type,target_id,details)
    VALUES($1,$2,'LUNCH_LOCATION_PROPOSED','SCHOOL_DEPARTMENT',$3,$4::jsonb)`,
    [req.auth.schoolId,req.auth.userId,departmentId,
     JSON.stringify({accuracyMeters:proposal.accuracyMeters,radiusMeters:point.radiusMeters,
       proposedAt:proposal.proposedAt})]);
   await client.query('COMMIT');
   return res.status(201).json({status:'PENDING_APPROVAL',departmentId,
    message:'Location submitted. The School Admin must approve it before it becomes active.'});
  }catch(error){await client.query('ROLLBACK').catch(()=>{});
   console.error('Department location proposal failed:',error.message);
   return res.status(503).json({error:'Unable to submit department location.'});
  }finally{client.release();}
 });
 // The legacy direct write endpoint must not bypass independent approval.
 app.put('/api/staff-attendance/lunch/location',authenticateSchoolClient,
  requireSchoolRoles('SCHOOL_ADMIN'),(req,res)=>{
   res.set('Cache-Control','private, no-store');
   return res.status(409).json({error:'Direct location activation is disabled. Ask the Department Head to submit an on-site location for School Admin approval.'});
 });
 app.post('/api/staff-attendance/lunch/location/decision',authenticateSchoolClient,
  requireSchoolRoles('SCHOOL_ADMIN'),async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  const departmentId=String(req.body?.departmentId||''),
    decision=String(req.body?.decision||''),note=String(req.body?.note||'').trim();
  if(!UUID.test(departmentId)||!['APPROVE','REJECT'].includes(decision)||
     note.length<10||note.length>500)
   return res.status(400).json({error:'Choose a department, approval decision and reason (10–500 characters).'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const found=await client.query(`SELECT setting_value AS proposal FROM school_settings
    WHERE school_id=$1 AND setting_key=$2 FOR UPDATE`,
    [req.auth.schoolId,proposalKey(departmentId)]);
   const proposal=found.rows[0]?.proposal;
   if(!proposal||proposal.status!=='PENDING'){
    await client.query('ROLLBACK');
    return res.status(409).json({error:'There is no pending location proposal for this department.'});
   }
   const dept=await client.query(`SELECT 1 FROM school_departments
     WHERE school_id=$1 AND department_id=$2 AND active=TRUE`,
     [req.auth.schoolId,departmentId]);
   if(!dept.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Department unavailable.'});}
   if(proposal.proposedBy===req.auth.userId){
    await client.query('ROLLBACK');return res.status(403).json({error:'The location proposer cannot approve their own submission.'});
   }
   if(decision==='APPROVE'){
    try{validateDepartmentPoint({...proposal.point,accuracyMeters:proposal.accuracyMeters});}
    catch(error){await client.query('ROLLBACK');return res.status(409).json({error:'Location proposal failed integrity checks.'});}
    await client.query(`INSERT INTO school_settings(school_id,setting_key,setting_value,updated_at)
     VALUES($1,$2,$3::jsonb,NOW()) ON CONFLICT(school_id,setting_key)
     DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=NOW()`,
     [req.auth.schoolId,locationKey(departmentId),JSON.stringify(proposal.point)]);
   }
   const reviewed={...proposal,status:decision==='APPROVE'?'APPROVED':'REJECTED',
     reviewedBy:req.auth.userId,reviewedAt:new Date().toISOString()};
   await client.query(`UPDATE school_settings SET setting_value=$3::jsonb,updated_at=NOW()
     WHERE school_id=$1 AND setting_key=$2`,
     [req.auth.schoolId,proposalKey(departmentId),JSON.stringify(reviewed)]);
   await client.query(`INSERT INTO staff_attendance_audit
    (school_id,actor_user_id,action,target_type,target_id,details)
    VALUES($1,$2,$3,'SCHOOL_DEPARTMENT',$4,$5::jsonb)`,
    [req.auth.schoolId,req.auth.userId,
     decision==='APPROVE'?'LUNCH_LOCATION_APPROVED':'LUNCH_LOCATION_REJECTED',
     departmentId,JSON.stringify({reason:note,proposedBy:proposal.proposedBy,
       proposedAt:proposal.proposedAt,radiusMeters:proposal.point.radiusMeters})]);
   await client.query('COMMIT');
   return res.json({departmentId,status:reviewed.status,
    message:decision==='APPROVE'?'Approved department location is now active.':'Proposal rejected; existing approved location unchanged.'});
  }catch(error){await client.query('ROLLBACK').catch(()=>{});
   console.error('Department location decision failed:',error.message);
   return res.status(503).json({error:'Unable to review department location.'});
  }finally{client.release();}
 });
 // A pending scan never becomes an official DTR entry without independent
 // School Admin review. A presenter cannot approve anyone's pending scan.
 app.get('/api/staff-attendance/lunch/pending',authenticateSchoolClient,
  requireSchoolRoles('SCHOOL_ADMIN'),async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  try {
   const rows=await pool.query(`SELECT e.event_id AS "eventId",
    e.staff_user_id AS "staffUserId",u.display_name AS "teacherName",
    e.dtr_slot AS "slot",to_char(e.school_date,'YYYY-MM-DD') AS "schoolDate",
    e.received_at AS "receivedAt",e.notes
    FROM staff_attendance_events e
    JOIN school_users u ON u.school_id=e.school_id AND u.user_id=e.staff_user_id
    WHERE e.school_id=$1 AND e.event_kind='DTR_SLOT'
      AND e.source='SELF_SERVICE' AND e.verification_status='PENDING_VERIFICATION'
      AND e.school_date >= ($2::date - 7)
      AND e.dtr_slot IN ('AM_OUT','PM_IN')
    ORDER BY e.created_at DESC LIMIT 100`,[req.auth.schoolId,manilaDate()]);
   return res.json({items:rows.rows});
  }catch(error){console.error('Lunch pending read failed:',error.message);
   return res.status(503).json({error:'Pending lunch scans unavailable.'});}
 });
 app.post('/api/staff-attendance/lunch/review',authenticateSchoolClient,
  requireSchoolRoles('SCHOOL_ADMIN'),async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  const eventId=String(req.body?.eventId||''),decision=String(req.body?.decision||'');
  const note=String(req.body?.note||'').trim();
  if(!UUID.test(eventId)||!['VERIFY','REJECT'].includes(decision)||note.length<10||note.length>500)
   return res.status(400).json({error:'Choose a pending scan, decision and a reason of 10–500 characters.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const found=await client.query(`SELECT staff_user_id,dtr_slot,
      to_char(school_date,'YYYY-MM-DD') AS "schoolDate",
      occurred_at,verification_status
    FROM staff_attendance_events WHERE school_id=$1 AND event_id=$2
    AND event_kind='DTR_SLOT' AND source='SELF_SERVICE' FOR UPDATE`,
    [req.auth.schoolId,eventId]);
   const record=found.rows[0];
   if(!record||record.verification_status!=='PENDING_VERIFICATION'){
    await client.query('ROLLBACK');return res.status(409).json({error:'This scan is no longer pending.'});
   }
   if(record.staff_user_id===req.auth.userId){
    await client.query('ROLLBACK');return res.status(403).json({error:'You cannot approve your own attendance.'});
   }
   if(decision==='VERIFY'){
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',
      [req.auth.schoolId+':leave:'+record.staff_user_id]);
    const leave=await client.query(`SELECT 1 FROM staff_form48_approved_leaves
      WHERE school_id=$1 AND staff_user_id=$2 AND revoked_at IS NULL
      AND start_date<=$3::date AND end_date>=$3::date
      UNION ALL
      SELECT 1 FROM school_users WHERE school_id=$1 AND user_id=$2
      AND teacher_status='ON_LEAVE' AND leave_start_date<=$3::date
      AND expected_return_date>=$3::date LIMIT 1`,
      [req.auth.schoolId,record.staff_user_id,record.schoolDate]);
    if(leave.rowCount){
     await client.query('ROLLBACK');
     return res.status(409).json({error:'Approved leave overlaps this scan. Resolve the leave/DTR conflict through the approved review workflow.'});
    }
    const ob=await client.query(`SELECT 1 FROM staff_official_business_requests
      WHERE school_id=$1 AND staff_user_id=$2 AND status='APPROVED'
        AND starts_at<=$3 AND ends_at>=$3 LIMIT 1`,
      [req.auth.schoolId,record.staff_user_id,record.occurred_at]);
    if(ob.rowCount){await client.query('ROLLBACK');
      return res.status(409).json({error:'Official Business overlaps this scan. Resolve the OB/DTR conflict before verification.'});}
    const closed=await client.query(`SELECT 1 FROM school_calendar_exceptions
      WHERE school_id=$1 AND calendar_date=$2::date
      AND exception_type='CLOSED' LIMIT 1`,[req.auth.schoolId,record.schoolDate]);
    if(closed.rowCount){await client.query('ROLLBACK');
      return res.status(409).json({error:'School calendar lists this day as closed. Use the school attendance exception workflow.'});}
   }
   const status=decision==='VERIFY'?'VERIFIED':'REJECTED';
   const updated=await client.query(`UPDATE staff_attendance_events
    SET verification_status=$3,
      verification_method=CASE WHEN $3='VERIFIED' THEN 'MANUAL_REVIEW' ELSE NULL END
    WHERE school_id=$1 AND event_id=$2 AND verification_status='PENDING_VERIFICATION'
    RETURNING event_id`,[req.auth.schoolId,eventId,status]);
   if(!updated.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'Scan already reviewed.'});}
   await client.query(`INSERT INTO staff_attendance_audit
    (school_id,actor_user_id,action,target_type,target_id,details)
    VALUES($1,$2,$3,'STAFF_ATTENDANCE_EVENT',$4,$5::jsonb)`,
    [req.auth.schoolId,req.auth.userId,decision==='VERIFY'?'LUNCH_DTR_MANUAL_VERIFIED':'LUNCH_DTR_REJECTED',eventId,
     JSON.stringify({reason:note,staffUserId:record.staff_user_id,slot:record.dtr_slot,schoolDate:record.schoolDate})]);
   await client.query('COMMIT');
   return res.json({eventId,status});
  }catch(error){await client.query('ROLLBACK').catch(()=>{});
   if(error.code==='23505')return res.status(409).json({error:'This DTR slot already has a verified entry.'});
   console.error('Lunch manual review failed:',error.message);return res.status(503).json({error:'Unable to review pending lunch scan.'});
  }finally{client.release();}
 });

 // Identity is taken only from the HttpOnly staff session. Location supplied
 // by a browser is a spoofable risk signal; it is never a trusted timestamp.
 app.post('/api/staff-attendance/lunch/redeem',authenticateSchoolClient,
  requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER'),async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  const {challengeId,token}=req.body||{};
  if(req.auth?.type!=='SCHOOL_USER'||!req.auth.schoolId||!req.auth.userId)
   return res.status(403).json({error:'Authenticated school staff required.'});
  if(!UUID.test(String(challengeId||''))||typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))
   return res.status(400).json({error:'Invalid lunch QR challenge.'});
  const client=await pool.connect();
  try {
   await client.query('BEGIN');
   const found=await client.query(`SELECT c.challenge_id,c.dtr_slot,
      c.school_date::text AS school_date,c.challenge_hash,
      c.issued_at,c.expires_at,c.revoked_at,c.presenter_user_id,
      p.department_id,p.role AS presenter_role
     FROM staff_attendance_challenges c
     JOIN school_users p ON p.school_id=c.school_id AND p.user_id=c.presenter_user_id AND p.active=TRUE
     WHERE c.school_id=$1 AND c.challenge_id=$2
       AND c.issued_at<=NOW() AND c.expires_at>NOW()-INTERVAL '90 seconds'
       AND c.revoked_at IS NULL
     FOR UPDATE OF c`,[req.auth.schoolId,challengeId]);
   const row=found.rows[0],today=manilaDate(),now=Date.now();
   const issued=Date.parse(row?.issued_at),expires=Date.parse(row?.expires_at);
   if(!row||row.school_date!==today||!Number.isFinite(issued)||!Number.isFinite(expires)||
      expires<=issued||expires-issued>5*60_000||now<issued||
      now>=expires+LATE_DELIVERY_GRACE_MS){
    await client.query('ROLLBACK');
    return res.status(410).json({error:'Lunch QR expired. Scan the currently displayed QR or use the Gatekeeper fallback.'});
   }
   const expected=Buffer.from(row.challenge_hash,'hex');
   const received=Buffer.from(hashLunchChallenge(token),'hex');
   if(expected.length!==32||!timingSafeEqual(expected,received)){
    await client.query('ROLLBACK');return res.status(403).json({error:'Invalid lunch QR.'});
   }
   if(row.presenter_role!=='SCHOOL_ADMIN'){
    const permission=await client.query(`SELECT 1 FROM staff_lunch_presenter_assignments
       WHERE school_id=$1 AND presenter_user_id=$2 AND school_date=$3::date
       AND dtr_slot=$4 AND revoked_at IS NULL LIMIT 1`,
      [req.auth.schoolId,row.presenter_user_id,today,row.dtr_slot]);
    if(!permission.rowCount){await client.query('ROLLBACK');return res.status(410).json({error:'Presenter is no longer authorized.'});}
   }
   // Serialize duplicates from concurrent scans without changing existing DTR
   // calculation or the unique verified-slot database constraint.
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',
    [req.auth.schoolId+':lunch:'+req.auth.userId+':'+today+':'+row.dtr_slot]);
   const existing=await client.query(`SELECT verification_status FROM staff_attendance_events
    WHERE school_id=$1 AND staff_user_id=$2 AND school_date=$3::date
    AND dtr_slot=$4 AND event_kind='DTR_SLOT'
    AND verification_status IN ('VERIFIED','PENDING_VERIFICATION') LIMIT 1`,
    [req.auth.schoolId,req.auth.userId,today,row.dtr_slot]);
   if(existing.rowCount){
    await client.query('ROLLBACK');
    return res.status(409).json({error:existing.rows[0].verification_status==='VERIFIED'?
      'This lunch DTR slot has already been recorded.':'Your lunch scan is pending review. Contact the School Admin.',
      alreadyRecorded:existing.rows[0].verification_status==='VERIFIED'});
   }
   const pointRow=await client.query(`SELECT setting_value AS point FROM school_settings
    WHERE school_id=$1 AND setting_key=$2`,
    [req.auth.schoolId,locationKey(row.department_id)]);
   const presence=classifyDepartmentPresence(pointRow.rows[0]?.point,req.body?.location,now);
   const reasons=[];
   if(now>=expires)reasons.push('LATE_DELIVERY');
   if(!presence.verified)reasons.push(presence.reason);
   if(row.presenter_user_id===req.auth.userId)reasons.push('SELF_SCAN_BY_PRESENTER');
   // A DTR punch during an approved leave requires independent reconciliation.
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',
    [req.auth.schoolId+':leave:'+req.auth.userId]);
   const leave=await client.query(`SELECT 1 FROM staff_form48_approved_leaves
    WHERE school_id=$1 AND staff_user_id=$2 AND revoked_at IS NULL
    AND start_date<=$3::date AND end_date>=$3::date
    UNION ALL SELECT 1 FROM school_users WHERE school_id=$1 AND user_id=$2
    AND teacher_status='ON_LEAVE' AND leave_start_date<=$3::date
    AND expected_return_date>=$3::date LIMIT 1`,
    [req.auth.schoolId,req.auth.userId,today]);
   if(leave.rowCount)reasons.push('APPROVED_LEAVE_CONFLICT');
   const ob=await client.query(`SELECT 1 FROM staff_official_business_requests
    WHERE school_id=$1 AND staff_user_id=$2 AND status='APPROVED'
    AND starts_at<=NOW() AND ends_at>=NOW() LIMIT 1`,
    [req.auth.schoolId,req.auth.userId]);
   if(ob.rowCount)reasons.push('APPROVED_OB_CONFLICT');
   const closed=await client.query(`SELECT 1 FROM school_calendar_exceptions
    WHERE school_id=$1 AND calendar_date=$2::date AND exception_type='CLOSED' LIMIT 1`,
    [req.auth.schoolId,today]);
   if(closed.rowCount)reasons.push('CLOSED_SCHOOL_DAY');
   const verification=reasons.length?'PENDING_VERIFICATION':'VERIFIED';
   const verificationMethod=reasons.length?null:'ROTATING_QR';
   const eventId=randomUUID(),clientKey=randomUUID();
   const event=await client.query(`INSERT INTO staff_attendance_events
      (event_id,school_id,staff_user_id,event_kind,dtr_slot,school_date,
       occurred_at,source,verification_status,verification_method,actor_user_id,client_event_key,notes)
     SELECT $1,$2,$3,'DTR_SLOT',$4,$5,NOW(),'SELF_SERVICE',$6,$7,$3,$8,$10
     WHERE EXISTS (
       SELECT 1 FROM staff_attendance_challenges
       WHERE school_id=$2 AND challenge_id=$9 AND school_date=$5::date
         AND dtr_slot=$4 AND revoked_at IS NULL AND issued_at<=NOW()
         AND expires_at>NOW()-INTERVAL '90 seconds'
     )
     ON CONFLICT DO NOTHING RETURNING event_id,occurred_at`,
    [eventId,req.auth.schoolId,req.auth.userId,row.dtr_slot,today,
     verification,verificationMethod,clientKey,challengeId,
     reasons.length?'QR scan requires review: '+reasons.join(', '):null]);
   if(!event.rowCount){
    await client.query('ROLLBACK');
    return res.status(409).json({error:'QR expired or this DTR slot was already recorded.',alreadyRecorded:false});
   }
   await client.query(`INSERT INTO staff_attendance_challenge_redemptions
      (school_id,challenge_id,staff_user_id,event_id) VALUES($1,$2,$3,$4)`,
    [req.auth.schoolId,challengeId,req.auth.userId,eventId]);
   await client.query(`INSERT INTO staff_attendance_audit
      (school_id,actor_user_id,action,target_type,target_id,details)
     VALUES($1,$2,$3,'STAFF_ATTENDANCE_EVENT',$4,$5::jsonb)`,
    [req.auth.schoolId,req.auth.userId,reasons.length?'LUNCH_SCAN_REVIEW_REQUIRED':'LUNCH_DTR_VERIFIED',eventId,
     JSON.stringify({slot:row.dtr_slot,schoolDate:today,challengeId,presenterUserId:row.presenter_user_id,
       departmentId:row.department_id,presence:presence.reason,distanceMeters:presence.distanceMeters??null,
       accuracyMeters:presence.accuracyMeters??null,flags:reasons})]);
   await client.query('COMMIT');
   return res.status(201).json({eventId,slot:row.dtr_slot,schoolDate:today,
    occurredAt:event.rows[0].occurred_at,status:verification,
    message:reasons.length?'Scan received; School Admin review is required. This is not yet a verified DTR entry.':
      'Lunch DTR verified.'});
  }catch(error){
   await client.query('ROLLBACK').catch(()=>{});
   if(error.code==='23505')return res.status(409).json({error:'This DTR slot was already recorded.',alreadyRecorded:true});
   console.error('Staff lunch redemption failed:',error.message);
   return res.status(503).json({error:'Unable to verify lunch attendance.'});
  }finally{client.release();}
 });

}
module.exports={registerStaffLunchRoutes,manilaDate};
