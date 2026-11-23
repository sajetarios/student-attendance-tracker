'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {sickFilingBasis,sickAccountForScheme,requiredSickEvidence,SCHEMES}=
 require('../staff-leave-deped-sick');
const {summarizeForm48}=require('../form48-calculations');
const {buildForm48LeaveRemarks}=require('../form48-leave-remarks');
const {parseRequest}=require('../staff-leave-policy');
const read=p=>fs.readFileSync(require('node:path').join(__dirname,'..',p),'utf8');
const hours={AM_IN:'07:00',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'16:00'};
const settings={workdays:[1,2,3,4,5],regularHours:hours,saturdayHours:{},dayReviews:{}};
test('Section 53: sick leave may be filed immediately upon return, not only before absence',()=>{
 const p=sickFilingBasis('SICK','2026-11-19','2026-11-20','2026-11-23');
 assert.equal(p,'POST_RETURN');
 assert.equal(sickFilingBasis('SICK','2026-11-23','2026-11-24','2026-11-23'),'DURING_ABSENCE');
 assert.equal(sickFilingBasis('SICK','2026-12-01','2026-12-02','2026-11-23'),'ADVANCE');
 assert.equal(sickFilingBasis('VACATION','2026-11-19','2026-11-20','2026-11-23'),'STANDARD');
 assert.equal(parseRequest({leaveType:'SICK',creditAccount:'NONE',
  startDate:'2026-11-19',endDate:'2026-11-20',reason:'Fictional illness'}).leaveType,'SICK');
});
test('HR must certify teaching VSC versus regular SL; roles cannot infer an entitlement',()=>{
 assert.deepEqual([...SCHEMES],['TEACHING_VSC','REGULAR_VL_SL']);
 assert.equal(sickAccountForScheme('TEACHING_VSC'),'VSC');
 assert.equal(sickAccountForScheme('REGULAR_VL_SL'),'SL');
 assert.equal(sickAccountForScheme('UNVERIFIED'),null);
 assert.equal(sickAccountForScheme('TEACHER'),null);
 const routes=read('staff-leave-routes.js');
 assert.match(routes,/LEAVE_CREDIT_SCHEME_CERTIFIED/);
 assert.match(routes,/req\.auth\.role!=='SCHOOL_ADMIN'/);
 assert.match(routes,/if\(staffId===req\.auth\.userId\)/);
 assert.match(routes,/sickAccountForScheme\(verifiedScheme\)/);
 assert.match(routes,/sickAccountForScheme\(verifiedScheme\.rows\[0\]\?\.leaveScheme\)/);
 assert.match(routes,/HR must verify whether this employee uses teaching-personnel VSC/);
});
test('long or advance-filed sickness requires documentary evidence before official approval',()=>{
 assert.equal(requiredSickEvidence('SICK','POST_RETURN','2026-11-19','2026-11-20'),false);
 assert.equal(requiredSickEvidence('SICK','POST_RETURN','2026-11-16','2026-11-21'),true);
 assert.equal(requiredSickEvidence('SICK','ADVANCE','2026-12-01','2026-12-01'),true);
 assert.equal(requiredSickEvidence('SICK','DURING_ABSENCE','2026-11-23','2026-11-24'),false);
 assert.equal(requiredSickEvidence('VACATION','ADVANCE','2026-12-01','2026-12-10'),false);
 const routes=read('staff-leave-routes.js');
 assert.match(routes,/document_kind IN \('MEDICAL','AFFIDAVIT'\)/);
 assert.match(routes,/document_kind='APPROVAL'/);
 assert.match(routes,/if\(!chargeAccount\)/);
 assert.match(routes,/Insufficient HR-certified/);
});
test('Unapproved post-return sickness remains a pending Form48 review, not a paid or excused leave',()=>{
 const r=summarizeForm48({month:'2026-11',today:'2026-11-23',settings,
  pendingSickLeaves:[{from:'2026-11-19',to:'2026-11-20'}]});
 const nov19=r.assessments.find(a=>a.date==='2026-11-19');
 assert.equal(nov19.status,'SICK_LEAVE_PENDING');
 assert.equal(nov19.needsReview,true);
 assert.equal(r.summary.approvedLeaveDays,0);
 assert.equal(r.summary.excusedDays,0);
 assert.equal(r.summary.daysAbsent,0);
 assert.equal(r.summary.daysPresent,0);
});
test('A prior confirmed absence is not silently undone by an unapproved sick application',()=>{
 const r=summarizeForm48({month:'2026-11',today:'2026-11-23',
  settings:{...settings,dayReviews:{'2026-11-19':'ABSENT'}},
  pendingSickLeaves:[{from:'2026-11-19',to:'2026-11-19'}]});
 assert.equal(r.assessments.find(a=>a.date==='2026-11-19').status,'SICK_LEAVE_REVIEW_CONFLICT');
 assert.equal(r.summary.daysAbsent,1);
 assert.equal(r.summary.hasUnreviewed,true);
});
test('Only officially approved SICK leave charged to VSC prints VSCA in Form 48',()=>{
 const vsc={from:'2026-11-19',to:'2026-11-20',leaveType:'SICK',creditAccount:'VSC',
  approvalReference:'SIM-APPROVAL-01'};
 const sl={...vsc,creditAccount:'SL'};
 const unknown={...vsc,creditAccount:'NONE'};
 const notes=buildForm48LeaveRemarks('2026-11',[vsc],[]);
 assert.equal(notes[0].text,'Nov 19–20 — Approved VSCA (Vacation Service Credits Applied) (Ref. SIM-APPROVAL-01).');
 assert.equal(buildForm48LeaveRemarks('2026-11',[sl],[])[0].text,'Nov 19–20 — Approved SL (Ref. SIM-APPROVAL-01).');
 assert.equal(buildForm48LeaveRemarks('2026-11',[unknown],[])[0].text,'Nov 19–20 — Approved SL (Ref. SIM-APPROVAL-01).');
});
test('Leave approval changes no actual gate/DTR punch and stores certified charge for future reporting',()=>{
 const routes=read('staff-leave-routes.js');
 const report=read('form48-review-routes.js');
 assert.doesNotMatch(routes,/INSERT INTO teacher_gate_events/i);
 assert.doesNotMatch(routes,/UPDATE staff_attendance_events/i);
 assert.doesNotMatch(routes,/INSERT INTO staff_attendance_events/i);
 assert.match(routes,/staff_form48_approved_leaves\(leave_id,school_id,staff_user_id,leave_type,start_date,end_date,approval_reference,recorded_by_user_id,credit_account\)/);
 assert.match(report,/credit_account AS \\"creditAccount\\"/);
 assert.match(report,/pendingSickLeaves:pendingSickLeaves\.rows/);
 assert.match(read('public/form48-report.js'),/SICK_LEAVE_PENDING/);
});
test('Sensitive medical and notarized affidavit attachments are not shared with department staff',()=>{
 const routes=read('staff-leave-routes.js');
 assert.match(routes,/!\['MEDICAL','AFFIDAVIT'\]\.includes\(d\.document_kind\)/);
 assert.match(routes,/!\['MEDICAL','AFFIDAVIT'\]\.includes\(d\.documentKind\)/);
 assert.match(read('public/staff-leave-ui.js'),/Post-absence filing/);
 assert.match(read('public/leave-form6.js'),/filingBasis==='POST_RETURN'/);
});
