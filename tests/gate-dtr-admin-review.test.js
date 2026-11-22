'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {registerGateDtrReviewRoutes,reviewableGateCandidates,dateValid}=require('../staff-gate-dtr-review-routes');
const day='2026-11-20',school='44444444-4444-4444-8444-444444444444';
const employee='33333333-3333-4333-8333-333333333333';
const keeper='55555555-5555-4555-8555-555555555555';
const gateId='22222222-2222-4222-8222-222222222222';
const hours={AM_IN:'07:00',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'16:00'};
const event={eventId:gateId,eventType:'TIME_IN',time:'06:30',
 occurredAt:'2026-11-19T22:30:00.000Z',actualLocalDate:day,schoolDate:day,
 origin:'TRUSTED_SERVER_GATE'};
const rows=items=>({rows:items,rowCount:items.length});
const basic={movements:[event],existingSlots:{},hours};

test('only one unique trusted original gate event supports a DTR candidate',()=>{
 assert.deepEqual(reviewableGateCandidates(basic).candidates,
  [{slot:'AM_IN',eventId:gateId,time:'06:30'}]);
 for(const row of [{...event,origin:'LEGACY_CLIENT_CLOCK'},
  {...event,actualLocalDate:'2026-11-19'}]){
  assert.equal(reviewableGateCandidates({...basic,movements:[row]}).status,'REVIEW_REQUIRED');
 }
 assert.equal(reviewableGateCandidates({...basic,movements:[event,event]}).status,'REVIEW_REQUIRED');
 assert.equal(reviewableGateCandidates({...basic,blockedReason:'APPROVED_OB_REQUIRES_REVIEW'}).status,'REVIEW_REQUIRED');
 assert.equal(reviewableGateCandidates({...basic,existingSlots:{AM_IN:'06:25'}}).status,'REVIEW_REQUIRED');
 assert.equal(reviewableGateCandidates({...basic,usedGateIds:[gateId]}).status,'REVIEW_REQUIRED');
 assert.equal(dateValid('2026-11-31'),false);
 assert.equal(dateValid('2099-01-01'),false);
});

function fixture({role='SCHOOL_ADMIN',approvedOb=false,approvedLeave=false,
 closure=false,reviewed=false,untrusted=false,existing=false,insertConflict=false}={}){
 const routes=new Map(),calls=[];
 const auth=(_req,_res,next)=>next();
 const requireSchoolRoles=(...roles)=>(_req,res,next)=>
  roles.includes(_req.auth.role)?next():res.status(403).json({error:'Forbidden'});
 const pool={
  async query(sql,params){return query(sql,params);},
  async connect(){return {query,release(){calls.push({sql:'RELEASE'})}};}
 };
 let completed=false;
 async function query(sql,params){
  calls.push({sql,params});
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.includes('pg_advisory_xact_lock')){
   if(sql==='COMMIT')completed=true;
   return rows([]);
  }
  if(sql.includes('SELECT 1 FROM school_users WHERE school_id=$1 AND user_id=$2')&&
     sql.includes('active=TRUE'))return rows([{user_id:employee}]);
  if(sql.includes('FROM staff_form48_monthly_reviews'))return rows(reviewed?[{
   workdays:[1,2,3,4,5],regularHours:hours,saturdayHours:{},dayReviews:{[day]:'ABSENT'}}]:[]);
  if(sql.includes('FROM staff_form48_employee_schedules'))return rows([]);
  if(sql.includes('FROM staff_form48_school_defaults'))return rows([{
   workdays:[1,2,3,4,5],regularHours:hours,saturdayHours:{},revision:0
  }]);
  if(sql.includes('FROM school_calendar_exceptions'))return rows(closure?[{x:1}]:[]);
  if(sql.includes('FROM staff_official_business_requests'))return rows(approvedOb?[{x:1}]:[]);
  if(sql.includes('AS blocked'))return rows([{blocked:approvedLeave}]);
  if(sql.includes('gate_history ORDER BY'))return rows([untrusted?{...event,origin:'LEGACY_CLIENT_CLOCK'}:event]);
  if(sql.includes('FROM staff_attendance_events')&&sql.includes("event_kind='DTR_SLOT'"))
   return rows(existing?[{slot:'AM_IN',time:'06:25'}]:[]);
  if(sql.includes("details->>'sourceGateEventId'"))return rows([]);
  if(sql.includes('INSERT INTO staff_attendance_events'))return rows(insertConflict?[]:[{event_id:'77777777-7777-4777-8777-777777777777'}]);
  if(sql.includes('INSERT INTO staff_attendance_audit'))return rows([]);
  throw Error('Unhandled SQL: '+sql.slice(0,120));
 }
 const app={
  get(path,...handlers){routes.set('GET '+path,handlers);},
  post(path,...handlers){routes.set('POST '+path,handlers);}
 };
 registerGateDtrReviewRoutes(app,pool,{authenticateSchoolClient:auth,requireSchoolRoles});
 const invoke=async(method,path,{body={},query:params={},as=role}={})=>{
  const req={body,query:params,auth:{type:'SCHOOL_USER',role:as,schoolId:school,userId:keeper}};
  const response={code:200,payload:null,headers:{},
   set(k,v){this.headers[k]=v;return this;},
   status(code){this.code=code;return this;},
   json(value){this.payload=value;return this;}};
  for(const handler of routes.get(method+' '+path)){
   let next=false;
   await handler(req,response,()=>{next=true});
   if(!next)break;
  }
  return response;
 };
 const body={staffUserId:employee,date:day,gateEventId:gateId,slot:'AM_IN',
  reason:'Compared the verified gate arrival with the staff schedule.'};
 return {invoke,calls,body,get completed(){return completed}};
}
const apply='/api/staff-attendance/admin/dtr-review-apply';
const preview='/api/staff-attendance/admin/dtr-review-options';

