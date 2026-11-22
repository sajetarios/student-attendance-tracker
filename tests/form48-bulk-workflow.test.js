'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {summarizeForm48}=require('../form48-calculations');
const {readDefaults,readSchoolSignatories,readLeave,validDate,mergeSchoolForm48Defaults}=require('../form48-bulk-routes');
const times={AM_IN:'08:00',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'17:00'};
const punch=(date,changes={})=>({date,slots:{...times,...changes}});
const settings={workdays:[1,2,3,4,5],regularHours:times,saturdayHours:{},dayReviews:{
 '2026-11-09':'ABSENT','2026-11-10':'ABSENT'}};
test('reference November scenario: holidays, leave, OB, incomplete punches and separate minute totals',()=>{
 const full=[
  punch('2026-11-12',{AM_IN:'08:12'}),
  punch('2026-11-13',{PM_OUT:'16:42'}),
  punch('2026-11-16',{AM_IN:'08:09',PM_OUT:'16:50'}),
  punch('2026-11-17',{AM_IN:'08:20',PM_IN:'13:15'}),
  punch('2026-11-18',{AM_IN:'08:07'}),
  punch('2026-11-19',{AM_OUT:'11:50'}),
  ...['20','23','24','25','26','27'].map(d=>punch('2026-11-'+d))
 ];
 const result=summarizeForm48({month:'2026-11',today:'2026-12-01',settings,
  records:[...full,{date:'2026-11-11',slots:{PM_IN:'13:00'}}],
  calendar:[{date:'2026-11-02',type:'CLOSED'},{date:'2026-11-30',type:'CLOSED'}],
  approvedLeaves:[{from:'2026-11-03',to:'2026-11-04'}],
  officialBusiness:[{from:'2026-11-05',to:'2026-11-06'}]});
 assert.equal(result.summary.scheduledDays,19);
 assert.equal(result.summary.daysPresent,13); // Includes one day with partial evidence.
 assert.equal(result.summary.partialRecordDays,1);
 assert.equal(result.summary.daysAbsent,2);
 assert.equal(result.summary.excusedDays,2);
 assert.equal(result.summary.approvedLeaveDays,2);
 assert.equal(result.summary.pendingAbsentDays,0);
 assert.equal(result.summary.tardyMinutes,63);
 assert.equal(result.summary.undertimeMinutes,38);
 assert.equal(result.assessments.find(d=>d.date==='2026-11-03').status,'APPROVED_LEAVE');
 assert.equal(result.assessments.find(d=>d.date==='2026-11-05').status,'APPROVED_OB_REVIEW');
 assert.equal(result.assessments.find(d=>d.date==='2026-11-11').status,'INCOMPLETE_DTR');
 assert.equal(result.assessments.find(d=>d.date==='2026-11-30').scheduled,false);
 assert.equal(result.summary.hasUnreviewed,true); // OB and incomplete scans need review.
});
test('authorized leave carries across month boundaries, without a fabricated punch',()=>{
 const start=summarizeForm48({month:'2026-11',today:'2026-12-01',settings,
  approvedLeaves:[{from:'2026-11-20',to:'2027-02-14'}]});
 const next=summarizeForm48({month:'2026-12',today:'2027-01-01',settings,
  approvedLeaves:[{from:'2026-11-20',to:'2027-02-14'}]});
 assert.equal(start.assessments.find(d=>d.date==='2026-11-23').status,'APPROVED_LEAVE');
 assert.equal(next.assessments.find(d=>d.date==='2026-12-04').status,'APPROVED_LEAVE');
 assert.equal(start.summary.daysPresent,0);
 assert.ok(start.summary.approvedLeaveDays>0);
});
test('leave plus a verified punch needs review, preserves verified evidence',()=>{
 const res=summarizeForm48({month:'2026-11',today:'2026-12-01',settings,
  approvedLeaves:[{from:'2026-11-18',to:'2026-11-18'}],
  records:[punch('2026-11-18')]});
 const day=res.assessments.find(d=>d.date==='2026-11-18');
 assert.equal(day.status,'LEAVE_PUNCH_CONFLICT');
 assert.equal(day.verifiedCount,4);
 assert.equal(day.needsReview,true);
 assert.equal(res.summary.approvedLeaveDays,0);
});
test('timestamps remain in their verified slots, even intentional night test scans',()=>{
 const res=summarizeForm48({month:'2026-11',today:'2026-12-01',settings,
  records:[{date:'2026-11-18',slots:{AM_IN:'23:46'}}]});
 const day=res.assessments.find(d=>d.date==='2026-11-18');
 assert.equal(day.verifiedCount,1);
 assert.equal(day.status,'TIME_SLOT_REVIEW');
 assert.equal(day.needsReview,true);
 assert.equal(res.summary.timeAnomalyDays,1);
 assert.equal(res.summary.tardyMinutes,0); // Preserve the punch, do not charge 15+ hours as tardiness.
 const afterMidnight=summarizeForm48({month:'2026-11',today:'2026-12-01',settings,
  records:[{date:'2026-11-19',slots:{AM_IN:'00:30'}}]});
 assert.equal(afterMidnight.summary.timeAnomalyDays,1);
 assert.equal(afterMidnight.summary.tardyMinutes,0);
});
test('school-wide signatories override previous employee/month settings',()=>{
 const defaults={workdays:[1,2,3,4,5],regularHours:times,saturdayHours:{},
  verifiedBy:'Administrative Officer',verifiedPosition:'In Charge',
  approvedBy:'Principal',approvedPosition:'School Principal'};
 const newStaff=mergeSchoolForm48Defaults(null,defaults);
 assert.equal(newStaff.verifiedBy,'Administrative Officer');
 assert.equal(newStaff.approvedBy,'Principal');
 assert.deepEqual(newStaff.regularHours,times);
 const prior=mergeSchoolForm48Defaults({configured:true,revision:2,workdays:[1,2,3,4,5],
  regularHours:times,saturdayHours:{},verifiedBy:'Other authorized signer',approvedBy:''},defaults);
 assert.equal(prior.verifiedBy,'Administrative Officer');
 assert.equal(prior.approvedBy,'Principal');
 assert.equal(prior.revision,2);
 assert.equal(mergeSchoolForm48Defaults({verifiedBy:'Legacy'},null).verifiedBy,'Legacy');
 assert.equal(mergeSchoolForm48Defaults({verifiedBy:'Legacy'},{...defaults,verifiedBy:''}).verifiedBy,'');
});
test('bulk leave validates dates, authorization references and input bounds',()=>{
 const id='22222222-2222-4222-8222-222222222222';
 const value={staffUserId:id,startDate:'2026-11-03',endDate:'2027-02-14',
  leaveType:'MATERNITY',approvalReference:'APPROVED-FORM-6-01'};
 assert.deepEqual(readLeave(value),value);
 assert.equal(readLeave({...value,endDate:'2026-11-00'}),null);
 assert.equal(readLeave({...value,endDate:'2026-10-31'}),null);
 assert.equal(readLeave({...value,approvalReference:''}),null);
 assert.equal(readLeave({...value,leaveType:'NOT_APPROVED'}),null);
 assert.equal(validDate('2026-02-30'),false);
 assert.equal(readDefaults({revision:0,workdays:[1,2,3,4,5],regularHours:times,
  saturdayHours:{},verifiedBy:'Principal',approvedBy:'In Charge'}).revision,0);
 assert.equal(readDefaults({revision:0,workdays:[1,1],regularHours:times,saturdayHours:{}}),null);
});
test('batch records are tenant scoped, locked, audited, and reversible without DTR edits',()=>{
 const src=fs.readFileSync(path.join(__dirname,'..','form48-bulk-routes.js'),'utf8');
 const sql=fs.readFileSync(path.join(__dirname,'..','migrations','057_staff_form48_school_defaults_and_leaves.sql'),'utf8');
 const calc=fs.readFileSync(path.join(__dirname,'..','form48-review-routes.js'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,'..','public','portal.html'),'utf8');
 const client=fs.readFileSync(path.join(__dirname,'..','public','form48-bulk-ui.js'),'utf8');
 const sw=fs.readFileSync(path.join(__dirname,'..','public','sw.js'),'utf8');
 assert.match(src,/requireSchoolRoles\('SCHOOL_ADMIN'\)/);
 assert.match(src,/FOR UPDATE/);
 assert.match(src,/staff_attendance_audit/);
 assert.match(src,/staff_form48_approved_leaves/);
 assert.match(src,/revoked_at=NOW\(\)/);
 assert.match(src,/ON CONFLICT \(school_id\) DO UPDATE/);
 assert.match(sql,/FOREIGN KEY \(school_id,staff_user_id\)/);
 assert.doesNotMatch(src,/UPDATE\s+staff_attendance_events/i);
 assert.match(calc,/approvedLeaves:approvedLeaves\.rows/);
 for(const id of ['form48BatchPanel','form48EmployeeSearch','form48BatchPrint','form48BatchRecordLeave',
  'form48SaveSchoolDefaults','form48LeaveCertified'])assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(client,/form48\/leaves\/batch/);
 assert.match(client,/form48\/defaults/);
 assert.match(sw,/form48-bulk-ui\.js\?v=2/);
});

