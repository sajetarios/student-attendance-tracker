'use strict';
const {createHash}=require('node:crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN=/^(JHS|TCH):([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const digest=value=>createHash('sha256').update(value.toLowerCase()).digest('hex');
const validStamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&
  Math.abs(Date.now()-Date.parse(value))<31*86400000;
function registerGateOfflineRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 const gate=requireSchoolRoles('GATE_KEEPER'),admin=requireSchoolRoles('SCHOOL_ADMIN');
 app.get('/api/gate/offline/prepare',authenticateSchoolClient,gate,(req,res)=>{
  res.set('Cache-Control','no-store, private');
  if(req.auth.type!=='SCHOOL_USER')return res.status(403).json({error:'Gatekeeper school account required.'});
  return res.json({schoolId:req.auth.schoolId,userId:req.auth.userId,role:'GATE_KEEPER',
    validUntil:new Date(Date.now()+12*3600000).toISOString(),
    notice:'Offline observations are NOT official attendance. Reconnect for school-scoped review.'});
 });
 app.post('/api/gate/offline/reconcile',authenticateSchoolClient,gate,async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  if(req.auth.type!=='SCHOOL_USER')return res.status(403).json({error:'Gatekeeper school account required.'});
  const items=req.body?.events;
  if(!Array.isArray(items)||items.length<1||items.length>50)
   return res.status(400).json({error:'Choose 1–50 offline observations per sync.'});
  const validated=items.map(item=>{
   const qr=String(item?.qr||'').trim(),match=TOKEN.exec(qr);
   if(!UUID.test(String(item?.eventId||''))||!match||!validStamp(item?.capturedAtDevice))
    return null;
   return {eventId:item.eventId,kind:match[1].toUpperCase()==='JHS'?'STUDENT':'STAFF',
     token:match[2],hash:digest(qr),timestamp:new Date(item.capturedAtDevice).toISOString()};
  });
  if(validated.some(x=>!x)||new Set(validated.map(x=>x.eventId)).size!==validated.length)
   return res.status(400).json({error:'One or more offline observations are invalid or repeated. No records saved.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const results=[];
   for(const item of validated){
    const existing=await client.query(
     'SELECT school_id,gatekeeper_user_id,subject_kind,badge_sha256,captured_at_device FROM offline_gate_observations WHERE event_id=$1',
     [item.eventId]);
    if(existing.rowCount){
     const e=existing.rows[0];
     if(String(e.school_id)!==String(req.auth.schoolId)||String(e.gatekeeper_user_id)!==String(req.auth.userId)||
       e.subject_kind!==item.kind||e.badge_sha256!==item.hash||
       new Date(e.captured_at_device).getTime()!==Date.parse(item.timestamp)){
      await client.query('ROLLBACK');
      return res.status(409).json({error:'An offline event ID was reused or belongs to another school/account. Keep the device copy for review.'});
     }
     results.push({eventId:item.eventId,status:'ALREADY_RECEIVED',officialAttendance:false});
     continue;
    }
    const found=item.kind==='STUDENT'
      ?await client.query('SELECT s.student_id AS id, '+
        '(s.photo_path IS NOT NULL OR EXISTS(SELECT 1 FROM official_profile_photos p '+
        "WHERE p.school_id=s.school_id AND p.subject_kind='STUDENT' AND p.subject_id=s.student_id)) AS has_photo "+
        'FROM students s WHERE s.school_id=$1 AND s.qr_token=$2 AND s.active=TRUE LIMIT 1',
        [req.auth.schoolId,item.token])
      :await client.query('SELECT su.user_id::text AS id, '+
        '(su.teacher_photo_path IS NOT NULL OR EXISTS(SELECT 1 FROM official_profile_photos p '+
        "WHERE p.school_id=su.school_id AND p.subject_kind='STAFF' AND p.subject_id=su.user_id::text)) AS has_photo "+
        "FROM school_users su WHERE su.school_id=$1 AND su.teacher_qr_token=$2 AND "+
        "su.role IN ('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN') AND su.active=TRUE LIMIT 1",
        [req.auth.schoolId,item.token]);
    const subject=found.rows[0],status=subject?'REVIEW_REQUIRED':'INVALID_BADGE';
    const reason=!subject?'Badge was not active or recognized at synchronization.'
      :!subject.has_photo?'Registered photo unavailable; identity cannot be verified.'
      :'Captured offline. Device timestamp and photo match require authorized review.';
    await client.query('INSERT INTO offline_gate_observations('+
      'event_id,school_id,gatekeeper_user_id,subject_kind,subject_reference,badge_sha256,'+
      'captured_at_device,status,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [item.eventId,req.auth.schoolId,req.auth.userId,item.kind,subject?.id||null,
       item.hash,item.timestamp,status,reason]);
    await client.query("INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details) "+
      "VALUES($1,'SCHOOL',$2,'GATE_OFFLINE_OBSERVATION_RECEIVED','offline_gate_observation',$3,$4::jsonb)",
      [req.auth.schoolId,req.auth.userId,item.eventId,JSON.stringify({kind:item.kind,status,officialAttendance:false})]);
    results.push({eventId:item.eventId,status,officialAttendance:false});
   }
   await client.query('COMMIT');
   return res.json({results,officialAttendance:false,notice:'Synced for review only. No gate or DTR attendance recorded.'});
  }catch(error){
   await client.query('ROLLBACK').catch(()=>{});
   console.error('Gate offline reconciliation:',error.code||error.message);
   return res.status(503).json({error:'Could not save offline observations for review. Device copies were not acknowledged.'});
  }finally{client.release();}
 });
 app.get('/api/gate/offline/review',authenticateSchoolClient,admin,async(req,res)=>{
  res.set('Cache-Control','no-store, private');
  try{
   const result=await pool.query('SELECT o.event_id AS "eventId",o.subject_kind AS "subjectKind",'+
       'o.subject_reference AS "subjectReference",o.captured_at_device AS "deviceTime",'+
       'o.received_at_server AS "serverReceivedAt",o.status,o.reason,'+
       'keeper.display_name AS "gatekeeper",o.review_note AS "reviewNote" '+
     'FROM offline_gate_observations o '+
     'JOIN school_users keeper ON keeper.school_id=o.school_id AND keeper.user_id=o.gatekeeper_user_id '+
     "WHERE o.school_id=$1 ORDER BY (o.status IN ('REVIEW_REQUIRED','INVALID_BADGE')) DESC,"+
     'o.received_at_server DESC LIMIT 250',[req.auth.schoolId]);
   return res.json({items:result.rows,notice:'Offline observations are not official gate or DTR attendance.'});
  }catch(error){console.error('Offline gate review list:',error.code||error.message);return res.status(503).json({error:'Could not load offline gate review.'});}
 });
 app.post('/api/gate/offline/review/:id',authenticateSchoolClient,admin,async(req,res)=>{
  const id=req.params.id,status=req.body?.status,note=String(req.body?.note||'').trim();
  if(!UUID.test(id)||!['CLOSED_REVIEWED','DISMISSED'].includes(status)||note.length<8||note.length>500)
   return res.status(400).json({error:'Choose a review outcome and provide an explanation (8–500 characters).'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const result=await client.query('UPDATE offline_gate_observations '+
     'SET status=$3,review_note=$4,reviewed_by_user_id=$5,reviewed_at=NOW() '+
     "WHERE school_id=$1 AND event_id=$2 AND status IN ('REVIEW_REQUIRED','INVALID_BADGE') RETURNING event_id",
     [req.auth.schoolId,id,status,note,req.auth.userId]);
   if(!result.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'Observation not found or already reviewed.'});}
   await client.query("INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details) "+
      "VALUES($1,'SCHOOL',$2,'GATE_OFFLINE_OBSERVATION_REVIEWED','offline_gate_observation',$3,$4::jsonb)",
      [req.auth.schoolId,req.auth.userId,id,JSON.stringify({status,note,officialAttendance:false})]);
   await client.query('COMMIT');
   return res.json({status,officialAttendance:false,notice:'Review closed. No official attendance generated.'});
  }catch(error){await client.query('ROLLBACK').catch(()=>{});return res.status(503).json({error:'Could not finish observation review.'});}
  finally{client.release();}
 });
}
module.exports={registerGateOfflineRoutes};
