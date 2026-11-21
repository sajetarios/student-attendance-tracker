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

test('late verified return following an OB departure requires review, never a DTR slot',()=>{
 const r=reconcileGateDay({hours,movements:[
  {eventType:'TIME_IN',time:'07:25'},{eventType:'TIME_OUT',time:'09:00'},
  {eventType:'TIME_IN',time:'18:00'},{eventType:'TIME_OUT',time:'18:15'}],
  approvedOb:[{start:'09:00',end:'17:00'}]});
 assert.ok(r.review.includes('OB_RETURN_AFTER_APPROVED_END_REVIEW'));
 assert.equal(r.suggestions.PM_IN,undefined);
 assert.equal(r.suggestions.PM_OUT,undefined);
 assert.ok(r.review.includes('POST_OB_RETURN_MOVEMENT_REVIEW'));
 assert.equal(r.safeToApply,false);
});
test('an isolated evening arrival is not misclassified as a late OB return',()=>{
 const r=reconcileGateDay({hours,movements:[{eventType:'TIME_IN',time:'18:00'}],
  approvedOb:[{start:'09:00',end:'17:00'}]});
 assert.ok(!r.review.includes('OB_RETURN_AFTER_APPROVED_END_REVIEW'));
 assert.equal(r.safeToApply,false);
});
test('OB return within boundary tolerance remains in standard OB review',()=>{
 const r=reconcileGateDay({hours,movements:[
  {eventType:'TIME_IN',time:'07:25'},{eventType:'TIME_OUT',time:'09:00'},
  {eventType:'TIME_IN',time:'17:10'}],approvedOb:[{start:'09:00',end:'17:00'}]});
 assert.ok(r.review.includes('OB_BOUNDARY_GATE_MOVEMENT'));
 assert.ok(!r.review.includes('OB_RETURN_AFTER_APPROVED_END_REVIEW'));
 assert.equal(r.suggestions.PM_IN,undefined);
});

test('three competing morning arrivals never restore a rejected DTR slot',()=>{
 const r=reconcileGateDay({hours,movements:[
  {eventType:'TIME_IN',time:'07:10'},{eventType:'TIME_OUT',time:'07:30'},
  {eventType:'TIME_IN',time:'08:00'},{eventType:'TIME_OUT',time:'08:20'},
  {eventType:'TIME_IN',time:'09:00'}]});
 assert.equal(r.suggestions.AM_IN,undefined);
 assert.ok(r.review.includes('DUPLICATE_SLOT_CANDIDATES'));
 assert.equal(r.safeToApply,false);
});
test('late OB return never implies overtime or automatic DTR',()=>{
 const r=reconcileGateDay({hours,movements:[
  {eventType:'TIME_IN',time:'07:40'},{eventType:'TIME_OUT',time:'09:00'},
  {eventType:'TIME_IN',time:'17:45'}],
  approvedOb:[{start:'09:00',end:'17:00'}]});
 assert.equal(r.suggestions.PM_IN,undefined);
 assert.equal(r.suggestions.PM_OUT,undefined);
 assert.ok(r.review.includes('OB_RETURN_AFTER_APPROVED_END_REVIEW'));
 assert.equal(r.safeToApply,false);
});

test('early afternoon arrival is suggested as PM_IN from scheduled boundary, not AM_IN',()=>{
 const r=reconcileGateDay({hours,movements:[
  {eventType:'TIME_IN',time:'07:25'},
  {eventType:'TIME_OUT',time:'11:55'},
  {eventType:'TIME_IN',time:'12:50'}]});
 assert.deepEqual(r.suggestions.PM_IN,{time:'12:50',source:'VERIFIED_GATE',requiresApproval:true});
 assert.equal(r.suggestions.AM_IN?.time,'07:25');
 assert.equal(r.safeToApply,false);
});
test('early scheduled departure is suggested as AM_OUT rather than PM_OUT',()=>{
 const r=reconcileGateDay({hours,movements:[
  {eventType:'TIME_IN',time:'07:30'},{eventType:'TIME_OUT',time:'12:20'}]});
 assert.equal(r.suggestions.AM_OUT?.time,'12:20');
 assert.equal(r.suggestions.PM_OUT,undefined);
});
test('equally plausible AM and PM arrival boundaries require review',()=>{
 const tightShift={AM_IN:'08:00',AM_OUT:'08:10',PM_IN:'08:40',PM_OUT:'09:10'};
 const r=reconcileGateDay({hours:tightShift,movements:[
  {eventType:'TIME_IN',time:'08:20'}]});
 assert.deepEqual(r.suggestions,{});
 assert.ok(r.review.includes('AMBIGUOUS_SCHEDULE_SLOT'));
 assert.equal(r.safeToApply,false);
});
test('unsupported or remote gate times never become official DTR suggestions',()=>{
 const r=reconcileGateDay({hours,movements:[{eventType:'TIME_IN',time:'02:05'}]});
 assert.deepEqual(r.suggestions,{});
 assert.ok(r.review.includes('OUTSIDE_SCHEDULE_WINDOW'));
 assert.equal(r.safeToApply,false);
});
