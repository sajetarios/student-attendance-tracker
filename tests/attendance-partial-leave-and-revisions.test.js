'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseRequest,allowReviewer}=require('../staff-leave-policy');
const {parseRevision,planRevision}=require('../staff-leave-revisions');
const {summarizeForm48}=require('../form48-calculations');
const {buildForm48LeaveRemarks}=require('../form48-leave-remarks');
const date='2026-11-25',hours={AM_IN:'08:00',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'17:00'};
const base={leaveType:'SICK',creditAccount:'VSC',startDate:date,endDate:date,reason:'Eligible documented sick leave'};
const am={from:date,to:date,leaveSession:'AM',sessionStart:'08:00',sessionEnd:'12:00',leaveType:'SICK',creditAccount:'VSC'};
const pm={...am,leaveSession:'PM',sessionStart:'13:00',sessionEnd:'17:00'};
const result=(leaves,slots={},ob=[],settings={})=>summarizeForm48({month:'2026-11',today:'2026-11-26',settings:{workdays:[3],regularHours:hours,...settings},approvedLeaves:leaves,records:[{date,slots}],officialBusiness:ob});
const day=r=>r.assessments.find(a=>a.date===date);
test('half-day must be explicit, eligible and single-date; legacy remains full',()=>{
 assert.equal(parseRequest(base).leaveSession,'FULL');
 assert.equal(parseRequest({...base,leaveSession:'AM'}).leaveSession,'AM');
 assert.equal(parseRequest({...base,leaveSession:'PM',endDate:'2026-11-26'}),null);
 assert.equal(parseRequest({...base,leaveType:'MATERNITY',creditAccount:'NONE',leaveSession:'AM'}),null);
});
test('morning leave + afternoon duty preserves verified afternoon tardiness and half-day leave',()=>{
 const r=result([am],{PM_IN:'13:10',PM_OUT:'17:00'});
 assert.equal(day(r).status,'PARTIAL_APPROVED_LEAVE');
 assert.equal(day(r).lateMinutes,10);assert.equal(r.summary.approvedLeaveDays,0.5);assert.equal(r.summary.daysPresent,0.5);
 assert.deepEqual(buildForm48LeaveRemarks('2026-11',[am],r.assessments)[0].conflictDates,[]);
});
test('afternoon leave + morning duty preserves verified morning undertime',()=>{
 const r=result([pm],{AM_IN:'08:00',AM_OUT:'11:45'});
 assert.equal(day(r).undertimeMinutes,15);assert.equal(r.summary.approvedLeaveDays,0.5);
});
test('missing remaining session or changed prescribed hours requires evidence review',()=>{
 assert.equal(day(result([am],{})).needsReview,true);
 assert.equal(day(result([am],{PM_IN:'13:00',PM_OUT:'17:00'},[],{regularHours:{...hours,AM_IN:'07:30'}})).needsReview,true);
});
test('verified punches in the approved half-day remain a conflict without attendance credit',()=>{
 const r=result([am],{AM_IN:'08:00',PM_IN:'13:00',PM_OUT:'17:00'});
 assert.equal(day(r).status,'LEAVE_PUNCH_CONFLICT');assert.equal(r.summary.daysPresent,0);
 assert.deepEqual(buildForm48LeaveRemarks('2026-11',[am],r.assessments)[0].conflictDates,[date]);
});
test('distinct AM and PM leave sessions total one day, duplicate session needs review',()=>{
 assert.equal(result([am,pm]).summary.approvedLeaveDays,1);
 assert.equal(day(result([am,am])).needsReview,true);
});
test('disjoint afternoon OB and morning leave remain independent; intersecting OB conflicts',()=>{
 const ob=(start,end)=>({startsAt:date+'T'+start+':00+08:00',endsAt:date+'T'+end+':00+08:00'});
 const clean=result([am],{},[ob('13:00','17:00')]);assert.equal(day(clean).authorizationConflict,false);assert.equal(clean.summary.approvedLeaveDays,0.5);assert.equal(day(clean).needsReview,true);
 assert.equal(day(result([am],{},[ob('10:00','14:00')])).status,'OB_LEAVE_CONFLICT');
});
const row={status:'APPROVED',revision:3,requester_role:'TEACHER',staff_user_id:'employee',leave_session:'FULL',start_date:'2026-11-23',end_date:'2026-11-27',certified_working_days:'5.000',credit_account:'VSC'};
const input={decision:'SHORTEN',endDate:'2026-11-25',certifiedWorkingDays:3,approvalReference:'SIGNED-1',reason:'Authorized early return',documentId:'a6831ee2-24db-42b2-9d27-39d130eb11f1',revision:3,approvedOn:'2026-11-26',approverName:'Authorized officer',approverPosition:'Principal',evidenceVerified:true};
const ledger=[{entry_kind:'USED',credit_account:'VSC',signed_days:'-5.000'}];
test('only documented revision can restore the unused net credit; stale or ambiguous ledger rejected',()=>{
 assert.equal(parseRevision({...input,evidenceVerified:false}),null);
 assert.equal(planRevision(row,parseRevision(input),ledger).restoredDays,2);
 assert.equal(planRevision({...row,revision:4},parseRevision(input),ledger),null);
 assert.equal(planRevision(row,parseRevision(input),[]),null);
 assert.equal(planRevision(row,parseRevision({...input,endDate:'2026-11-30'}),ledger),null);
 assert.equal(planRevision({...row,credit_account:'NONE'},parseRevision(input),[]).restoredDays,0);
});
test('cancellation restores original net debit once, and no applicant or Department Head can authorize it',()=>{
 const cancel=parseRevision({...input,decision:'CANCEL'});
 assert.equal(planRevision(row,cancel,ledger).restoredDays,5);
 assert.equal(planRevision({...row,status:'CANCELLED'},cancel,ledger),null);
 assert.equal(allowReviewer('PRINCIPAL','reviewer',null,row,'REVISION'),true);
 assert.equal(allowReviewer('PRINCIPAL','employee',null,row,'REVISION'),false);
 assert.equal(allowReviewer('DEPARTMENT_HEAD','reviewer',null,row,'REVISION'),false);
 assert.equal(allowReviewer('SCHOOL_ADMIN','reviewer',null,{...row,requester_role:'PRINCIPAL'},'REVISION'),true);
});

test('duty-side manual verification accepts only opposite session and valid local time',()=>{
 const {dutySlotWithinSession}=require('../staff-leave-sessions');
 const a={leaveSession:'AM',leaveStart:'08:00',leaveEnd:'12:00',dutyStart:'13:00',dutyEnd:'17:00'};
 assert.equal(dutySlotWithinSession({...a,slot:'PM_IN',time:'12:55'}),true);
 assert.equal(dutySlotWithinSession({...a,slot:'PM_OUT',time:'17:20'}),true);
 assert.equal(dutySlotWithinSession({...a,slot:'AM_IN',time:'08:00'}),false);
 assert.equal(dutySlotWithinSession({...a,slot:'PM_IN',time:'11:45'}),false);
 const p={leaveSession:'PM',leaveStart:'13:00',leaveEnd:'17:00',dutyStart:'08:00',dutyEnd:'12:00'};
 assert.equal(dutySlotWithinSession({...p,slot:'AM_OUT',time:'12:05'}),true);
 assert.equal(dutySlotWithinSession({...p,slot:'AM_OUT',time:'17:20'}),false);
});
