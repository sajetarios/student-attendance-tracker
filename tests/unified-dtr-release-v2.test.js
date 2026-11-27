'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {summarizeForm48}=require('../form48-calculations');
const date='2026-11-25';
const hours={AM_IN:'08:00',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'17:00'};
const settings={workdays:[3],regularHours:hours};
function run(slots,extra={}){
 const result=summarizeForm48({month:'2026-11',today:'2026-11-26',settings,records:[{date,slots}],...extra});
 return {day:result.assessments.find(x=>x.date===date),summary:result.summary};
}
test('single ordinary punch is evidence but not a full or half day of verified duty',()=>{
 const {day,summary}=run({AM_IN:'08:00'});
 assert.equal(day.status,'INCOMPLETE_DTR');assert.equal(day.needsReview,true);
 assert.equal(summary.daysPresent,0);assert.equal(summary.verifiedEvidenceDays,1);
});
test('only one complete morning or afternoon session is half-day evidence, not a full day',()=>{
 for(const slots of [{AM_IN:'08:00',AM_OUT:'12:00'},{PM_IN:'13:00',PM_OUT:'17:00'}]){
  const {day,summary}=run(slots);
  assert.equal(day.needsReview,true);assert.equal(summary.daysPresent,0.5);
  assert.equal(summary.verifiedPartialDutyDays,0.5);
 }
});
test('four plausible ordinary punches retain full verified day and independent penalties',()=>{
 const {day,summary}=run({...hours,AM_IN:'08:15',PM_OUT:'16:30'});
 assert.equal(day.status,'VERIFIED');assert.equal(day.needsReview,false);
 assert.equal(day.lateMinutes,15);assert.equal(day.undertimeMinutes,30);
 assert.equal(summary.daysPresent,1);assert.equal(summary.verifiedPartialDutyDays,0);
});
test('reversed arrival and departure cannot certify service or calculate a penalty',()=>{
 for(const slots of [{...hours,AM_IN:'11:30',AM_OUT:'09:00'},{...hours,PM_IN:'16:30',PM_OUT:'14:00'},{...hours,AM_OUT:'13:00',PM_IN:'12:30'}]){
  const {day,summary}=run(slots);
  assert.equal(day.status,'TIME_SLOT_REVIEW');assert.equal(day.needsReview,true);
  assert.equal(day.lateMinutes,0);assert.equal(day.undertimeMinutes,0);
  assert.equal(summary.daysPresent,0);
 }
});
test('approved OB with four punches is evidence, not ordinary completed service',()=>{
 const {day,summary}=run(hours,{officialBusiness:[{startsAt:date+'T14:00:00+08:00',endsAt:date+'T15:00:00+08:00'}]});
 assert.equal(day.status,'APPROVED_OB_REVIEW');assert.equal(day.needsReview,true);
 assert.equal(summary.daysPresent,0);assert.equal(summary.verifiedEvidenceDays,1);
});
test('report with configured workdays but missing prescribed hours cannot be ready for signature',()=>{
 const {summary}=run({}, {settings:{workdays:[3],regularHours:{},dayReviews:{'2026-11-04':'EXCUSED','2026-11-11':'EXCUSED','2026-11-18':'EXCUSED','2026-11-25':'EXCUSED'}}});
 assert.equal(summary.configured,true);assert.equal(summary.timeConfigured,false);
 assert.equal(summary.hasUnreviewed,true);assert.equal(summary.tardyMinutes,null);
});

test('pending non-sick leave is review-only and does not confer excusal or credit',()=>{
 const {day,summary}=run({}, {pendingOtherLeaves:[{from:date,to:date}]});
 assert.equal(day.status,'LEAVE_REVIEW');assert.equal(day.otherLeavePending,true);
 assert.equal(day.needsReview,true);assert.equal(summary.approvedLeaveDays,0);
 assert.equal(summary.excusedDays,0);assert.equal(summary.daysPresent,0);
});
test('pending non-sick leave does not erase an already confirmed absence',()=>{
 const {day,summary}=run({}, {settings:{...settings,dayReviews:{[date]:'ABSENT'}},pendingOtherLeaves:[{from:date,to:date}]});
 assert.equal(day.needsReview,true);assert.equal(day.review,'ABSENT');
 assert.equal(summary.daysAbsent,1);assert.equal(summary.approvedLeaveDays,0);
});
test('future pending non-sick leave does not change current attendance or confer credit',()=>{
 const {day,summary}=run({}, {today:'2026-11-24',pendingOtherLeaves:[{from:date,to:date}]});
 assert.equal(day.status,'NOT_DUE');assert.equal(day.needsReview,false);
 assert.equal(summary.approvedLeaveDays,0);
});

test('conflicting active office-hours memoranda cannot silently pick a schedule',()=>{
 const {day,summary}=run(hours,{scheduleAdjustments:[
  {from:date,to:date,hours},{from:date,to:date,hours:{...hours,AM_IN:'09:00'}}
 ]});
 assert.equal(day.status,'SCHEDULE_REVIEW');assert.equal(day.needsReview,true);
 assert.equal(summary.daysPresent,0);assert.equal(day.lateMinutes,0);
});
test('archived memorandum does not conflict with active adjustment',()=>{
 const {day}=run(hours,{scheduleAdjustments:[
  {from:date,to:date,hours,archivedDate:date},{from:date,to:date,hours}
 ]});
 assert.equal(day.status,'VERIFIED');assert.equal(day.needsReview,false);
});
test('shortened office day without certified hours cannot be ready for signature',()=>{
 const {day,summary}=run(hours,{calendar:[{date,type:'SHORTENED_DAY'}]});
 assert.equal(day.status,'SCHEDULE_REVIEW');assert.equal(day.needsReview,true);
 assert.equal(summary.hasUnreviewed,true);assert.equal(summary.daysPresent,0);
});
test('one valid shortened-hours memorandum is applied without inventing attendance',()=>{
 const {day,summary}=run({...hours,PM_OUT:'16:00'},{calendar:[{date,type:'SHORTENED_DAY'}],scheduleAdjustments:[{from:date,to:date,hours:{...hours,PM_OUT:'16:00'}}]});
 assert.equal(day.status,'VERIFIED');assert.equal(day.undertimeMinutes,0);assert.equal(summary.daysPresent,1);
});
test('pending sick leave with verified attendance is visible without granting leave',()=>{
 const {day,summary}=run(hours,{pendingSickLeaves:[{from:date,to:date}]});
 assert.equal(day.status,'SICK_LEAVE_PENDING');assert.equal(day.needsReview,true);
 assert.equal(summary.daysPresent,1);assert.equal(summary.approvedLeaveDays,0);
});

test('pending offline evidence blocks signature readiness without reassigning or fabricating punches',()=>{
 const {day,summary}=run(hours,{offlineObservations:[{date}]});
 assert.equal(day.status,'VERIFIED');assert.equal(day.offlineReview,true);
 assert.equal(day.needsReview,true);assert.equal(day.verifiedCount,4);
 assert.equal(summary.daysPresent,1);assert.equal(summary.offlineReviewDays,1);
 const clean=run(hours);assert.equal(clean.day.offlineReview,false);
 const next=run(hours,{offlineObservations:[{date:'2026-11-26'}]});
 assert.equal(next.day.offlineReview,false);
});
