'use strict';
// Web Push RFC 8291 (aes128gcm) + RFC 8292 (VAPID), implemented with Node crypto.
// No student names, attendance statuses or private records go to the lock screen.
const crypto=require('node:crypto');
const safeBase64Url=s=>typeof s==='string'&&/^[A-Za-z0-9_-]+$/.test(s);
const hashEndpoint=s=>crypto.createHash('sha256').update(s).digest('hex');
function decode(s){if(!safeBase64Url(s))throw Error('Invalid Web Push key.');return Buffer.from(s,'base64url');}
function validPushEndpoint(value){
 if(typeof value!=='string'||value.length>2048||value.length<30)return false;
 let u;try{u=new URL(value)}catch{return false}
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash)return false;
 const h=u.hostname.toLowerCase();
 return h==='fcm.googleapis.com'||h==='fcm-xm.googleapis.com'||
   h==='updates.push.services.mozilla.com'||h.endsWith('.push.services.mozilla.com')||
   h==='web.push.apple.com'||h.endsWith('.push.apple.com')||
   h.endsWith('.notify.windows.com');
}
function validatePushSubscription(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid push subscription.');
 const {endpoint,keys}=value;
 if(!validPushEndpoint(endpoint))throw Error('Unsupported or unsafe browser push endpoint.');
 const clientPublic=decode(keys?.p256dh),auth=decode(keys?.auth);
 if(clientPublic.length!==65||clientPublic[0]!==4||auth.length!==16)
   throw Error('Invalid push encryption keys.');
 // Verify that the advertised browser public key is on curve P-256.
 try{crypto.ECDH.convertKey(clientPublic,'prime256v1',undefined,undefined,'uncompressed')}
 catch{throw Error('Invalid push public key.')}
 return {endpoint,endpointHash:hashEndpoint(endpoint),p256dh:keys.p256dh,authSecret:keys.auth};
}
function vapidConfig(env=process.env){
 const p=env.PARENT_PUSH_VAPID_PUBLIC_KEY,priv=env.PARENT_PUSH_VAPID_PRIVATE_KEY;
 const subject=env.PARENT_PUSH_VAPID_SUBJECT;
 if(!p||!priv||!subject)return null;
 try{
   const pb=decode(p),privateBytes=decode(priv);
   if(pb.length!==65||pb[0]!==4||privateBytes.length!==32)throw Error('bad key size');
   const e=crypto.createECDH('prime256v1');e.setPrivateKey(privateBytes);
   if(!e.getPublicKey().equals(pb))throw Error('mismatched VAPID pair');
   if(!(/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/i).test(subject))throw Error('bad subject');
   const privateKey=crypto.createPrivateKey({key:{
     kty:'EC',crv:'P-256',d:priv,x:pb.subarray(1,33).toString('base64url'),
     y:pb.subarray(33).toString('base64url')
   },format:'jwk'});
   return {publicKey:p,privateKey,subject};
 }catch{return null}
}
function createVapidToken(endpoint,config,now=Date.now()){
 const head=Buffer.from(JSON.stringify({typ:'JWT',alg:'ES256'})).toString('base64url');
 const body=Buffer.from(JSON.stringify({
   aud:new URL(endpoint).origin,exp:Math.floor(now/1000)+3600,sub:config.subject
 })).toString('base64url');
 const data=head+'.'+body;
 const sig=crypto.sign('sha256',Buffer.from(data),{key:config.privateKey,dsaEncoding:'ieee-p1363'});
 return data+'.'+sig.toString('base64url');
}
function encryptWebPush(payload,subscription,options={}){
 const ua=decode(subscription.p256dh||subscription.keys?.p256dh);
 const auth=decode(subscription.authSecret||subscription.keys?.auth);
 const e=options.ecdh||crypto.createECDH('prime256v1');
 if(!options.ecdh)e.generateKeys();
 const sender=e.getPublicKey(),shared=e.computeSecret(ua);
 const keyInfo=Buffer.concat([Buffer.from('WebPush: info\0'),ua,sender]);
 const ikm=Buffer.from(crypto.hkdfSync('sha256',shared,auth,keyInfo,32));
 const salt=options.salt||crypto.randomBytes(16);
 const cek=Buffer.from(crypto.hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16));
 const nonce=Buffer.from(crypto.hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12));
 const cleartext=Buffer.concat([Buffer.from(JSON.stringify(payload),'utf8'),Buffer.from([2])]);
 if(cleartext.length+16>=4096)throw Error('Push payload too large.');
 const cipher=crypto.createCipheriv('aes-128-gcm',cek,nonce);
 const body=Buffer.concat([cipher.update(cleartext),cipher.final(),cipher.getAuthTag()]);
 const header=Buffer.alloc(21);salt.copy(header,0);header.writeUInt32BE(4096,16);header.writeUInt8(sender.length,20);
 return Buffer.concat([header,sender,body]);
}
async function sendWebPush(subscription,message,{env=process.env,fetchImpl=fetch}={}){
 const config=vapidConfig(env);
 if(!config)return {kind:'disabled'};
 let s;try{s=validatePushSubscription({endpoint:subscription.endpoint,keys:{
   p256dh:subscription.p256dh,auth:subscription.authSecret
 }})}catch{return {kind:'gone'}}
 const body=encryptWebPush(message,s);
 try{
   const r=await fetchImpl(s.endpoint,{
     method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),body,
     headers:{
       'Content-Type':'application/octet-stream','Content-Encoding':'aes128gcm',
       'TTL':'3600','Urgency':'normal',
       Authorization:'vapid t='+createVapidToken(s.endpoint,config)+', k='+config.publicKey
     }
   });
   if(r.status>=200&&r.status<300)return {kind:'accepted'};
   if(r.status===404||r.status===410)return {kind:'gone'};
   if(r.status===429||r.status>=500)return {kind:'retry'};
   return {kind:'failed'};
 }catch{return {kind:'retry'}}
}
function safeSubjectUrl(eventKey){
 const parts=String(eventKey||'').split(':');
 if(parts.length!==5||!/^subject$/.test(parts[0])||!/^20\d{2}-\d{2}-\d{2}$/.test(parts[3]))
   return '/parent-portal.html#subjectAttendance';
 // Student identity is in the URL fragment; server and Referer never receive it.
 return '/parent-portal.html#subjectAttendance?child='+encodeURIComponent(parts[4])+
   '&date='+encodeURIComponent(parts[3]);
}
function subjectPush(eventKey){
 return {title:'Attendigo · Subject Attendance',body:'A confirmed subject attendance update is available. Open Attendigo to view securely.',
   url:safeSubjectUrl(eventKey),tag:'attendigo-subject-'+hashEndpoint(String(eventKey)).slice(0,16)};
}
const testPush=()=>({title:'Attendigo · Test Notification',
 body:'Phone notifications are working for this device.',url:'/parent-portal.html#pushNotifications',tag:'attendigo-push-test'});
