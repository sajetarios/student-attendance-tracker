'use strict';
const { createLunchChallenge, validateLunchSlot, hashLunchChallenge, isLunchChallengeRedeemable } = require('./staff-lunch-challenge');
const { randomUUID, timingSafeEqual } = require('node:crypto');
const QRCode=require('qrcode');
const {readWindows,localTime,withinWindow,officialScheduleDecision}=require('./staff-lunch-windows');
const {validCampus,containsDepartment,campusById,trustedDepartmentPoint}=require('./staff-lunch-campus');
const {validateDepartmentPoint,classifyDepartmentPresence,assessLocationEvidence,distanceMeters}=require('./staff-lunch-location');
const UUID=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const LATE_DELIVERY_GRACE_MS=90_000;
const MIN_ROTATION_MS=20_000;
const MAX_ACTIVE_QR_MS=60_000;
const locationKey=departmentId=>'staff_lunch_geo_'+departmentId;
const configKey=departmentId=>'staff_lunch_config_'+departmentId;
const ownDepartment=req=>UUID.test(String(req.auth?.departmentId||''))?String(req.auth.departmentId):null;
async function lockLunchSlots(client,schoolId){
 for(const slot of ['AM_OUT','PM_IN']) await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[String(schoolId),manilaDate()+':'+slot]);
}
async function revokeDepartmentCodes(client,schoolId,departmentId){
 return client.query(`UPDATE staff_attendance_challenges c SET revoked_at=NOW()
  WHERE c.school_id=$1 AND c.department_id=$2 AND c.revoked_at IS NULL
  AND c.expires_at>NOW()-INTERVAL '90 seconds'`,[schoolId,departmentId]);
}

