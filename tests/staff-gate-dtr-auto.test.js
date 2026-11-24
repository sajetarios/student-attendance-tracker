'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {chooseSafeAutoSlot,autoRecordVerifiedGateDtr}=require('../staff-gate-dtr-auto');
const hours={AM_IN:'07:00',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'16:00'};
const ev=(id,eventType,time)=>({eventId:id,eventType,time});
const schoolId='44444444-4444-4444-8444-444444444444';
const staffUserId='33333333-3333-4333-8333-333333333333';
const gateEventId='22222222-2222-4222-8222-222222222222';
const day='2026-11-20';

test('early verified arrival selects the AM slot, not an absence or tardy inference',()=>{
 assert.deepEqual(chooseSafeAutoSlot({
   movements:[ev(gateEventId,'TIME_IN','06:30')],existingSlots:{},hours,gateEventId
 }),{status:'MATCHED',slot:'AM_IN'});
});
test('morning and afternoon gate scans never fabricate lunch punches',()=>{
 const result=chooseSafeAutoSlot({
  movements:[ev('one','TIME_IN','07:00'),ev(gateEventId,'TIME_OUT','16:00')],
  existingSlots:{AM_IN:'07:00'},hours,gateEventId
 });
 assert.deepEqual(result,{status:'MATCHED',slot:'PM_OUT'});
});
test('true lunch out and return select the corresponding verified slots',()=>{
 const lunch=chooseSafeAutoSlot({
  movements:[ev('one','TIME_IN','07:00'),ev(gateEventId,'TIME_OUT','12:00')],
  existingSlots:{AM_IN:'07:00'},hours,gateEventId
 });
 assert.equal(lunch.slot,'AM_OUT');
 const returned=chooseSafeAutoSlot({
  movements:[ev('one','TIME_IN','07:00'),ev('two','TIME_OUT','12:00'),ev(gateEventId,'TIME_IN','13:00')],
  existingSlots:{AM_IN:'07:00',AM_OUT:'12:00'},hours,gateEventId
 });
 assert.equal(returned.slot,'PM_IN');
});
test('no noon-first auto-record, ambiguous directions, out-of-window time or stale event ID',()=>{
 const cases=[
  [ev(gateEventId,'TIME_IN','12:55')],
  [ev('one','TIME_IN','07:00'),ev(gateEventId,'TIME_IN','07:01')],
  [ev(gateEventId,'TIME_IN','04:00')]
 ];
 for(const movements of cases)assert.equal(chooseSafeAutoSlot({
  movements,existingSlots:{},hours,gateEventId
 }).status,'REVIEW_REQUIRED');
 assert.equal(chooseSafeAutoSlot({movements:[
  ev('one','TIME_IN','07:00'),ev('two','TIME_OUT','16:00')],
  existingSlots:{},hours,gateEventId:'one'}).status,'REVIEW_REQUIRED');
});
function fakeClient({ob=false,closed=false,leave=false,defaults=true,monthlyReviewed=false}={}){
 const calls=[];
 const client={calls,async query(sql,params){
  calls.push({sql,params});
  const rows=(records)=>({rows:records,rowCount:records.length});
  if(sql.includes('FROM staff_form48_monthly_reviews'))
   return rows(monthlyReviewed?[{dayReviews:{[day]:'ABSENT'}}]:[]);
  if(sql.includes('FROM staff_form48_employee_schedules'))return rows([]);
  if(sql.includes('FROM staff_form48_school_defaults'))
   return rows(defaults?[{workdays:[1,2,3,4,5],regularHours:hours,saturdayHours:{}}]:[]);
  if(sql.includes('FROM school_calendar_exceptions'))return rows(closed?[{one:1}]:[]);
  if(sql.includes('FROM staff_official_business_requests'))return rows(ob?[{one:1}]:[]);
  if(sql.includes('AS blocked'))return rows([{blocked:leave}]);
  if(sql.includes('all_gate ORDER BY'))
   return rows([ev(gateEventId,'TIME_IN','06:50')]);
  if(sql.startsWith('SELECT dtr_slot AS slot'))return rows([]);
  if(sql.startsWith('INSERT INTO staff_attendance_events'))
   return rows([{event_id:'11111111-1111-4111-8111-111111111111'}]);
  if(sql.startsWith('INSERT INTO staff_attendance_audit'))return rows([]);
  throw Error('Unexpected SQL in test: '+sql.slice(0,100));
 }};
 return client;
}
async function run(client){return autoRecordVerifiedGateDtr(client,{
 schoolId,staffUserId,gateEventId,schoolDate:day,
 occurredAt:'2026-11-19T22:50:00Z',actorUserId:staffUserId
});}
test('clean, authorized day creates one verified slot and matching audit evidence',async()=>{
 const client=fakeClient(),result=await run(client);
 assert.equal(result.status,'AUTO_RECORDED');
 assert.equal(result.slot,'AM_IN');
 const insert=client.calls.filter(x=>x.sql.startsWith('INSERT INTO staff_attendance_events'));
 const audit=client.calls.filter(x=>x.sql.startsWith('INSERT INTO staff_attendance_audit'));
 assert.equal(insert.length,1);
 assert.equal(audit.length,1);
 assert.match(audit[0].sql,/AUTO_GATE_TO_DTR_VERIFIED/);
 assert.equal(JSON.parse(audit[0].params[3]).sourceGateEventId,gateEventId);
});
for(const [name,settings,reason] of [
 ['approved OB',{ob:true},'APPROVED_OB_REQUIRES_REVIEW'],
 ['calendar exception',{closed:true},'CALENDAR_EXCEPTION'],
 ['approved leave',{leave:true},'LEAVE_REQUIRES_REVIEW'],
 ['unconfigured hours',{defaults:false},'SCHEDULE_UNAVAILABLE'],
 ['previously reviewed absence',{monthlyReviewed:true},'DAY_ALREADY_REVIEWED']
]){
 test(name+' never creates a synthetic DTR time',async()=>{
  const client=fakeClient(settings),result=await run(client);
  assert.equal(result.status,'REVIEW_REQUIRED');
  assert.equal(result.reason,reason);
  assert.equal(client.calls.some(x=>x.sql.startsWith('INSERT INTO')),false);
 });
}

test('explicitly confirmed last exit can fill PM_OUT without manufacturing PM_IN',()=>{
 const movements=[ev('one','TIME_IN','07:43'),ev('two','TIME_OUT','12:05'),
  {...ev(gateEventId,'TIME_OUT','17:42'),confirmedMissingReturnExit:true}];
 const existingSlots={AM_IN:'07:43',AM_OUT:'12:05'};
 assert.deepEqual(chooseSafeAutoSlot({movements,existingSlots,hours,gateEventId}),
  {status:'MATCHED',slot:'PM_OUT'});
 const unconfirmed=movements.map(({confirmedMissingReturnExit,...e})=>e);
 assert.equal(chooseSafeAutoSlot({movements:unconfirmed,existingSlots,hours,gateEventId}).status,'REVIEW_REQUIRED');
 assert.equal(chooseSafeAutoSlot({movements,existingSlots:{},hours,gateEventId}).status,'REVIEW_REQUIRED');
 assert.equal(chooseSafeAutoSlot({movements,existingSlots:{...existingSlots,PM_OUT:'16:00'},hours,gateEventId}).status,'REVIEW_REQUIRED');
 const midday=[...movements.slice(0,2),{...movements[2],time:'12:20'}];
 assert.equal(chooseSafeAutoSlot({movements:midday,existingSlots,hours,gateEventId}).status,'REVIEW_REQUIRED');
});