function startParentPushWorker(pool,{env=process.env,pollMs=15000}={}){
 if(!vapidConfig(env)){console.log('Parent Web Push disabled: no valid VAPID configuration.');return null}
 let busy=false;
 async function tick(){
   if(busy)return;busy=true;
   try{
     await pool.query("UPDATE parent_push_deliveries SET state='FAILED',last_error='Retry limit reached'"+
       " WHERE state='SENDING' AND lease_until<NOW() AND attempts>=4");
     const claimed=await pool.query([
       'WITH locked AS (SELECT delivery_id FROM parent_push_deliveries',
       "WHERE ((state IN ('PENDING','RETRY') AND next_attempt_at<=NOW())",
       "OR (state='SENDING' AND lease_until<NOW())) AND attempts<4",
       'ORDER BY created_at LIMIT 12 FOR UPDATE SKIP LOCKED)',
       "UPDATE parent_push_deliveries d SET state='SENDING',attempts=d.attempts+1,",
       "lease_until=NOW()+interval '60 seconds' FROM locked WHERE d.delivery_id=locked.delivery_id",
       'RETURNING d.delivery_id,d.subscription_id,d.notification_id,d.attempts'
     ].join(' '));
     for(const job of claimed.rows){
       try{
         const result=await pool.query([
           'SELECT sub.endpoint,sub.p256dh,sub.auth_secret AS "authSecret",n.event_key',
           'FROM parent_push_deliveries d',
           'JOIN user_notifications n ON n.notification_id=d.notification_id',
           'JOIN parent_push_subscriptions sub ON sub.subscription_id=d.subscription_id',
           'JOIN school_users u ON u.school_id=sub.school_id AND u.user_id=sub.parent_user_id',
           "AND u.active=TRUE AND u.role='PARENT'",
           'JOIN parent_student_links l ON l.school_id=sub.school_id',
           "AND l.parent_user_id=sub.parent_user_id AND l.status='APPROVED'",
           "AND l.student_id=split_part(n.event_key,':',5)",
           "JOIN school_settings st ON st.school_id=n.school_id",
           "AND st.setting_key='parent_subject_notifications' AND st.setting_value='true'::jsonb",
           "WHERE d.delivery_id=$1 AND sub.active=TRUE AND n.category='SYSTEM'",
           "AND n.event_key LIKE 'subject:%' AND n.recipient_kind='SCHOOL_USER'",
           'AND n.recipient_id=sub.parent_user_id AND n.school_id=sub.school_id LIMIT 1'
         ].join(' '),[job.delivery_id]);
         const row=result.rows[0];
         const sent=row?await sendWebPush(row,subjectPush(row.event_key),{env}):{kind:'gone'};
         let state=sent.kind==='accepted'?'ACCEPTED':sent.kind==='retry'&&job.attempts<4?'RETRY':
           sent.kind==='gone'?'EXPIRED':'FAILED';
         await pool.query([
           'UPDATE parent_push_deliveries SET state=$2,lease_until=NULL,',
           "accepted_at=CASE WHEN $2='ACCEPTED' THEN NOW() ELSE accepted_at END,",
           "next_attempt_at=CASE WHEN $2='RETRY' THEN NOW()+($3*interval '1 second') ELSE next_attempt_at END,",
           "last_error=CASE WHEN $2 IN ('RETRY','FAILED') THEN 'Web Push provider did not accept this attempt' ELSE NULL END",
           'WHERE delivery_id=$1'
         ].join(' '),[job.delivery_id,state,Math.min(900,30*Math.pow(2,job.attempts))]);
         if(state==='ACCEPTED')await pool.query(
           'UPDATE parent_push_subscriptions SET last_success_at=NOW(),failure_count=0 WHERE subscription_id=$1',
           [job.subscription_id]);
         if(state==='EXPIRED')await pool.query(
           'UPDATE parent_push_subscriptions SET active=FALSE WHERE subscription_id=$1',[job.subscription_id]);
       }catch(error){
         await pool.query("UPDATE parent_push_deliveries SET state='RETRY',lease_until=NULL,"+
           "next_attempt_at=NOW()+interval '90 seconds',last_error='Temporary push processing failure'"+
           " WHERE delivery_id=$1",[job.delivery_id]).catch(()=>{});
         console.warn('Parent push processing temporary error:',error.code||error.name||'UNKNOWN');
       }
     }
   }catch(error){console.warn('Parent push worker unavailable:',error.code||error.name||'UNKNOWN')}
   finally{busy=false}
 }
 void tick();
 const timer=setInterval(()=>{void tick()},pollMs);timer.unref();
 return {stop:()=>clearInterval(timer),tick};
}
module.exports={validatePushSubscription,validPushEndpoint,vapidConfig,createVapidToken,
 encryptWebPush,sendWebPush,safeSubjectUrl,subjectPush,testPush,hashEndpoint,startParentPushWorker};
