'use strict';
const crypto=require('node:crypto');
const QRCode=require('qrcode');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const localDate=()=>{const p=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const x=Object.fromEntries(p.map(v=>[v.type,v.value]));return x.year+'-'+x.month+'-'+x.day;};
const dayOfWeek=d=>new Date(d+'T00:00:00Z').getUTCDay();
const at=(date,time)=>new Date(date+'T'+String(time).slice(0,5)+':00+08:00');
const sign=(secret,id,bucket)=>crypto.createHmac('sha256',secret).update(id+':'+bucket).digest('hex');
const bucket=()=>Math.floor(Date.now()/30000);
async function saveAttendance(pool,s,studentId,method,actor,reason,verificationMethod=null){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const status=Date.now()<=new Date(s.starts_at).getTime()+600000?'PRESENT':'LATE';
  const id=crypto.randomUUID();
  const inserted=await client.query(`INSERT INTO class_qr_checkins
   (session_id,school_id,student_id,attendance_status,method,recorded_by_user_id,reason)
   VALUES($1,$2,$3,$4,$5,$6,$7)
   ON CONFLICT(session_id,student_id) DO NOTHING RETURNING checkin_id,checked_in_at`,
   [s.session_id,s.school_id,studentId,status,method,actor||null,reason||null]);
  if(!inserted.rowCount){await client.query('ROLLBACK');return {duplicate:true};}
  const event=await client.query(`INSERT INTO attendance_events
   (event_id,school_id,device_id,student_id,attendance_scope,period_id,event_type,
    occurred_at_device,school_date,late,sync_status,metadata)
   VALUES($1,$2,$3,$4,'CLASS',$5,'TIME_IN',$6,$7,$8,'ACCEPTED',$9::jsonb)
   ON CONFLICT DO NOTHING RETURNING event_id`,
   [id,s.school_id,'CLASS_QR',studentId,s.period_id,inserted.rows[0].checked_in_at,
    s.school_date,status==='LATE',JSON.stringify({source:'CLASS_QR',sessionId:s.session_id,method,actor:actor||null,verificationMethod:verificationMethod||null})]);
  if(!event.rowCount){await client.query('ROLLBACK');return {duplicate:true};}
  await client.query('COMMIT');
  return {status,checkedInAt:inserted.rows[0].checked_in_at,eventId:id};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
function registerClassQrRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 const staff=requireSchoolRoles('SCHOOL_ADMIN','TEACHER');
 const teacher=requireSchoolRoles('TEACHER');
 const admin=requireSchoolRoles('SCHOOL_ADMIN');
 const checkinAttempts=new Map();
 function checkinLimit(req,res,next){
  const key=String(req.auth?.schoolId||'')+':'+String(req.auth?.studentId||req.ip||'');
  const now=Date.now(),entry=checkinAttempts.get(key);
  if(checkinAttempts.size>10000)for(const [k,v] of checkinAttempts)if(v.until<=now)checkinAttempts.delete(k);
  if(entry&&entry.until>now&&entry.count>=12)return res.status(429).json({error:'Too many check-in attempts. Try again shortly.'});
  checkinAttempts.set(key,{count:entry&&entry.until>now?entry.count+1:1,until:entry&&entry.until>now?entry.until:now+60000});
  next();
 }
 // Keep student portal and passwordless QR identity separate.
 // A live student session AND their existing portal password are required to
 // establish/reset a QR PIN. Student passwords are never used at QR check-in.
 app.post('/api/class-qr/attendance-pin',authenticateSchoolClient,async(req,res)=>{
  if(req.auth?.type!=='STUDENT'||req.auth.mustChangePassword)
   return res.status(403).json({error:'Complete student account setup before creating an attendance PIN.'});
  const {validAttendancePin,hashAttendancePin}=require('./attendance-pin-security');
  const {verifyPassword}=require('./auth-security');
  const pin=req.body?.pin,password=req.body?.currentPassword;
  if(!validAttendancePin(pin))return res.status(400).json({error:'Attendance PIN must contain exactly six digits.'});
  if(typeof password!=='string'||password.length<12||password.length>256)
   return res.status(400).json({error:'Current account password is required.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const account=await client.query(`SELECT password_hash,failed_login_attempts,locked_until
    FROM student_accounts WHERE school_id=$1 AND student_id=$2 AND active=TRUE
    FOR UPDATE`,[req.auth.schoolId,req.auth.studentId]);
   if(!account.rowCount){await client.query('ROLLBACK');return res.sendStatus(403);}
   const row=account.rows[0];
   if(row.locked_until&&new Date(row.locked_until).getTime()>Date.now()){
    await client.query('ROLLBACK');return res.status(429).json({error:'Account temporarily locked. Try again later.'});
   }
   if(!await verifyPassword(password,row.password_hash)){
    await client.query(`UPDATE student_accounts SET failed_login_attempts=LEAST(
      CASE WHEN locked_until IS NOT NULL AND locked_until<=NOW() THEN 0 ELSE failed_login_attempts END+1,5),
      locked_until=CASE WHEN (CASE WHEN locked_until IS NOT NULL AND locked_until<=NOW() THEN 0 ELSE failed_login_attempts END)+1>=5
      THEN NOW()+INTERVAL '15 minutes' ELSE NULL END WHERE school_id=$1 AND student_id=$2`,[req.auth.schoolId,req.auth.studentId]);
    await client.query('COMMIT');
    return res.status(403).json({error:'Unable to verify student account password.'});
   }
   const old=await client.query('SELECT 1 FROM student_attendance_pins WHERE school_id=$1 AND student_id=$2',[req.auth.schoolId,req.auth.studentId]);
   const hash=await hashAttendancePin(pin);
   await client.query(`INSERT INTO student_attendance_pins(school_id,student_id,pin_hash) VALUES($1,$2,$3)
    ON CONFLICT(school_id,student_id) DO UPDATE SET pin_hash=EXCLUDED.pin_hash,
      failed_attempts=0,locked_until=NULL,updated_at=NOW()`,[req.auth.schoolId,req.auth.studentId,hash]);
   await client.query('UPDATE student_accounts SET failed_login_attempts=0,locked_until=NULL WHERE school_id=$1 AND student_id=$2',[req.auth.schoolId,req.auth.studentId]);
   await client.query(`INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
    VALUES($1,'SYSTEM',NULL,$2,'student_attendance_pin',$3,$4::jsonb)`,
    [req.auth.schoolId,old.rowCount?'STUDENT_ATTENDANCE_PIN_RESET':'STUDENT_ATTENDANCE_PIN_ENROLLED',
     req.auth.studentId,JSON.stringify({studentId:req.auth.studentId,verification:'STUDENT_PORTAL_PASSWORD'})]);
   await client.query('COMMIT');
   res.set('Cache-Control','no-store');return res.status(204).end();
  }catch(e){
   await client.query('ROLLBACK').catch(()=>{});
   console.error('Attendance PIN enrollment:',e.message);
   return res.status(500).json({error:'Unable to save attendance PIN.'});
  }finally{client.release();}
 });
 const {registerQrPinCheckin}=require('./class-qr-pin-checkin');
 registerQrPinCheckin(app,pool,{saveAttendance});
 const read=async(schoolId,periodId,date)=>{
  const r=await pool.query(`SELECT p.period_id,p.grade_level,p.section,p.subject_name,p.start_time,p.end_time,
    COALESCE(a.teacher_user_id,cover.substitute_teacher_user_id,regular.teacher_user_id) AS teacher_user_id,
    COALESCE(a.start_time,p.start_time) AS effective_start,
    COALESCE(a.end_time,p.end_time) AS effective_end,
    COALESCE(sub.subject_name,p.subject_name) AS effective_subject,
    a.adjustment_type
   FROM class_periods p
   LEFT JOIN LATERAL (SELECT teacher_user_id FROM teacher_period_assignments t
     WHERE t.school_id=p.school_id AND t.period_id=p.period_id ORDER BY assignment_id LIMIT 1) regular ON TRUE
   LEFT JOIN LATERAL (SELECT substitute_teacher_user_id FROM teacher_period_substitutions t
     WHERE t.school_id=p.school_id AND t.period_id=p.period_id
     AND t.original_teacher_user_id=regular.teacher_user_id AND t.status='ACTIVE'
     AND $3::date BETWEEN t.start_date AND t.end_date ORDER BY created_at DESC LIMIT 1) cover ON TRUE
   LEFT JOIN schedule_day_adjustments a ON a.school_id=p.school_id AND a.period_id=p.period_id AND a.school_date=$3::date
   LEFT JOIN school_subjects sub ON sub.school_id=a.school_id AND sub.subject_id=a.subject_id
   WHERE p.school_id=$1 AND p.period_id=$2 AND p.active=TRUE
     AND (p.effective_from IS NULL OR p.effective_from<=$3::date)
     AND (p.effective_to IS NULL OR p.effective_to>=$3::date)
     AND EXISTS(SELECT 1 FROM class_period_days d WHERE d.school_id=p.school_id
       AND d.period_id=p.period_id AND d.weekday=$4)
     AND NOT EXISTS(SELECT 1 FROM school_calendar_exceptions ce WHERE ce.school_id=p.school_id AND ce.calendar_date=$3::date AND ce.exception_type='CLOSED')`,[schoolId,periodId,date,dayOfWeek(date)]);
  return r.rows[0];
 };
 app.post('/api/class-qr/sessions',authenticateSchoolClient,teacher,async(req,res)=>{
  const {periodId}=req.body||{},date=localDate();
  if(!uuid.test(String(periodId||'')))return res.status(400).json({error:'Valid class period required.'});
  try{
   const p=await read(req.auth.schoolId,periodId,date);
   if(!p||p.adjustment_type==='CANCEL'||!p.teacher_user_id||!p.section||!p.effective_subject)return res.status(404).json({error:'No active class on this date.'});
   if(String(p.teacher_user_id)!==String(req.auth.userId))
    return res.status(403).json({error:'Only the assigned teacher may start this session.'});
   const start=at(date,p.effective_start),end=at(date,p.effective_end),close=new Date(end.getTime()-300000);
   if(!(end>start)||close<=start||Date.now()<start.getTime()||Date.now()>=close.getTime())
    return res.status(409).json({error:'QR attendance is available only during the scheduled class, ending five minutes early.'});
   const r=await pool.query(`INSERT INTO class_qr_sessions
     (school_id,period_id,school_date,teacher_user_id,grade_level,section,subject_name,starts_at,ends_at,closes_at,secret)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT(school_id,period_id,school_date) DO NOTHING RETURNING session_id`,
     [req.auth.schoolId,periodId,date,p.teacher_user_id,p.grade_level,p.section,p.effective_subject,start,end,close,crypto.randomBytes(32).toString('hex')]);
   const found=r.rows[0]|| (await pool.query('SELECT session_id FROM class_qr_sessions WHERE school_id=$1 AND period_id=$2 AND school_date=$3',[req.auth.schoolId,periodId,date])).rows[0];
   const current=await pool.query('SELECT closed_at,closes_at,teacher_user_id FROM class_qr_sessions WHERE session_id=$1 AND school_id=$2',[found.session_id,req.auth.schoolId]);
   if(String(current.rows[0]?.teacher_user_id)!==String(req.auth.userId))return res.sendStatus(403);
   if(Date.now()>=new Date(current.rows[0]?.closes_at).getTime())return res.status(410).json({error:'The scheduled QR attendance window has ended.'});
   if(current.rows[0]?.closed_at){
    if(req.body?.reopen!==true)return res.status(410).json({error:'This class QR session was already closed.',canReopen:true});
    // Reuse the same session ID to preserve check-ins and rotate the signing
    // secret so QR codes issued before closure cannot be used after reopening.
    const reopened=await pool.query(`UPDATE class_qr_sessions
      SET closed_at=NULL,secret=$3
      WHERE session_id=$1 AND school_id=$2 AND closed_at IS NOT NULL
        AND closes_at>NOW() RETURNING session_id,closes_at`,
      [found.session_id,req.auth.schoolId,crypto.randomBytes(32).toString('hex')]);
    if(reopened.rowCount)return res.json({sessionId:found.session_id,closesAt:reopened.rows[0].closes_at,onTimeGraceMinutes:10,rotationSeconds:30,reopened:true});
    const latest=await pool.query('SELECT closed_at FROM class_qr_sessions WHERE session_id=$1 AND school_id=$2',[found.session_id,req.auth.schoolId]);
    if(latest.rows[0]?.closed_at)return res.status(410).json({error:'The session could not be reopened within its scheduled window.'});
   }
   res.json({sessionId:found.session_id,closesAt:current.rows[0].closes_at,onTimeGraceMinutes:10,rotationSeconds:30});
  }catch(e){console.error('QR session:',e.message);res.status(500).json({error:'Unable to start QR attendance.'});}
 });
 app.get('/api/class-qr/sessions/:id/qr',authenticateSchoolClient,teacher,async(req,res)=>{
  try{
   const r=await pool.query('SELECT * FROM class_qr_sessions WHERE school_id=$1 AND session_id=$2',[req.auth.schoolId,req.params.id]),s=r.rows[0];
   if(!s)return res.status(404).json({error:'Session not found.'});
   if(String(s.teacher_user_id)!==String(req.auth.userId))return res.sendStatus(403);
   if(s.closed_at||Date.now()<new Date(s.starts_at).getTime()||Date.now()>=new Date(s.closes_at).getTime())return res.status(410).json({error:'QR attendance closed.'});
   const b=bucket();
   const token=sign(s.secret,s.session_id,b);
   // QR links must share the canonical student-login origin for persistent cookies.
   const configured=process.env.PUBLIC_BASE_URL||'';
   const origin=(process.env.NODE_ENV==='production' && (!configured || /student-attendance-tracker-jmp4\\.onrender\\.com/.test(configured)))
     ? 'https://attendigo.tech' : (configured || 'http://localhost:3000');
   const url=new URL('/class-qr-checkin.html',origin);
   url.searchParams.set('sessionId',String(s.session_id));url.searchParams.set('token',token);
   const qrImage=await QRCode.toDataURL(url.toString(),{margin:2,width:320});
   res.set('Cache-Control','no-store, private');
   res.json({sessionId:s.session_id,token,qrImage,validUntil:new Date((b+1)*30000).toISOString(),closesAt:s.closes_at});
  }catch(e){console.error('QR read:',e.message);res.sendStatus(500);}
 });
 app.get('/api/class-qr/check-in/status',authenticateSchoolClient,async(req,res)=>{
  if(req.auth?.type!=='STUDENT')return res.status(403).json({error:'Student authentication required.'});
  const sessionId=String(req.query.sessionId||'');
  if(!uuid.test(sessionId))return res.status(400).json({error:'Invalid class QR session.'});
  try{
   const session=await pool.query('SELECT session_id,school_date,subject_name,section FROM class_qr_sessions WHERE school_id=$1 AND session_id=$2',[req.auth.schoolId,sessionId]);
   if(!session.rowCount)return res.status(404).json({error:'Class QR session not found.'});
   const existing=await pool.query('SELECT attendance_status,checked_in_at FROM class_qr_checkins WHERE school_id=$1 AND session_id=$2 AND student_id=$3 LIMIT 1',[req.auth.schoolId,sessionId,req.auth.studentId]);
   res.set('Cache-Control','no-store');
   return res.json({recorded:!!existing.rowCount,status:existing.rows[0]?.attendance_status||null,checkedInAt:existing.rows[0]?.checked_in_at||null,class:session.rows[0]});
  }catch(e){console.error('QR status:',e.message);res.status(500).json({error:'Could not verify attendance status.'});}
 });
 app.post('/api/class-qr/check-in',authenticateSchoolClient,checkinLimit,async(req,res)=>{
  if(req.auth?.type!=='STUDENT'||req.auth.mustChangePassword)return res.status(403).json({error:'Student login and password update required.'});
  const {sessionId,token}=req.body||{};
  if(!uuid.test(String(sessionId||''))||!(/^[a-f0-9]{64}$/i).test(String(token||'')))return res.status(400).json({error:'Invalid QR.'});
  try{
   const r=await pool.query('SELECT * FROM class_qr_sessions WHERE school_id=$1 AND session_id=$2',[req.auth.schoolId,sessionId]),s=r.rows[0];
   if(!s||s.closed_at||Date.now()>=new Date(s.closes_at).getTime()||Date.now()<new Date(s.starts_at).getTime())
    return res.status(410).json({error:'QR attendance is closed.'});
   const already=await pool.query('SELECT attendance_status,checked_in_at FROM class_qr_checkins WHERE school_id=$1 AND session_id=$2 AND student_id=$3 LIMIT 1',[req.auth.schoolId,sessionId,req.auth.studentId]);
   if(already.rowCount)return res.status(409).json({error:'Attendance already recorded for this class.',alreadyRecorded:true,status:already.rows[0].attendance_status,checkedInAt:already.rows[0].checked_in_at});
   const b=bucket(),matches=[b,b-1].some(n=>crypto.timingSafeEqual(Buffer.from(sign(s.secret,s.session_id,n),'hex'),Buffer.from(token,'hex')));
   if(!matches)return res.status(410).json({error:'QR expired. Scan the latest code.'});
   const eligible=await pool.query(`SELECT 1 FROM students st
    WHERE st.school_id=$1 AND st.student_id=$2 AND st.active=TRUE
    AND EXISTS(SELECT 1 FROM student_enrollments e JOIN school_years sy
      ON sy.school_id=e.school_id AND sy.school_year_id=e.school_year_id
      WHERE e.school_id=st.school_id AND e.student_id=st.student_id
      AND e.grade_level=$3 AND lower(e.section)=lower($4)
      AND e.enrollment_status='ENROLLED' AND sy.status='ACTIVE')`,
      [req.auth.schoolId,req.auth.studentId,s.grade_level,s.section]);
   if(!eligible.rowCount)return res.status(403).json({error:'Student is not enrolled in this class.'});
   const result=await saveAttendance(pool,s,req.auth.studentId,'QR',null,null);
   if(result.duplicate)return res.status(409).json({error:'Attendance already recorded for this class.',alreadyRecorded:true});
   res.status(201).json({ok:true,status:result.status,checkedInAt:result.checkedInAt});
  }catch(e){console.error('QR check-in:',e.message);res.status(500).json({error:'Unable to record attendance. Please retry.'});}
 });

 app.get('/api/class-qr/today',authenticateSchoolClient,staff,async(req,res)=>{
  const today=localDate();
  const date=typeof req.query.date==='string'?req.query.date:today;
  const max=new Date(today+'T00:00:00Z');max.setUTCDate(max.getUTCDate()+7);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<today||date>max.toISOString().slice(0,10))return res.status(400).json({error:'Choose a date within the next seven days.'});
  try{
   const result=await pool.query(`SELECT p.period_id,p.grade_level,p.section,
    COALESCE(sub.subject_name,p.subject_name) AS subject_name,
    COALESCE(a.start_time,p.start_time) AS start_time,
    COALESCE(a.end_time,p.end_time) AS end_time,
    COALESCE(a.teacher_user_id,cover.substitute_teacher_user_id,regular.teacher_user_id) AS teacher_user_id
    FROM class_periods p
    LEFT JOIN LATERAL(SELECT teacher_user_id FROM teacher_period_assignments t
      WHERE t.school_id=p.school_id AND t.period_id=p.period_id ORDER BY assignment_id LIMIT 1) regular ON TRUE
    LEFT JOIN LATERAL(SELECT substitute_teacher_user_id FROM teacher_period_substitutions t
      WHERE t.school_id=p.school_id AND t.period_id=p.period_id AND t.original_teacher_user_id=regular.teacher_user_id
      AND t.status='ACTIVE' AND $2::date BETWEEN t.start_date AND t.end_date
      ORDER BY created_at DESC LIMIT 1) cover ON TRUE
    LEFT JOIN schedule_day_adjustments a ON a.school_id=p.school_id AND a.period_id=p.period_id AND a.school_date=$2::date
    LEFT JOIN school_subjects sub ON sub.school_id=a.school_id AND sub.subject_id=a.subject_id
    WHERE p.school_id=$1 AND p.active=TRUE AND COALESCE(a.adjustment_type,'')<>'CANCEL'
      AND (p.effective_from IS NULL OR p.effective_from<=$2::date)
      AND (p.effective_to IS NULL OR p.effective_to>=$2::date)
      AND EXISTS(SELECT 1 FROM class_period_days d WHERE d.school_id=p.school_id
        AND d.period_id=p.period_id AND d.weekday=$3)
      AND NOT EXISTS(SELECT 1 FROM school_calendar_exceptions ce WHERE ce.school_id=p.school_id AND ce.calendar_date=$2::date AND ce.exception_type='CLOSED')
      AND ($4='SCHOOL_ADMIN' OR COALESCE(a.teacher_user_id,cover.substitute_teacher_user_id,regular.teacher_user_id)=$5)
    ORDER BY start_time`,[req.auth.schoolId,date,dayOfWeek(date),req.auth.role,req.auth.userId]);
   res.json({date,today,classes:result.rows.map(p=>({periodId:p.period_id,gradeLevel:p.grade_level,section:p.section,subjectName:p.subject_name,startTime:String(p.start_time).slice(0,5),endTime:String(p.end_time).slice(0,5)}))});
  }catch(e){console.error('QR today:',e.message);res.status(500).json({error:'Could not load classes.'});}
 });

 // School-wide oversight is read-only; this endpoint never exposes QR tokens or secrets.
 app.get('/api/class-qr/monitor',authenticateSchoolClient,admin,async(req,res)=>{
  try{
   const date=localDate();
   const result=await pool.query(`SELECT s.session_id,s.period_id,s.grade_level,s.section,
     s.subject_name,s.starts_at,s.closes_at,s.closed_at,
     COUNT(c.checkin_id)::int AS checked_in_count,
     COUNT(c.checkin_id) FILTER (WHERE c.attendance_status='PRESENT')::int AS present_count,
     COUNT(c.checkin_id) FILTER (WHERE c.attendance_status='LATE')::int AS late_count
    FROM class_qr_sessions s
    LEFT JOIN class_qr_checkins c ON c.school_id=s.school_id AND c.session_id=s.session_id
    WHERE s.school_id=$1 AND s.school_date=$2::date
    GROUP BY s.session_id
    ORDER BY s.starts_at,s.section`,[req.auth.schoolId,date]);
   res.set('Cache-Control','no-store, private');
   res.json({date,sessions:result.rows.map(s=>({
    sessionId:s.session_id,periodId:s.period_id,gradeLevel:s.grade_level,
    section:s.section,subjectName:s.subject_name,startsAt:s.starts_at,
    closesAt:s.closes_at,closedAt:s.closed_at,
    checkedIn:Number(s.checked_in_count)||0,present:Number(s.present_count)||0,
    late:Number(s.late_count)||0
   }))});
  }catch(e){console.error('Class QR monitoring:',e.message);res.status(500).json({error:'Unable to load class QR monitoring.'});}
 });

 // A separately authorized, reason-required administrator emergency action.
 // This does not issue QR codes, create sessions, or modify checked-in students.
 app.post('/api/class-qr/admin-override/sessions/:id/close',authenticateSchoolClient,admin,async(req,res)=>{
  const sessionId=String(req.params.id||'');
  const reason=typeof req.body?.reason==='string'?req.body.reason.trim():'';
  if(!uuid.test(sessionId))return res.status(400).json({error:'Valid session required.'});
  if(reason.length<12||reason.length>500)return res.status(400).json({error:'Provide an emergency reason of 12–500 characters.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const found=await client.query(`SELECT session_id,period_id,teacher_user_id,school_date,closed_at
     FROM class_qr_sessions WHERE school_id=$1 AND session_id=$2 FOR UPDATE`,[req.auth.schoolId,sessionId]);
   if(!found.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Session not found.'});}
   const record=found.rows[0];
   if(record.closed_at){await client.query('ROLLBACK');return res.status(409).json({error:'Session already closed.'});}
   await client.query(`UPDATE class_qr_sessions SET closed_at=NOW()
     WHERE school_id=$1 AND session_id=$2`,[req.auth.schoolId,sessionId]);
   await client.query(`INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
     VALUES($1,'SCHOOL',$2,'CLASS_QR_ADMIN_EMERGENCY_CLOSE','class_qr_session',$3,$4::jsonb)`,
     [req.auth.schoolId,req.auth.userId,sessionId,JSON.stringify({
      reason,periodId:record.period_id,teacherUserId:record.teacher_user_id,
      schoolDate:record.school_date
     })]);
   await client.query('COMMIT');
   res.set('Cache-Control','no-store');
   res.json({ok:true});
  }catch(e){
   await client.query('ROLLBACK').catch(()=>{});
   console.error('Class QR emergency override:',e.message);
   res.status(500).json({error:'Could not close session. No change was saved.'});
  }finally{client.release();}
 });

 app.post('/api/class-qr/sessions/:id/manual',authenticateSchoolClient,teacher,async(req,res)=>{
  const studentId=String(req.body?.studentId||'').trim(),reason=String(req.body?.reason||'').trim();
  if(!studentId||studentId.length>160||reason.length<8||reason.length>500)
   return res.status(400).json({error:'Student ID and a reason of 8–500 characters are required.'});
  try{
   const s=(await pool.query('SELECT * FROM class_qr_sessions WHERE school_id=$1 AND session_id=$2',[req.auth.schoolId,req.params.id])).rows[0];
   if(!s)return res.sendStatus(404);
   if(s.closed_at||Date.now()<new Date(s.starts_at).getTime()||Date.now()>=new Date(s.closes_at).getTime())return res.status(410).json({error:'Class attendance session is closed.'});
   if(req.auth.role!=='SCHOOL_ADMIN'&&String(s.teacher_user_id)!==String(req.auth.userId))return res.sendStatus(403);
   const e=await pool.query(`SELECT 1 FROM students st WHERE st.school_id=$1 AND st.student_id=$2 AND st.active=TRUE
     AND EXISTS(SELECT 1 FROM student_enrollments en JOIN school_years sy ON sy.school_id=en.school_id
       AND sy.school_year_id=en.school_year_id WHERE en.school_id=st.school_id AND en.student_id=st.student_id
       AND en.grade_level=$3 AND lower(en.section)=lower($4)
       AND en.enrollment_status='ENROLLED' AND sy.status='ACTIVE')`,
    [req.auth.schoolId,studentId,s.grade_level,s.section]);
   if(!e.rowCount)return res.status(403).json({error:'Student is not enrolled in this class.'});
   const result=await saveAttendance(pool,s,studentId,'MANUAL',req.auth.userId,reason);
   if(result.duplicate)return res.status(409).json({error:'Attendance already recorded.'});
   res.status(201).json({ok:true,status:result.status});
  }catch(e){console.error('Manual QR attendance:',e.message);res.status(500).json({error:'Manual attendance failed.'});}
 });
 app.post('/api/class-qr/sessions/:id/close',authenticateSchoolClient,teacher,async(req,res)=>{
  try{
   const r=await pool.query(`UPDATE class_qr_sessions SET closed_at=NOW()
    WHERE school_id=$1 AND session_id=$2 AND closed_at IS NULL
    AND teacher_user_id=$3 RETURNING session_id`,
    [req.auth.schoolId,req.params.id,req.auth.userId]);
   if(!r.rowCount)return res.status(404).json({error:'Session unavailable or already closed.'});
   res.json({ok:true});
  }catch(e){res.status(500).json({error:'Unable to close session.'});}
 });
}
module.exports={registerClassQrRoutes,localDate,dayOfWeek,at,sign};
