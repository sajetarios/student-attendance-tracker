'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const cloud=require('../cloud-sync-routes');
const fs=require('node:fs');
const path=require('node:path');

const school='11111111-1111-4111-8111-111111111111';
const uuid='22222222-2222-4222-8222-222222222222';
const secret='random-school-key-that-is-at-least-32-characters';
const schoolCode='SCHOOL001';
function signature(body,code=schoolCode,signingSecret=secret) {
  const timestamp=String(Date.now()),nonce=crypto.randomUUID();
  const digest=crypto.createHmac('sha256',signingSecret).update(timestamp+'.'+nonce+'.').update(body).digest('hex');
  const headers={
    'X-Cloud-Timestamp':timestamp,
    'X-Cloud-Nonce':nonce,
    'X-Cloud-Signature':digest
  };
  return {rawBody:Buffer.from(body),body:JSON.parse(body),
    get:key=>headers[key]||''};
}
function runVerify(req) {
  let called=false,status=200,payload=null;
  const res={status(code){status=code;return this;},json(body){payload=body;return this;}};
  cloud.verifySchoolCloudSignature(req,res,()=>{called=true;});
  return {called,status,payload};
}

test('each school has a separate HMAC key and signed body is immutable',()=>{
  const original=process.env.CLOUD_SYNC_SCHOOL_SECRETS_JSON;
  process.env.CLOUD_SYNC_SCHOOL_SECRETS_JSON=JSON.stringify({
    SCHOOL001:secret,SCHOOL002:'another-independent-key-at-least-32-characters'
  });
  try{
    const raw=JSON.stringify({schoolCode,operation:{operationId:uuid}});
    assert.equal(runVerify(signature(raw)).called,true);
    const forged=signature(raw);
    forged.body.schoolCode='SCHOOL002';
    const result=runVerify(forged);
    assert.equal(result.called,false);
    assert.equal(result.status,401);
    assert.equal(runVerify(signature(JSON.stringify({schoolCode:'SCHOOL002'}),'SCHOOL002',secret)).status,401);
  }finally{
    if(original===undefined)delete process.env.CLOUD_SYNC_SCHOOL_SECRETS_JSON;
    else process.env.CLOUD_SYNC_SCHOOL_SECRETS_JSON=original;
  }
});
test('unconfigured cloud school credentials fail closed, not to a global secret',()=>{
  const old=process.env.CLOUD_SYNC_SCHOOL_SECRETS_JSON;
  process.env.CLOUD_SYNC_SCHOOL_SECRETS_JSON='{}';
  try{assert.equal(runVerify(signature(JSON.stringify({schoolCode}))).status,503);}
  finally{if(old===undefined)delete process.env.CLOUD_SYNC_SCHOOL_SECRETS_JSON;else process.env.CLOUD_SYNC_SCHOOL_SECRETS_JSON=old;}
});
test('Express raw body is captured for all signed cloud routes',()=>{
  const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(server,/\/api\/cloud-sync\/receive-operations/);
  assert.match(server,/\/api\/cloud-sync\/health-school/);
  assert.match(server,/req\.rawBody = Buffer\.from\(buffer\)/);
});

function relayHarness(records,reply){
  const queries=[],requests=[];
  const pool={async query(sql,args=[]){
    queries.push({sql,args});
    if(sql.includes('SELECT q.kind'))return {rows:records};
    if(sql.includes("status='PROCESSING'")&&sql.includes('RETURNING attempts'))
      return {rowCount:1,rows:[{attempts:1}]};
    return {rowCount:1,rows:[]};
  }};
  const previousFetch=global.fetch;
  global.fetch=async(url,options)=>{
    const body=JSON.parse(options.body);
    requests.push({url,body});
    return {ok:true,status:200,json:async()=>reply(body)};
  };
  return {pool,queries,requests,restore:()=>{global.fetch=previousFetch;}};
}
const row=(kind,id,createdAt)=>({
  kind,rowId:kind==='QR_SCAN'?'1':id,operationId:id,schoolId:school,schoolCode,
  cloudBaseUrl:'https://cloud.example.com',
  payload:kind==='QR_SCAN'?{eventId:id,studentId:'S1'}:{operationId:id,type:kind},
  status:'PENDING',nextAttemptAt:new Date(Date.now()-10000).toISOString(),createdAt
});
test('ordered relay sends QR before the dependent manual update and records acknowledgments',async()=>{
  const old=process.env.CLOUD_SYNC_SHARED_SECRET;process.env.CLOUD_SYNC_SHARED_SECRET=secret;
  const records=[row('QR_SCAN',uuid,'2026-11-16T08:00:00Z'),
    row('MANUAL_MARKS','33333333-3333-4333-8333-333333333333','2026-11-16T08:01:00Z')];
  const h=relayHarness(records,body=>({results:[body.events?
    {eventId:body.events[0].eventId,status:'ACCEPTED'} :
    {operationId:body.operation.operationId,status:'ACCEPTED'}]}));
  try{
    const done=await cloud.processCloudSyncOutbox(h.pool);
    assert.equal(done.sent,2);
    assert.deepEqual(h.requests.map(r=>r.url),[
      'https://cloud.example.com/api/cloud-sync/receive',
      'https://cloud.example.com/api/cloud-sync/receive-operations'
    ]);
    assert.equal(h.queries.filter(x=>x.sql.includes("status='SENT'")).length,2);
  }finally{
    h.restore();
    if(old===undefined)delete process.env.CLOUD_SYNC_SHARED_SECRET;
    else process.env.CLOUD_SYNC_SHARED_SECRET=old;
  }
});
test('NEEDS_REVIEW prevents later dependent sign-off from being forwarded',async()=>{
  const old=process.env.CLOUD_SYNC_SHARED_SECRET;process.env.CLOUD_SYNC_SHARED_SECRET=secret;
  const records=[row('MANUAL_MARKS',uuid,'2026-11-16T08:00:00Z'),
    row('REGISTER_SIGNOFF','33333333-3333-4333-8333-333333333333','2026-11-16T08:01:00Z')];
  const h=relayHarness(records,body=>({results:[{
    operationId:body.operation.operationId,status:'NEEDS_REVIEW',code:'STALE_CLOUD_MARK',
    reason:'Cloud mark has changed.'
  }]}));
  try{
    const done=await cloud.processCloudSyncOutbox(h.pool);
    assert.equal(done.review,1);
    assert.equal(h.requests.length,1);
    assert.equal(h.queries.filter(x=>x.sql.includes("status='REVIEW'")).length,1);
  }finally{
    h.restore();
    if(old===undefined)delete process.env.CLOUD_SYNC_SHARED_SECRET;
    else process.env.CLOUD_SYNC_SHARED_SECRET=old;
  }
});
