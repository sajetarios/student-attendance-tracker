'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {buildForm48LeaveRemarks}=require('../form48-leave-remarks');
const fake={from:'2026-12-01',to:'2026-12-02',leaveType:'VACATION',approvalReference:'234'};
test('approved December vacation leave prints exact dates, abbreviation, and approval reference',()=>{
 const notes=buildForm48LeaveRemarks('2026-12',[fake],[]);
 assert.equal(notes.length,1);
 assert.equal(notes[0].text,'Dec 1–2 — Approved VL (Ref. 234).');
 assert.deepEqual(notes[0].conflictDates,[]);
 assert.equal(buildForm48LeaveRemarks('2026-11',[fake],[]).length,0);
});
test('date range is month-scoped but approval spans other reporting months',()=>{
 const leave={from:'2026-11-20',to:'2027-02-14',leaveType:'MATERNITY',approvalReference:'MAT-01'};
 assert.equal(buildForm48LeaveRemarks('2026-11',[leave])[0].text,'Nov 20–30 — Approved Maternity Leave (Ref. MAT-01).');
 assert.equal(buildForm48LeaveRemarks('2026-12',[leave])[0].text,'Dec 1–31 — Approved Maternity Leave (Ref. MAT-01).');
 assert.equal(buildForm48LeaveRemarks('2027-01',[leave])[0].text,'Jan 1–31 — Approved Maternity Leave (Ref. MAT-01).');
 assert.equal(buildForm48LeaveRemarks('2027-02',[leave])[0].text,'Feb 1–14 — Approved Maternity Leave (Ref. MAT-01).');
});
test('single day, sick leave, non-vacation types and invalid month',()=>{
 const sl={from:'2026-12-08',to:'2026-12-08',leaveType:'SICK',approvalReference:'FORM6-9'};
 assert.equal(buildForm48LeaveRemarks('2026-12',[sl])[0].text,'Dec 8 — Approved SL (Ref. FORM6-9).');
 assert.equal(buildForm48LeaveRemarks('2026-13',[sl]).length,0);
 assert.equal(buildForm48LeaveRemarks('2026-12',[{...sl,from:'bad'}]).length,0);
});
test('verified DTR punches on an approved leave day produce a conflict annotation, not invented times',()=>{
 const days=[
  {date:'2026-12-01',verifiedCount:0,status:'APPROVED_LEAVE'},
  {date:'2026-12-02',verifiedCount:1,status:'LEAVE_PUNCH_CONFLICT'},
  {date:'2026-12-03',verifiedCount:4,status:'VERIFIED'}
 ];
 const notes=buildForm48LeaveRemarks('2026-12',[fake],days);
 assert.deepEqual(notes[0].conflictDates,['2026-12-02']);
 assert.equal(notes[0].text,'Dec 1–2 — Approved VL (Ref. 234).');
 assert.equal('slots' in notes[0],false);
});
test('Form 48 report uses same HTML-escaped leave remarks in both copies',()=>{
 const root=path.join(__dirname,'..');
 const front=fs.readFileSync(path.join(root,'public/form48-report.js'),'utf8');
 const api=fs.readFileSync(path.join(root,'form48-review-routes.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'public/portal.html'),'utf8');
 const sw=fs.readFileSync(path.join(root,'public/sw.js'),'utf8');
 assert.match(front,/const leaveEntries=Array\.isArray\(analysis\.approvedLeaveRemarks\)/);
 assert.match(front,/esc\(item\.text\)/);
 assert.match(front,/hasLeaveConflicts/);
 assert.match(front,/DRAFT — PERIOD NOT COMPLETE/);
 assert.match(front,/window\.attendigoForm48RenderCopy=copy/);
 assert.match(front,/copy\(data,analysis,"Office's"\)\+copy\(data,analysis,"Employee's"\)/);
 assert.match(api,/buildForm48LeaveRemarks\(params\.month,approvedLeaves\.rows,analysis\.assessments\)/);
 assert.match(api,/approvedLeaveRemarks,asOfDate:manilaDate\(\)/);
 assert.match(api,/leave_type AS \\"leaveType\\"/);
 assert.match(api,/approval_reference AS \\"approvalReference\\"/);
 assert.match(api,/school_id=\$1 AND staff_user_id=\$2 AND revoked_at IS NULL/);
 assert.match(html,/form48-report\.js\?v=7/);
 assert.match(sw,/form48-report\.js\?v=7/);
 assert.match(sw,/form48-report\.css\?v=7/);
});
