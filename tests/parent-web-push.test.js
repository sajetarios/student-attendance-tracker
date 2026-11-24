'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const {validatePushSubscription,vapidConfig,createVapidToken,encryptWebPush,sendWebPush,
 safeSubjectUrl,subjectPush}=require('../parent-web-push');

function sample(){
 const receiver=crypto.createECDH('prime256v1');receiver.generateKeys();
 const auth=crypto.randomBytes(16);
 const endpoint='https://web.push.apple.com/test/subscription/sample-123456';
 const keys={p256dh:receiver.getPublicKey().toString('base64url'),auth:auth.toString('base64url')};
 return {endpoint,keys,receiver,auth};
}
function vapid(){
 const ecdh=crypto.createECDH('prime256v1');ecdh.generateKeys();
 return {
  PARENT_PUSH_VAPID_PUBLIC_KEY:ecdh.getPublicKey().toString('base64url'),
  PARENT_PUSH_VAPID_PRIVATE_KEY:ecdh.getPrivateKey().toString('base64url'),
  PARENT_PUSH_VAPID_SUBJECT:'https://attendigo-staging.onrender.com'
 };
}
test('rejects non-HTTPS, localhost and attacker-controlled push endpoints',()=>{
 const s=sample();
 assert.equal(validatePushSubscription(s).endpoint,s.endpoint);
 for(const bad of ['http://web.push.apple.com/','https://127.0.0.1/push',
  'https://web.push.apple.com.evil.example/push','https://web.push.apple.com:8443/push',
  'https://user:pass@web.push.apple.com/push']){
   assert.throws(()=>validatePushSubscription({...s,endpoint:bad}));
 }
 assert.throws(()=>validatePushSubscription({...s,keys:{...s.keys,auth:'bad'}}));
});
test('VAPID JWT signs intended push-service origin using ES256',()=>{
 const env=vapid(),conf=vapidConfig(env);
 assert.ok(conf);
 const endpoint=sample().endpoint;
 const token=createVapidToken(endpoint,conf).split('.');
 assert.equal(token.length,3);
 const payload=JSON.parse(Buffer.from(token[1],'base64url').toString());
 assert.equal(payload.aud,'https://web.push.apple.com');
 assert.ok(payload.exp*1000>Date.now());
 const p=Buffer.from(env.PARENT_PUSH_VAPID_PUBLIC_KEY,'base64url');
 const pub=crypto.createPublicKey({key:{kty:'EC',crv:'P-256',
   x:p.subarray(1,33).toString('base64url'),y:p.subarray(33).toString('base64url')},format:'jwk'});
 assert.equal(crypto.verify('sha256',Buffer.from(token[0]+'.'+token[1]),
   {key:pub,dsaEncoding:'ieee-p1363'},Buffer.from(token[2],'base64url')),true);
});
test('Web Push aes128gcm frame decrypts with browser keys',()=>{
 const s=sample(),normalized=validatePushSubscription(s);
 const message={title:'Attendigo',body:'Test without student information',url:'/parent-portal.html'};
 const encoded=encryptWebPush(message,normalized);
 const salt=encoded.subarray(0,16),rs=encoded.readUInt32BE(16);
 assert.equal(rs,4096);assert.equal(encoded.readUInt8(20),65);
 const sender=encoded.subarray(21,86);
 const shared=s.receiver.computeSecret(sender);
 const info=Buffer.concat([Buffer.from('WebPush: info\0'),s.receiver.getPublicKey(),sender]);
 const ikm=Buffer.from(crypto.hkdfSync('sha256',shared,s.auth,info,32));
 const key=Buffer.from(crypto.hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16));
 const nonce=Buffer.from(crypto.hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12));
 const ciphertext=encoded.subarray(86);
 const decipher=crypto.createDecipheriv('aes-128-gcm',key,nonce);
 decipher.setAuthTag(ciphertext.subarray(-16));
 const clear=Buffer.concat([decipher.update(ciphertext.subarray(0,-16)),decipher.final()]);
 assert.equal(clear.at(-1),2);
 assert.deepEqual(JSON.parse(clear.subarray(0,-1).toString()),message);
});
test('provider acceptance is not represented as handset delivery',async()=>{
 const s=sample();
 const r=await sendWebPush({endpoint:s.endpoint,p256dh:s.keys.p256dh,authSecret:s.keys.auth},
   {title:'Attendigo',body:'Test'},{env:vapid(),fetchImpl:async(endpoint,init)=>{
     assert.equal(endpoint,s.endpoint);
     assert.equal(init.headers['Content-Encoding'],'aes128gcm');
     assert.match(init.headers.Authorization,/^vapid t=/);
     assert.equal(init.redirect,'error');
     return {status:201};
   }});
 assert.equal(r.kind,'accepted');
});
test('expired subscriptions and errors have safe statuses',async()=>{
 const s=sample(),subscription={endpoint:s.endpoint,p256dh:s.keys.p256dh,authSecret:s.keys.auth};
 assert.equal((await sendWebPush(subscription,{title:'Attendigo'},{env:vapid(),fetchImpl:async()=>({status:410})})).kind,'gone');
 assert.equal((await sendWebPush(subscription,{title:'Attendigo'},{env:vapid(),fetchImpl:async()=>({status:429})})).kind,'retry');
 assert.equal((await sendWebPush(subscription,{title:'Attendigo'},{env:vapid(),fetchImpl:async()=>{throw Error('Network failure')}})).kind,'retry');
});
test('phone notifications use protected, privacy-safe deep links',()=>{
 const eventKey='subject:00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002:2026-11-24:26-00001';
 const url=safeSubjectUrl(eventKey);
 assert.match(url,/^\/parent-portal\.html#subjectAttendance\?child=26-00001&date=2026-11-24$/);
 const notice=subjectPush(eventKey);
 assert.doesNotMatch(notice.title+' '+notice.body,/26-00001|Student|ABSENT|Math/);
 assert.ok(!url.includes('00000000-0000-4000-8000-000000000001'));
});
test('migration keeps API-only subscriptions and explicit school opt-in',()=>{
 const migration=fs.readFileSync('migrations/083_parent_web_push.sql','utf8');
 const registry=fs.readFileSync('scripts/migrate.js','utf8');
 const portal=fs.readFileSync('public/parent-portal.html','utf8');
 const sw=fs.readFileSync('public/sw.js','utf8');
 assert.match(migration,/ENABLE ROW LEVEL SECURITY/);
 assert.match(migration,/parent_push_deliveries/);
 assert.match(migration,/queue_parent_subject_push/);
 assert.match(migration,/parent_subject_notifications/);
 assert.match(registry,/'083_parent_web_push\.sql'/);
 assert.match(portal,/id="pushEnable"/);
 assert.match(portal,/id="pushTest"/);
 assert.match(portal,/\/parent-push\.js\?v=1/);
 assert.match(sw,/addEventListener\('push'/);
 assert.match(sw,/addEventListener\('notificationclick'/);
});
