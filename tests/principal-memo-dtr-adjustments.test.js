'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {summarizeForm48}=require('../form48-calculations');
const {readTemporaryHours,durationDays}=require('../school-memo-routes');

const normal={AM_IN:'07:30',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'16:30'};
const delayed={AM_IN:'08:30',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'16:30'};
const memo={memoId:'11111111-1111-4111-8111-111111111111',title:'Temporary reporting hours',
 from:'2026-11-25',to:'2026-11-26',archivedDate:null,hours:delayed};
const dates=['2026-11-25','2026-11-26','2026-11-27'];
const records=dates.map(date=>({date,slots:{AM_IN:'08:15',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'16:30'}}));
const settings={workdays:[1,2,3,4,5],regularHours:normal,saturdayHours:{},dayReviews:{}};
function calculate(options={}){
 return summarizeForm48({month:'2026-11',today:'2026-11-30',
  settings,records,calendar:[],...options});
}
test('temporary memorandum hours apply exactly within the inclusive window, then revert',()=>{
 const ordinary=calculate();
 assert.equal(ordinary.summary.tardyMinutes,135);
 const adjusted=calculate({scheduleAdjustments:[memo]});
 assert.equal(adjusted.summary.tardyMinutes,45);
 assert.equal(adjusted.assessments.find(a=>a.date==='2026-11-25').lateMinutes,0);
 assert.equal(adjusted.assessments.find(a=>a.date==='2026-11-26').lateMinutes,0);
 assert.equal(adjusted.assessments.find(a=>a.date==='2026-11-27').lateMinutes,45);
 assert.equal(adjusted.assessments.find(a=>a.date==='2026-11-26').temporaryMemoId,memo.memoId);
 assert.equal(adjusted.assessments.find(a=>a.date==='2026-11-27').temporaryMemoId,null);
 assert.deepEqual(records,dates.map(date=>({date,slots:{AM_IN:'08:15',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'16:30'}})));
});
test('archiving a memorandum stops future effects without rewriting earlier reporting days',()=>{
 const result=calculate({scheduleAdjustments:[{...memo,archivedDate:'2026-11-26'}]});
 assert.equal(result.summary.tardyMinutes,90);
 assert.equal(result.assessments.find(a=>a.date==='2026-11-25').lateMinutes,0);
 assert.equal(result.assessments.find(a=>a.date==='2026-11-26').lateMinutes,45);
});
test('leave and closure continue to take precedence over prescribed-hour memo',()=>{
 const leave=calculate({scheduleAdjustments:[memo],approvedLeaves:[{from:'2026-11-25',to:'2026-11-25',leaveType:'SICK'}]});
 assert.equal(leave.assessments.find(a=>a.date==='2026-11-25').status,'LEAVE_PUNCH_CONFLICT');
 assert.equal(leave.assessments.find(a=>a.date==='2026-11-25').lateMinutes,0);
 const closed=calculate({scheduleAdjustments:[memo],calendar:[{date:'2026-11-25',type:'CLOSED'}]});
 assert.equal(closed.assessments.find(a=>a.date==='2026-11-25').scheduled,false);
 assert.equal(closed.assessments.find(a=>a.date==='2026-11-25').status,'UNSCHEDULED_PUNCH');
});
test('temporary prescribed hours have strict four-slot and date validators',()=>{
 assert.deepEqual(readTemporaryHours(encodeURIComponent(JSON.stringify(delayed))),delayed);
 assert.equal(readTemporaryHours(encodeURIComponent(JSON.stringify({...delayed,PM_OUT:'12:00'}))),null);
 assert.equal(readTemporaryHours(encodeURIComponent(JSON.stringify({...delayed,FIFTH:'16:00'}))),null);
 assert.equal(readTemporaryHours('%not_json'),null);
 assert.equal(durationDays('2026-11-25','2026-11-25'),0);
 assert.equal(durationDays('2026-11-25','2026-11-26'),1);
});
test('memo DTR link requires principal, staff-only schedule notice, period and school scope',()=>{
 const source=fs.readFileSync('school-memo-routes.js','utf8');
 const html=fs.readFileSync('public/principal.html','utf8');
 const js=fs.readFileSync('public/principal-dashboard.js','utf8');
 const db=fs.readFileSync('migrations/081_school_memo_effective_period_and_dtr.sql','utf8');
 assert.match(source,/requireSchoolRoles\('PRINCIPAL'\)/);
 assert.match(source,/category!=='SCHEDULE_NOTICE'/);
 assert.match(source,/dtrRequested/);
 assert.match(source,/AUDIENCES=new Set\(\['ALL_USERS','SCHOOL_STAFF'\]\)/);
 assert.match(source,/pg_advisory_xact_lock/);
 assert.match(source,/MEMO_DTR_DATE_CONFLICT/);
 assert.match(source,/end_date/);
 assert.match(db,/CHECK \(end_date IS NULL/);
 for(const item of ['name="endDate"','id="principalMemoApplyDtr"','id="principalMemoDtrFields"'])
  assert.ok(html.includes(item),item);
 assert.match(js,/x-memo-end-date/);
 assert.match(js,/x-memo-apply-dtr/);
 assert.match(fs.readFileSync('form48-review-routes.js','utf8'),/scheduleAdjustments:memoAdjustments.rows/);
});
