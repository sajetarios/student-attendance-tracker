'use strict';

// Effective classroom schedule on a specific date. Never rewrites the recurring schedule.
const dateOk=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&
 !Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const uuidOk=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const timeOk=v=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const day=v=>new Date(v+'T00:00:00Z').getUTCDay();
const iso=v=>new Date(v).toISOString().slice(0,10);
const eachDate=(from,to)=>{
 if(!dateOk(from)||!dateOk(to)||from>to)return null;
 const out=[],stop=new Date(to+'T00:00:00Z');
 for(let d=new Date(from+'T00:00:00Z');d<=stop;d.setUTCDate(d.getUTCDate()+1)){
   out.push(d.toISOString().slice(0,10));if(out.length>31)return null;
 }
 return out;
};
const hh=v=>v==null?null:String(v).slice(0,5);
function effective(base,change) {
 return {periodId:base.period_id,gradeLevel:base.grade_level,section:base.section,
  startTime:hh(change?.start_time)||hh(base.start_time),
  endTime:hh(change?.end_time)||hh(base.end_time),
  classroom:change?.classroom??base.classroom??'',
  teacherUserId:change?.teacher_user_id??base.teacher_user_id??null,
  subjectId:change?.subject_id??base.subject_id,
  subjectName:change?.subject_name??base.subject_name,
  type:change?.adjustment_type||null,cancelled:change?.adjustment_type==='CANCEL'};
}
function conflict(candidate,others) {
 for(const other of others) {
  if(other.cancelled||String(other.periodId)===String(candidate.periodId)||
   candidate.startTime>=other.endTime||other.startTime>=candidate.endTime)continue;
  const section=candidate.gradeLevel===other.gradeLevel&&String(candidate.section||'').toLowerCase()===String(other.section||'').toLowerCase();
  const teacher=candidate.teacherUserId&&other.teacherUserId&&String(candidate.teacherUserId)===String(other.teacherUserId);
  const room=candidate.classroom&&other.classroom&&String(candidate.classroom).trim().toLowerCase()===String(other.classroom).trim().toLowerCase();
  if(section||teacher||room)return {kind:section?'section':teacher?'teacher':'room',other};
 }
 return null;
}
function registerFlexibleScheduleRoutes(app,pool,auth) {
 const {authenticateSchoolClient,requireSchoolRoles}=auth;
 const reader=requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER');
 const manager=requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD');
 const now=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const queryDate=client=>async(sid,date)=>{
  const sql=[
   'SELECT p.period_id,p.grade_level,p.section,p.classroom,p.start_time,p.end_time,p.subject_id,p.subject_name,',
   'COALESCE(cover.substitute_teacher_user_id,regular.teacher_user_id) AS teacher_user_id,',
   'a.adjustment_type,a.teacher_user_id AS alt_teacher,a.subject_id AS alt_subject,',
   'sub.subject_name AS alt_subject_name,a.start_time AS alt_start,a.end_time AS alt_end,a.classroom AS alt_room',
   'FROM class_periods p',
   'LEFT JOIN LATERAL (SELECT ta.teacher_user_id FROM teacher_period_assignments ta',
   'WHERE ta.school_id=p.school_id AND ta.period_id=p.period_id ORDER BY ta.assignment_id LIMIT 1) regular ON TRUE',
   'LEFT JOIN LATERAL (SELECT ts.substitute_teacher_user_id FROM teacher_period_substitutions ts',
   "WHERE ts.school_id=p.school_id AND ts.period_id=p.period_id AND ts.original_teacher_user_id=regular.teacher_user_id AND ts.status='ACTIVE'",
   'AND $2::date BETWEEN ts.start_date AND ts.end_date ORDER BY ts.created_at DESC LIMIT 1) cover ON TRUE',
   'LEFT JOIN schedule_day_adjustments a ON a.school_id=p.school_id AND a.period_id=p.period_id AND a.school_date=$2::date',
   'LEFT JOIN school_subjects sub ON sub.school_id=a.school_id AND sub.subject_id=a.subject_id',
   'WHERE p.school_id=$1 AND p.active=TRUE AND (p.effective_from IS NULL OR p.effective_from<=$2::date)',
   'AND (p.effective_to IS NULL OR p.effective_to>=$2::date)',
   'AND EXISTS(SELECT 1 FROM class_period_days w WHERE w.school_id=p.school_id AND w.period_id=p.period_id',
   'AND w.weekday=EXTRACT(DOW FROM $2::date)::int)'
  ].join(' ');
  const result=await client.query(sql,[sid,date]);
  return result.rows.map(p=>effective(p,p.adjustment_type?{
   adjustment_type:p.adjustment_type,teacher_user_id:p.alt_teacher,subject_id:p.alt_subject,
   subject_name:p.alt_subject_name,start_time:p.alt_start,end_time:p.alt_end,classroom:p.alt_room
  }:null));
 };
 // Read-only summary for the existing Teacher Dashboard shortcuts.
 // Effective timetable is shared with date-specific schedule validation.
 // This never writes attendance, DTR, SF2 or teacher assignments.
 app.get('/api/teacher/today-overview',authenticateSchoolClient,requireSchoolRoles('TEACHER'),async(req,res)=>{
  const schoolId=req.auth.schoolId,teacherId=req.auth.userId,date=now();
  const localTime=new Intl.DateTimeFormat('en-GB',{
   timeZone:'Asia/Manila',hourCycle:'h23',hour:'2-digit',minute:'2-digit'
  }).format(new Date());
  try {
   const [allPeriods,calendar,conflicts,sf2] = await Promise.all([
    queryDate(pool)(schoolId,date),
    pool.query([
     'SELECT e.exception_type AS type,e.title,',
     "to_char(e.dismissal_time,'HH24:MI') AS \"dismissalTime\",",
     "to_char(e.suspension_time,'HH24:MI') AS \"suspensionTime\",",
     "COALESCE(array_agg(ep.period_id) FILTER(WHERE ep.period_id IS NOT NULL),'{}') AS \"periodIds\"",
     'FROM school_calendar_exceptions e',
     'LEFT JOIN school_calendar_exception_periods ep ON ep.school_id=e.school_id AND ep.exception_id=e.exception_id',
     'WHERE e.school_id=$1 AND e.calendar_date=$2::date',
     'GROUP BY e.exception_id'
    ].join(' '),[schoolId,date]),
    // Same accepted-QR/manual contradiction as the existing conflict review:
    // one distinct manual mark per learner, period, and date; no gate scans.
    pool.query([
     'SELECT COUNT(*)::int AS total FROM manual_attendance_marks m',
     'JOIN class_periods p ON p.school_id=m.school_id AND p.period_id=m.period_id',
     "WHERE m.school_id=$1 AND m.school_date=$3::date AND m.status IN ('ABSENT','EXCUSED')",
     "AND EXISTS(SELECT 1 FROM attendance_events e WHERE e.school_id=m.school_id",
     " AND e.period_id=m.period_id AND e.student_id=m.student_id AND e.school_date=m.school_date",
     " AND e.attendance_scope='CLASS' AND e.event_type='TIME_IN' AND e.sync_status='ACCEPTED')",
     'AND (EXISTS(SELECT 1 FROM teacher_period_assignments ta WHERE ta.school_id=m.school_id',
     ' AND ta.period_id=m.period_id AND ta.teacher_user_id=$2)',
     'OR EXISTS(SELECT 1 FROM teacher_period_substitutions ts WHERE ts.school_id=m.school_id',
     " AND ts.period_id=m.period_id AND ts.substitute_teacher_user_id=$2 AND ts.status='ACTIVE'",
     ' AND m.school_date BETWEEN ts.start_date AND ts.end_date)',
     'OR EXISTS(SELECT 1 FROM schedule_day_adjustments da WHERE da.school_id=m.school_id',
     ' AND da.period_id=m.period_id AND da.teacher_user_id=$2 AND da.school_date=m.school_date)',
     'OR EXISTS(SELECT 1 FROM class_adviser_assignments ca WHERE ca.school_id=m.school_id',
     ' AND ca.adviser_user_id=$2 AND ca.grade_level=p.grade_level AND ca.section=p.section))'
    ].join(' '),[schoolId,teacherId,date]),
    pool.query([
     'SELECT ca.grade_level AS "gradeLevel",ca.section,sub.status',
     'FROM class_adviser_assignments ca',
     'LEFT JOIN sf2_submissions sub ON sub.school_id=ca.school_id',
     ' AND sub.grade_level=ca.grade_level AND sub.section=ca.section',
     " AND sub.reporting_month=date_trunc('month',$3::date)::date AND sub.is_current=TRUE",
     'WHERE ca.school_id=$1 AND ca.adviser_user_id=$2',
     'ORDER BY ca.grade_level,ca.section'
    ].join(' '),[schoolId,teacherId,date])
   ]);

   // Full-day or time-specific learner class suspension remains a school
   // calendar exception, not an attendance/DTR event.
   const exception=calendar.rows[0]||null;
   const selected=new Set((exception?.periodIds||[]).map(String));
   const affects=id=>exception&&(!selected.size||selected.has(String(id)));
   const permitted=allPeriods.filter(p=>!p.cancelled && String(p.teacherUserId||'')===String(teacherId));
   const scheduled=permitted.filter(p=>{
    if(!affects(p.periodId))return true;
    if(exception.type==='CLOSED'||exception.type==='SPECIAL_CLASS')return false;
    if(exception.type==='CLASS_SUSPENSION')
     return !exception.suspensionTime || p.endTime>exception.suspensionTime ? false : true;
    if(exception.type==='SHORTENED_DAY')
     return !exception.dismissalTime || p.endTime>exception.dismissalTime ? false : true;
    return true;
   }).sort((a,b)=>String(a.startTime||'').localeCompare(String(b.startTime||'')));

   const next=scheduled.find(p=>p.endTime && p.endTime>localTime && p.startTime);
   const completed=scheduled.filter(p=>p.endTime && p.endTime<=localTime);
   const periodIds=[...new Set(completed.map(p=>p.periodId))];
   let unsigned=0;
   if(periodIds.length){
    const signed=await pool.query(
     'SELECT period_id FROM class_attendance_finalizations WHERE school_id=$1 AND school_date=$2::date AND finalized=TRUE AND period_id=ANY($3::uuid[])',
     [schoolId,date,periodIds]);
    const signedIds=new Set(signed.rows.map(r=>String(r.period_id)));
    unsigned=periodIds.filter(id=>!signedIds.has(String(id))).length;
   }
   let scheduleMessage=next?'':'No remaining assigned teaching periods today.';
   if(exception?.type==='CLOSED'&&permitted.some(p=>affects(p.periodId)))
    scheduleMessage='School calendar closure today. Review the official timetable.';
   else if(exception?.type==='CLASS_SUSPENSION'&&permitted.some(p=>affects(p.periodId)))
    scheduleMessage=exception.suspensionTime
     ? 'Class suspension applies from '+exception.suspensionTime+'. Check the school calendar.'
     : 'Full-day class suspension. Review the school calendar.';
   else if(exception?.type==='SPECIAL_CLASS'&&permitted.some(p=>affects(p.periodId)))
    scheduleMessage='Special-class calendar change. Confirm the timetable before class.';
   else if(exception?.type==='SHORTENED_DAY'&&permitted.some(p=>affects(p.periodId)))
    scheduleMessage='Shortened school day. Verify the published timetable.';
   const counts={
    sections:sf2.rows.length,
    submitted:sf2.rows.filter(r=>r.status==='SUBMITTED').length,
    collected:sf2.rows.filter(r=>r.status==='COLLECTED').length,
    notSubmitted:sf2.rows.filter(r=>!r.status).length,
    month:date.slice(0,7)
   };
   return res.json({
    asOfDate:date,
    nextClass:next?{
     periodId:next.periodId,subject:next.subjectName||'Class',
     gradeLevel:next.gradeLevel,section:next.section,
     startTime:next.startTime,endTime:next.endTime,
     inProgress:next.startTime<=localTime
    }:null,
    scheduleMessage,
    attendance:{
     verifiedConflictsToday:Number(conflicts.rows[0]?.total||0),
     completedUnsignedToday:unsigned
    },
    sf2:counts
   });
  }catch(err){
   console.error('Teacher teaching overview:',err.message);
   return res.status(500).json({error:'Today’s teaching overview is unavailable. Open the timetable or attendance register to verify details.'});
  }
 });

 app.get('/api/schedule-adjustments',authenticateSchoolClient,reader,async(req,res)=>{
  const {from,to}=req.query||{};
  if(!dateOk(from)||!dateOk(to)||from>to||(Date.parse(to)-Date.parse(from)>62*86400000))
   return res.status(400).json({error:'Select a valid date range of at most 63 days.'});
  try {
   const sql=[
    'SELECT a.adjustment_id AS "adjustmentId",a.period_id AS "periodId",to_char(a.school_date,\'YYYY-MM-DD\') AS date,',
    'a.adjustment_type AS type,a.teacher_user_id AS "teacherUserId",t.display_name AS "teacherName",a.memo_id AS "memoId",m.title AS "memoTitle",',    'a.subject_id AS "subjectId",sub.subject_name AS "subjectName",sub.department_id AS "subjectDepartmentId",',
    'to_char(a.start_time,\'HH24:MI\') AS "startTime",to_char(a.end_time,\'HH24:MI\') AS "endTime",',
    'a.classroom,a.reason_type AS reason,a.notes,p.grade_level AS "gradeLevel",p.section,p.department_id AS "departmentId"',
    'FROM schedule_day_adjustments a JOIN class_periods p ON p.school_id=a.school_id AND p.period_id=a.period_id',
    'LEFT JOIN school_users t ON t.school_id=a.school_id AND t.user_id=a.teacher_user_id',
    'LEFT JOIN school_memoranda m ON m.school_id=a.school_id AND m.memo_id=a.memo_id',
    'LEFT JOIN school_subjects sub ON sub.school_id=a.school_id AND sub.subject_id=a.subject_id',
    'WHERE a.school_id=$1 AND a.school_date BETWEEN $2::date AND $3::date',
    'AND ($4::boolean=FALSE OR a.teacher_user_id=$5::uuid',
    'OR EXISTS(SELECT 1 FROM teacher_period_assignments ta WHERE ta.school_id=a.school_id AND ta.period_id=a.period_id AND ta.teacher_user_id=$5::uuid)',
    'OR EXISTS(SELECT 1 FROM class_adviser_assignments ca WHERE ca.school_id=a.school_id AND ca.adviser_user_id=$5::uuid AND ca.grade_level=p.grade_level AND ca.section=p.section))',
    'ORDER BY a.school_date,p.start_time,p.section'
   ].join(' ');
   const found=await pool.query(sql,[req.auth.schoolId,from,to,req.auth.role==='TEACHER',req.auth.userId]);
   res.json({adjustments:found.rows});
  } catch(err){console.error('Schedule adjustment read:',err.message);res.status(500).json({error:'Unable to load schedule adjustments.'});}
 });

 app.post('/api/schedule-adjustments',authenticateSchoolClient,manager,async(req,res)=>{
  const b=req.body||{},dates=eachDate(b.startDate,b.endDate||b.startDate),type=b.type,reason=b.reason;
  const types=['SUBSTITUTE','REPLACE','RESCHEDULE','CANCEL'],reasons=['SEMINAR','TRAINING','EXAMINATION','SPECIAL_ACTIVITY','LEAVE','OTHER'];
  const memoId=b.memoId||null,teacherId=b.teacherUserId||null,subjectId=b.subjectId||null,
   start=b.startTime||null,end=b.endTime||null,room=b.classroom==null?null:String(b.classroom).trim(),
   notes=b.notes==null?null:String(b.notes).trim();
  if(!uuidOk(b.periodId)||(memoId&&!uuidOk(memoId))||!dates||!types.includes(type)||!reasons.includes(reason))
   return res.status(400).json({error:'Choose a class, change, reason and date range of up to 31 days.'});
  if(dates.some(date=>date<now()))return res.status(409).json({error:'Past class schedules cannot be changed.'});
  if((teacherId&&!uuidOk(teacherId))||(subjectId&&!uuidOk(subjectId))||
    ((start||end)&&(!timeOk(start)||!timeOk(end)||start>=end))||
    (room!=null&&room.length>100)||(notes!=null&&notes.length>500)||
    (type==='SUBSTITUTE'&&(!teacherId||subjectId||start||end))||
    (type==='REPLACE'&&!subjectId)||
    (type==='RESCHEDULE'&&(!start||!end||teacherId||subjectId))||
    (type==='CANCEL'&&(teacherId||subjectId||start||end||room)))
   return res.status(400).json({error:'Complete only the fields required for this adjustment type.'});
  let c;
  try {
   c=await pool.connect();await c.query('BEGIN');
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1::text), 16016)',[req.auth.schoolId]);
   const parent=await c.query([
    'SELECT p.period_id,p.period_name,p.grade_level,p.section,p.start_time,p.end_time,p.classroom,p.subject_name,',
    'p.subject_id,p.department_id,p.effective_from,p.effective_to,',
    '(SELECT ta.teacher_user_id FROM teacher_period_assignments ta WHERE ta.school_id=p.school_id',
    'AND ta.period_id=p.period_id ORDER BY ta.assignment_id LIMIT 1) AS teacher_user_id',
    'FROM class_periods p WHERE p.school_id=$1 AND p.period_id=$2 AND p.active=TRUE FOR UPDATE'
   ].join(' '),[req.auth.schoolId,b.periodId]);
   if(!parent.rowCount){await c.query('ROLLBACK');return res.status(404).json({error:'Class schedule not found.'});}
   const base=parent.rows[0];
   if(req.auth.role==='DEPARTMENT_HEAD'&&(!req.auth.departmentId||req.auth.departmentCode==='UNASSIGNED'||
    String(req.auth.departmentId)!==String(base.department_id))){
    await c.query('ROLLBACK');return res.status(403).json({error:'Only your department schedules can be changed.'});
   }
   let subject=null,teacher=null;
   if(subjectId){
    const got=await c.query('SELECT subject_id,subject_name,department_id FROM school_subjects WHERE school_id=$1 AND subject_id=$2 AND active=TRUE',[req.auth.schoolId,subjectId]);
    if(!got.rowCount){await c.query('ROLLBACK');return res.status(400).json({error:'Choose an active subject.'});}
    subject=got.rows[0];
    if(req.auth.role==='DEPARTMENT_HEAD'&&String(subject.department_id)!==String(req.auth.departmentId)){
     await c.query('ROLLBACK');return res.status(403).json({error:'Replacement subjects must belong to your department.'});
    }
   }
   if(teacherId){
    const got=await c.query([
     'SELECT user_id,display_name,department_id FROM school_users',
     "WHERE school_id=$1 AND user_id=$2 AND role='TEACHER' AND active=TRUE",
     "AND 'SUBJECT_TEACHER'=ANY(teacher_designations) AND COALESCE(teacher_status,'ACTIVE')='ACTIVE'"
    ].join(' '),[req.auth.schoolId,teacherId]);
    if(!got.rowCount){await c.query('ROLLBACK');return res.status(400).json({error:'Choose an active Subject Teacher.'});}
    teacher=got.rows[0];
    if(req.auth.role==='DEPARTMENT_HEAD'&&String(teacher.department_id)!==String(req.auth.departmentId)){
     await c.query('ROLLBACK');return res.status(403).json({error:'A Department Head can assign only teachers in their department.'});
    }
    if(type==='SUBSTITUTE'&&String(teacherId)===String(base.teacher_user_id)){
     await c.query('ROLLBACK');return res.status(400).json({error:'Choose a different teacher for seminar coverage.'});
    }
   }
   const dept=subject?.department_id||base.department_id;
   if(teacher&&String(teacher.department_id)!==String(dept)){
    await c.query('ROLLBACK');return res.status(400).json({error:'The replacement teacher must belong to the subject department.'});
   }
   if(type==='REPLACE'&&!teacher&&base.teacher_user_id){
    const existing=await c.query('SELECT department_id FROM school_users WHERE school_id=$1 AND user_id=$2',[req.auth.schoolId,base.teacher_user_id]);
    if(existing.rowCount&&String(existing.rows[0].department_id)!==String(dept)){
     await c.query('ROLLBACK');return res.status(400).json({error:'Choose a teacher from the replacement subject department.'});
    }
   }
   const schedulesFor=queryDate(c),savedIds=[],applicable=[];
   for(const date of dates) {
    if(base.effective_from&&iso(base.effective_from)>date||base.effective_to&&iso(base.effective_to)<date){
     continue; // Days outside the class's effective range are not altered.
    }
    const cal=await c.query("SELECT exception_type,to_char(suspension_time,'HH24:MI') AS suspension_time FROM school_calendar_exceptions WHERE school_id=$1 AND calendar_date=$2::date",[req.auth.schoolId,date]);
    if(cal.rows[0]?.exception_type==='CLOSED'||(cal.rows[0]?.exception_type==='CLASS_SUSPENSION'&&
       (!cal.rows[0].suspension_time||String(base.start_time).slice(0,5)>=cal.rows[0].suspension_time)))continue; // Already suspended or closed; do not create duplicate cancellations.
    if(memoId){
     const memo=await c.query(`SELECT 1 FROM school_memoranda WHERE school_id=$1 AND memo_id=$2
       AND archived_at IS NULL AND effective_date<=$3::date AND end_date>=$3::date`,
       [req.auth.schoolId,memoId,date]);
     if(!memo.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'Selected Principal memorandum does not cover '+date+'.'});}
    }
    const schedules=await schedulesFor(req.auth.schoolId,date);
    const current=schedules.find(x=>String(x.periodId)===String(b.periodId));
    if(!current)continue; // Skip weekends or weekdays on which this subject does not meet.
    const attendance=await c.query([
     'SELECT 1 FROM attendance_events WHERE school_id=$1 AND period_id=$2 AND school_date=$3::date',
     "AND sync_status='ACCEPTED' LIMIT 1"
    ].join(' '),[req.auth.schoolId,b.periodId,date]);
    if(attendance.rowCount){
     await c.query('ROLLBACK');return res.status(409).json({error:'Accepted class attendance exists on '+date+'. That date is locked.'});
    }
    const previous=await c.query(
      'SELECT teacher_user_id FROM schedule_day_adjustments WHERE school_id=$1 AND period_id=$2 AND school_date=$3::date',
      [req.auth.schoolId,b.periodId,date]);
    const originalCover=previous.rows[0]?.teacher_user_id ? base.teacher_user_id : current.teacherUserId;
    const proposed=effective({...base,teacher_user_id:originalCover},{
     adjustment_type:type,teacher_user_id:teacherId,subject_id:subjectId,
     subject_name:subject?.subject_name||null,start_time:start,end_time:end,classroom:room
    });
    if(type!=='CANCEL'){
     const hit=conflict(proposed,schedules);
     if(hit){
      await c.query('ROLLBACK');
      return res.status(409).json({error:'Schedule conflict on '+date+': '+hit.kind+
       ' overlaps '+hit.other.gradeLevel+' · '+hit.other.section+' at '+hit.other.startTime+'–'+hit.other.endTime+'.'});
     }
    }
    applicable.push(date);
   }
   if(!applicable.length){
    await c.query('ROLLBACK');
    return res.status(409).json({error:'No scheduled class days were found in this range. Choose the weekday(s) on which this subject meets.'});
   }
   for(const date of applicable){
    const saved=await c.query([
     'INSERT INTO schedule_day_adjustments(school_id,period_id,school_date,adjustment_type,',
     'teacher_user_id,subject_id,start_time,end_time,classroom,reason_type,notes,created_by_user_id,memo_id)',
     'VALUES($1,$2,$3::date,$4,$5,$6,$7::time,$8::time,$9,$10,$11,$12,$13)',
     'ON CONFLICT(school_id,period_id,school_date) DO UPDATE SET',
     'adjustment_type=EXCLUDED.adjustment_type,teacher_user_id=EXCLUDED.teacher_user_id,',
     'subject_id=EXCLUDED.subject_id,start_time=EXCLUDED.start_time,end_time=EXCLUDED.end_time,',
     'classroom=EXCLUDED.classroom,reason_type=EXCLUDED.reason_type,notes=EXCLUDED.notes,memo_id=EXCLUDED.memo_id,updated_at=NOW()',
     'RETURNING adjustment_id'
    ].join(' '),[req.auth.schoolId,b.periodId,date,type,teacherId,subjectId,start,end,room,reason,notes||null,req.auth.userId,memoId]);
    savedIds.push(saved.rows[0].adjustment_id);
    await c.query([
     'INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)',
     "VALUES($1,'SCHOOL',$2,'SAVE_DATE_SPECIFIC_SCHEDULE','schedule_day_adjustment',$3,$4::jsonb)"
    ].join(' '),[req.auth.schoolId,req.auth.userId,saved.rows[0].adjustment_id,JSON.stringify({periodId:b.periodId,date,type,reason,memoId})]);
   }
   await c.query('COMMIT');res.status(201).json({ok:true,changedDates:applicable,updated:applicable.length,skipped:dates.length-applicable.length});
  }catch(err){
   if(c)await c.query('ROLLBACK').catch(()=>{});
   console.error('Schedule adjustment save failed:',err.message);
   res.status(500).json({error:'Could not save dated schedule adjustment.'});
  }finally{if(c)c.release();}
 });
 app.delete('/api/schedule-adjustments/:id',authenticateSchoolClient,manager,async(req,res)=>{
  if(!uuidOk(req.params.id))return res.status(400).json({error:'Invalid adjustment ID.'});
  let c;
  try {
   c=await pool.connect();await c.query('BEGIN');
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1::text), 16016)',[req.auth.schoolId]);
   const got=await c.query([
    'SELECT a.period_id,to_char(a.school_date,\'YYYY-MM-DD\') AS date,p.department_id',
    'FROM schedule_day_adjustments a JOIN class_periods p ON p.school_id=a.school_id AND p.period_id=a.period_id',
    'WHERE a.school_id=$1 AND a.adjustment_id=$2 FOR UPDATE OF a'
   ].join(' '),[req.auth.schoolId,req.params.id]);
   if(!got.rowCount){await c.query('ROLLBACK');return res.status(404).json({error:'Adjustment not found.'});}
   const x=got.rows[0];
   if(req.auth.role==='DEPARTMENT_HEAD'&&(req.auth.departmentCode==='UNASSIGNED'||String(x.department_id)!==String(req.auth.departmentId))){
    await c.query('ROLLBACK');return res.status(403).json({error:'Only your department adjustments can be restored.'});
   }
   if(x.date<now()){await c.query('ROLLBACK');return res.status(409).json({error:'Historical changes cannot be removed.'});}
   const attendance=await c.query([
    'SELECT 1 FROM attendance_events WHERE school_id=$1 AND period_id=$2 AND school_date=$3::date',
    "AND sync_status='ACCEPTED' LIMIT 1"
   ].join(' '),[req.auth.schoolId,x.period_id,x.date]);
   if(attendance.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'Class attendance already exists for that date.'});}
   await c.query('DELETE FROM schedule_day_adjustments WHERE school_id=$1 AND adjustment_id=$2',[req.auth.schoolId,req.params.id]);
   await c.query([
    'INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)',
    "VALUES($1,'SCHOOL',$2,'RESTORE_REGULAR_SCHEDULE','schedule_day_adjustment',$3,$4::jsonb)"
   ].join(' '),[req.auth.schoolId,req.auth.userId,req.params.id,JSON.stringify({periodId:x.period_id,date:x.date})]);
   await c.query('COMMIT');res.json({ok:true});
  }catch(err){
   if(c)await c.query('ROLLBACK').catch(()=>{});
   console.error('Schedule restore failed:',err.message);
   res.status(500).json({error:'Could not restore regular schedule.'});
  }finally{if(c)c.release();}
 });
}
module.exports={registerFlexibleScheduleRoutes,effective,conflict,eachDate};
