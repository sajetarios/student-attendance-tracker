'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {chooseSafeAutoSlot}=require('../staff-gate-dtr-auto');
const {reconcileGateDay}=require('../gate-dtr-reconciliation');
const {summarizeForm48}=require('../form48-calculations');
const date='2026-11-20',month='2026-11',today='2026-11-22';
const slots=['AM_IN','AM_OUT','PM_IN','PM_OUT'];
function simulate(times,hours){
 const movements=[],verified={};
 for(let i=0;i<times.length;i++){
  const eventId='synthetic-gate-'+i;
  movements.push({eventId,eventType:i%2===0?'TIME_IN':'TIME_OUT',time:times[i]});
  const decision=chooseSafeAutoSlot({movements,existingSlots:verified,hours,gateEventId:eventId});
  assert.deepEqual(decision,{status:'MATCHED',slot:slots[i]});
  verified[decision.slot]=times[i];
 }
 const assessment=summarizeForm48({records:[{date,slots:verified}],month,today,
  settings:{workdays:[1,2,3,4,5],regularHours:hours,saturdayHours:{}}});
 return {verified,day:assessment.assessments.find(x=>x.date===date),summary:assessment.summary};
}
test('pilot 7-to-4 school day: all four verified scans appear in DTR with no invented penalties',()=>{
 const hours={AM_IN:'07:00',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'16:00'};
 const r=simulate(['06:55','12:02','12:55','16:10'],hours);
 assert.deepEqual(r.verified,{AM_IN:'06:55',AM_OUT:'12:02',PM_IN:'12:55',PM_OUT:'16:10'});
 assert.equal(r.day.status,'VERIFIED');
 assert.equal(r.day.lateMinutes,0);
 assert.equal(r.day.undertimeMinutes,0);
});
test('pilot temporary 6-to-3 school schedule remains schedule-specific',()=>{
 const hours={AM_IN:'06:00',AM_OUT:'11:00',PM_IN:'12:00',PM_OUT:'15:00'};
 const r=simulate(['05:55','11:00','11:55','15:10'],hours);
 assert.equal(r.day.status,'VERIFIED');
 assert.equal(r.day.lateMinutes,0);
 assert.equal(r.day.undertimeMinutes,0);
});
test('pilot 8-to-5 school day: tardy and undertime use official schedule, not device clock',()=>{
 const hours={AM_IN:'08:00',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'17:00'};
 const r=simulate(['08:12','12:00','13:03','16:50'],hours);
 assert.equal(r.day.lateMinutes,15);
 assert.equal(r.day.undertimeMinutes,10);
 assert.equal(r.summary.daysPresent,1);
});
test('missing lunch return stays incomplete, not absent',()=>{
 const hours={AM_IN:'07:00',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'16:00'};
 const record={AM_IN:'06:55',AM_OUT:'12:02'};
 const r=summarizeForm48({records:[{date,slots:record}],month,today,
  settings:{workdays:[1,2,3,4,5],regularHours:hours,saturdayHours:{}}});
 const day=r.assessments.find(x=>x.date===date);
 assert.equal(day.status,'INCOMPLETE_DTR');
 assert.equal(day.needsReview,true);
 assert.equal(r.summary.daysAbsent,0);
});
test('approved OB return after end requires human review, never an inferred punch',()=>{
 const hours={AM_IN:'07:00',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'16:00'};
 const r=reconcileGateDay({hours,movements:[
  {eventType:'TIME_IN',time:'06:55'},{eventType:'TIME_OUT',time:'09:00'},
  {eventType:'TIME_IN',time:'18:00'},{eventType:'TIME_OUT',time:'18:10'}],
  approvedOb:[{start:'09:00',end:'17:00'}]});
 assert.ok(r.review.includes('OB_RETURN_AFTER_APPROVED_END_REVIEW'));
 assert.equal(r.suggestions.PM_IN,undefined);
 assert.equal(r.suggestions.PM_OUT,undefined);
 assert.equal(r.safeToApply,false);
});
