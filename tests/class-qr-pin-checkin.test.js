'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {registerQrPinCheckin,validQrInput,currentQrTokenMatches}=require('../class-qr-pin-checkin');
const {hashAttendancePin}=require('../attendance-pin-security');

const sessionId='11111111-1111-4111-8111-111111111111';
const schoolId='22222222-2222-4222-8222-222222222222';
const secret='test-only-qr-signing-secret';
const freshToken=()=>crypto.createHmac('sha256',secret).update(sessionId+':'+Math.floor(Date.now()/30000)).digest('hex');
const session=()=>({session_id:sessionId,school_id:schoolId,secret,starts_at:new Date(Date.now()-60000).toISOString(),
 closes_at:new Date(Date.now()+60000).toISOString(),closed_at:null,grade_level:'8',section:'SPJ'});
const request=(overrides={})=>({ip:'127.0.0.1',body:{sessionId,token:freshToken(),studentId:'STU-001',pin:'012345'},...overrides});
function response(){
 return {statusCode:200,headers:{},set(k,v){this.headers[k]=v;return this;},
  status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;},
  end(){this.ended=true;return this;}};
}
function harness({present=true,enrolled=true,sessionOverride={},rate=1}={}){
 const routes={};
 const app={post(path,handler){routes['POST '+path]=handler;},get(path,handler){routes['GET '+path]=handler;}};
 const state={saved:[],attempts:0,dbCalls:[],pinHash:null};
 const pool={
  async query(sql,args){
   if(sql.includes('FROM class_qr_sessions'))return {rows:[{...session(),...sessionOverride}],rowCount:1};
   if(sql.includes('INSERT INTO class_qr_pin_ip_limits'))return {rows:[{attempt_count:rate}],rowCount:1};
   throw Error('Unexpected pool SQL '+sql.slice(0,100));
  },
  async connect(){
   return {async query(sql,args){
     state.dbCalls.push({sql,args});
     if(sql.includes('SELECT sap.pin_hash'))return present?
       {rows:[{pin_hash:state.pinHash,failed_attempts:0,locked_until:null}],rowCount:1}:{rows:[],rowCount:0};
     if(sql.includes('FROM student_enrollments'))return {rows:enrolled?[{yes:1}]:[],rowCount:enrolled?1:0};
     return {rows:[],rowCount:0};
   },release(){}};
  }
 };
 registerQrPinCheckin(app,pool,{saveAttendance:async(_pool,s,id,method,actor,reason,verificationMethod)=>{
  state.saved.push({schoolId:s.school_id,id,method,verificationMethod});
  if(state.saved.length>1)return {duplicate:true};
  return {status:'PRESENT',checkedInAt:'2026-11-18T01:00:00Z'};
 }});
 return {routes,state};
}
async function invoke(h,req){const res=response();await h.routes['POST /api/class-qr/check-in/pin'](req,res);return res;}

