'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {providerReady,submit}=require('../sms-service');
const env={PHILSMS_API_TOKEN:'test-secret',PHILSMS_SENDER_ID:'ATTENDIGO',SMS_DELIVERY_ENABLED:'true'};
test('PhilSMS stays disabled without explicit flag and sender ID',()=>{
 assert.equal(providerReady({...env,SMS_DELIVERY_ENABLED:'false'}),false);
 assert.equal(providerReady({...env,PHILSMS_SENDER_ID:''}),false);
});
test('PhilSMS uses bearer authentication and JSON payload',async()=>{
 let called=false;
 const result=await submit({recipient:'09171234567',message:'Attendance confirmed'},{
 env,fetchImpl:async(url,options)=>{
 called=true;
 assert.equal(url,'https://app.philsms.com/api/v3/sms/send');
 assert.equal(options.headers.Authorization,'Bearer test-secret');
 assert.deepEqual(JSON.parse(options.body),{recipient:'639171234567',sender_id:'ATTENDIGO',type:'plain',message:'Attendance confirmed'});
 return {ok:true,status:200,json:async()=>({status:'success',data:{uid:'sms-123',status:'queued'}})};
 }});
 assert.equal(called,true);
 assert.equal(result.kind,'accepted');
 assert.equal(result.id,'sms-123');
});
test('PhilSMS rejection and ambiguous acceptance never mark SMS as sent',async()=>{
 const rejected=await submit({recipient:'09171234567',message:'Test'},{
 env,fetchImpl:async()=>({ok:true,status:200,json:async()=>({status:'error',message:'Invalid sender'})})});
 assert.equal(rejected.kind,'failed');
 const unknown=await submit({recipient:'09171234567',message:'Test'},{
 env,fetchImpl:async()=>({ok:true,status:200,json:async()=>({status:'success',data:{}})})});
 assert.equal(unknown.kind,'unknown');
});
test('invalid mobile number never calls provider',async()=>{
 const result=await submit({recipient:'123',message:'Test'},{
 env,fetchImpl:async()=>{throw Error('Must not call');}});
 assert.equal(result.kind,'failed');
});
