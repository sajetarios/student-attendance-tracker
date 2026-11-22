'use strict';
// Conservative, school-admin-only transfer of trusted physical gate evidence into Form 48.
const {randomUUID}=require('node:crypto');
const {manilaDate}=require('./staff-lunch-routes');
const {getEmployeeForm48Schedule}=require('./form48-employee-schedules');
const {getSchoolForm48Defaults}=require('./form48-bulk-routes');
const {effectiveStaffSchedule,isConfiguredSchedule}=require('./staff-attendance-schedule');
const {reconcileGateDay}=require('./gate-dtr-reconciliation');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLOTS=['AM_IN','AM_OUT','PM_IN','PM_OUT'];
const sql=(...parts)=>parts.join(' ');
function dateValid(value){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;
 const d=new Date(value+'T00:00:00Z');
 return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value&&value<=manilaDate();
}
const blocked=reason=>({status:'REVIEW_REQUIRED',reason,candidates:[]});
const kindFor=slot=>slot.endsWith('_IN')?'TIME_IN':'TIME_OUT';
function reviewableGateCandidates({movements=[],existingSlots={},hours={},blockedReason=null,usedGateIds=[]}={}){
 if(blockedReason)return blocked(blockedReason);
 if(!movements.length||movements.length>4)return blocked('UNUSUAL_GATE_SEQUENCE');
 if(movements.some(row=>row.origin!=='TRUSTED_SERVER_GATE'||
    row.actualLocalDate!==row.schoolDate))return blocked('UNTRUSTED_GATE_TIMESTAMP');
 if(movements[0].eventType!=='TIME_IN')return blocked('MORNING_ARRIVAL_UNCONFIRMED');
 const decision=reconcileGateDay({movements,existingSlots,hours,approvedOb:[]});
 const flags=decision.review.filter(x=>x!=='SLOT_ALREADY_VERIFIED');
 if(flags.length)return blocked(flags[0]);
 // A first noon/afternoon-only arrival cannot establish a full morning.
 if(!existingSlots.AM_IN&&!decision.suggestions.AM_IN)
  return blocked('MORNING_ARRIVAL_UNCONFIRMED');
 const used=new Set(usedGateIds.map(String)),candidates=[];
 for(const [slot,proposal] of Object.entries(decision.suggestions)){
  if(!SLOTS.includes(slot)||existingSlots[slot])continue;
  const matching=movements.filter(e=>e.time===proposal.time&&
   e.eventType===kindFor(slot)&&!used.has(String(e.eventId)));
  if(matching.length!==1)return blocked('GATE_EVIDENCE_AMBIGUOUS');
  candidates.push({slot,time:matching[0].time,eventId:String(matching[0].eventId)});
 }
 return candidates.length?{status:'ELIGIBLE',reason:null,candidates}:blocked('NO_CLEAR_UNVERIFIED_SLOT');
}
async function reviewEvidence(db,schoolId,staffUserId,date){
 const staff=await db.query(sql(
  "SELECT 1 FROM school_users WHERE school_id=$1 AND user_id=$2",
  "AND active=TRUE AND role IN ('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN')"),
  [schoolId,staffUserId]);
 if(!staff.rowCount)return blocked('STAFF_NOT_FOUND');
 // A transaction-scoped PostgreSQL client cannot safely run concurrent queries.
 // Serialize evidence reads, including reads hidden in schedule helpers.
 let evidenceQueue=Promise.resolve();
 const serial={query(...args){
  const work=evidenceQueue.then(()=>db.query(...args));
  evidenceQueue=work.catch(()=>{});
  return work;
 }};
 const [monthly,employee,defaults,calendar,ob,leave,gate,dtr,links]=await Promise.all([
  serial.query(sql('SELECT workdays, regular_hours AS "regularHours",',
   'saturday_hours AS "saturdayHours", day_reviews AS "dayReviews"',
   'FROM staff_form48_monthly_reviews WHERE school_id=$1 AND staff_user_id=$2',
   "AND report_month=date_trunc('month',$3::date)::date"),[schoolId,staffUserId,date]),
  getEmployeeForm48Schedule(serial,schoolId,staffUserId),
  getSchoolForm48Defaults(serial,schoolId),
  serial.query('SELECT 1 FROM school_calendar_exceptions WHERE school_id=$1 AND calendar_date=$2::date LIMIT 1',
   [schoolId,date]),
  serial.query(sql('SELECT 1 FROM staff_official_business_requests',
   "WHERE school_id=$1 AND staff_user_id=$2 AND status='APPROVED'",
   "AND starts_at < (($3::date + INTERVAL '1 day') AT TIME ZONE 'Asia/Manila')",
   "AND ends_at > ($3::date AT TIME ZONE 'Asia/Manila') LIMIT 1"),[schoolId,staffUserId,date]),
  serial.query(sql('SELECT (EXISTS(SELECT 1 FROM staff_form48_approved_leaves',
   'WHERE school_id=$1 AND staff_user_id=$2 AND revoked_at IS NULL',
   'AND start_date<=$3::date AND end_date>=$3::date)',
   'OR EXISTS(SELECT 1 FROM school_users WHERE school_id=$1 AND user_id=$2',
   "AND teacher_status='ON_LEAVE' AND leave_start_date<=$3::date",
   'AND expected_return_date>=$3::date)) AS blocked'),[schoolId,staffUserId,date]),
  serial.query(sql('SELECT "eventId","eventType",time,"occurredAt",origin,"actualLocalDate","schoolDate"',
   'FROM (SELECT event_id AS "eventId",',
   "CASE WHEN gate_direction='IN' THEN 'TIME_IN' ELSE 'TIME_OUT' END AS \"eventType\",",
   "to_char(occurred_at AT TIME ZONE 'Asia/Manila','HH24:MI') AS time,",
   'occurred_at AS "occurredAt",',
   "CASE WHEN source='GATEKEEPER' AND verification_method='GUARD_PHOTO'",
   "AND actor_user_id IS NOT NULL AND legacy_gate_event_id IS NULL",
   "THEN 'TRUSTED_SERVER_GATE' ELSE 'OTHER_GATE_SOURCE' END AS origin,",
   "to_char(occurred_at AT TIME ZONE 'Asia/Manila','YYYY-MM-DD') AS \"actualLocalDate\",",
   'to_char(school_date,\'YYYY-MM-DD\') AS "schoolDate", occurred_at',
   'FROM staff_attendance_events WHERE school_id=$1 AND staff_user_id=$2',
   "AND school_date=$3::date AND event_kind='GATE_MOVEMENT'",
   "AND verification_status='VERIFIED'",
   'UNION ALL SELECT t.event_id,t.event_type,',
   "to_char(t.occurred_at AT TIME ZONE 'Asia/Manila','HH24:MI'),t.occurred_at,",
   "'LEGACY_CLIENT_CLOCK',",
   "to_char(t.occurred_at AT TIME ZONE 'Asia/Manila','YYYY-MM-DD'),",
   "to_char(t.school_date,'YYYY-MM-DD'),t.occurred_at",
   'FROM teacher_gate_events t WHERE t.school_id=$1 AND t.teacher_user_id=$2',
   'AND t.school_date=$3::date AND t.photo_verified=TRUE',
   'AND NOT EXISTS(SELECT 1 FROM staff_attendance_events e',
   'WHERE e.school_id=t.school_id AND e.legacy_gate_event_id=t.event_id)',
   ') gate_history ORDER BY occurred_at,"eventId"'),[schoolId,staffUserId,date]),
  serial.query(sql('SELECT dtr_slot AS slot,',
   "to_char(occurred_at AT TIME ZONE 'Asia/Manila','HH24:MI') AS time",
   'FROM staff_attendance_events WHERE school_id=$1 AND staff_user_id=$2',
   "AND school_date=$3::date AND event_kind='DTR_SLOT'",
   "AND verification_status='VERIFIED'"),[schoolId,staffUserId,date]),
  serial.query(sql('SELECT details->>\'sourceGateEventId\' AS "sourceGateEventId"',
   'FROM staff_attendance_audit WHERE school_id=$1',
   "AND action IN ('AUTO_GATE_TO_DTR_VERIFIED','ADMIN_GATE_TO_DTR_VERIFIED')",
   "AND details->>'staffUserId'=$2 AND details->>'schoolDate'=$3"),
   [schoolId,String(staffUserId),date])
 ]);
 const review=monthly.rows[0]||null;
 const inherited=effectiveStaffSchedule(employee,defaults);
 const schedule=review&&isConfiguredSchedule(review)?review:inherited.schedule;
 const scheduleSource=review&&isConfiguredSchedule(review)?'MONTHLY_REVIEW':inherited.source;
 const weekday=new Date(date+'T12:00:00Z').getUTCDay();
 let blocker=null;
 if(['ABSENT','EXCUSED'].includes(review?.dayReviews?.[date]))blocker='DAY_ALREADY_REVIEWED';
 else if(!schedule)blocker='SCHEDULE_UNAVAILABLE';
 else if(!schedule.workdays.includes(weekday))blocker='NOT_SCHEDULED_WORKDAY';
 else if(calendar.rowCount)blocker='CALENDAR_EXCEPTION';
 else if(ob.rowCount)blocker='APPROVED_OB_REQUIRES_REVIEW';
 else if(leave.rows[0]?.blocked)blocker='LEAVE_REQUIRES_REVIEW';
 const existingSlots=Object.fromEntries(dtr.rows.map(row=>[row.slot,row.time]));
 const hours=schedule?(weekday===6?schedule.saturdayHours:schedule.regularHours):{};
 const decision=reviewableGateCandidates({
  movements:gate.rows,existingSlots,hours,blockedReason:blocker,
  usedGateIds:links.rows.map(row=>row.sourceGateEventId).filter(Boolean)
 });
 return {...decision,existingSlots,scheduleSource,gateEvents:gate.rows};
}
function registerGateDtrReviewRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 const admin=requireSchoolRoles('SCHOOL_ADMIN');
 app.get('/api/staff-attendance/admin/dtr-review-options',authenticateSchoolClient,admin,async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  const staffUserId=String(req.query?.staffUserId||''),date=String(req.query?.date||'');
  if(!UUID.test(staffUserId)||!dateValid(date))
   return res.status(400).json({error:'Valid employee and school date required.'});
  try{
   const decision=await reviewEvidence(pool,req.auth.schoolId,staffUserId,date);
   return res.json({staffUserId,date,status:decision.status,reason:decision.reason,
    candidates:decision.candidates});
  }catch(error){
   console.error('DTR review options:',error.code||error.message);
   return res.status(503).json({error:'Could not inspect DTR approval options.'});
  }
 });
 app.post('/api/staff-attendance/admin/dtr-review-apply',authenticateSchoolClient,admin,async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  const staffUserId=String(req.body?.staffUserId||''),date=String(req.body?.date||'');
  const gateEventId=String(req.body?.gateEventId||''),slot=String(req.body?.slot||'');
  const reason=String(req.body?.reason||'').trim();
  if(!UUID.test(staffUserId)||!UUID.test(gateEventId)||!dateValid(date)||
     !SLOTS.includes(slot)||reason.length<10||reason.length>500)
   return res.status(400).json({error:'Choose a verified gate event, DTR slot and approval reason (10–500 characters).'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',
    [String(req.auth.schoolId),staffUserId]);
   const evidence=await reviewEvidence(client,req.auth.schoolId,staffUserId,date);
   const candidate=evidence.candidates.find(row=>row.slot===slot&&row.eventId===gateEventId);
   if(evidence.status!=='ELIGIBLE'||!candidate){
    await client.query('ROLLBACK');
    return res.status(409).json({error:'Evidence changed. Refresh the scan review before approving.',
     reason:evidence.reason||'SLOT_NOT_ELIGIBLE'});
   }
   const original=evidence.gateEvents.find(row=>String(row.eventId)===gateEventId);
   if(!original||original.origin!=='TRUSTED_SERVER_GATE'){
    await client.query('ROLLBACK');
    return res.status(409).json({error:'Only original server-timestamped, verified gate scans may be approved.'});
   }
   const eventId=randomUUID();
   const inserted=await client.query(sql(
    'INSERT INTO staff_attendance_events',
    '(event_id,school_id,staff_user_id,event_kind,dtr_slot,school_date,occurred_at,',
    'source,verification_status,verification_method,actor_user_id,client_event_key,notes)',
    "VALUES($1,$2,$3,'DTR_SLOT',$4,$5::date,$6,",
    "'AUTHORIZED_CORRECTION','VERIFIED','MANUAL_REVIEW',$7,$8,'ADMIN_VERIFIED_GATE_EVIDENCE')",
    'ON CONFLICT DO NOTHING RETURNING event_id'),
    [eventId,req.auth.schoolId,staffUserId,slot,date,original.occurredAt,
     req.auth.userId,randomUUID()]);
   if(!inserted.rowCount){
    await client.query('ROLLBACK');
    return res.status(409).json({error:'This DTR slot is already verified. No duplicate was created.'});
   }
   await client.query(sql('INSERT INTO staff_attendance_audit',
    '(school_id,actor_user_id,action,target_type,target_id,details)',
    "VALUES($1,$2,'ADMIN_GATE_TO_DTR_VERIFIED','STAFF_ATTENDANCE_EVENT',$3,$4::jsonb)"),
    [req.auth.schoolId,req.auth.userId,eventId,JSON.stringify({
     sourceGateEventId:gateEventId,sourceOccurredAt:original.occurredAt,
     staffUserId,schoolDate:date,slot,reviewReason:reason,
     verificationMethod:'MANUAL_REVIEW',scheduleSource:evidence.scheduleSource
    })]);
   await client.query('COMMIT');
   return res.status(201).json({status:'VERIFIED',eventId,sourceGateEventId:gateEventId,
    slot,schoolDate:date,occurredAt:original.occurredAt,
    notice:'Verified gate time added to official DTR and audit history.'});
  }catch(error){
   await client.query('ROLLBACK').catch(()=>{});
   if(error.code==='23505')return res.status(409).json({error:'A verified entry already exists. Reload the report.'});
   console.error('Admin gate DTR approval:',error.code||error.message);
   return res.status(503).json({error:'DTR verification could not be saved. No change was confirmed.'});
  }finally{client.release();}
 });
}
module.exports={registerGateDtrReviewRoutes,reviewableGateCandidates,reviewEvidence,dateValid};