test('QR input accepts a valid ID and PIN, not arbitrary credentials',()=>{
 assert.equal(validQrInput(request().body),true);
 assert.equal(validQrInput({...request().body,pin:'12345'}),false);
 assert.equal(validQrInput({...request().body,token:'not-qr'}),false);
 assert.equal(validQrInput({...request().body,studentId:''}),false);
});
test('rotating HMAC accepts delayed check-ins within a bounded window for the intended session',()=>{
 const start=30000*1000;
 const token=crypto.createHmac('sha256',secret).update(sessionId+':1000').digest('hex');
 for(const delay of [0,29999,30000,90000,120000,149999])
  assert.equal(currentQrTokenMatches(secret,sessionId,token,start+delay),true);
 for(const delay of [-1,150000,180000])
  assert.equal(currentQrTokenMatches(secret,sessionId,token,start+delay),false);
 assert.equal(currentQrTokenMatches(secret,'other-id',token,start),false);
 assert.equal(currentQrTokenMatches('rotated-secret',sessionId,token,start),false);
 assert.equal(currentQrTokenMatches(secret,sessionId,'0'.repeat(64),start),false);
});
test('passwordless check-in is off by default and exposes no credentials',async()=>{
 const previous=process.env.ENABLE_CLASS_QR_PIN_CHECKIN;
 delete process.env.ENABLE_CLASS_QR_PIN_CHECKIN;
 try{
  const h=harness(),res=await invoke(h,request());
  assert.equal(res.statusCode,404);
  assert.deepEqual(h.state.saved,[]);
  const mode=response();h.routes['GET /api/class-qr/check-in/mode']({},mode);
  assert.deepEqual(mode.body,{pinEnabled:false});
 }finally{if(previous===undefined)delete process.env.ENABLE_CLASS_QR_PIN_CHECKIN;else process.env.ENABLE_CLASS_QR_PIN_CHECKIN=previous;}
});
test('valid live QR plus enrolled student and correct PIN records only one class event',async()=>{
 const previous=process.env.ENABLE_CLASS_QR_PIN_CHECKIN;
 process.env.ENABLE_CLASS_QR_PIN_CHECKIN='true';
 try{
  const h=harness();h.state.pinHash=await hashAttendancePin('012345');
  const r=await invoke(h,request());
  assert.equal(r.statusCode,201);
  assert.deepEqual(h.state.saved,[{schoolId,id:'STU-001',method:'QR',verificationMethod:'STUDENT_PIN'}]);
  const credential=h.state.dbCalls.find(x=>x.sql.includes('SELECT sap.pin_hash'));
  assert.deepEqual(credential.args,[schoolId,'STU-001']);
  const duplicate=await invoke(h,request());
  assert.equal(duplicate.statusCode,409);
  assert.equal(duplicate.body.alreadyRecorded,true);
 }finally{if(previous===undefined)delete process.env.ENABLE_CLASS_QR_PIN_CHECKIN;else process.env.ENABLE_CLASS_QR_PIN_CHECKIN=previous;}
});
test('wrong PIN, missing credential, and ineligible enrollment cannot record attendance',async()=>{
 const previous=process.env.ENABLE_CLASS_QR_PIN_CHECKIN;
 process.env.ENABLE_CLASS_QR_PIN_CHECKIN='true';
 try{
  const bad=harness();bad.state.pinHash=await hashAttendancePin('012345');
  const wrong=await invoke(bad,request({body:{...request().body,pin:'999999'}}));
  assert.equal(wrong.statusCode,403);assert.equal(bad.state.saved.length,0);
  const unknown=harness({present:false});
  const missing=await invoke(unknown,request());
  assert.equal(missing.statusCode,403);assert.equal(unknown.state.saved.length,0);
  assert.equal(wrong.body.error,missing.body.error);
  const notEnrolled=harness({enrolled:false});notEnrolled.state.pinHash=await hashAttendancePin('012345');
  const other=await invoke(notEnrolled,request());assert.equal(other.statusCode,403);assert.equal(notEnrolled.state.saved.length,0);
 }finally{if(previous===undefined)delete process.env.ENABLE_CLASS_QR_PIN_CHECKIN;else process.env.ENABLE_CLASS_QR_PIN_CHECKIN=previous;}
});
test('closed and expired QR or network rate limit rejects without attendance writes',async()=>{
 const previous=process.env.ENABLE_CLASS_QR_PIN_CHECKIN;
 process.env.ENABLE_CLASS_QR_PIN_CHECKIN='true';
 try{
  const closed=harness({sessionOverride:{closed_at:new Date().toISOString()}});
  assert.equal((await invoke(closed,request())).statusCode,410);
  const expired=harness();
  const oldToken=crypto.createHmac('sha256',secret).update(sessionId+':'+(Math.floor(Date.now()/30000)-5)).digest('hex');
  assert.equal((await invoke(expired,request({body:{...request().body,token:oldToken}}))).statusCode,410);
  assert.equal(expired.state.saved.length,0);
  const throttled=harness({rate:121});
  assert.equal((await invoke(throttled,request())).statusCode,429);
  assert.equal(throttled.state.saved.length,0);
 }finally{if(previous===undefined)delete process.env.ENABLE_CLASS_QR_PIN_CHECKIN;else process.env.ENABLE_CLASS_QR_PIN_CHECKIN=previous;}
});
