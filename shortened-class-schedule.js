'use strict';
const {conflict,eachDate}=require('./flexible-schedule-routes');
const minutes=v=>Number(String(v).slice(0,2))*60+Number(String(v).slice(3,5));
const clock=v=>String(Math.floor(v/60)).padStart(2,'0')+':'+String(v%60).padStart(2,'0');
const bad=message=>Object.assign(new Error(message),{scheduleConflict:true});
function validDurations(original,adjusted){
 return Number.isInteger(original)&&Number.isInteger(adjusted)&&adjusted>=10&&original<=180&&adjusted<original;
}
// A school-wide change uses common clock slots, not independent per-teacher shifts.
// Preserve gaps and non-class durations; reject ambiguous staggered slots instead of
// guessing at a school timetable. Only periods that have not started may move.
function planShortenedPeriods(rows,original,adjusted,cutoff='00:00'){
 if(!validDurations(original,adjusted))throw bad('Choose valid original and shorter class durations (10–180 minutes).');
 const from=minutes(cutoff),slots=new Map(),delta=original-adjusted;
 for(const p of rows){
  const a=minutes(p.startTime),b=minutes(p.endTime);
  if(p.scheduleType==='CLASS'&&a>from&&b-a===original)slots.set(a+':'+b,{a,b});
 }
 const blocks=[...slots.values()].sort((x,y)=>x.a-y.a);
 for(let i=1;i<blocks.length;i++)if(blocks[i].a<blocks[i-1].b)
  throw bad('Overlapping teaching time blocks require a coordinated timetable adjustment.');
 const shift=t=>blocks.filter(x=>x.b<=t).length*delta;
 const changed=[];
 for(const p of rows){
  const a=minutes(p.startTime),b=minutes(p.endTime);
  if(a<=from)continue;
  const exact=blocks.some(x=>x.a===a&&x.b===b);
  if(blocks.some(x=>a<x.b&&x.a<b)&&!(exact&&p.scheduleType==='CLASS'))
   throw bad('A different activity or class overlaps a shortened block. Resolve the timetable conflict first.');
  const start=a-shift(a),end=b-shift(b);
  if(start===a&&end===b)continue;
  if(start<=from||end<=start)throw bad('Adjusted class would begin in the past or have an invalid duration.');
  if(p.adjusted||p.recorded)throw bad('An affected class already has an adjustment, attendance, or QR session. Resolve it before publishing.');
  changed.push({...p,startTime:clock(start),endTime:clock(end)});
 }
 const effective=rows.map(p=>changed.find(q=>q.periodId===p.periodId)||p);
 for(const p of changed)if(conflict(p,effective))throw bad('Shortening would overlap a section, assigned teacher or classroom.');
 return changed;
}
async function planSchoolShortening(client,schoolId,from,to,original,adjusted,now=new Date()){
 const dates=eachDate(from,to);
 if(!dates||!validDurations(original,adjusted))throw bad('Choose a valid date range (up to 31 days) and shorter duration.');
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
 const today=parts.year+'-'+parts.month+'-'+parts.day;
 if(from<today)throw bad('Past class schedules cannot be changed.');
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text), 16016)',[schoolId]);
 const planned=[];
 for(const date of dates){
  const cal=await client.query('SELECT exception_type FROM school_calendar_exceptions WHERE school_id=$1 AND calendar_date=$2::date',[schoolId,date]);
  if(cal.rows.some(x=>['CLOSED','CLASS_SUSPENSION','SPECIAL_CLASS','SHORTENED_DAY'].includes(x.exception_type)))throw bad('Existing calendar exception on '+date+'. Resolve it before publishing.');
  const result=await client.query(`SELECT p.period_id AS "periodId",p.grade_level AS "gradeLevel",p.section,p.classroom,
    COALESCE(a.start_time,p.start_time)::text AS "startTime",COALESCE(a.end_time,p.end_time)::text AS "endTime",
    p.schedule_type AS "scheduleType",COALESCE(a.teacher_user_id,cover.substitute_teacher_user_id,regular.teacher_user_id) AS "teacherUserId",
    (a.adjustment_id IS NOT NULL) AS adjusted,
    (EXISTS(SELECT 1 FROM attendance_events e WHERE e.school_id=p.school_id AND e.period_id=p.period_id AND e.school_date=$2::date AND e.sync_status='ACCEPTED')
      OR EXISTS(SELECT 1 FROM manual_attendance_marks m WHERE m.school_id=p.school_id AND m.period_id=p.period_id AND m.school_date=$2::date)
      OR EXISTS(SELECT 1 FROM class_qr_sessions q WHERE q.school_id=p.school_id AND q.period_id=p.period_id AND q.school_date=$2::date)) AS recorded
    FROM class_periods p
    LEFT JOIN LATERAL (SELECT teacher_user_id FROM teacher_period_assignments t WHERE t.school_id=p.school_id AND t.period_id=p.period_id ORDER BY assignment_id LIMIT 1) regular ON TRUE
    LEFT JOIN LATERAL (SELECT substitute_teacher_user_id FROM teacher_period_substitutions t WHERE t.school_id=p.school_id AND t.period_id=p.period_id AND t.original_teacher_user_id=regular.teacher_user_id AND t.status='ACTIVE' AND $2::date BETWEEN t.start_date AND t.end_date ORDER BY created_at DESC LIMIT 1) cover ON TRUE
    LEFT JOIN schedule_day_adjustments a ON a.school_id=p.school_id AND a.period_id=p.period_id AND a.school_date=$2::date
    WHERE p.school_id=$1 AND p.active=TRUE AND COALESCE(a.adjustment_type,'')<>'CANCEL'
      AND (p.effective_from IS NULL OR p.effective_from<=$2::date) AND (p.effective_to IS NULL OR p.effective_to>=$2::date)
      AND EXISTS(SELECT 1 FROM class_period_days d WHERE d.school_id=p.school_id AND d.period_id=p.period_id AND d.weekday=EXTRACT(DOW FROM $2::date)::int)`,[schoolId,date]);
  const rows=result.rows.map(p=>({...p,startTime:p.startTime.slice(0,5),endTime:p.endTime.slice(0,5)}));
  planned.push(...planShortenedPeriods(rows,original,adjusted,date===today?parts.hour+':'+parts.minute:'00:00').map(p=>({...p,date})));
 }
 if(!planned.length)throw bad('No upcoming matching class periods were found.');
 return planned;
}
async function saveSchoolShortening(client,schoolId,actor,memoId,planned){
 for(const p of planned){
  await client.query(`INSERT INTO schedule_day_adjustments(school_id,period_id,school_date,adjustment_type,start_time,end_time,reason_type,notes,created_by_user_id,memo_id)
    VALUES($1,$2,$3::date,'RESCHEDULE',$4::time,$5::time,'SPECIAL_ACTIVITY','Principal shortened teaching periods',$6,$7)`,
    [schoolId,p.periodId,p.date,p.startTime,p.endTime,actor,memoId]);
 }
}
module.exports={validDurations,planShortenedPeriods,planSchoolShortening,saveSchoolShortening};
