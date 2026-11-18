'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {validHours,summarizeForm48}=require('../form48-calculations');
const {readBody}=require('../form48-review-routes');
const times={AM_IN:'08:00',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'17:00'};
function month(opts={}){
 return summarizeForm48({month:'2026-02',today:'2026-02-05',settings:{
  workdays:[1,2,3,4,5],regularHours:times,saturdayHours:{},dayReviews:{},...opts.settings},
  records:opts.records||[],calendar:opts.calendar||[],officialBusiness:opts.officialBusiness||[],leave:opts.leave||null});
}
test('Form 48 time rules require four ordered real clock values',()=>{
 assert.equal(validHours(times),true);
 assert.equal(validHours({...times,AM_OUT:'07:30'}),false);
 assert.equal(validHours({...times,PM_OUT:'not-a-time'}),false);
});
test('verified punches calculate tardiness and early departures without inventing missing entries',()=>{
 const r=month({records:[{date:'2026-02-02',slots:{AM_IN:'08:12',AM_OUT:'11:55',PM_IN:'13:03',PM_OUT:'16:50'}}]});
 assert.equal(r.summary.daysPresent,1);
 assert.equal(r.summary.daysAbsent,0);
 assert.equal(r.summary.tardyMinutes,15);
 assert.equal(r.summary.undertimeMinutes,15);
 assert.equal(r.summary.tardyDays,1);
 assert.equal(r.summary.undertimeDays,1);
 assert.equal(r.summary.pendingAbsentDays,2); // Tue/Wed are unreviewed, Thu is today.
});
test('missing verified DTR is pending review, not a confirmed absence',()=>{
 const a=month();
 assert.equal(a.summary.daysAbsent,0);
 assert.ok(a.summary.pendingAbsentDays>0);
 assert.ok(a.assessments.some(x=>x.status==='MISSING_REVIEW'));
 assert.equal(a.assessments.find(x=>x.date==='2026-02-05').status,'NOT_DUE');
});
test('School Admin-reviewed absence and excusal are distinct and dated',()=>{
 const r=month({settings:{dayReviews:{'2026-02-02':'ABSENT','2026-02-03':'EXCUSED'}}});
 assert.equal(r.summary.daysAbsent,1);
 assert.equal(r.summary.excusedDays,1);
 assert.equal(r.summary.pendingAbsentDays,1);
});
test('closures and approved Official Business block automatic absence determination',()=>{
 const r=month({calendar:[{date:'2026-02-02',type:'CLOSED'}],
  officialBusiness:[{from:'2026-02-03',to:'2026-02-03'}]});
 assert.equal(r.assessments.find(x=>x.date==='2026-02-02').scheduled,false);
 assert.equal(r.assessments.find(x=>x.date==='2026-02-03').status,'APPROVED_OB_REVIEW');
 assert.equal(r.summary.pendingAbsentDays,1);
 assert.equal(r.summary.daysAbsent,0);
});
test('partial verified attendance shows a present day and an incomplete record warning',()=>{
 const r=month({records:[{date:'2026-02-02',slots:{PM_IN:'13:30'}}]});
 assert.equal(r.summary.daysPresent,1);
 assert.equal(r.summary.partialRecordDays,1);
 assert.equal(r.summary.tardyMinutes,30);
 assert.equal(r.summary.daysAbsent,0);
});
test('without a prescribed schedule, time totals remain unavailable, not zero',()=>{
 const r=summarizeForm48({month:'2026-02',today:'2026-02-05',
  records:[{date:'2026-02-02',slots:{AM_IN:'08:01'}}]});
 assert.equal(r.summary.configured,false);
 assert.equal(r.summary.tardyMinutes,null);
 assert.equal(r.summary.undertimeMinutes,null);
 assert.equal(r.summary.daysAbsent,0);
});
test('form review save payload is school-admin validated and cannot claim a name as approval',()=>{
 const good={body:{staffUserId:'22222222-2222-4222-8222-222222222222',month:'2026-02',
  workdays:[1,2,3,4,5],regularHours:times,saturdayHours:{},
  dayReviews:{'2026-02-02':'ABSENT'},verifiedBy:'In Charge Example',approvedBy:'School Head Example',revision:0}};
 assert.equal(readBody(good).approvedBy,'School Head Example');
 assert.equal(readBody({...good,body:{...good.body,verifiedPosition:'Administrative Officer',approvedPosition:'School Principal'}}).approvedPosition,'School Principal');
 assert.equal(readBody({...good,body:{...good.body,approvedPosition:'x'.repeat(121)}}),null);
 assert.equal(readBody({...good,body:{...good.body,dayReviews:{'2026-02-31':'ABSENT'}}}),null);
 assert.equal(readBody({...good,body:{...good.body,workdays:[1,1]}}),null);
 assert.equal(readBody({...good,body:{...good.body,verifiedBy:'x'.repeat(121)}}),null);
});
test('server restricts Form 48 draft writes to administrators, school scope and audit',()=>{
 const src=fs.readFileSync('form48-review-routes.js','utf8');
 assert.match(src,/requireSchoolRoles\('SCHOOL_ADMIN'\)/);
 assert.match(src,/staff_user_id=\$2/);
 assert.match(src,/staff_attendance_audit/);
 assert.match(src,/FORM48_DRAFT_UPDATED/);
 assert.match(src,/revision=\$13/);
 assert.match(src,/verification_status='VERIFIED'/);
 const css=fs.readFileSync('public/form48-report.css','utf8');
 const html=fs.readFileSync('public/portal.html','utf8');
 const js=fs.readFileSync('public/form48-report.js','utf8');
 for(const id of ['form48VerifiedBy','form48ApprovedBy','form48VerifiedPosition','form48ApprovedPosition','form48ReviewDays','form48ReportSettings','form48ScheduleDetails']){
  assert.ok(html.includes('id="'+id+'"'),id);
 }
 assert.match(js,/Draft names are NOT electronic signatures/);
 assert.match(css,/\.form48-settings-panel/);
 assert.match(html,/<details id="form48ScheduleDetails" class="form48-schedule-details">/);
 assert.doesNotMatch(html,/<details id="form48ReportSettings"/);
 assert.match(js,/form48-signer-position/);
 assert.match(js,/analysis\.signatories\?\.approvedPosition/);
 assert.match(js,/updateScheduleSummary/);
 assert.match(src,/verified_by_position/);
 assert.match(src,/approved_by_position/);
});
