'use strict';
// Conservative automatic Form 48 slot capture from an actual, photo-verified
// SERVER-timestamped gate movement. Never infer a missing lunch scan or OB.
const {randomUUID}=require('node:crypto');
const {effectiveStaffSchedule,isConfiguredSchedule}=require('./staff-attendance-schedule');
const {getEmployeeForm48Schedule}=require('./form48-employee-schedules');
const {getSchoolForm48Defaults}=require('./form48-bulk-routes');
const {reconcileGateDay}=require('./gate-dtr-reconciliation');
const SLOT_KIND={AM_IN:'TIME_IN',AM_OUT:'TIME_OUT',PM_IN:'TIME_IN',PM_OUT:'TIME_OUT'};

function chooseSafeAutoSlot({movements=[],existingSlots={},hours={},gateEventId}={}){
  if(!movements.length||movements.length>4||movements[0].eventType!=='TIME_IN')
    return {status:'REVIEW_REQUIRED',reason:'UNUSUAL_GATE_SEQUENCE'};
  const latest=movements[movements.length-1];
  if(String(latest.eventId)!==String(gateEventId))
    return {status:'REVIEW_REQUIRED',reason:'GATE_EVENT_NOT_LATEST'};
  const result=reconcileGateDay({movements,existingSlots,hours,approvedOb:[]});
  const blockers=(result.review||[]).filter(reason=>reason!=='SLOT_ALREADY_VERIFIED');
  if(blockers.length)return {status:'REVIEW_REQUIRED',reason:blockers[0]};
  const choices=Object.entries(result.suggestions||{}).filter(([slot,proposal])=>
    SLOT_KIND[slot]===latest.eventType&&proposal.time===latest.time);
  if(choices.length!==1)return {status:'REVIEW_REQUIRED',reason:'UNMATCHED_DTR_SLOT'};
  const [slot]=choices[0];
  // The first entry must be a morning arrival. A first scan at noon cannot
  // establish attendance for an entire morning.
  if(movements.length===1&&slot!=='AM_IN')
    return {status:'REVIEW_REQUIRED',reason:'MORNING_ARRIVAL_UNCONFIRMED'};
  if(existingSlots[slot])return {status:'REVIEW_REQUIRED',reason:'SLOT_ALREADY_VERIFIED'};
  return {status:'MATCHED',slot};
}

