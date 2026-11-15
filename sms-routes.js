'use strict';
const {providerReady,validateSettings}=require('./sms-service');
const defaults={enabled:false,school_events:true,class_events:false,advisory_events:false,time_in:true,time_out:true};
function registerSmsRoutes(app,pool,{authenticateSchoolClient,requireSchoolRoles}){
 const guards=[authenticateSchoolClient,requireSchoolRoles('SCHOOL_ADMIN')];
 app.get('/api/sms/settings',...guards,async(req,res)=>{try{const r=await pool.query('SELECT * FROM school_sms_settings WHERE school_id=$1',[req.auth.schoolId]);res.set('Cache-Control','no-store').json({settings:r.rows[0]||defaults,provider:{name:'Semaphore',configured:providerReady(),senderName:process.env.SEMAPHORE_SENDER_NAME||'Provider default',deliveryMode:'Web server queue; processing pauses when the service sleeps.'}});}catch(e){res.status(500).json({error:'Could not load SMS settings.'});}});
 app.put('/api/sms/settings',...guards,async(req,res)=>{
  let v;try{v=validateSettings(req.body);}catch(e){return res.status(400).json({error:e.message});}
  if(v.enabled&&!providerReady())return res.status(409).json({error:'Delivery is not configured. Set SEMAPHORE_API_KEY and SMS_DELIVERY_ENABLED=true in the server environment, then redeploy.'});
  try{const r=await pool.query(`INSERT INTO school_sms_settings(school_id,enabled,school_events,class_events,advisory_events,time_in,time_out,enabled_at,updated_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $2 THEN NOW() ELSE NULL END,$8)
   ON CONFLICT(school_id) DO UPDATE SET enabled=$2,school_events=$3,class_events=$4,advisory_events=$5,time_in=$6,time_out=$7,
   enabled_at=CASE WHEN $2 AND NOT school_sms_settings.enabled THEN NOW() ELSE school_sms_settings.enabled_at END,updated_by=$8,updated_at=NOW() RETURNING *`,
   [req.auth.schoolId,v.enabled,v.school_events,v.class_events,v.advisory_events,v.time_in,v.time_out,req.auth.userId]);res.json({settings:r.rows[0]});}catch(e){res.status(500).json({error:'Could not save SMS settings.'});}
 });
 app.get('/api/sms/messages',...guards,async(req,res)=>{try{
  const status=['PENDING','SENDING','SENT','FAILED'].includes(req.query.status)?req.query.status:null;
  const [items,counts]=await Promise.all([pool.query(`SELECT o.id,o.status,o.message,o.provider_message_id,o.provider_status,o.attempts,o.last_error,o.created_at,o.sent_at,
   '•••••••'||right(o.recipient,4) AS recipient,s.full_name,e.attendance_scope
   FROM sms_outbox o JOIN attendance_events e ON e.event_id=o.event_id
   JOIN students s ON s.school_id=e.school_id AND s.student_id=e.student_id
   WHERE e.school_id=$1 AND ($2::text IS NULL OR o.status=$2) ORDER BY o.created_at DESC,o.id DESC LIMIT 100`,[req.auth.schoolId,status]),
   pool.query('SELECT o.status,COUNT(*)::int AS count FROM sms_outbox o JOIN attendance_events e ON e.event_id=o.event_id WHERE e.school_id=$1 GROUP BY o.status',[req.auth.schoolId])]);
  res.set('Cache-Control','no-store').json({messages:items.rows,counts:Object.fromEntries(counts.rows.map(r=>[r.status,r.count]))});
 }catch(e){res.status(500).json({error:'Could not load SMS history.'});}});
}
module.exports={registerSmsRoutes};
