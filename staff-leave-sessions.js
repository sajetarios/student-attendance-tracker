'use strict';
// Freeze the officially approved session against the prescribed hours on that date.
const {validHours}=require('./form48-calculations');
const {getSchoolForm48Defaults,mergeSchoolForm48Defaults}=require('./form48-bulk-routes');
const {getEmployeeForm48Schedule}=require('./form48-employee-schedules');
function dateKey(value){
 if(typeof value==='string')return value.slice(0,10);
 return value instanceof Date&&!Number.isNaN(value.getTime())?value.toISOString().slice(0,10):'';
}
async function certifiedSession(db,schoolId,staffId,date,session){
 if(!['AM','PM'].includes(session))return null;
 const [monthly,defaults,employee,calendar,memos]=await Promise.all([
 db.query('SELECT workdays,regular_hours AS "regularHours",saturday_hours AS "saturdayHours" FROM staff_form48_monthly_reviews WHERE school_id=$1 AND staff_user_id=$2 AND report_month=$3::date',[schoolId,staffId,date.slice(0,7)+'-01']),
 getSchoolForm48Defaults(db,schoolId),getEmployeeForm48Schedule(db,schoolId,staffId),
 db.query('SELECT exception_type FROM school_calendar_exceptions WHERE school_id=$1 AND calendar_date=$2::date',[schoolId,date]),
 db.query(`SELECT dtr_hours AS hours FROM school_memoranda WHERE school_id=$1 AND dtr_hours IS NOT NULL
 AND audience IN ('ALL_USERS','SCHOOL_STAFF') AND category='SCHEDULE_NOTICE'
 AND effective_date<=$2::date AND end_date>=$2::date
 AND (archived_at IS NULL OR (archived_at AT TIME ZONE 'Asia/Manila')::date>$2::date)`,[schoolId,date])]);
 const saved=monthly.rows[0]?{...monthly.rows[0],configured:true}:null;
 const settings=mergeSchoolForm48Defaults(saved,defaults,employee);
 const weekday=new Date(date+'T12:00:00Z').getUTCDay(),exception=calendar.rows[0]?.exception_type;
 if(!settings?.configured||exception==='CLOSED'||(!(settings.workdays||[]).includes(weekday)&&exception!=='OPEN')||memos.rows.length>1)return null;
 if(exception==='SHORTENED_DAY'&&!memos.rows.length)return null;
 const hours=memos.rows[0]?.hours||(weekday===6?settings.saturdayHours:settings.regularHours);
 if(!validHours(hours))return null;
 return {start:hours[session+'_IN'],end:hours[session+'_OUT']};
}
// Only a single explicitly approved half-day may permit the other session.
// Full/legacy leave, two half-days, changed hours, OB at the punch time, or
// mismatched dates fail closed. Caller retains all existing verification rules.
function dutySlotWithinSession({slot,time,leaveSession,leaveStart,leaveEnd,dutyStart,dutyEnd}){
 if(!['AM','PM'].includes(leaveSession)||!['AM_IN','AM_OUT','PM_IN','PM_OUT'].includes(slot)||slot.startsWith(leaveSession+'_'))return false;
 const minute=s=>typeof s==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(s)?Number(s.slice(0,2))*60+Number(s.slice(3)):NaN;
 const [at,ls,le,ds,de]=[time,leaveStart,leaveEnd,dutyStart,dutyEnd].map(minute);
 if([at,ls,le,ds,de].some(x=>!Number.isFinite(x))||ls>=le||ds>=de)return false;
 if(leaveSession==='AM'&&(at<le||ds<le))return false;
 if(leaveSession==='PM'&&(at>=ls||de>ls))return false;
 return slot.endsWith('_IN')?at>=Math.max(0,ds-240)&&at<=de:at>=ds;
}
async function partialDutySlotAllowed(db,schoolId,staffId,date,slot,eventAt=null){
 const approval=await db.query(`SELECT leave_session AS session,left(session_start::text,5) AS start,left(session_end::text,5) AS "end"
 FROM staff_form48_approved_leaves WHERE school_id=$1 AND staff_user_id=$2 AND revoked_at IS NULL
 AND start_date<=$3::date AND end_date>=$3::date`,[schoolId,staffId,date]);
 if(approval.rows.length!==1||!['AM','PM'].includes(approval.rows[0].session))return false;
 const a=approval.rows[0],duty=a.session==='AM'?'PM':'AM';
 if(!slot.startsWith(duty+'_'))return false;
 const clock=await db.query(`SELECT to_char(COALESCE($4::timestamptz,NOW()) AT TIME ZONE 'Asia/Manila','YYYY-MM-DD') AS date,
 to_char(COALESCE($4::timestamptz,NOW()) AT TIME ZONE 'Asia/Manila','HH24:MI') AS time,
 (EXISTS(SELECT 1 FROM school_users WHERE school_id=$1 AND user_id=$2 AND teacher_status='ON_LEAVE'
 AND leave_start_date<=$3::date AND expected_return_date>=$3::date)
 OR EXISTS(SELECT 1 FROM staff_official_business_requests WHERE school_id=$1 AND staff_user_id=$2 AND status='APPROVED'
 AND starts_at<=COALESCE($4::timestamptz,NOW())
 AND (CASE WHEN completion_status='VERIFIED' THEN GREATEST(ends_at,completion_at) ELSE ends_at END)>COALESCE($4::timestamptz,NOW()))) AS blocked`,[schoolId,staffId,date,eventAt]);
 const actual=clock.rows[0];
 if(!actual||actual.date!==date||actual.blocked!==false)return false;
 const currentLeave=await certifiedSession(db,schoolId,staffId,date,a.session);
 const currentDuty=await certifiedSession(db,schoolId,staffId,date,duty);
 if(!currentLeave||!currentDuty||currentLeave.start!==a.start||currentLeave.end!==a.end)return false;
 return dutySlotWithinSession({slot,time:actual.time,leaveSession:a.session,leaveStart:a.start,leaveEnd:a.end,dutyStart:currentDuty.start,dutyEnd:currentDuty.end});
}
module.exports={dateKey,certifiedSession,partialDutySlotAllowed,dutySlotWithinSession};
