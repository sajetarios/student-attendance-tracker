'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizePhone,validateSettings,submit,providerReady}=require('../sms-service');
const env={SMS_DELIVERY_ENABLED:'true',PHILSMS_API_TOKEN:'fake-test-key',PHILSMS_SENDER_ID:'ATTENDIGO'};
const row={recipient:'09171234567',message:'Attendigo: Example arrival.'};
test('Philippine recipient normalization rejects multiple recipients and non-mobile numbers',()=>{
 for(const n of ['09171234567','+63 917 123 4567','9171234567'])assert.equal(normalizePhone(n),'639171234567');
 for(const n of ['','09171234567,09181234567','123','+12025550123'])assert.equal(normalizePhone(n),null);
});
test('provider requires explicit activation and private credentials',()=>{
 assert.equal(providerReady({PHILSMS_API_TOKEN:'key'}),false);
 assert.equal(providerReady({SMS_DELIVERY_ENABLED:'true'}),false);
 assert.equal(providerReady({...env,PHILSMS_SENDER_ID:''}),false);
 assert.equal(providerReady(env),true);
});
test('settings reject coercion and an enabled empty notification selection',()=>{
 assert.throws(()=>validateSettings({enabled:'true'}));
 assert.throws(()=>validateSettings({enabled:true,school_events:false,class_events:false,advisory_events:false,time_in:true,time_out:true}));
});
test('disabled delivery makes no provider request',async()=>{
 assert.deepEqual(await submit(row,{env:{},fetchImpl:()=>{throw Error('should not call');}}),{kind:'disabled'});
});
test('accepted PhilSMS response records an ID without claiming handset delivery',async()=>{
 const r=await submit(row,{env,fetchImpl:async(url,o)=>{
  assert.equal(url,'https://app.philsms.com/api/v3/sms/send');
  assert.equal(JSON.parse(o.body).recipient,'639171234567');
  assert.equal(o.headers.Authorization,'Bearer fake-test-key');
  assert.equal(o.redirect,'error');
  return {ok:true,status:200,json:async()=>({status:'success',data:{uid:'123',status:'Queued'}})};
 }});
 assert.equal(r.kind,'accepted');assert.equal(r.status,'Queued');assert.equal(r.id,'123');
});
test('timeouts and server errors are held uncertain rather than resent',async()=>{
 assert.equal((await submit(row,{env,fetchImpl:async()=>{throw Error('timeout');}})).kind,'unknown');
 assert.equal((await submit(row,{env,fetchImpl:async()=>({ok:false,status:503})})).kind,'unknown');
});
test('rate limiting schedules bounded retry',async()=>{
 const r=await submit(row,{env,fetchImpl:async()=>({status:429,headers:new Headers({'retry-after':'90'})})});
 assert.equal(r.kind,'retry');assert.equal(r.delay,90);
});
test('provider rejection never treated as accepted',async()=>{
 const r=await submit(row,{env,fetchImpl:async()=>({
  ok:true,status:200,json:async()=>({status:'success',data:{uid:'12',status:'Failed'}})
 })});
 assert.equal(r.kind,'failed');
});
test('malformed successful responses are held for review',async()=>{
 assert.equal((await submit(row,{env,fetchImpl:async()=>({ok:true,status:200,json:async()=>({status:'success',data:{}})})})).kind,'unknown');
});
