'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {reconcileGateDay}=require('../gate-dtr-reconciliation');
const hours={AM_IN:'07:30',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'17:00'};
test('four verified gate movements generate review-only candidate slots',()=>{
 const r=reconcileGateDay({hours,movements:[
 {eventType:'TIME_IN',time:'07:25'},{eventType:'TIME_OUT',time:'12:00'},
 {eventType:'TIME_IN',time:'13:05'},{eventType:'TIME_OUT',time:'17:05'}]});
 assert.deepEqual(Object.keys(r.suggestions),['AM_IN','AM_OUT','PM_IN','PM_OUT']);
 assert.equal(r.safeToApply,false);
});
test('OB boundary movements do not become ordinary lunch punches',()=>{
 const r=reconcileGateDay({hours,movements:[
 {eventType:'TIME_IN',time:'07:25'},{eventType:'TIME_OUT',time:'09:00'},
 {eventType:'TIME_IN',time:'14:15'},{eventType:'TIME_OUT',time:'17:05'}],
 approvedOb:[{start:'09:00',end:'14:00'}]});
 assert.equal(r.suggestions.AM_OUT,undefined);
 assert.equal(r.suggestions.PM_IN,undefined);
 assert.ok(r.review.includes('OB_BOUNDARY_GATE_MOVEMENT'));
});
test('missing and contradictory gate movements never auto-fill',()=>{
 const r=reconcileGateDay({hours,movements:[{eventType:'TIME_OUT',time:'12:00'}]});
 assert.deepEqual(r.suggestions,{});
 assert.ok(r.review.includes('GATE_HISTORY_AMBIGUOUS'));
});
test('existing verified slot cannot be overwritten',()=>{
 const r=reconcileGateDay({hours,existingSlots:{AM_IN:'07:20'},movements:[{eventType:'TIME_IN',time:'07:25'}]});
 assert.equal(r.suggestions.AM_IN,undefined);
 assert.ok(r.review.includes('SLOT_ALREADY_VERIFIED'));
});
test('unconfigured schedule blocks classification',()=>{
 const r=reconcileGateDay({movements:[{eventType:'TIME_IN',time:'07:25'}]});
 assert.deepEqual(r.suggestions,{});
 assert.equal(r.safeToApply,false);
});

test('three competing AM_IN movements cannot restore an ambiguous DTR candidate',()=>{
 const r=reconcileGateDay({hours,movements:[
  {eventType:'TIME_IN',time:'07:30'},
  {eventType:'TIME_OUT',time:'08:00'},
  {eventType:'TIME_IN',time:'08:30'},
  {eventType:'TIME_OUT',time:'09:00'},
  {eventType:'TIME_IN',time:'09:30'}
 ]});
 assert.equal(r.suggestions.AM_IN,undefined);
 assert.ok(r.review.includes('DUPLICATE_SLOT_CANDIDATES'));
 assert.equal(r.safeToApply,false);
});