test('unauthorized roles, malformed evidence and missing reason never reach database',async()=>{
 const f=fixture();
 assert.equal((await f.invoke('POST',apply,{body:f.body,as:'TEACHER'})).code,403);
 assert.equal((await f.invoke('POST',apply,{body:{...f.body,reason:'yes'}})).code,400);
 assert.equal((await f.invoke('POST',apply,{body:{...f.body,gateEventId:'invalid'}})).code,400);
 assert.equal(f.calls.length,0);
});
test('admin can inspect safe candidates through a read-only GET',async()=>{
 const f=fixture();
 const res=await f.invoke('GET',preview,{query:{staffUserId:employee,date:day}});
 assert.equal(res.code,200);
 assert.equal(res.payload.status,'ELIGIBLE');
 assert.equal(res.payload.candidates[0].eventId,gateId);
 assert.equal(f.calls.some(x=>/INSERT|DELETE|UPDATE|BEGIN|COMMIT/.test(x.sql)),false);
});
test('authorized approval records original server timestamp and audit in one transaction',async()=>{
 const f=fixture(),res=await f.invoke('POST',apply,{body:f.body});
 assert.equal(res.code,201);
 assert.equal(res.payload.status,'VERIFIED');
 assert.equal(res.payload.occurredAt,event.occurredAt);
 assert.equal(f.completed,true);
 const record=f.calls.find(x=>x.sql.includes('INSERT INTO staff_attendance_events'));
 assert.ok(record);
 assert.match(record.sql,/AUTHORIZED_CORRECTION/);
 assert.match(record.sql,/MANUAL_REVIEW/);
 assert.equal(record.params[5],event.occurredAt);
 const audit=f.calls.find(x=>x.sql.includes('INSERT INTO staff_attendance_audit'));
 assert.ok(audit);
 const details=JSON.parse(audit.params[3]);
 assert.equal(details.sourceGateEventId,gateId);
 assert.equal(details.staffUserId,employee);
 assert.equal(details.reviewReason,f.body.reason);
 assert.equal(f.calls.at(-2).sql,'COMMIT');
});
test('approved OB, leave, calendar, absence and untrusted evidence block approval',async()=>{
 for(const options of [{approvedOb:true},{approvedLeave:true},{closure:true},{reviewed:true},{untrusted:true},{existing:true}]){
  const f=fixture(options),res=await f.invoke('POST',apply,{body:f.body});
  assert.equal(res.code,409,JSON.stringify(options));
  assert.equal(f.calls.some(x=>x.sql.startsWith('INSERT INTO')),false,JSON.stringify(options));
  assert.equal(f.completed,false);
  assert.ok(f.calls.some(x=>x.sql==='ROLLBACK'));
 }
});
test('verified slot conflict rolls back, never writes an approval audit',async()=>{
 const f=fixture({insertConflict:true}),res=await f.invoke('POST',apply,{body:f.body});
 assert.equal(res.code,409);
 assert.equal(f.calls.filter(x=>x.sql.includes('INSERT INTO staff_attendance_audit')).length,0);
 assert.equal(f.completed,false);
});
