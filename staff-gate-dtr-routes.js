'use strict';
const {randomUUID}=require('node:crypto');
const {manilaDate}=require('./staff-lunch-routes');
const DTR_SLOTS=Object.freeze(['AM_IN','AM_OUT','PM_IN','PM_OUT']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function registerStaffGateDtrRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 // School-scoped read-only reconciliation: never create DTR punches from gate movements.
 app.get('/api/staff-attendance/admin/dtr-reconciliation-preview',authenticateSchoolClient,
 requireSchoolRoles('SCHOOL_ADMIN'),async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  const staffUserId=String(req.query?.staffUserId||''),date=String(req.query?.date||manilaDate());
  if(!UUID.test(staffUserId)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)||
     Number.isNaN(Date.parse(date+'T00:00:00Z'))||
     new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||date>manilaDate())
   return res.status(400).json({error:'Valid employee and school date required.'});
  try{
   const schoolId=req.auth.schoolId;
   const [employee,employeeSchedule,schoolDefaults,gate,dtr,ob,calendar]=await Promise.all([
    pool.query("SELECT 1 FROM school_users WHERE school_id=$1 AND user_id=$2 AND active=TRUE",[schoolId,staffUserId]),
    require('./form48-employee-schedules').getEmployeeForm48Schedule(pool,schoolId,staffUserId),
    require('./form48-bulk-routes').getSchoolForm48Defaults(pool,schoolId),
    pool.query(`SELECT "eventType",time FROM (
      SELECT CASE WHEN gate_direction='IN' THEN 'TIME_IN' ELSE 'TIME_OUT' END AS "eventType",
       to_char(occurred_at AT TIME ZONE 'Asia/Manila','HH24:MI') AS time,occurred_at
      FROM staff_attendance_events WHERE school_id=$1 AND staff_user_id=$2 AND school_date=$3::date
       AND event_kind='GATE_MOVEMENT' AND verification_status='VERIFIED'
      UNION ALL SELECT event_type AS "eventType",
       to_char(occurred_at AT TIME ZONE 'Asia/Manila','HH24:MI') AS time,occurred_at
      FROM teacher_gate_events WHERE school_id=$1 AND teacher_user_id=$2 AND school_date=$3::date
     ) gate ORDER BY occurred_at`,[schoolId,staffUserId,date]),
    pool.query(`SELECT dtr_slot AS slot,to_char(occurred_at AT TIME ZONE 'Asia/Manila','HH24:MI') AS time
      FROM staff_attendance_events WHERE school_id=$1 AND staff_user_id=$2 AND school_date=$3::date
       AND event_kind='DTR_SLOT' AND verification_status='VERIFIED'`,[schoolId,staffUserId,date]),
    pool.query(`SELECT to_char(starts_at AT TIME ZONE 'Asia/Manila','HH24:MI') AS start,
       to_char(ends_at AT TIME ZONE 'Asia/Manila','HH24:MI') AS "end"
      FROM staff_official_business_requests WHERE school_id=$1 AND staff_user_id=$2 AND status='APPROVED'
       AND starts_at<(($3::date+INTERVAL '1 day') AT TIME ZONE 'Asia/Manila')
       AND ends_at>($3::date::timestamp AT TIME ZONE 'Asia/Manila')`,[schoolId,staffUserId,date]),
    pool.query(`SELECT exception_type FROM school_calendar_exceptions WHERE school_id=$1
       AND calendar_date=$2::date AND exception_type IN ('CLOSED','SHORTENED_DAY')`,[schoolId,date])
   ]);
   if(!employee.rowCount)return res.status(404).json({error:'Employee not found in school.'});
   const weekday=new Date(date+'T12:00:00Z').getUTCDay();
   const existingSlots=Object.fromEntries(dtr.rows.map(x=>[x.slot,x.time]));
   const {effectiveStaffSchedule}=require('./staff-attendance-schedule');
   const {schedule,source}=effectiveStaffSchedule(employeeSchedule,schoolDefaults);
   const result=calendar.rowCount?{suggestions:{},review:['CALENDAR_EXCEPTION_REQUIRES_REVIEW'],safeToApply:false}:
    !schedule?{suggestions:{},review:['SCHEDULE_UNAVAILABLE'],safeToApply:false}:
    !schedule.workdays.includes(weekday)?{suggestions:{},review:['NOT_SCHEDULED_WORKDAY'],safeToApply:false}:
    require('./gate-dtr-reconciliation').reconcileGateDay({
     movements:gate.rows,existingSlots,
     hours:weekday===6?schedule.saturdayHours:schedule.regularHours,approvedOb:ob.rows});
   return res.json({staffUserId,date,existingSlots,gateEventCount:gate.rowCount,
    approvedObCount:ob.rowCount,scheduleSource:source,
    ...result,notice:'Review only. No DTR punch was created.'});
  }catch(err){console.error('DTR preview:',err.message);
   return res.status(503).json({error:'Unable to preview DTR reconciliation.'});}
 });

 // School Admin only: one daily exception queue over VERIFIED evidence.
 // No absences, punches, OB decisions or attendance records are written here.
 app.get('/api/staff-attendance/admin/smart-overview',authenticateSchoolClient,
  requireSchoolRoles('SCHOOL_ADMIN'),async(req,res)=>{
   res.set('Cache-Control','private, no-store');
   const date=String(req.query?.date||manilaDate());
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date+'T00:00:00Z'))||
      new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||date>manilaDate())
    return res.status(400).json({error:'Choose a valid school date, not in the future.'});
   const schoolId=req.auth.schoolId;
   try{
    const [staff,schedules,defaults,gate,dtr,ob,calendar]=await Promise.all([
     pool.query(`SELECT user_id AS "userId",display_name AS "displayName",role
      FROM school_users WHERE school_id=$1 AND active=TRUE
       AND role IN ('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN')
      ORDER BY display_name`,[schoolId]),
     pool.query(`SELECT staff_user_id AS "staffUserId",workdays,
       regular_hours AS "regularHours",saturday_hours AS "saturdayHours"
       FROM staff_form48_employee_schedules WHERE school_id=$1`,[schoolId]),
     require('./form48-bulk-routes').getSchoolForm48Defaults(pool,schoolId),
     pool.query(`SELECT "staffUserId","eventType",time FROM (
      SELECT staff_user_id AS "staffUserId",
       CASE WHEN gate_direction='IN' THEN 'TIME_IN' ELSE 'TIME_OUT' END AS "eventType",
       to_char(occurred_at AT TIME ZONE 'Asia/Manila','HH24:MI') AS time,occurred_at
       FROM staff_attendance_events WHERE school_id=$1 AND school_date=$2::date
        AND event_kind='GATE_MOVEMENT' AND verification_status='VERIFIED'
      UNION ALL
      SELECT teacher_user_id AS "staffUserId",event_type AS "eventType",
       to_char(occurred_at AT TIME ZONE 'Asia/Manila','HH24:MI') AS time,occurred_at
       FROM teacher_gate_events t WHERE t.school_id=$1 AND t.school_date=$2::date
        AND t.photo_verified=TRUE
        AND NOT EXISTS(SELECT 1 FROM staff_attendance_events e WHERE
         e.school_id=t.school_id AND e.legacy_gate_event_id=t.event_id)
     ) physical ORDER BY occurred_at`,[schoolId,date]),
     pool.query(`SELECT staff_user_id AS "staffUserId",dtr_slot AS slot,
      to_char(occurred_at AT TIME ZONE 'Asia/Manila','HH24:MI') AS time
      FROM staff_attendance_events WHERE school_id=$1 AND school_date=$2::date
       AND event_kind='DTR_SLOT' AND verification_status='VERIFIED'`,[schoolId,date]),
     pool.query(`SELECT staff_user_id AS "staffUserId",
       to_char(starts_at AT TIME ZONE 'Asia/Manila','HH24:MI') AS start,
       to_char(ends_at AT TIME ZONE 'Asia/Manila','HH24:MI') AS "end",
       (to_char(starts_at AT TIME ZONE 'Asia/Manila','YYYY-MM-DD')<>$2
         OR to_char(ends_at AT TIME ZONE 'Asia/Manila','YYYY-MM-DD')<>$2) AS "crossDay"
      FROM staff_official_business_requests
      WHERE school_id=$1 AND status='APPROVED'
       AND starts_at<(($2::date+INTERVAL '1 day') AT TIME ZONE 'Asia/Manila')
       AND ends_at>($2::date::timestamp AT TIME ZONE 'Asia/Manila')`,[schoolId,date]),
     pool.query(`SELECT exception_type FROM school_calendar_exceptions
      WHERE school_id=$1 AND calendar_date=$2::date
       AND exception_type IN ('CLOSED','SHORTENED_DAY')`,[schoolId,date])
    ]);
    const overview=require('./smart-attendance-overview').buildSmartOverview({
     date,staff:staff.rows,schedules:schedules.rows,defaults,
     gate:gate.rows,dtr:dtr.rows,ob:ob.rows,calendarExceptions:calendar.rows
    });
    return res.json(overview);
   }catch(err){
    console.error('Smart attendance daily overview:',err.message);
    return res.status(503).json({error:'Attendance overview is temporarily unavailable. No records changed.'});
   }
  });

 // Physical gate movements are maintained separately by existing Gatekeeper
 // endpoints; this endpoint is solely a verified Form-48 DTR fallback.
 app.post('/api/staff-attendance/gatekeeper/dtr',authenticateSchoolClient,
   requireSchoolRoles('GATE_KEEPER'),async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  const qrToken=String(req.body?.teacherQrToken||'').trim();
  const slot=String(req.body?.slot||'');
  if(!UUID.test(qrToken)||!DTR_SLOTS.includes(slot)||req.body?.photoVerified!==true)
   return res.status(400).json({error:'A valid staff badge, DTR slot, and confirmed photo match are required.'});
  if(req.auth?.type!=='SCHOOL_USER'||req.auth.role!=='GATE_KEEPER')
   return res.status(403).json({error:'Gatekeeper authentication required.'});
  const schoolId=req.auth.schoolId,keeperId=req.auth.userId,schoolDate=manilaDate();
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const forbidden=await client.query(
    `SELECT 1 FROM school_calendar_exceptions
      WHERE school_id=$1 AND calendar_date=$2::date AND exception_type='CLOSED'
      LIMIT 1`,[schoolId,schoolDate]);
   if(forbidden.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'The school is closed on this date.'});}
   const teacher=await client.query(
    `SELECT user_id,display_name
     FROM school_users
     WHERE school_id=$1 AND teacher_qr_token=$2 AND role IN ('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN')
       AND active=TRUE AND (teacher_photo_path IS NOT NULL OR EXISTS (
         SELECT 1 FROM official_profile_photos p WHERE p.school_id=school_users.school_id
           AND p.subject_kind='STAFF' AND p.subject_id=school_users.user_id::text))
     FOR SHARE`,[schoolId,qrToken]);
   if(!teacher.rowCount){
    await client.query('ROLLBACK');
    return res.status(404).json({error:'An active school staff member and registered photo are required.'});
   }
   const teacherId=teacher.rows[0].user_id,eventId=randomUUID();
   const recorded=await client.query(
    `INSERT INTO staff_attendance_events
      (event_id,school_id,staff_user_id,event_kind,dtr_slot,school_date,
       occurred_at,source,verification_status,verification_method,actor_user_id,client_event_key)
     VALUES($1,$2,$3,'DTR_SLOT',$4,$5,NOW(),'GATEKEEPER','VERIFIED','GUARD_PHOTO',$6,$7)
     ON CONFLICT DO NOTHING RETURNING event_id,occurred_at`,
    [eventId,schoolId,teacherId,slot,schoolDate,keeperId,randomUUID()]);
   if(!recorded.rowCount){
    await client.query('ROLLBACK');
    return res.status(409).json({error:'This staff member already has a verified DTR entry for that slot.',alreadyRecorded:true});
   }
   await client.query(
    `INSERT INTO staff_attendance_audit
      (school_id,actor_user_id,action,target_type,target_id,details)
     VALUES($1,$2,'GATEKEEPER_DTR_VERIFIED','STAFF_ATTENDANCE_EVENT',$3,$4::jsonb)`,
    [schoolId,keeperId,eventId,JSON.stringify({staffUserId:teacherId,slot,schoolDate,photoVerified:true})]);
   await client.query('COMMIT');
   return res.status(201).json({
     eventId,teacherName:teacher.rows[0].display_name,slot,schoolDate,
     occurredAt:recorded.rows[0].occurred_at,status:'VERIFIED'
   });
  }catch(err){
   await client.query('ROLLBACK').catch(()=>{});
   if(err.code==='23505')return res.status(409).json({error:'This DTR entry was already recorded.',alreadyRecorded:true});
   console.error('Gatekeeper DTR fallback:',err.message);
   return res.status(503).json({error:'Unable to record the gatekeeper-verified DTR.'});
  }finally{client.release();}
 });
 app.get('/api/staff-attendance/my/dtr',authenticateSchoolClient,
  requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER'),async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  const date=String(req.query?.date||manilaDate());
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date+'T00:00:00Z')))
   return res.status(400).json({error:'Invalid school date.'});
  try{
   const rows=await pool.query(
    `SELECT dtr_slot AS "slot",occurred_at AS "occurredAt",
       source,verification_method AS "verificationMethod"
     FROM staff_attendance_events WHERE school_id=$1 AND staff_user_id=$2
       AND school_date=$3::date AND event_kind='DTR_SLOT' AND verification_status='VERIFIED'
     ORDER BY occurred_at ASC`,[req.auth.schoolId,req.auth.userId,date]);
   return res.json({schoolDate:date,slots:DTR_SLOTS.map(slot=>{
    const match=rows.rows.find(x=>x.slot===slot);
    return {slot,status:match?'VERIFIED':'NOT_RECORDED',occurredAt:match?.occurredAt||null,
      source:match?.source||null,verificationMethod:match?.verificationMethod||null};
   })});
  }catch(err){console.error('Staff DTR personal read:',err.message);return res.status(503).json({error:'DTR records unavailable.'});}
 });


 // Read-only, self-scoped range of verified Form 48 entries for one attendance timeline.
 // Gate scans remain independent and are never copied into DTR entries.
 app.get('/api/staff-attendance/my/dtr-history',authenticateSchoolClient,
  requireSchoolRoles('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN'),async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  const from=String(req.query?.from||manilaDate()),to=String(req.query?.to||manilaDate());
  const validDate=value=>{
   if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
   const parsed=new Date(value+'T00:00:00Z');
   return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
  };
  if(!validDate(from)||!validDate(to)||from>to||
      Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z')>31*86400000)
   return res.status(400).json({error:'Choose a valid date range of up to 31 days.'});
  try{
   const result=await pool.query(
    `SELECT to_char(school_date,'YYYY-MM-DD') AS "schoolDate",
       dtr_slot AS "slot",occurred_at AS "occurredAt",
       source,verification_method AS "verificationMethod"
     FROM staff_attendance_events
     WHERE school_id=$1 AND staff_user_id=$2
       AND school_date BETWEEN $3::date AND $4::date
       AND event_kind='DTR_SLOT' AND verification_status='VERIFIED'
     ORDER BY school_date DESC,occurred_at ASC`,
    [req.auth.schoolId,req.auth.userId,from,to]);
   const [ob,gate]=await Promise.all([
     pool.query(`SELECT request_id AS "requestId",purpose,destination,
       starts_at AS "startsAt",ends_at AS "endsAt"
       FROM staff_official_business_requests WHERE school_id=$1 AND staff_user_id=$2
       AND status='APPROVED'
       AND starts_at<(($4::date + INTERVAL '1 day') AT TIME ZONE 'Asia/Manila')
       AND ends_at>($3::date::timestamp AT TIME ZONE 'Asia/Manila')
       ORDER BY starts_at ASC`,[req.auth.schoolId,req.auth.userId,from,to]),
     pool.query(`SELECT "schoolDate","eventType","occurredAt" FROM (
       SELECT to_char(school_date,'YYYY-MM-DD') AS "schoolDate",
         CASE WHEN gate_direction='IN' THEN 'TIME_IN' ELSE 'TIME_OUT' END AS "eventType",
         occurred_at AS "occurredAt"
       FROM staff_attendance_events WHERE school_id=$1 AND staff_user_id=$2
         AND event_kind='GATE_MOVEMENT' AND verification_status='VERIFIED'
         AND school_date BETWEEN $3::date AND $4::date
       UNION ALL
       SELECT to_char(school_date,'YYYY-MM-DD') AS "schoolDate",
         event_type AS "eventType",occurred_at AS "occurredAt"
       FROM teacher_gate_events WHERE school_id=$1 AND teacher_user_id=$2
         AND school_date BETWEEN $3::date AND $4::date
     ) gate_history ORDER BY "occurredAt" ASC`,[req.auth.schoolId,req.auth.userId,from,to])
   ]);
   const {buildObDtrRemarks}=require('./ob-dtr-remarks');
   const obRemarks=[];
   for(let stamp=Date.parse(from+'T00:00:00Z');stamp<=Date.parse(to+'T00:00:00Z');stamp+=86400000){
     const date=new Date(stamp).toISOString().slice(0,10);
     const remarks=buildObDtrRemarks(date,ob.rows,gate.rows);
     if(remarks.length)obRemarks.push({date,remarks});
   }
   // Self-scoped advisory evidence uses the SAME verified DTR/gate/OB rows.
   // A schedule or calendar lookup failure fails closed for suggestions without
   // hiding the employee's existing official attendance history.
   const [scheduleLookup,defaultsLookup,calendarLookup]=await Promise.allSettled([
    require('./form48-employee-schedules').getEmployeeForm48Schedule(
     pool,req.auth.schoolId,req.auth.userId),
    require('./form48-bulk-routes').getSchoolForm48Defaults(pool,req.auth.schoolId),
    pool.query(`SELECT to_char(calendar_date,'YYYY-MM-DD') AS "schoolDate",exception_type
      FROM school_calendar_exceptions WHERE school_id=$1 AND
       calendar_date BETWEEN $2::date AND $3::date
       AND exception_type IN ('CLOSED','SHORTENED_DAY')`,
     [req.auth.schoolId,from,to])
   ]);
   const {summarizePersonalAttendance}=require('./personal-attendance-insights');
   const {effectiveStaffSchedule}=require('./staff-attendance-schedule');
   const effective=scheduleLookup.status==='fulfilled'&&defaultsLookup.status==='fulfilled'
    ?effectiveStaffSchedule(scheduleLookup.value,defaultsLookup.value)
    :{schedule:null,source:'UNAVAILABLE'};
   const intelligence=summarizePersonalAttendance({
    from,to,dtrEvents:result.rows,gateEvents:gate.rows,approvedOb:ob.rows,
    schedule:effective.schedule,
    calendar:calendarLookup.status==='fulfilled'?calendarLookup.value.rows:null
   });
   return res.json({from,to,events:result.rows,obRemarks,intelligence});
  }catch(err){
   console.error('Personal DTR history:',err.message);
   return res.status(503).json({error:'Verified DTR history unavailable.'});
  }
 });

 // School Admin only: staff roster and verified monthly Form 48 reporting.
 // Never infer or backfill missing punches from gate movements or sign-in events.
 app.get('/api/staff-attendance/admin/form48/employees',authenticateSchoolClient,
  requireSchoolRoles('SCHOOL_ADMIN'),async(req,res)=>{
   res.set('Cache-Control','no-store, private');
   if(req.auth?.type!=='SCHOOL_USER'||req.auth.role!=='SCHOOL_ADMIN')return res.status(403).json({error:'School Administrator required.'});
   try{
    const staff=await pool.query(
     `SELECT user_id AS "userId",display_name AS "displayName",role
       FROM school_users WHERE school_id=$1
       AND role IN ('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER','GATE_KEEPER')
       ORDER BY display_name ASC`,[req.auth.schoolId]);
    return res.json({staff:staff.rows});
   }catch(err){console.error('Form48 employee lookup:',err.message);return res.status(503).json({error:'Staff listing unavailable.'});}
 });
 app.get('/api/staff-attendance/admin/form48',authenticateSchoolClient,
  requireSchoolRoles('SCHOOL_ADMIN'),async(req,res)=>{
   res.set('Cache-Control','no-store, private');
   if(req.auth?.type!=='SCHOOL_USER'||req.auth.role!=='SCHOOL_ADMIN')return res.status(403).json({error:'School Administrator required.'});
   const staffUserId=String(req.query?.staffUserId||'');
   const month=String(req.query?.month||'');
   if(!UUID.test(staffUserId)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    return res.status(400).json({error:'Valid staff member and month required.'});
   const [yearPart,monthPart]=month.split('-').map(Number);
   if(yearPart<2000||yearPart>2100)return res.status(400).json({error:'Invalid reporting year.'});
   const from=month+'-01';
   const to=monthPart===12?(yearPart+1)+'-01-01':yearPart+'-'+String(monthPart+1).padStart(2,'0')+'-01';
   try{
    const staff=await pool.query(
     `SELECT display_name AS "displayName",role FROM school_users
       WHERE school_id=$1 AND user_id=$2
       AND role IN ('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER','GATE_KEEPER')`,
     [req.auth.schoolId,staffUserId]);
    if(!staff.rowCount)return res.status(404).json({error:'Staff member not found in this school.'});
    const events=await pool.query(
     `SELECT to_char(school_date,'YYYY-MM-DD') AS "schoolDate",
         dtr_slot AS "slot",
         to_char(occurred_at AT TIME ZONE 'Asia/Manila','HH24:MI') AS "localTime",
         source,verification_method AS "verificationMethod"
       FROM staff_attendance_events
       WHERE school_id=$1 AND staff_user_id=$2
       AND event_kind='DTR_SLOT' AND verification_status='VERIFIED'
       AND school_date >= $3::date AND school_date < $4::date
       ORDER BY school_date ASC,occurred_at ASC`,
       [req.auth.schoolId,staffUserId,from,to]);
    // OB is an authorization, not a clock punch. Attach approved intervals as
    // DTR remarks without filling any missing Form 48 arrival/departure slot.
    const [approvedOb,physicalGate]=await Promise.all([
      pool.query(`SELECT request_id AS "requestId",purpose,destination,starts_at AS "startsAt",ends_at AS "endsAt"
        FROM staff_official_business_requests
        WHERE school_id=$1 AND staff_user_id=$2 AND status='APPROVED'
          AND starts_at < ($4::date::timestamp AT TIME ZONE 'Asia/Manila')
          AND ends_at > ($3::date::timestamp AT TIME ZONE 'Asia/Manila')
        ORDER BY starts_at ASC`,[req.auth.schoolId,staffUserId,from,to]),
      pool.query(`SELECT "schoolDate","eventType","occurredAt" FROM (
        SELECT to_char(school_date,'YYYY-MM-DD') AS "schoolDate",
          CASE WHEN gate_direction='IN' THEN 'TIME_IN' ELSE 'TIME_OUT' END AS "eventType",
          occurred_at AS "occurredAt",event_id
        FROM staff_attendance_events
        WHERE school_id=$1 AND staff_user_id=$2
          AND event_kind='GATE_MOVEMENT' AND verification_status='VERIFIED'
          AND school_date >= $3::date AND school_date < $4::date
        UNION ALL
        SELECT to_char(school_date,'YYYY-MM-DD') AS "schoolDate",
          event_type AS "eventType",occurred_at AS "occurredAt",event_id
        FROM teacher_gate_events
        WHERE school_id=$1 AND teacher_user_id=$2
          AND school_date >= $3::date AND school_date < $4::date
      ) actual_gate ORDER BY "occurredAt" ASC,event_id ASC`,
       [req.auth.schoolId,staffUserId,from,to])
    ]);
    const {buildObDtrRemarks}=require('./ob-dtr-remarks');
    const days=new Date(Date.UTC(yearPart,monthPart,0)).getUTCDate();
    const index=new Map();
    for(const ev of events.rows){const key=ev.schoolDate+':'+ev.slot;if(!index.has(key))index.set(key,ev);}
    // Expose verified physical gate evidence beside the official slots without
    // creating synthetic DTR punches or changing payroll/absence calculations.
    const gateByDate=new Map();
    for(const gate of physicalGate.rows){
      if(!gateByDate.has(gate.schoolDate))gateByDate.set(gate.schoolDate,[]);
      const localTime=new Intl.DateTimeFormat('en-GB',{
        timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
      }).format(new Date(gate.occurredAt));
      gateByDate.get(gate.schoolDate).push({
        direction:gate.eventType==='TIME_IN'?'IN':'OUT',time:localTime
      });
    }
    const records=Array.from({length:days},(_,i)=>{
      const day=i+1, date=month+'-'+String(day).padStart(2,'0');
      const slots=Object.fromEntries(DTR_SLOTS.map(slot=>[slot,index.get(date+':'+slot)?.localTime||null]));
      const obRemarks=buildObDtrRemarks(date,approvedOb.rows,physicalGate.rows);
      return {day,date,slots,verifiedCount:Object.values(slots).filter(Boolean).length,
        gateEvidence:gateByDate.get(date)||[],obRemarks};
    });
    return res.json({month,staffUserId,displayName:staff.rows[0].displayName,role:staff.rows[0].role,
      timezone:'Asia/Manila',records,verifiedEntries:events.rows.length,
      notice:'Verified DTR slots only. Missing or pending times are not inferred. Hours, absences, and undertime require authorized review.'});
   }catch(err){console.error('Form48 monthly report:',err.message);return res.status(503).json({error:'Monthly DTR unavailable.'});}
 });

}
module.exports={registerStaffGateDtrRoutes,DTR_SLOTS};
