'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function uiPeriodSelector() {
  const folio = read('public/manual-folio.js');
  const match = folio.match(/state\.periods\s*=\s*\(ps\.periods\s*\|\|\s*\[\]\)\.filter\((p\s*=>[^;\n]+)\);/);
  assert.ok(match, 'Teacher class selection must be discoverable and testable');
  return new Function('ps', 'user', 'return (ps.periods || []).filter(' + match[1] + ');');
}

test('Teacher attendance UI retains every school-authorized class, even when teacher is adviser or substitute', () => {
  const select = uiPeriodSelector();
  const ps = {periods:[
    {periodId:'subject', section:'A',gradeLevel:'Grade 8',assignedTeacherUserId:'teacher-1'},
    {periodId:'advisory',section:'A',gradeLevel:'Grade 8',assignedTeacherUserId:'teacher-2'},
    {periodId:'substitute',section:'A',gradeLevel:'Grade 8',assignedTeacherUserId:'teacher-3'},
    {periodId:'invalid',section:'',gradeLevel:'Grade 8',assignedTeacherUserId:'teacher-1'}
  ]};
  const selected = select(ps,{userId:'teacher-1'}).map(p=>p.periodId);
  assert.deepEqual(selected,['subject','advisory','substitute']);
});

test('Period API remains the authorization boundary for teachers',()=>{
  const src=read('server.js');
  const start=src.indexOf("app.get('/api/periods'");
  assert.ok(start>=0);
  const handler=src.slice(start,src.indexOf("app.patch('/api/periods",start));
  assert.match(handler,/authenticateSchoolClient/);
  assert.match(handler,/requireSchoolRoles\('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER'\)/);
  assert.match(handler,/class_adviser_assignments ca/);
  assert.match(handler,/teacher_period_substitutions ts/);
  assert.match(handler,/schedule_day_adjustments a/);
  assert.match(handler,/p\.school_id=\$1/);
});

test('Manual attendance writes require the assigned class and reject finalized or stale marks',()=>{
  const src=read('manual-attendance-routes.js');
  assert.match(src,/requireSchoolRoles\('TEACHER'\)/);
  assert.match(src,/const period=await authorizedPeriod\(client,req,periodId,date\)/);
  assert.match(src,/This register is finalized\. Reopen it before editing marks/);
  assert.match(src,/STALE_MANUAL_MARK/);
  assert.match(src,/\bROLLBACK\b/);
});

test('Finalizing requires complete class coverage and resolved QR/manual conflicts',()=>{
  const src=read('class-finalization-routes.js');
  assert.match(src,/total!==completed/);
  assert.match(src,/Missing entries are not absences/);
  assert.match(src,/Resolve QR\/manual attendance conflicts before finalizing/);
  assert.match(src,/date>now/);
});

test('Offline draft is distinguishable from server-confirmed attendance in UI',()=>{
  const src=read('public/manual-folio.js');
  assert.match(src,/Saved on device/);
  assert.match(src,/Waiting to sync/);
  assert.match(src,/Verified in school records/);
  assert.match(src,/Server verification differs from your device/);
  assert.match(src,/await loadRemote\(\)/);
});

test('Official SF2 cannot be exported with pending, conflicting, or incomplete learner sex data',()=>{
  const src=read('sf2-routes.js');
  assert.match(src,/data\.summary\.pending/);
  assert.match(src,/data\.summary\.conflicts/);
  assert.match(src,/data\.summary\.missingSex/);
  assert.match(src,/Only positive marks establish daily presence/);
});

test('Attendance UI shows the correct role-specific SF2 export and error states',()=>{
  const src=read('public/portal.js');
  assert.match(src,/Generate official SF2 Excel/);
  assert.match(src,/data\.summary\.pending === 0 && data\.summary\.conflicts === 0 && data\.summary\.missingSex === 0/);
  assert.match(src,/response\.headers\.get\('Content-Type'\)/);
  assert.match(src,/The generated SF2 workbook is empty/);
});