function manilaDate(now = new Date()) {
 const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Manila', year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(now);
 const p = Object.fromEntries(parts.map(x=>[x.type,x.value]));
 return p.year+'-'+p.month+'-'+p.day;
}
function registerStaffLunchRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}) {
 const presenter=requireSchoolRoles('TEACHER');

 // Department Heads authorize multiple teachers within their own active department.
 // Each presenter's challenges rotate independently and grants are audited.
 app.get('/api/staff-attendance/lunch/presenter',authenticateSchoolClient,
  requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER'),async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  const date=manilaDate(),slot=String(req.query?.slot||'');
  const admin=req.auth.role==='SCHOOL_ADMIN',departmentId=ownDepartment(req);
  if(!admin&&!departmentId)return res.status(403).json({error:'An assigned department is required.'});
  if(!['AM_OUT','PM_IN'].includes(slot))return res.status(400).json({error:'Invalid lunch slot.'});
  try{
   const found=await pool.query(
    `SELECT a.presenter_user_id AS "presenterUserId",u.display_name AS "presenterName",
      a.assigned_at AS "assignedAt",u.department_id AS "departmentId",d.department_name AS "departmentName"
     FROM staff_lunch_presenter_assignments a
     JOIN school_users u ON u.school_id=a.school_id AND u.user_id=a.presenter_user_id
     LEFT JOIN school_departments d ON d.school_id=u.school_id AND d.department_id=u.department_id
     WHERE a.school_id=$1 AND a.school_date=$2::date AND a.dtr_slot=$3
       AND a.revoked_at IS NULL AND a.department_id=u.department_id AND u.active=TRUE AND d.active=TRUE AND d.department_code<>'UNASSIGNED'
       AND ($4::uuid IS NULL OR u.department_id=$4::uuid)
     ORDER BY d.department_name NULLS LAST,u.display_name`,
    [req.auth.schoolId,date,slot,admin?null:departmentId]);
   const presenters=found.rows||[],row=presenters[0]||null;
   const config=departmentId?await pool.query('SELECT setting_value FROM school_settings WHERE school_id=$1 AND setting_key=$2',[req.auth.schoolId,configKey(departmentId)]):null;
   const enabled=config?.rows[0]?.setting_value?.enabled!==false;
   return res.json({schoolDate:date,slot,enabled,windows:config?.rows[0]?.setting_value?.windows||null,assigned:enabled&&presenters.length>0,
    presenterName:row?.presenterName||null,
    // Other teachers need to know whether they are the assigned presenter,
    // not the assigned teacher's stable internal ID.
    isCurrentPresenter:enabled&&presenters.some(p=>p.presenterUserId===req.auth.userId),
    ...(['SCHOOL_ADMIN','DEPARTMENT_HEAD'].includes(req.auth.role)?{presenterUserId:row?.presenterUserId||null,presenters}:{}),
    assignedAt:row?.assignedAt||null});
  }catch(error){console.error('Lunch presenter read failed:',error.message);return res.status(503).json({error:'Presenter unavailable.'});}
 });
 app.put('/api/staff-attendance/lunch/presenter',authenticateSchoolClient,
  requireSchoolRoles('DEPARTMENT_HEAD'),async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  const departmentId=ownDepartment(req);
  if(!departmentId)return res.status(403).json({error:'An assigned department is required.'});
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
     WHERE school_id=$1 AND user_id=$2 AND role='TEACHER' AND active=TRUE
      AND department_id=$3 AND EXISTS(SELECT 1 FROM school_departments d WHERE d.school_id=$1 AND d.department_id=$3 AND d.active=TRUE AND d.department_code<>'UNASSIGNED')
      FOR SHARE`,
    [req.auth.schoolId,presenterId,departmentId]);
   if(!teacher.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Active teacher not found in your assigned department.'});}
   const current=await client.query(
    `SELECT assignment_id,presenter_user_id,department_id FROM staff_lunch_presenter_assignments
     WHERE school_id=$1 AND school_date=$2::date AND dtr_slot=$3 AND presenter_user_id=$4 AND revoked_at IS NULL FOR UPDATE`,
    [req.auth.schoolId,date,slot,presenterId]);
   if(current.rows[0]?.presenter_user_id===presenterId&&String(current.rows[0].department_id)===departmentId){
    await client.query('COMMIT');
    return res.json({schoolDate:date,slot,presenterUserId:presenterId,
     presenterName:teacher.rows[0].display_name,unchanged:true});
   }
   if(current.rowCount){
    await client.query('ROLLBACK');return res.status(409).json({error:'A stale presenter grant requires revocation before reassignment.'});
   }
   const inserted=await client.query(
    `INSERT INTO staff_lunch_presenter_assignments
      (school_id,presenter_user_id,school_date,dtr_slot,assigned_by_user_id,department_id)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING assignment_id`,
    [req.auth.schoolId,presenterId,date,slot,req.auth.userId,departmentId]);
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
  requireSchoolRoles('DEPARTMENT_HEAD'),async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  const departmentId=ownDepartment(req);
  if(!departmentId)return res.status(403).json({error:'An assigned department is required.'});
  const slot=String(req.body?.slot||''),date=manilaDate(),presenterId=String(req.body?.presenterUserId||'');
  if(!['AM_OUT','PM_IN'].includes(slot)||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(presenterId))
   return res.status(400).json({error:'Select a presenter and valid lunch slot.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',
    [String(req.auth.schoolId),date+':'+slot]);
   const allowed=await client.query(`SELECT 1 FROM school_users u JOIN school_departments d ON d.school_id=u.school_id AND d.department_id=u.department_id WHERE u.school_id=$1 AND u.user_id=$2 AND u.department_id=$3 AND u.role='TEACHER' AND d.active=TRUE AND d.department_code<>'UNASSIGNED' FOR SHARE OF u,d`,[req.auth.schoolId,presenterId,departmentId]);
   if(!allowed.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Presenter not found in your assigned department.'});}
   const old=await client.query(`UPDATE staff_lunch_presenter_assignments SET revoked_at=NOW()
    WHERE school_id=$1 AND school_date=$2::date AND dtr_slot=$3 AND presenter_user_id=$4 AND department_id=$5 AND revoked_at IS NULL
    RETURNING assignment_id,presenter_user_id`,[req.auth.schoolId,date,slot,presenterId,departmentId]);
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
   {
    const permission=await client.query(
     `SELECT 1 FROM staff_lunch_presenter_assignments a JOIN school_users u ON u.school_id=a.school_id AND u.user_id=a.presenter_user_id AND u.department_id=a.department_id
       WHERE a.school_id=$1 AND a.presenter_user_id=$2 AND a.school_date=$3::date
       AND a.dtr_slot=$4 AND a.revoked_at IS NULL AND u.active=TRUE AND u.role='TEACHER' LIMIT 1 FOR SHARE OF u`,
     [req.auth.schoolId,req.auth.userId,manilaDate(),slot]
    );
    if(!permission.rowCount){await client.query('ROLLBACK');return res.status(403).json({error:'Not assigned to present the lunch QR.'});}
   }
   // Resolve the presenter's current department and approved point on the server.
   // An administrator is not exempt from the same GPS requirement.
   const department=await client.query(`SELECT d.department_id,s.setting_value AS point,c.setting_value AS config
     FROM school_users u
     JOIN school_departments d ON d.school_id=u.school_id AND d.department_id=u.department_id
     LEFT JOIN school_settings s ON s.school_id=d.school_id
       AND s.setting_key='staff_lunch_geo_'||d.department_id::text
     LEFT JOIN school_settings c ON c.school_id=d.school_id AND c.setting_key='staff_lunch_config_'||d.department_id::text
     WHERE u.school_id=$1 AND u.user_id=$2 AND u.active=TRUE
       AND d.active=TRUE AND d.department_code<>'UNASSIGNED' FOR SHARE OF u,d`,
     [req.auth.schoolId,req.auth.userId]);
   const location=department.rows[0],now=Date.now();
   if(location?.config?.enabled===false){await client.query('ROLLBACK');return res.status(403).json({error:'Lunch QR is disabled for your department. Use supervised Gatekeeper scanning.'});}
   if(!withinWindow(location?.config?.windows,slot,localTime(new Date(now)))){await client.query('ROLLBACK');return res.status(403).json({code:'OUTSIDE_DEPARTMENT_QR_WINDOW',error:'This department QR slot is outside its configured operating window. Use supervised Gatekeeper scanning.'});}
   const evidence=assessLocationEvidence(req.body?.location,now);
   const trustedPoint=await trustedDepartmentPoint(client,req.auth.schoolId,location?.point);
   let presence=classifyDepartmentPresence(trustedPoint,req.body?.location,now);
   if(presence.verified&&now-evidence.point.capturedAt>30000)
    presence={verified:false,reason:'LOCATION_SAMPLE_STALE'};
   if(!presence.verified){
    // Only invalidate this presenter's own outstanding codes for this slot.
    // Commit the revocation even though QR issuance itself is refused.
    const revoked=await client.query(`UPDATE staff_attendance_challenges SET revoked_at=NOW()
     WHERE school_id=$1 AND school_date=$2::date AND dtr_slot=$3
       AND presenter_user_id=$4 AND revoked_at IS NULL
       AND expires_at>NOW()-INTERVAL '90 seconds'`,
     [req.auth.schoolId,manilaDate(),slot,req.auth.userId]);
    if(revoked.rowCount)await client.query(`INSERT INTO staff_attendance_audit
     (school_id,actor_user_id,action,target_type,target_id,details)
     VALUES($1,$2,'LUNCH_PRESENTER_LOCATION_BLOCKED','SCHOOL_USER',$2,$3::jsonb)`,
     [req.auth.schoolId,req.auth.userId,JSON.stringify({slot,reason:presence.reason,revoked:revoked.rowCount})]);
    await client.query('COMMIT');
    const messages={
     DEPARTMENT_LOCATION_NOT_CONFIGURED:'Your department has no active attendance location. Ask your Department Head.',
     OUTSIDE_DEPARTMENT_AREA:'You are outside the approved department attendance area.',
     DEPARTMENT_BOUNDARY_UNCERTAIN:'Your GPS accuracy overlaps the department boundary. Move closer to the approved point and retry.',
     LOCATION_NOT_AVAILABLE:'Location is unavailable. Enable precise location and try again.',
     LOCATION_SAMPLE_STALE:'Your GPS reading is too old. Request a fresh location and retry.'
    };
    return res.status(403).json({error:messages[presence.reason]||'GPS evidence is not precise or consistent enough. Move closer to the department and retry.',
      code:presence.reason,locationVerified:false});
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
     (challenge_id,school_id,presenter_user_id,dtr_slot,school_date,challenge_hash,issued_at,expires_at,department_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id,req.auth.schoolId,req.auth.userId,slot,date,challenge.challengeHash,challenge.issuedAt,challenge.expiresAt,location.department_id]
   );
   await client.query(
    `INSERT INTO staff_attendance_audit(school_id,actor_user_id,action,target_type,target_id,details)
     VALUES($1,$2,'LUNCH_CHALLENGE_ISSUED','LUNCH_CHALLENGE',$3,$4::jsonb)`,
    [req.auth.schoolId,req.auth.userId,id,JSON.stringify({slot,date,presenterLocationVerified:true,
      departmentId:location.department_id,accuracyMeters:presence.accuracyMeters})]
   );
   await client.query('COMMIT');
   // Remaining TTL is computed on the server; presenter device clocks are not trusted.
   const remainingMs=Math.max(0,challenge.expiresAt.getTime()-Date.now());
   return res.status(201).json({challengeId:id,token:challenge.token,qrImage,slot,schoolDate:date,expiresAt:challenge.expiresAt,remainingMs,locationVerified:true});
  } catch(error) {
   await client.query('ROLLBACK').catch(()=>{});
   console.error('Staff lunch challenge issue failed:',error.message);
   return res.status(503).json({error:'Lunch challenge unavailable.'});
  } finally {client.release();}
 });


 // Operational QR switch only: never changes official working hours or DTR requirements.
 app.put('/api/staff-attendance/lunch/config',authenticateSchoolClient,requireSchoolRoles('DEPARTMENT_HEAD'),async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  const departmentId=ownDepartment(req),enabled=req.body?.enabled;
  if(!departmentId)return res.status(403).json({error:'An assigned department is required.'});
  if(typeof enabled!=='boolean')return res.status(400).json({error:'A boolean enabled value is required.'});
  const provided=Object.hasOwn(req.body||{},'windows');
  const windows=provided?readWindows(req.body.windows):undefined;
  if(provided&&windows===undefined)return res.status(400).json({error:'Provide valid start and end times for AM Out and PM In, or disable optional operating windows.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await lockLunchSlots(client,req.auth.schoolId);
   const dept=await client.query("SELECT 1 FROM school_departments WHERE school_id=$1 AND department_id=$2 AND active=TRUE AND department_code<>'UNASSIGNED' FOR SHARE",[req.auth.schoolId,departmentId]);
   if(!dept.rowCount){await client.query('ROLLBACK');return res.status(403).json({error:'Active department required.'});}
   const prior=await client.query('SELECT setting_value FROM school_settings WHERE school_id=$1 AND setting_key=$2 FOR UPDATE',[req.auth.schoolId,configKey(departmentId)]);
   const previous=prior.rows[0]?.setting_value||{};
   const next={...previous,enabled,windows:provided?windows:previous.windows||null};
   await client.query(`INSERT INTO school_settings(school_id,setting_key,setting_value,updated_at)
    VALUES($1,$2,$3::jsonb,NOW()) ON CONFLICT(school_id,setting_key)
    DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=NOW()`,[req.auth.schoolId,configKey(departmentId),JSON.stringify(next)]);
   if(!enabled||provided)await revokeDepartmentCodes(client,req.auth.schoolId,departmentId);
   await client.query(`INSERT INTO staff_attendance_audit(school_id,actor_user_id,action,target_type,target_id,details)
    VALUES($1,$2,'LUNCH_CONFIG_CHANGED','SCHOOL_DEPARTMENT',$3,$4::jsonb)`,[req.auth.schoolId,req.auth.userId,departmentId,JSON.stringify({previousEnabled:prior.rows[0]?.setting_value?.enabled!==false,enabled,previousWindows:previous.windows||null,windows:next.windows})]);
   await client.query('COMMIT');
   return res.json({enabled,departmentId,windows:next.windows});
  }catch(error){await client.query('ROLLBACK').catch(()=>{});return res.status(503).json({error:'Unable to save lunch QR configuration.'});}
  finally{client.release();}
 });
 // Department Heads capture fresh on-site coordinates; the server validates and audits activation.
 // Use existing school_settings (JSONB) and append-only staff audit records.
 // Existing approved locations remain active until a fresh, validated replacement.
 const proposalKey=departmentId=>'staff_lunch_geo_proposal_'+departmentId;
 // Rare institutional onboarding, not a per-department approval queue.
 app.get('/api/staff-attendance/lunch/campuses',authenticateSchoolClient,requireSchoolRoles('PRINCIPAL','DEPARTMENT_HEAD','SCHOOL_ADMIN'),async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  try{
   const management=req.auth.role==='PRINCIPAL';
   const r=await pool.query(`SELECT campus_id AS "campusId",name,radius_meters AS "radiusMeters",active
    ${management?',latitude,longitude,evidence_reference AS "evidenceReference",authorized_at AS "authorizedAt"':''}
    FROM staff_lunch_campuses WHERE school_id=$1 AND ($2::boolean OR active=TRUE) ORDER BY active DESC,name`,[req.auth.schoolId,management]);
   return res.json({campuses:r.rows});
  }catch(e){return res.status(503).json({error:'Trusted campus registry unavailable.'});}
 });
 app.post('/api/staff-attendance/lunch/campuses',authenticateSchoolClient,requireSchoolRoles('PRINCIPAL'),async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  const input=req.body||{},name=String(input.name||'').trim(),reference=String(input.evidenceReference||'').trim();
  if(!validCampus(input)||name.length<2||name.length>100||reference.length<10||reference.length>500||input.attested!==true)
   return res.status(400).json({error:'Enter independently verified campus coordinates, a 100–5000 m radius, an evidence reference and explicit institutional attestation.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const r=await client.query(`INSERT INTO staff_lunch_campuses(school_id,name,latitude,longitude,radius_meters,evidence_reference,authorized_by)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING campus_id AS "campusId"`,[req.auth.schoolId,name,input.latitude,input.longitude,input.radiusMeters,reference,req.auth.userId]);
   const campusId=r.rows[0].campusId;
   await client.query(`INSERT INTO staff_attendance_audit(school_id,actor_user_id,action,target_type,target_id,details)
    VALUES($1,$2,'LUNCH_CAMPUS_AUTHORIZED','SCHOOL_CAMPUS',$3,$4::jsonb)`,[req.auth.schoolId,req.auth.userId,campusId,JSON.stringify({name,latitude:input.latitude,longitude:input.longitude,radiusMeters:input.radiusMeters,evidenceReference:reference})]);
   await client.query('COMMIT');return res.status(201).json({campusId,name});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});return res.status(e.code==='23505'?409:503).json({error:'Unable to register campus; no authorization was confirmed.'});}
  finally{client.release();}
 });
 // Campus records cannot be edited or reactivated. Retirement fails closed on every subsequent issue/redeem.
 app.post('/api/staff-attendance/lunch/campuses/retire',authenticateSchoolClient,requireSchoolRoles('PRINCIPAL'),async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  const campusId=String(req.body?.campusId||''),reason=String(req.body?.reason||'').trim();
  if(!UUID.test(campusId)||reason.length<10||reason.length>500)return res.status(400).json({error:'Campus and documented retirement reason required.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const r=await client.query('UPDATE staff_lunch_campuses SET active=FALSE,retired_at=NOW() WHERE school_id=$1 AND campus_id=$2 AND active=TRUE RETURNING campus_id',[req.auth.schoolId,campusId]);
   if(!r.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Active campus not found.'});}
   await client.query(`INSERT INTO staff_attendance_audit(school_id,actor_user_id,action,target_type,target_id,details)
    VALUES($1,$2,'LUNCH_CAMPUS_RETIRED','SCHOOL_CAMPUS',$3,$4::jsonb)`,[req.auth.schoolId,req.auth.userId,campusId,JSON.stringify({reason})]);
   await client.query('COMMIT');return res.json({campusId,active:false});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});return res.status(503).json({error:'Campus retirement could not be confirmed.'});}
  finally{client.release();}
 });
 // Exceptional relocation is independent of routine department setup. The old
 // location stays in history, but cannot authorize QR until fresh on-site capture.
 app.get('/api/staff-attendance/lunch/relocation-departments',authenticateSchoolClient,requireSchoolRoles('PRINCIPAL'),async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  try{
   const r=await pool.query(`SELECT d.department_id AS "departmentId",d.department_name AS "departmentName",
    s.setting_value->>'campusId' AS "campusId",s.setting_value->'relocationPending'->>'campusId' AS "pendingCampusId"
    FROM school_departments d JOIN school_settings s ON s.school_id=d.school_id AND s.setting_key='staff_lunch_geo_'||d.department_id::text
    WHERE d.school_id=$1 AND d.active=TRUE AND d.department_code<>'UNASSIGNED' ORDER BY d.department_name`,[req.auth.schoolId]);
   return res.json({departments:r.rows});
  }catch(e){return res.status(503).json({error:'Department relocation list unavailable.'});}
 });
 app.post('/api/staff-attendance/lunch/location/relocate',authenticateSchoolClient,requireSchoolRoles('PRINCIPAL'),async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  const departmentId=String(req.body?.departmentId||''),campusId=String(req.body?.campusId||''),reason=String(req.body?.reason||'').trim();
  if(!UUID.test(departmentId)||!UUID.test(campusId)||reason.length<10||reason.length>500||req.body?.attested!==true)
   return res.status(400).json({error:'Select an established department, trusted destination campus, and documented independent authorization.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await lockLunchSlots(client,req.auth.schoolId);
   const dept=await client.query("SELECT department_id FROM school_departments WHERE school_id=$1 AND department_id=$2 AND active=TRUE AND department_code<>'UNASSIGNED' FOR SHARE",[req.auth.schoolId,departmentId]);
   const campus=await campusById(client,req.auth.schoolId,campusId,true);
   if(!dept.rowCount||!campus){await client.query('ROLLBACK');return res.status(404).json({error:'Active department or campus not found in this school.'});}
   const old=await client.query('SELECT setting_value AS point FROM school_settings WHERE school_id=$1 AND setting_key=$2 FOR UPDATE',[req.auth.schoolId,locationKey(departmentId)]);
   const previous=old.rows[0]?.point;
   if(!previous||previous.relocationPending||previous.campusId===campusId){await client.query('ROLLBACK');return res.status(409).json({error:'No eligible relocation, or a relocation is already pending.'});}
   const relocationPending={campusId,authorizedBy:req.auth.userId,authorizedAt:new Date().toISOString()};
   await client.query('UPDATE school_settings SET setting_value=$3::jsonb,updated_at=NOW() WHERE school_id=$1 AND setting_key=$2',[req.auth.schoolId,locationKey(departmentId),JSON.stringify({...previous,relocationPending})]);
   const revoked=await revokeDepartmentCodes(client,req.auth.schoolId,departmentId);
   await client.query(`INSERT INTO staff_attendance_audit(school_id,actor_user_id,action,target_type,target_id,details)
     VALUES($1,$2,'LUNCH_LOCATION_RELOCATION_AUTHORIZED','SCHOOL_DEPARTMENT',$3,$4::jsonb)`,[req.auth.schoolId,req.auth.userId,departmentId,JSON.stringify({previous,destinationCampusId:campusId,reason,revoked:revoked.rowCount})]);
   await client.query('COMMIT');return res.status(201).json({status:'RELOCATION_PENDING',departmentId,campusId});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});return res.status(503).json({error:'Relocation authorization could not be confirmed.'});}
  finally{client.release();}
 });
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
   const campus=row.approved?.campusId?await campusById(pool,req.auth.schoolId,row.approved.campusId):null;
   return res.json({departmentId,departmentName:row.departmentName,
    campusId:row.approved?.relocationPending?.campusId||row.approved?.campusId||null,campusName:campus?.name||null,
    relocationPending:!!row.approved?.relocationPending,
    configured:!!row.approved&&!row.approved.relocationPending&&(!row.approved.campusId||containsDepartment(campus,row.approved)),radiusMeters:row.approved?.radiusMeters||null,
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
  try{
   point=validateDepartmentPoint(req.body);
   const evidence=assessLocationEvidence(req.body);
   if(!evidence.valid||!Array.isArray(req.body.samples)||
      req.body.samples.length<2||evidence.sampleCount<2||
      !['STABLE_MULTIPLE','EXCELLENT_SINGLE'].includes(evidence.confidence)||
      !req.body.samples.some(sample=>sample!==evidence.point&&
       Math.abs(sample.capturedAt-evidence.point.capturedAt)>=500&&
       sample.accuracyMeters<=70))
    return res.status(422).json({error:'A department location requires two consistent, fresh and precise GPS readings. Retry near the department, or use another location-enabled device.'});
   if(distanceMeters(point,evidence.point)>5)
    return res.status(422).json({error:'Selected department coordinates do not agree with the collected GPS readings.'});
  }catch(error){return res.status(400).json({error:error.message});}
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await lockLunchSlots(client,req.auth.schoolId);
   const dept=await client.query(`SELECT department_id FROM school_departments
    WHERE school_id=$1 AND department_id=$2 AND active=TRUE AND department_code<>'UNASSIGNED'
    FOR SHARE`,[req.auth.schoolId,departmentId]);
   if(!dept.rowCount){await client.query('ROLLBACK');
    return res.status(403).json({error:'A valid active department assignment is required.'});}
   const prior=await client.query('SELECT setting_value AS point FROM school_settings WHERE school_id=$1 AND setting_key=$2 FOR UPDATE',[req.auth.schoolId,locationKey(departmentId)]);
   const previous=prior.rows[0]?.point||null;
   // A head can enroll within an independently authorized campus, but cannot switch a bound department
   // to another campus or self-authorize a site. Legacy trusted points remain protected.
   const requestedCampus=String(req.body?.campusId||''),boundCampus=String(previous?.relocationPending?.campusId||previous?.campusId||'');
   if(boundCampus&&requestedCampus&&requestedCampus!==boundCampus){await client.query('ROLLBACK');return res.status(409).json({error:'Cross-campus relocation requires independent authorization. Use Gatekeeper scanning.'});}
   const selectedCampus=boundCampus||requestedCampus;
   let activePoint;
   if(selectedCampus){
    const campus=await campusById(client,req.auth.schoolId,selectedCampus,true);
    if(!campus){await client.query('ROLLBACK');return res.status(403).json({error:'Selected campus is not authorized for this school.'});}
    if(!containsDepartment(campus,point,Math.max(req.body.accuracyMeters,assessLocationEvidence(req.body).accuracyMeters||0))||
       (previous&&!boundCampus&&!containsDepartment(campus,previous))){
     await client.query('ROLLBACK');return res.status(422).json({error:'The full department geofence and GPS uncertainty must fit inside its trusted campus.'});
    }
    activePoint={...point,campusId:selectedCampus};
   }else{
    const anchor=previous?.anchor||(previous?{latitude:previous.latitude,longitude:previous.longitude,radiusMeters:previous.radiusMeters}:null);
    if(!anchor){await client.query('ROLLBACK');return res.status(409).json({code:'TRUSTED_LOCATION_REQUIRED',error:'Choose an independently established campus or use supervised Gatekeeper scanning.'});}
    if(distanceMeters(anchor,point)+point.radiusMeters>anchor.radiusMeters){
     await client.query('ROLLBACK');return res.status(422).json({error:'The replacement area would extend beyond the existing authorized location.'});
    }
    activePoint={...point,anchor};
   }
   await client.query(`INSERT INTO school_settings(school_id,setting_key,setting_value,updated_at)
    VALUES($1,$2,$3::jsonb,NOW()) ON CONFLICT(school_id,setting_key)
    DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=NOW()`,[req.auth.schoolId,locationKey(departmentId),JSON.stringify(activePoint)]);
   // Pending proposals from the former approval workflow are preserved as superseded, not activated.
   await client.query(`UPDATE school_settings SET setting_value=setting_value||'{"status":"SUPERSEDED"}'::jsonb,updated_at=NOW()
    WHERE school_id=$1 AND setting_key=$2 AND setting_value->>'status'='PENDING'`,[req.auth.schoolId,proposalKey(departmentId)]);
   await client.query(`UPDATE user_notifications SET status='SUPERSEDED',read_at=COALESCE(read_at,NOW()),updated_at=NOW()
    WHERE school_id=$1 AND request_type='DEPARTMENT_LOCATION' AND request_id=$2 AND status='PENDING'`,[req.auth.schoolId,departmentId]);
   const revoked=await revokeDepartmentCodes(client,req.auth.schoolId,departmentId);
   await client.query(`INSERT INTO staff_attendance_audit
    (school_id,actor_user_id,action,target_type,target_id,details)
    VALUES($1,$2,'LUNCH_LOCATION_ACTIVATED','SCHOOL_DEPARTMENT',$3,$4::jsonb)`,
    [req.auth.schoolId,req.auth.userId,departmentId,JSON.stringify({previous,point:activePoint,accuracyMeters:req.body.accuracyMeters,revoked:revoked.rowCount})]);
   await client.query('COMMIT');
   return res.status(201).json({status:'ACTIVE',departmentId,message:'Department attendance location is active. Generate a fresh QR.'});
  }catch(error){await client.query('ROLLBACK').catch(()=>{});
   console.error('Department location proposal failed:',error.message);
   return res.status(503).json({error:'Unable to submit department location.'});
  }finally{client.release();}
 });
 // Retire the old Admin approval mutations; stale clients cannot activate a point.
 app.put('/api/staff-attendance/lunch/location',authenticateSchoolClient,requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD'),(req,res)=>res.status(410).json({error:'Use the Department Head on-site GPS activation workflow.'}));
 app.post('/api/staff-attendance/lunch/location/decision',authenticateSchoolClient,requireSchoolRoles('SCHOOL_ADMIN'),(req,res)=>res.status(410).json({error:'Department location approval has been retired.'}));
 // A pending scan never becomes an official DTR entry without independent
 // Department Head review; an independently authorized principal handles head exceptions.
 app.get('/api/staff-attendance/lunch/pending',authenticateSchoolClient,
  requireSchoolRoles('DEPARTMENT_HEAD','PRINCIPAL'),async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  const principal=req.auth.role==='PRINCIPAL',departmentId=ownDepartment(req);
  if(!principal&&!departmentId)return res.status(403).json({error:'An assigned department is required.'});
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
      AND (($3::boolean AND u.role='DEPARTMENT_HEAD') OR (NOT $3::boolean AND u.role='TEACHER' AND u.department_id=$4::uuid))
    ORDER BY e.created_at DESC LIMIT 100`,[req.auth.schoolId,manilaDate(),principal,departmentId]);
   return res.json({items:rows.rows});
  }catch(error){console.error('Lunch pending read failed:',error.message);
   return res.status(503).json({error:'Pending lunch scans unavailable.'});}
 });
 app.post('/api/staff-attendance/lunch/review',authenticateSchoolClient,
  requireSchoolRoles('DEPARTMENT_HEAD','PRINCIPAL'),async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  const principal=req.auth.role==='PRINCIPAL',departmentId=ownDepartment(req);
  if(!principal&&!departmentId)return res.status(403).json({error:'An assigned department is required.'});
  const eventId=String(req.body?.eventId||''),decision=String(req.body?.decision||'');
  const note=String(req.body?.note||'').trim();
  if(!UUID.test(eventId)||!['VERIFY','REJECT'].includes(decision)||note.length<10||note.length>500)
   return res.status(400).json({error:'Choose a pending scan, decision and a reason of 10–500 characters.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const found=await client.query(`SELECT e.staff_user_id,e.dtr_slot,
      to_char(e.school_date,'YYYY-MM-DD') AS "schoolDate",
      e.occurred_at,e.verification_status
    FROM staff_attendance_events e JOIN school_users u ON u.school_id=e.school_id AND u.user_id=e.staff_user_id
    WHERE e.school_id=$1 AND e.event_id=$2 AND e.event_kind='DTR_SLOT' AND e.source='SELF_SERVICE'
    AND e.dtr_slot IN ('AM_OUT','PM_IN')
    AND (($3::boolean AND u.role='DEPARTMENT_HEAD') OR (NOT $3::boolean AND u.role='TEACHER' AND u.department_id=$4::uuid)) FOR UPDATE OF e FOR SHARE OF u`,
    [req.auth.schoolId,eventId,principal,departmentId]);
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
    const leave=await client.query(`SELECT 1,leave_session FROM staff_form48_approved_leaves
      WHERE school_id=$1 AND staff_user_id=$2 AND revoked_at IS NULL
      AND start_date<=$3::date AND end_date>=$3::date
      UNION ALL
      SELECT 1,'FULL' AS leave_session FROM school_users WHERE school_id=$1 AND user_id=$2
      AND teacher_status='ON_LEAVE' AND leave_start_date<=$3::date
      AND expected_return_date>=$3::date LIMIT 1`,
      [req.auth.schoolId,record.staff_user_id,record.schoolDate]);
    if(leave.rowCount&&!(['AM','PM'].includes(leave.rows[0]?.leave_session)&&await require('./staff-leave-sessions').partialDutySlotAllowed(client,req.auth.schoolId,record.staff_user_id,record.schoolDate,record.dtr_slot,record.occurred_at))){
     await client.query('ROLLBACK');
     return res.status(409).json({error:'Approved leave overlaps this scan. Resolve the leave/DTR conflict through the approved review workflow.'});
    }
    const ob=await client.query(`SELECT 1 FROM staff_official_business_requests
      WHERE school_id=$1 AND staff_user_id=$2 AND status='APPROVED'
        AND starts_at<=$3 AND (CASE WHEN completion_status='VERIFIED' THEN GREATEST(ends_at,completion_at) ELSE ends_at END)>$3 LIMIT 1`,
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
      c.department_id,p.role AS presenter_role
     FROM staff_attendance_challenges c
     JOIN school_users p ON p.school_id=c.school_id AND p.user_id=c.presenter_user_id AND p.active=TRUE AND p.department_id=c.department_id
     JOIN school_departments d ON d.school_id=c.school_id AND d.department_id=c.department_id AND d.active=TRUE AND d.department_code<>'UNASSIGNED'
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
   if(row.presenter_role!=='TEACHER'){await client.query('ROLLBACK');return res.status(410).json({error:'Presenter is no longer authorized.'});}
   if(!ownDepartment(req)||String(row.department_id)!==ownDepartment(req)){await client.query('ROLLBACK');return res.status(403).json({error:'Use your own department QR or Gatekeeper scanning.'});}
   {
    const permission=await client.query(`SELECT 1 FROM staff_lunch_presenter_assignments
       WHERE school_id=$1 AND presenter_user_id=$2 AND school_date=$3::date
       AND dtr_slot=$4 AND department_id=$5 AND revoked_at IS NULL LIMIT 1`,
      [req.auth.schoolId,row.presenter_user_id,today,row.dtr_slot,row.department_id]);
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
      'This lunch DTR slot has already been recorded.':'Your lunch scan is pending review. Contact your Department Head.',
      alreadyRecorded:existing.rows[0].verification_status==='VERIFIED'});
   }
   const config=await client.query('SELECT setting_value FROM school_settings WHERE school_id=$1 AND setting_key=$2',[req.auth.schoolId,configKey(row.department_id)]);
   if(config.rows[0]?.setting_value?.enabled===false){await client.query('ROLLBACK');return res.status(410).json({error:'Lunch QR is disabled. Use Gatekeeper scanning.'});}
   const pointRow=await client.query(`SELECT setting_value AS point FROM school_settings
    WHERE school_id=$1 AND setting_key=$2`,
    [req.auth.schoolId,locationKey(row.department_id)]);
   const storedPoint=pointRow.rows[0]?.point;
   const trustedPoint=await trustedDepartmentPoint(client,req.auth.schoolId,storedPoint);
   if((storedPoint?.campusId||storedPoint?.relocationPending)&&!trustedPoint){await client.query('ROLLBACK');return res.status(410).json({error:'The authorized campus is unavailable. Use supervised Gatekeeper scanning.'});}
   const presence=classifyDepartmentPresence(trustedPoint,req.body?.location,now);
   const reasons=[];
   if(now>=expires)reasons.push('LATE_DELIVERY');
   if(!presence.verified)reasons.push(presence.reason);
   if(row.presenter_user_id===req.auth.userId)reasons.push('SELF_SCAN_BY_PRESENTER');
   const operationalWindows=config.rows[0]?.setting_value?.windows;
   if(operationalWindows!=null){
    const time=localTime(new Date(now));
    if(!withinWindow(operationalWindows,row.dtr_slot,time))reasons.push('OUTSIDE_DEPARTMENT_QR_WINDOW');
    const officialReason=await officialScheduleDecision(client,{schoolId:req.auth.schoolId,staffUserId:req.auth.userId,date:today,slot:row.dtr_slot,time});
    if(officialReason)reasons.push(officialReason);
   }
   // A DTR punch during an approved leave requires independent reconciliation.
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',
    [req.auth.schoolId+':leave:'+req.auth.userId]);
   const leave=await client.query(`SELECT 1,leave_session FROM staff_form48_approved_leaves
    WHERE school_id=$1 AND staff_user_id=$2 AND revoked_at IS NULL
    AND start_date<=$3::date AND end_date>=$3::date
    UNION ALL SELECT 1,'FULL' AS leave_session FROM school_users WHERE school_id=$1 AND user_id=$2
    AND teacher_status='ON_LEAVE' AND leave_start_date<=$3::date
    AND expected_return_date>=$3::date LIMIT 1`,
    [req.auth.schoolId,req.auth.userId,today]);
   if(leave.rowCount&&!(['AM','PM'].includes(leave.rows[0]?.leave_session)&&await require('./staff-leave-sessions').partialDutySlotAllowed(client,req.auth.schoolId,req.auth.userId,today,row.dtr_slot)))reasons.push('APPROVED_LEAVE_CONFLICT');
   const ob=await client.query(`SELECT 1 FROM staff_official_business_requests
    WHERE school_id=$1 AND staff_user_id=$2 AND status='APPROVED'
    AND starts_at<=NOW() AND (CASE WHEN completion_status='VERIFIED' THEN GREATEST(ends_at,completion_at) ELSE ends_at END)>NOW() LIMIT 1`,
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
       accuracyMeters:presence.accuracyMeters??null,
       sampleCount:presence.sampleCount??null,
       locationConfidence:presence.confidence??null,flags:reasons})]);
   await client.query('COMMIT');
   return res.status(201).json({eventId,slot:row.dtr_slot,schoolDate:today,
    occurredAt:event.rows[0].occurred_at,status:verification,
    message:reasons.length?'Scan received; Independent attendance review is required. This is not yet a verified DTR entry.':
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