test('school certification requires complete and safe school-wide signatories',()=>{
 const good={revision:0,verifiedBy:'In Charge',verifiedPosition:'Administrative Officer',
  approvedBy:'Principal',approvedPosition:'School Principal'};
 assert.deepEqual(readSchoolSignatories(good),good);
 assert.equal(readSchoolSignatories({...good,approvedPosition:''}),null);
 assert.equal(readSchoolSignatories({...good,approvedBy:'A\nB'}),null);
 assert.equal(readSchoolSignatories({...good,verifiedBy:'X'.repeat(121)}),null);
 assert.equal(readSchoolSignatories({...good,revision:-1}),null);
});
test('school signatories are audited and never edit an employee DTR or schedule',()=>{
 const src=fs.readFileSync(path.join(__dirname,'..','form48-bulk-routes.js'),'utf8');
 const section=src.slice(src.indexOf("app.put('/api/staff-attendance/admin/form48/signatories'"),
  src.indexOf("app.get('/api/staff-attendance/admin/form48/leaves'"));
 assert.match(section,/\.\.\.admin/);
 assert.match(section,/FORM48_SCHOOL_SIGNATORIES_UPDATED/);
 assert.match(section,/staff_attendance_audit/);
 assert.match(section,/staff_form48_school_defaults\.revision\+1/);
 assert.doesNotMatch(section,/staff_attendance_events|day_reviews|regular_hours=|saturday_hours=/);
});
