'use strict';
// Department windows control QR availability only. Official hours and Form 48
// calculations remain owned by the existing school/employee/month/memo engine.
const {isTime,validHours,summarizeForm48}=require('./form48-calculations');
const {isConfiguredSchedule}=require('./staff-attendance-schedule');
const {getEmployeeForm48Schedule}=require('./form48-employee-schedules');
const {getSchoolForm48Defaults,mergeSchoolForm48Defaults}=require('./form48-bulk-routes');
const slots=['AM_OUT','PM_IN'];
function readWindows(value){
 if(value===null)return null;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2)return undefined;
 const clean={};
 for(const slot of slots){
  const entry=value[slot];
  if(!entry||!isTime(entry.start)||!isTime(entry.end)||entry.start>=entry.end)return undefined;
  clean[slot]={start:entry.start,end:entry.end};
 }
 return clean;
}
function localTime(now=new Date()){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 return parts.find(x=>x.type==='hour').value+':'+parts.find(x=>x.type==='minute').value;
}
function withinWindow(windows,slot,time){
 if(windows==null)return true;
 const clean=readWindows(windows);
 return !!(clean&&clean[slot]&&isTime(time)&&time>=clean[slot].start&&time<=clean[slot].end);
}
function scheduleDecision({date,slot,time,settings,calendar=[],adjustments=[]}){
 if(!isConfiguredSchedule(settings))return 'OFFICIAL_SCHEDULE_UNAVAILABLE';
 if(!slots.includes(slot)||!isTime(time))return 'INVALID_LUNCH_SLOT';
 const assessment=summarizeForm48({month:date.slice(0,7),today:date,settings,calendar,
  scheduleAdjustments:adjustments,records:[{date,slots:{[slot]:time}}]}).assessments.find(x=>x.date===date);
 if(!assessment?.scheduled)return 'NOT_SCHEDULED_WORKDAY';
 if(['CLOSED','SHORTENED_DAY'].includes(assessment.calendarException))return 'CALENDAR_EXCEPTION_REVIEW';
 if(['ABSENT','EXCUSED'].includes(assessment.review))return 'DAY_ALREADY_REVIEWED';
 if(assessment.timeAnomaly)return 'OUTSIDE_OFFICIAL_DTR_SLOT';
 return null;
}
async function officialScheduleDecision(client,{schoolId,staffUserId,date,slot,time}){
 const monthly=await client.query('SELECT workdays,regular_hours AS "regularHours",saturday_hours AS "saturdayHours",day_reviews AS "dayReviews" FROM staff_form48_monthly_reviews WHERE school_id=$1 AND staff_user_id=$2 AND report_month=date_trunc(\'month\',$3::date)::date',[schoolId,staffUserId,date]);
 const saved=monthly.rows[0]||null;
 const employee=await getEmployeeForm48Schedule(client,schoolId,staffUserId);
 const defaults=await getSchoolForm48Defaults(client,schoolId);
 const settings=mergeSchoolForm48Defaults(saved?{...saved,configured:isConfiguredSchedule(saved)}:null,defaults,employee);
 const calendar=await client.query("SELECT to_char(calendar_date,'YYYY-MM-DD') AS date,exception_type AS type FROM school_calendar_exceptions WHERE school_id=$1 AND calendar_date=$2::date",[schoolId,date]);
 const adjustments=await client.query("SELECT memo_id AS \"memoId\",to_char(effective_date,'YYYY-MM-DD') AS \"from\",to_char(end_date,'YYYY-MM-DD') AS \"to\",to_char((archived_at AT TIME ZONE 'Asia/Manila')::date,'YYYY-MM-DD') AS \"archivedDate\",dtr_hours AS hours FROM school_memoranda WHERE school_id=$1 AND dtr_hours IS NOT NULL AND audience IN ('ALL_USERS','SCHOOL_STAFF') AND category='SCHEDULE_NOTICE' AND effective_date<=$2::date AND end_date>=$2::date ORDER BY effective_date,published_at",[schoolId,date]);
 return scheduleDecision({date,slot,time,settings,calendar:calendar.rows,adjustments:adjustments.rows});
}
module.exports={readWindows,localTime,withinWindow,scheduleDecision,officialScheduleDecision};
