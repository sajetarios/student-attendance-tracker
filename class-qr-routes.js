'use strict';
const crypto=require('node:crypto');
const QRCode=require('qrcode');
const uuid=/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const localDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const dayOfWeek=d=>new Date(d+'T00:00:00Z').getUTCDay();
const at=(date,time)=>new Date(date+'T'+String(time).slice(0,5)+':00+08:00');
const sign=(secret,id,bucket)=>crypto.createHmac('sha256',secret).update(id+':'+bucket).digest('hex');
const bucket=()=>Math.floor(Date.now()/30000);
function registerClassQrRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 const staff=requireSchoolRoles('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER');
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
       AND d.period_id=p.period_id AND d.weekday=$4)`,[schoolId,periodId,date,dayOfWeek(date)]);
  return r.rows[0];
 };
 app.post('/api/class-qr/sessions',authenticateSchoolClient,staff,async(req,res)=>{
  const {periodId}=req.body||{},date=localDate();
  if(!uuid.test(String(periodId||'')))return res.status(400).json({error:'Valid class period required.'});
  try{
   const p=await read(req.auth.schoolId,periodId,date);
   if(!p||p.adjustment_type==='CANCEL')return res.status(404).json({error:'No active class on this date.'});
   if(req.auth.role!=='SCHOOL_ADMIN'&&String(p.teacher_user_id)!==String(req.auth.userId))
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
   res.json({sessionId:found.session_id,closesAt:close.toISOString(),onTimeGraceMinutes:10,rotationSeconds:30});
  }catch(e){console.error('QR session:',e.message);res.status(500).json({error:'Unable to start QR attendance.'});}
 });
 app.get('/api/class-qr/sessions/:id/qr',authenticateSchoolClient,staff,async(req,res)=>{
  try{
   const r=await pool.query('SELECT * FROM class_qr_sessions WHERE school_id=$1 AND session_id=$2',[req.auth.schoolId,req.params.id]),s=r.rows[0];
   if(!s)return res.status(404).json({error:'Session not found.'});
   if(req.auth.role!=='SCHOOL_ADMIN'&&String(s.teacher_user_id)!==String(req.auth.userId))return res.sendStatus(403);
   if(s.closed_at||Date.now()>=new Date(s.closes_at).getTime())return res.status(410).json({error:'QR attendance closed.'});
   const b=bucket();
   const token=sign(s.secret,s.session_id,b);
   const url=new URL('/class-qr-checkin.html',req.protocol+'://'+req.get('host'));
   url.searchParams.set('sessionId',String(s.session_id));url.searchParams.set('token',token);
   const qrImage=await QRCode.toDataURL(url.toString(),{margin:2,width:320});
   res.json({sessionId:s.session_id,token,qrImage,validUntil:new Date((b+1)*30000).toISOString(),closesAt:s.closes_at});
  }catch(e){console.error('QR read:',e.message);res.sendStatus(500);}
 });
 app.post('/api/class-qr/check-in',authenticateSchoolClient,async(req,res)=>{
  if(req.auth?.type!=='STUDENT'||req.auth.mustChangePassword)return res.status(403).json({error:'Student login and password update required.'});
  const {sessionId,token}=req.body||{};
  if(!uuid.test(String(sessionId||''))||!(/^[a-f0-9]{64}$/i).test(String(token||'')))return res.status(400).json({error:'Invalid QR.'});
  try{
   const r=await pool.query('SELECT * FROM class_qr_sessions WHERE school_id=$1 AND session_id=$2',[req.auth.schoolId,sessionId]),s=r.rows[0];
   if(!s||s.closed_at||Date.now()>=new Date(s.closes_at).getTime()||Date.now()<new Date(s.starts_at).getTime())
    return res.status(410).json({error:'QR attendance is closed.'});
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
   const result=await pool.query(`INSERT INTO class_qr_checkins(session_id,school_id,student_id,attendance_status)
    VALUES($1,$2,$3,CASE WHEN NOW()<=$4::timestamptz+INTERVAL '10 minutes' THEN 'PRESENT' ELSE 'LATE' END)
    ON CONFLICT(session_id,student_id) DO NOTHING RETURNING attendance_status,checked_in_at`,
    [sessionId,req.auth.schoolId,req.auth.studentId,s.starts_at]);
   if(!result.rowCount)return res.status(409).json({error:'Attendance already recorded for this class.'});
   res.status(201).json({ok:true,status:result.rows[0].attendance_status,checkedInAt:result.rows[0].checked_in_at});
  }catch(e){console.error('QR check-in:',e.message);res.status(500).json({error:'Unable to record attendance. Please retry.'});}
 });
 app.post('/api/class-qr/sessions/:id/close',authenticateSchoolClient,staff,async(req,res)=>{
  try{
   const r=await pool.query(`UPDATE class_qr_sessions SET closed_at=NOW()
    WHERE school_id=$1 AND session_id=$2 AND closed_at IS NULL
    AND ($3='SCHOOL_ADMIN' OR teacher_user_id=$4) RETURNING session_id`,
    [req.auth.schoolId,req.params.id,req.auth.role,req.auth.userId]);
   if(!r.rowCount)return res.status(404).json({error:'Session unavailable or already closed.'});
   res.json({ok:true});
  }catch(e){res.status(500).json({error:'Unable to close session.'});}
 });
}
module.exports={registerClassQrRoutes};
