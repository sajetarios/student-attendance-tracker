'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const code=fs.readFileSync('staff-gate-dtr-routes.js','utf8');
const schema=fs.readFileSync('migrations/051_staff_smart_attendance_foundation.sql','utf8');
const {registerStaffGateDtrRoutes}=require('../staff-gate-dtr-routes');
function fixture(role='TEACHER'){
 const handlers=new Map(),queries=[];
 const auth={type:'SCHOOL_USER',schoolId:'school-1',userId:'user-1',role};
 const client={query:async(sql,args)=>{queries.push({sql,args});
  if(sql.includes('SELECT event_id,staff_user_id,dtr_slot,device_capture_at'))return {rowCount:0,rows:[]};
  if(sql.includes('SELECT event_id,staff_user_id,dtr_slot,school_date'))return {rowCount:1,rows:[{event_id:'e1',staff_user_id:'other-user',dtr_slot:'AM_IN',school_date:'2026-11-18'}]};
  return {rowCount:1,rows:[]};},release(){}};
 const pool={connect:async()=>client,query:client.query};
 registerStaffGateDtrRoutes({get:(p,...h)=>handlers.set('GET '+p,h),post:(p,...h)=>handlers.set('POST '+p,h)},pool,{
  authenticateSchoolClient:(req,res,next)=>next(),
  requireSchoolRoles:(...roles)=>(req,res,next)=>roles.includes(req.auth.role)?next():res.status(403).json({error:'Denied'})});
 async function call(method,path,body={},params={}){
  const req={auth,body,params,query:{}},res={code:200,set(){return this;},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};
  const handlersFor=handlers.get(method+' '+path);assert.ok(handlersFor,path);
  for(const handler of handlersFor){if(res.body)break;await new Promise((resolve,reject)=>{let next=false;
   try{Promise.resolve(handler(req,res,()=>{next=true;resolve();})).then(()=>{if(!next)resolve();},reject);}catch(e){reject(e);}});}
  return res;
 }
 return {call,queries};
}
const id='a6831ee2-24db-42b2-9d27-39d130eb11f1';
test('offline staff DTR is queued, never automatically verified',async()=>{
 const f=fixture(),r=await f.call('POST','/api/staff-attendance/my/dtr/offline-sync',
  {clientEventKey:id,slot:'AM_IN',capturedAt:new Date().toISOString()});
 assert.equal(r.code,202);
 assert.equal(r.body.status,'PENDING_VERIFICATION');
 const q=f.queries.find(q=>q.sql.includes('INSERT INTO staff_attendance_events'));
 assert.match(q.sql,/OFFLINE_SYNC','PENDING_VERIFICATION'/);
 assert.ok(f.queries.some(q=>q.sql.includes('STAFF_OFFLINE_DTR_PENDING')));
});
test('offline queue rejects invalid identifiers and unauthorized roles',async()=>{
 const f=fixture();
 assert.equal((await f.call('POST','/api/staff-attendance/my/dtr/offline-sync',
  {clientEventKey:'bad',slot:'AM_IN',capturedAt:new Date().toISOString()})).code,400);
 assert.equal((await fixture('STUDENT').call('POST','/api/staff-attendance/my/dtr/offline-sync',
  {clientEventKey:id,slot:'AM_IN',capturedAt:new Date().toISOString()})).code,403);
});
test('school admin alone can review with audit and explicit note',async()=>{
 const path='/api/staff-attendance/offline-review/:eventId';
 assert.equal((await fixture('TEACHER').call('POST',path,{decision:'VERIFY',note:'Photo checked'},{eventId:id})).code,403);
 const admin=fixture('SCHOOL_ADMIN');
 assert.equal((await admin.call('POST',path,{decision:'VERIFY',note:'Photo checked'},{eventId:id})).code,200);
 assert.ok(admin.queries.some(q=>q.sql.includes('STAFF_OFFLINE_DTR_VERIFIED')));
 assert.match(code,/staff_user_id===req.auth.userId/);
 assert.match(code,/verification_method=CASE WHEN \$3='VERIFIED' THEN 'MANUAL_REVIEW'/);
 assert.match(code,/FOR UPDATE/);
 assert.match(schema,/staff_dtr_one_verified_slot_per_day/);
 assert.match(code,/verification_status='VERIFIED'/);
});
test('school scoped review queue never exposes other schools',async()=>{
 const f=fixture('SCHOOL_ADMIN');
 assert.equal((await f.call('GET','/api/staff-attendance/offline-review')).code,200);
 assert.ok(f.queries.some(q=>q.sql.includes('e.school_id=$1')));
 assert.equal((await fixture('TEACHER').call('GET','/api/staff-attendance/offline-review')).code,403);
});
