'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {obCoverageForDate,calculateObBoundaryGaps}=require('../attendance-reconciliation');
const {summarizeForm48}=require('../form48-calculations');
const date='2026-11-25',hours={AM_IN:'08:00',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'17:00'};
const ob=(start,end,extra={})=>({startsAt:date+'T'+start+':00+08:00',endsAt:date+'T'+end+':00+08:00',...extra});
const analyze=(officialBusiness,slots={},approvedLeaves=[])=>summarizeForm48({
 month:'2026-11',today:'2026-11-26',settings:{workdays:[1,2,3,4,5],regularHours:hours},
 officialBusiness,approvedLeaves,records:[{date,slots}]
});
const day=result=>result.assessments.find(x=>x.date===date);
test('afternoon OB cannot waive independently verified morning tardiness',()=>{
 const result=analyze([ob('14:00','17:00')],{...hours,AM_IN:'08:25',PM_OUT:'14:00'});
 assert.equal(day(result).lateMinutes,25);
 assert.equal(day(result).undertimeMinutes,0);
 assert.equal(day(result).needsReview,true);
 assert.equal(result.summary.tardyMinutes,25);
});
test('early return to work does not automatically excuse uncovered departure after OB',()=>{
 const result=analyze([ob('09:00','10:00')],{...hours,PM_OUT:'16:40'});
 assert.equal(day(result).undertimeMinutes,20);
});
test('overlapping authorized intervals are unioned, not deducted twice',()=>{
 const coverage=obCoverageForDate(date,[ob('14:00','15:00'),ob('14:30','16:00')]);
 assert.deepEqual(coverage.intervals,[[840,960]]);
 assert.deepEqual(calculateObBoundaryGaps({...hours,PM_OUT:'14:00'},hours,coverage),
  {lateMinutes:0,undertimeMinutes:60,evaluatedSessions:2});
});
test('pending or rejected overnight completion does not extend coverage; verified completion does',()=>{
 const end='2026-11-26T09:00:00+08:00';
 for(const completionStatus of ['PENDING_HEAD','PENDING_PRINCIPAL','REJECTED']){
  assert.equal(obCoverageForDate('2026-11-26',[ob('16:00','17:00',{completionStatus,completionAt:end})]).approved,false);
 }
 assert.deepEqual(obCoverageForDate('2026-11-26',[ob('16:00','17:00',{completionStatus:'VERIFIED',completionAt:end})]).intervals,[[0,540]]);
});
test('OB ending exactly at Manila midnight does not spill into next month',()=>{
 const request={startsAt:'2026-11-30T16:00:00+08:00',endsAt:'2026-12-01T00:00:00+08:00'};
 assert.equal(obCoverageForDate('2026-11-30',[request]).approved,true);
 assert.equal(obCoverageForDate('2026-12-01',[request]).approved,false);
});
test('legacy date-only authorization remains review-only, no inferred timing penalty',()=>{
 const result=analyze([{from:date,to:date}],{...hours,AM_IN:'08:25'});
 assert.equal(day(result).lateMinutes,0);
 assert.equal(day(result).needsReview,true);
});
test('missing session boundary cannot create a penalty or an invented punch',()=>{
 const slots={AM_IN:'08:25',PM_IN:'13:00',PM_OUT:'17:00'};
 const result=analyze([ob('14:00','15:00')],slots);
 assert.equal(day(result).lateMinutes,0);
 assert.equal(day(result).verifiedCount,3);
 assert.equal(day(result).needsReview,true);
 assert.deepEqual(slots,{AM_IN:'08:25',PM_IN:'13:00',PM_OUT:'17:00'});
});
test('reversed session evidence requires review, not a penalty',()=>{
 const result=analyze([ob('14:00','15:00')],{...hours,AM_IN:'11:00',AM_OUT:'09:00'});
 assert.equal(day(result).lateMinutes,0);
 assert.equal(day(result).needsReview,true);
});
test('OB and documented leave overlapping without punches is an explicit conflict',()=>{
 const result=analyze([ob('14:00','17:00')],{},[{from:date,to:date,leaveType:'SICK'}]);
 assert.equal(day(result).status,'OB_LEAVE_CONFLICT');
 assert.equal(day(result).needsReview,true);
 assert.equal(result.summary.approvedLeaveDays,0);
 assert.equal(result.summary.daysPresent,0);
 assert.equal(result.summary.daysAbsent,0);
});
test('overlap with verified punches is not silently credited as ordinary attendance',()=>{
 const result=analyze([ob('14:00','17:00')],hours,[{from:date,to:date}]);
 assert.equal(day(result).status,'OB_LEAVE_CONFLICT');
 assert.equal(day(result).verifiedCount,4);
 assert.equal(result.summary.daysPresent,0);
});
