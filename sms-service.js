'use strict';
const API='https://api.semaphore.co/api/v4/messages';
function normalizePhone(value){let p=String(value||'').replace(/[\s()+-]/g,'');if(/^09\d{9}$/.test(p))p='63'+p.slice(1);else if(/^9\d{9}$/.test(p))p='63'+p;return /^639\d{9}$/.test(p)?p:null;}
function providerReady(env=process.env){return env.SMS_DELIVERY_ENABLED==='true'&&Boolean(env.SEMAPHORE_API_KEY?.trim());}
function validateSettings(v){const keys=['enabled','school_events','class_events','advisory_events','time_in','time_out'];if(!v||keys.some(k=>typeof v[k]!=='boolean'))throw Error('All SMS settings must be true or false.');if(v.enabled&&(![v.school_events,v.class_events,v.advisory_events].some(Boolean)||![v.time_in,v.time_out].some(Boolean)))throw Error('Select at least one attendance type and one notification action.');return Object.fromEntries(keys.map(k=>[k,v[k]]));}
async function submit(row,{env=process.env,fetchImpl=fetch}={}){
 if(!providerReady(env))return {kind:'disabled'};
 const phone=normalizePhone(row.recipient);if(!phone)return {kind:'failed',error:'INVALID_RECIPIENT: Invalid Philippine mobile number.'};
 const body=new URLSearchParams({apikey:env.SEMAPHORE_API_KEY,number:phone,message:row.message});if(env.SEMAPHORE_SENDER_NAME)body.set('sendername',env.SEMAPHORE_SENDER_NAME);
 let response;
 try{response=await fetchImpl(API,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(15000),redirect:'error'});}catch{return {kind:'unknown',error:'DELIVERY_UNCERTAIN: Connection ended without confirmation. Check the provider before sending again.'};}
 if(response.status===429)return {kind:'retry',error:'RATE_LIMIT: Provider asked us to wait.',delay:Math.min(3600,Math.max(60,Number(response.headers.get('retry-after'))||60))};
 if(!response.ok)return {kind:response.status>=500?'unknown':'failed',error:response.status>=500?'DELIVERY_UNCERTAIN: Provider error; check provider history before resending.':`PROVIDER_HTTP_${response.status}: Check API credentials, credits, sender name and recipient in Semaphore.`};
 let data;try{data=await response.json();}catch{return {kind:'unknown',error:'DELIVERY_UNCERTAIN: Provider response could not be read.'};}
 const item=Array.isArray(data)?data[0]:data;
 if(!item?.message_id)return {kind:'unknown',error:'DELIVERY_UNCERTAIN: Provider did not return a message identifier.'};
 const status=String(item.status||'Queued');return {kind:['failed','refunded'].includes(status.toLowerCase())?'failed':'accepted',id:String(item.message_id),status,error:['failed','refunded'].includes(status.toLowerCase())?'PROVIDER_REJECTED: Review the message in Semaphore.':null};
}
function startSmsWorker(pool,{env=process.env,fetchImpl=fetch,interval=5000,logger=console}={}){
 let stopped=false,running=null;
 async function tick(){
  if(stopped||!providerReady(env))return;
  // Interrupted sends cannot be safely replayed: Semaphore has no documented idempotency key.
  await pool.query("UPDATE sms_outbox SET status='FAILED',last_error='DELIVERY_UNCERTAIN: Worker interrupted; check provider history before resending.' WHERE status='SENDING' AND claimed_at < NOW()-INTERVAL '2 minutes'");
  const c=await pool.connect();let row;
  try{await c.query('BEGIN');const r=await c.query(`SELECT o.*,e.school_id,e.student_id,e.occurred_at_device,s.parent_mobile,s.active,
    cfg.enabled_at,cfg.school_events,cfg.class_events,cfg.advisory_events,cfg.time_in,cfg.time_out,e.attendance_scope,e.event_type
    FROM sms_outbox o JOIN attendance_events e ON e.event_id=o.event_id
    JOIN students s ON s.school_id=e.school_id AND s.student_id=e.student_id
    JOIN school_sms_settings cfg ON cfg.school_id=e.school_id AND cfg.enabled=TRUE
    WHERE o.status='PENDING' AND o.next_attempt_at<=NOW() ORDER BY o.created_at FOR UPDATE OF o SKIP LOCKED LIMIT 1`);
   row=r.rows[0];if(row)await c.query("UPDATE sms_outbox SET status='SENDING',claimed_at=NOW(),attempts=attempts+1 WHERE id=$1",[row.id]);await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  if(!row)return;
  let result;
  const scopeKey={SCHOOL:'school_events',CLASS:'class_events',ADVISORY:'advisory_events'}[row.attendance_scope];
  if(!row.active||!normalizePhone(row.parent_mobile)||normalizePhone(row.parent_mobile)!==normalizePhone(row.recipient))result={kind:'failed',error:'RECIPIENT_CHANGED: Guardian number changed or student is inactive; message not sent.'};
  else if(!row[scopeKey]||!row[row.event_type==='TIME_IN'?'time_in':'time_out'])result={kind:'failed',error:'DISABLED_EVENT: This notification type was disabled; message not sent.'};
  else if(new Date(row.created_at)<new Date(row.enabled_at)||Date.now()-new Date(row.occurred_at_device).getTime()>86400000)result={kind:'failed',error:'EXPIRED: Notification predates activation or attendance is over 24 hours old; message not sent.'};
  else result=await submit(row,{env,fetchImpl});
  if(result.kind==='disabled'){await pool.query("UPDATE sms_outbox SET status='PENDING',claimed_at=NULL WHERE id=$1",[row.id]);return;}
  const retry=result.kind==='retry'&&Number(row.attempts)<4;
  await pool.query(`UPDATE sms_outbox SET status=$2,provider_message_id=$3,provider_status=$4,last_error=$5,
   sent_at=CASE WHEN $2='SENT' THEN NOW() ELSE sent_at END,next_attempt_at=NOW()+($6*INTERVAL '1 second') WHERE id=$1`,
  [row.id,result.kind==='accepted'?'SENT':retry?'PENDING':'FAILED',result.id||null,result.status||null,result.error||null,result.delay||60]);
 }
 const launch=()=>{if(running||stopped)return running;running=tick().catch(e=>logger.error('SMS worker:',e.message)).finally(()=>{running=null;});return running;};
 const timer=setInterval(launch,interval);timer.unref();launch();
 logger.log(providerReady(env)?'SMS delivery worker ready; school activation required.':'SMS delivery disabled: configure SEMAPHORE_API_KEY and SMS_DELIVERY_ENABLED=true.');
 return {stop:async()=>{stopped=true;clearInterval(timer);if(running)await running;},tick:launch};
}
module.exports={normalizePhone,providerReady,validateSettings,submit,startSmsWorker};
