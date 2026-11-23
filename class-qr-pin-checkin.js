'use strict';
const crypto=require('node:crypto');
const {validAttendancePin,hashAttendancePin,verifyAttendancePin}=require('./attendance-pin-security');

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QR_TOKEN=/^[a-f0-9]{64}$/i;
const MAX_PER_NETWORK_AND_SESSION=120;
const genericError='Unable to confirm attendance. Check your Student ID and private PIN.';

function validQrInput(body){
 return !!body&&UUID.test(String(body.sessionId||''))&&QR_TOKEN.test(String(body.token||''))
  &&typeof body.studentId==='string'&&body.studentId.trim().length>0
  &&body.studentId.trim().length<=160&&validAttendancePin(body.pin);
}
function currentQrTokenMatches(secret,sessionId,token,now=Date.now()){
 if(typeof secret!=='string'||typeof token!=='string'||!QR_TOKEN.test(token))return false;
 const b=Math.floor(now/30000);
 const supplied=Buffer.from(token,'hex');
 return [b,b-1].some(n=>{
  const expected=crypto.createHmac('sha256',secret).update(sessionId+':'+n).digest();
  return crypto.timingSafeEqual(supplied,expected);
 });
}

function registerQrPinCheckin(app,pool,{saveAttendance}){
 // Constant-cost dummy PIN verification prevents unauthenticated ID probing
 // from cheaply detecting whether the student has configured a credential.
 const dummyHash=hashAttendancePin('743801');
 const isEnabled=()=>process.env.ENABLE_CLASS_QR_PIN_CHECKIN==='true';
 app.get('/api/class-qr/check-in/mode',(_req,res)=>{
  res.set('Cache-Control','no-store');
  return res.json({pinEnabled:isEnabled()});
 });
 app.post('/api/class-qr/check-in/pin',async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(!isEnabled())return res.status(404).json({error:'This attendance method is not enabled.'});
  if(!validQrInput(req.body))return res.status(400).json({error:'Valid QR, Student ID, and six-digit PIN are required.'});
  const {sessionId,token,pin}=req.body,studentId=req.body.studentId.trim();
  try{
   const found=await pool.query('SELECT * FROM class_qr_sessions WHERE session_id=$1',[sessionId]);
   const s=found.rows[0];
   if(!s||s.closed_at||Date.now()<new Date(s.starts_at).getTime()||Date.now()>=new Date(s.closes_at).getTime())
    return res.status(410).json({error:'Class QR attendance is closed. Scan the current teacher code.'});
   if(!currentQrTokenMatches(s.secret,s.session_id,token))
    return res.status(410).json({error:'The QR code expired. Scan the latest teacher code.'});
   // Persist a keyed limit across process restarts. A school network may share
   // one IP, so also enforce tighter individual PIN lockouts below.
   const networkKey=crypto.createHash('sha256').update(String(req.ip||req.socket?.remoteAddress||'unknown')+':'+s.session_id).digest('hex');
   const rate=await pool.query(`INSERT INTO class_qr_pin_ip_limits(ip_hash,attempt_count,window_expires_at)
    VALUES($1,1,NOW()+INTERVAL '5 minutes')
    ON CONFLICT(ip_hash) DO UPDATE
      SET attempt_count=CASE WHEN class_qr_pin_ip_limits.window_expires_at<=NOW() THEN 1 ELSE class_qr_pin_ip_limits.attempt_count+1 END,
          window_expires_at=CASE WHEN class_qr_pin_ip_limits.window_expires_at<=NOW() THEN NOW()+INTERVAL '5 minutes' ELSE class_qr_pin_ip_limits.window_expires_at END,
          updated_at=NOW()
    RETURNING attempt_count`,[networkKey]);
   if(rate.rows[0]?.attempt_count>MAX_PER_NETWORK_AND_SESSION)
    return res.status(429).json({error:'Too many check-in requests from this network. Ask the teacher for assistance.'});
   const db=await pool.connect();
   let verified=false;
   try{
    await db.query('BEGIN');
    const credential=await db.query(`SELECT sap.pin_hash,sap.failed_attempts,sap.locked_until
      FROM student_attendance_pins sap
      JOIN students st ON st.school_id=sap.school_id AND st.student_id=sap.student_id
        AND st.active=TRUE AND st.archived_at IS NULL
      JOIN student_accounts sa ON sa.school_id=st.school_id AND sa.student_id=st.student_id
        AND sa.active=TRUE AND sa.must_change_password=FALSE
      JOIN schools school ON school.school_id=st.school_id AND school.active=TRUE
      WHERE sap.school_id=$1 AND sap.student_id=$2 FOR UPDATE OF sap`,
      [s.school_id,studentId]);
    const row=credential.rows[0];
    if(!row){
     await verifyAttendancePin(pin,await dummyHash);
    }else if(!row.locked_until||new Date(row.locked_until).getTime()<=Date.now()){
     const correct=await verifyAttendancePin(pin,row.pin_hash);
     if(correct){
      const eligible=await db.query(`SELECT 1 FROM student_enrollments en
       JOIN school_years sy ON sy.school_id=en.school_id AND sy.school_year_id=en.school_year_id
       WHERE en.school_id=$1 AND en.student_id=$2 AND en.enrollment_status='ENROLLED'
         AND sy.status='ACTIVE' AND en.grade_level=$3 AND LOWER(en.section)=LOWER($4) LIMIT 1`,
       [s.school_id,studentId,s.grade_level,s.section]);
      verified=eligible.rowCount>0;
      if(verified)await db.query('UPDATE student_attendance_pins SET failed_attempts=0,locked_until=NULL,updated_at=NOW() WHERE school_id=$1 AND student_id=$2',[s.school_id,studentId]);
     }else{
      await db.query(`UPDATE student_attendance_pins SET
        failed_attempts=CASE WHEN locked_until IS NOT NULL AND locked_until<=NOW() THEN 1 ELSE LEAST(failed_attempts+1,5) END,
        locked_until=CASE WHEN locked_until IS NOT NULL AND locked_until<=NOW() THEN NULL
          WHEN failed_attempts+1>=5 THEN NOW()+INTERVAL '15 minutes' ELSE locked_until END,
        updated_at=NOW()
        WHERE school_id=$1 AND student_id=$2`,[s.school_id,studentId]);
     }
    }
    await db.query('COMMIT');
   }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
   finally{db.release();}
   if(!verified)return res.status(403).json({error:genericError});
   const result=await saveAttendance(pool,s,studentId,'QR',null,null,'STUDENT_PIN');
   if(result.suspended)return res.status(410).json({error:'Classes are suspended. QR check-in is closed; earlier records are preserved.'});
   if(result.duplicate)return res.status(409).json({error:'Attendance has already been recorded for this class.',alreadyRecorded:true});
   return res.status(201).json({ok:true,status:result.status,checkedInAt:result.checkedInAt});
  }catch(e){
   console.error('Passwordless classroom QR check-in:',e.message);
   return res.status(500).json({error:'Unable to record attendance. Ask your teacher for assistance.'});
  }
 });
}
module.exports={registerQrPinCheckin,validQrInput,currentQrTokenMatches};
