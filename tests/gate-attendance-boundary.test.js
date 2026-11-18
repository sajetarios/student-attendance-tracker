'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validateAutomaticGateRecording,PHYSICAL_GATE}=require('../gate-attendance-boundary');
const valid={actorRole:'GATE_KEEPER',photoVerified:true,recordingTarget:PHYSICAL_GATE};
test('verified Gatekeeper can request physical gate recording only',()=>{
 assert.deepEqual(validateAutomaticGateRecording(valid),{allowed:true});
});
test('OB and Form 48 DTR cannot be recorded by automatic gate flow',()=>{
 for(const recordingTarget of ['OFFICIAL_BUSINESS','DTR_SLOT','AM_IN','AM_OUT','PM_IN','PM_OUT',null,undefined]){
  assert.deepEqual(validateAutomaticGateRecording({...valid,recordingTarget}),{allowed:false,reason:'DTR_OB_ISOLATION'});
 }
});
test('photo confirmation and Gatekeeper authorization remain mandatory',()=>{
 assert.equal(validateAutomaticGateRecording({...valid,photoVerified:false}).reason,'PHOTO_VERIFICATION_REQUIRED');
 assert.equal(validateAutomaticGateRecording({...valid,actorRole:'TEACHER'}).reason,'GATEKEEPER_REQUIRED');
});
test('browser cannot select time-in or time-out in automatic gate flow',()=>{
 for(const clientEventType of ['TIME_IN','TIME_OUT',null]){
  assert.equal(validateAutomaticGateRecording({...valid,clientEventType}).reason,'CLIENT_EVENT_SELECTION_FORBIDDEN');
 }
});
