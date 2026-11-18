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
