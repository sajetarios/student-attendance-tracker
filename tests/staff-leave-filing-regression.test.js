'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {parseRequest,NON_COMMUTABLE}=require('../staff-leave-policy');

const baseline={
 leaveType:'VACATION',creditAccount:'VL',startDate:'2026-11-24',
 endDate:'2026-11-24',reason:'Personal leave',details:'',
 commutation:'NOT_REQUESTED'
};
test('ordinary leave request still accepts CSC Form 6 commutation option',()=>{
 assert.equal(parseRequest({...baseline,commutation:'REQUESTED'}).commutation,'REQUESTED');
 assert.equal(parseRequest(baseline).creditAccount,'VL');
});
for(const type of ['SPECIAL_PRIVILEGE','WELLNESS']){
 test(type+' cannot request commutation or deduct an ordinary leave account',()=>{
  assert.ok(NON_COMMUTABLE.includes(type));
  assert.equal(parseRequest({...baseline,leaveType:type,creditAccount:'NONE'}).creditAccount,'NONE');
  assert.equal(parseRequest({...baseline,leaveType:type,creditAccount:'VL'}),null);
  assert.equal(parseRequest({...baseline,leaveType:type,creditAccount:'NONE',commutation:'REQUESTED'}),null);
 });
}
test('form keeps all controls connected when contextual guidance is inserted',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','public','staff-leave-ui.js'),'utf8');
 assert.match(source,/leave-type-guidance" role="status" aria-live="polite"><\/p>'\+\s*textInput\('startDate'/);
 for(const control of ['supportingDocument','supportingKind','commutation','reason','startDate','endDate']){
  assert.ok(source.includes(control),'missing '+control+' control');
 }
 assert.ok(source.includes('function updateAttachmentChoice()'));
 assert.ok(source.includes("payload.commutation=commutationControl.value"));
 assert.ok(source.includes("birthdayAction.addEventListener('click'"));
 assert.ok(source.includes('leaveTypeControl.setCustomValidity'));
});
test('the final approval handler independently requires HR-certified SPL eligibility',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','staff-leave-routes.js'),'utf8');
 assert.ok(source.includes("schemeForSpl.rows[0]?.leave_scheme!=='REGULAR_VL_SL'"));
 assert.ok(source.includes("row.commutation!=='NOT_REQUESTED'||days>3"));
 assert.ok(source.includes("chargeAccount='NONE'"));
});

test('date inputs use independent tracks inside padded leave form fieldsets',()=>{
 const css=fs.readFileSync(path.join(__dirname,'..','public','staff-leave-ui.css'),'utf8');
 assert.match(css,/#staffLeaveDialog #leaveNewForm fieldset\s*\{[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.doesNotMatch(css,/#leaveNewForm fieldset\{[^}]*grid-template-columns:inherit/);
 assert.match(css,/@media\(max-width:700px\)\s*\{\s*#staffLeaveDialog #leaveNewForm fieldset\{grid-template-columns:minmax\(0,1fr\)/);
 assert.match(css,/#staffLeaveDialog #leaveNewForm fieldset > label > input,[\s\S]*?max-width:100%/);
});