async function autoRecordVerifiedGateDtr(client,{schoolId,staffUserId,gateEventId,occurredAt,schoolDate,actorUserId}){
  const date=new Date(schoolDate+'T12:00:00Z');
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==schoolDate)
    return {status:'REVIEW_REQUIRED',reason:'INVALID_DATE'};
  const weekday=date.getUTCDay();

  // Never silently reinterpret an already reviewed absence/excusal.
  const month=await client.query(
    'SELECT workdays,regular_hours AS "regularHours",saturday_hours AS "saturdayHours",'+
    ' day_reviews AS "dayReviews" FROM staff_form48_monthly_reviews '+
    'WHERE school_id=$1 AND staff_user_id=$2 AND report_month=date_trunc(\'month\',$3::date)::date',
    [schoolId,staffUserId,schoolDate]);
  const monthly=month.rows[0]||null;
  if(['ABSENT','EXCUSED'].includes(monthly?.dayReviews?.[schoolDate]))
    return {status:'REVIEW_REQUIRED',reason:'DAY_ALREADY_REVIEWED'};

  const employee=await getEmployeeForm48Schedule(client,schoolId,staffUserId);
  const defaults=await getSchoolForm48Defaults(client,schoolId);
  const inherited=effectiveStaffSchedule(employee,defaults);
  const schedule=monthly&&isConfiguredSchedule(monthly)?monthly:inherited.schedule;
  const source=monthly&&isConfiguredSchedule(monthly)?'MONTHLY_REVIEW':inherited.source;
  if(!schedule)return {status:'REVIEW_REQUIRED',reason:'SCHEDULE_UNAVAILABLE'};
  if(!schedule.workdays.includes(weekday))
    return {status:'REVIEW_REQUIRED',reason:'NOT_SCHEDULED_WORKDAY'};

  const calendar=await client.query(
    'SELECT 1 FROM school_calendar_exceptions WHERE school_id=$1 AND calendar_date=$2::date LIMIT 1',
    [schoolId,schoolDate]);
  if(calendar.rowCount)return {status:'REVIEW_REQUIRED',reason:'CALENDAR_EXCEPTION'};

  const ob=await client.query(
    'SELECT 1 FROM staff_official_business_requests WHERE school_id=$1 AND staff_user_id=$2 '+
    'AND status=\'APPROVED\' AND starts_at < (($3::date + INTERVAL \'1 day\') AT TIME ZONE \'Asia/Manila\') '+
    'AND ends_at > ($3::date::timestamp AT TIME ZONE \'Asia/Manila\') LIMIT 1',
    [schoolId,staffUserId,schoolDate]);
  if(ob.rowCount)return {status:'REVIEW_REQUIRED',reason:'APPROVED_OB_REQUIRES_REVIEW'};

  const leave=await client.query(
    'SELECT (EXISTS(SELECT 1 FROM staff_form48_approved_leaves WHERE school_id=$1 '+
    'AND staff_user_id=$2 AND revoked_at IS NULL AND start_date<=$3::date AND end_date>=$3::date) '+
    'OR EXISTS(SELECT 1 FROM school_users WHERE school_id=$1 AND user_id=$2 '+
    'AND teacher_status=\'ON_LEAVE\' AND leave_start_date<=$3::date '+
    'AND expected_return_date>=$3::date)) AS blocked',
    [schoolId,staffUserId,schoolDate]);
  if(leave.rows[0]?.blocked)return {status:'REVIEW_REQUIRED',reason:'LEAVE_REQUIRES_REVIEW'};

  const gate=await client.query(
    'SELECT "eventId","eventType",time FROM ('+
    ' SELECT event_id AS "eventId",CASE WHEN gate_direction=\'IN\' THEN \'TIME_IN\' '+
    ' ELSE \'TIME_OUT\' END AS "eventType",'+
    ' to_char(occurred_at AT TIME ZONE \'Asia/Manila\',\'HH24:MI\') AS time,occurred_at '+
    ' FROM staff_attendance_events WHERE school_id=$1 AND staff_user_id=$2 AND school_date=$3::date '+
    ' AND event_kind=\'GATE_MOVEMENT\' AND verification_status=\'VERIFIED\' '+
    ' UNION ALL '+
    ' SELECT t.event_id AS "eventId",t.event_type AS "eventType",'+
    ' to_char(t.occurred_at AT TIME ZONE \'Asia/Manila\',\'HH24:MI\') AS time,t.occurred_at '+
    ' FROM teacher_gate_events t WHERE t.school_id=$1 AND t.teacher_user_id=$2 AND t.school_date=$3::date '+
    ' AND t.photo_verified=TRUE AND NOT EXISTS (SELECT 1 FROM staff_attendance_events e '+
    ' WHERE e.school_id=t.school_id AND e.legacy_gate_event_id=t.event_id)'+
    ') all_gate ORDER BY occurred_at,"eventId"',
    [schoolId,staffUserId,schoolDate]);
  const dtr=await client.query(
    'SELECT dtr_slot AS slot,to_char(occurred_at AT TIME ZONE \'Asia/Manila\',\'HH24:MI\') AS time '+
    'FROM staff_attendance_events WHERE school_id=$1 AND staff_user_id=$2 AND school_date=$3::date '+
    'AND event_kind=\'DTR_SLOT\' AND verification_status=\'VERIFIED\'',
    [schoolId,staffUserId,schoolDate]);
  const existingSlots=Object.fromEntries(dtr.rows.map(x=>[x.slot,x.time]));
  const hours=weekday===6?schedule.saturdayHours:schedule.regularHours;
  const decision=chooseSafeAutoSlot({
    movements:gate.rows,existingSlots,hours,gateEventId
  });
  if(decision.status!=='MATCHED')return decision;

  const eventId=randomUUID();
  const recorded=await client.query(
    'INSERT INTO staff_attendance_events '+
    '(event_id,school_id,staff_user_id,event_kind,dtr_slot,school_date,occurred_at,'+
    'source,verification_status,verification_method,actor_user_id,client_event_key,notes) '+
    'VALUES($1,$2,$3,\'DTR_SLOT\',$4,$5::date,$6,\'GATEKEEPER\',\'VERIFIED\',\'GUARD_PHOTO\',$7,$8,$9) '+
    'ON CONFLICT DO NOTHING RETURNING event_id',
    [eventId,schoolId,staffUserId,decision.slot,schoolDate,occurredAt,actorUserId,
     randomUUID(),'AUTO_MATCHED_VERIFIED_GATE']);
  if(!recorded.rowCount)return {status:'REVIEW_REQUIRED',reason:'DTR_SLOT_CONFLICT'};
  await client.query(
    'INSERT INTO staff_attendance_audit '+
    '(school_id,actor_user_id,action,target_type,target_id,details) '+
    'VALUES($1,$2,\'AUTO_GATE_TO_DTR_VERIFIED\',\'STAFF_ATTENDANCE_EVENT\',$3,$4::jsonb)',
    [schoolId,actorUserId,eventId,JSON.stringify({
      sourceGateEventId:gateEventId,staffUserId,schoolDate,slot:decision.slot,
      verificationMethod:'GUARD_PHOTO',scheduleSource:source
    })]);
  return {status:'AUTO_RECORDED',slot:decision.slot,eventId};
}
module.exports={chooseSafeAutoSlot,autoRecordVerifiedGateDtr};
