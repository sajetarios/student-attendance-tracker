'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildObDtrRemarks}=require('../ob-dtr-remarks');
const date='2026-11-19';
const ob={requestId:'ob1',purpose:'Seminar',destination:'Training venue',startsAt:'2026-11-19T09:00:00+08:00',endsAt:'2026-11-19T17:00:00+08:00'};
test('approved OB produces DTR remark without generating a slot',()=>{
 const result=buildObDtrRemarks(date,[ob],[]);
 assert.equal(result.length,1);assert.match(result[0].remark,/09:00.*17:00/);
 assert.equal(result[0].actualGateReturn,undefined);
 assert.equal(result[0].slot,undefined);
});
test('6 PM return is a review exception, not automatic overtime or departure',()=>{
 const result=buildObDtrRemarks(date,[ob],[{schoolDate:date,eventType:'TIME_IN',occurredAt:'2026-11-19T18:00:00+08:00'}]);
 assert.equal(result[0].exception,'RETURN_AFTER_APPROVED_END_REVIEW');
 assert.equal(result[0].exceptionRemark,'Gate re-entry 18:00 (1h 00m after OB end).');
 assert.equal(result[0].slot,undefined);
});
test('gate exits and unrelated days do not create return remarks',()=>{
 const events=[{schoolDate:date,eventType:'TIME_OUT',occurredAt:'2026-11-19T18:00:00+08:00'}];
 assert.equal(buildObDtrRemarks(date,[ob],events)[0].exception,undefined);
 assert.equal(buildObDtrRemarks('2026-11-20',[ob],events).length,0);
});
test('unapproved OB is never supplied to the formatter by report query',()=>{
 assert.deepEqual(buildObDtrRemarks(date,[],[]),[]);
});

test('very late OB gate re-entry has a short, exact delay without suggesting overtime',()=>{
 const sample={requestId:'ob2',startsAt:'2026-11-18T00:39:00+08:00',endsAt:'2026-11-18T02:39:00+08:00'};
 const result=buildObDtrRemarks('2026-11-18',[sample],[{
  schoolDate:'2026-11-18',eventType:'TIME_IN',occurredAt:'2026-11-18T15:46:00+08:00'
 }]);
 assert.equal(result[0].remark,'Approved OB 00:39–02:39');
 assert.equal(result[0].exceptionRemark,'Gate re-entry 15:46 (13h 07m after OB end).');
 assert.equal(result[0].exception,'RETURN_AFTER_APPROVED_END_REVIEW');
 assert.equal(result[0].slot,undefined);
 assert.doesNotMatch(result[0].exceptionRemark,/overtime|undertime|completed business/i);
});
test('sub-hour delayed return states minutes only',()=>{
 const result=buildObDtrRemarks(date,[ob],[{
  schoolDate:date,eventType:'TIME_IN',occurredAt:'2026-11-19T17:25:00+08:00'
 }]);
 assert.equal(result[0].exceptionRemark,'Gate re-entry 17:25 (25m after OB end).');
});


test('next morning entry is evidence for separate attendance, never prior PM_OUT',()=>{
 const request={requestId:'overnight',startsAt:'2026-11-25T16:26:00+08:00',endsAt:'2026-11-25T17:26:00+08:00'};
 const gate=[{schoolDate:'2026-11-25',eventType:'TIME_OUT',occurredAt:'2026-11-25T16:26:00+08:00'},
 {schoolDate:'2026-11-26',eventType:'TIME_IN',occurredAt:'2026-11-26T07:45:00+08:00'}];
 const now=Date.parse('2026-11-26T08:00:00+08:00');
 const prior=buildObDtrRemarks('2026-11-25',[request],gate,now)[0];
 assert.equal(prior.exception,'OB_NO_SAME_DAY_RETURN_REVIEW');
 assert.match(prior.exceptionRemark,/separate gate entry/);
 assert.equal(prior.actualGateReturn,undefined);assert.equal(prior.slot,undefined);
 assert.equal(prior.nextDayGateEntry,gate[1].occurredAt);
 assert.deepEqual(buildObDtrRemarks('2026-11-26',[request],gate,now),[]);
 assert.equal(buildObDtrRemarks('2026-11-25',[request],gate.slice(0,1),now)[0].exception,'OB_NO_SAME_DAY_RETURN_REVIEW');
 assert.equal(buildObDtrRemarks('2026-11-25',[request],gate.slice(0,1),Date.parse('2026-11-25T17:00:00+08:00'))[0].exception,undefined);
 assert.equal(buildObDtrRemarks('2026-11-25',[request],gate.slice(1),now)[0].exception,undefined);
});
