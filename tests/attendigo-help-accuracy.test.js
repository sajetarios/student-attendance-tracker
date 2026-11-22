'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const guide = require('../public/attendigo-help-topics');
const read = path => fs.readFileSync(path,'utf8');
const portal = read('public/portal.js');
const html = read('public/portal.html');
const leave = read('public/staff-leave-ui.js');
const leaveInbox = read('public/leave-approval-inbox.js');
const ob = read('public/staff-ob-ui.js');
const accounts = read('public/student-portal-accounts.js');
const schedule = read('public/schedule-workspace-ui.js');
const client = read('public/attendigo-help-guide.js');
const aiRoutes = read('help-ai-routes.js');
const sw = read('public/sw.js');

test('every help topic refers to a real live or dynamically generated menu and defines a safe note',()=>{
  const ids = new Set();
  for (const topic of guide.topics) {
    assert.ok(!ids.has(topic.id),'Duplicate topic '+topic.id);
    ids.add(topic.id);
    assert.ok(topic.title && topic.steps.length>=2 && topic.note,'Missing steps or note: '+topic.id);
    assert.ok(topic.roles.length>0, 'Missing role '+topic.id);
    if (topic.nav) {
      assert.ok(html.includes('id="'+topic.nav+'"') || leave.includes("id='"+topic.nav+"'"),
        'Unknown menu id '+topic.nav+' for '+topic.id);
    }
  }
});

test('teachers get the actual SF1 import prerequisites and review behavior',()=>{
  assert.equal(guide.match('How do I import SF1?','TEACHER')?.id,'sf1-import');
  assert.equal(guide.match('How do I import SF1?','DEPARTMENT_HEAD'),null);
  assert.match(guide.answer('How do I import SF1?','DEPARTMENT_HEAD').title,/restricted/i);
  const steps=guide.answer('How do I import SF1?','TEACHER').steps.join(' ');
  assert.match(steps,/Class Adviser/);
  assert.match(steps,/active school year/);
  assert.match(steps,/Unassigned/);
  assert.match(portal,/SF1 imports require a Class Adviser designation/);
  assert.match(portal,/\.xls,\.xlsx,\.pdf/);
  assert.match(portal,/5 MB and 2,000 learners/);
});

test('leave requests, leave approvals and certified balances do not share authority',()=>{
  assert.equal(guide.match('How do I apply for leave?','TEACHER')?.id,'leave');
  assert.equal(guide.match('Leave approvals','SCHOOL_ADMIN')?.id,'leave-approvals');
  assert.equal(guide.match('Leave approvals','DEPARTMENT_HEAD')?.id,'leave-approvals');
  assert.equal(guide.match('How do I approve leave?','TEACHER'),null);
  assert.match(guide.answer('How do I approve leave?','TEACHER').title,/authorized reviewer/);
  assert.equal(guide.match('leave credits','TEACHER')?.id,'leave-credits');
  assert.match(guide.answer('How do I review my leave status?','TEACHER').title,/leave/i);
  assert.ok(leave.includes('Leave Requests'));
  assert.ok(leave.includes('New leave application'));
  assert.ok(leave.includes('Print prefilled CSC Form No. 6'));
  assert.ok(leaveInbox.includes('Department recommendation'));
  assert.ok(leaveInbox.includes('signed by the authorized DepEd official'));
});

test('student account directions point to the existing Portal Accounts tab',()=>{
  const topic=guide.answer('Where are student account requests?','TEACHER');
  assert.equal(topic.topic?.id,'student-account');
  assert.equal(topic.topic.nav,'studentsNav');
  assert.match(topic.steps.join(' '),/Portal Accounts tab/);
  assert.equal(guide.match('student login','DEPARTMENT_HEAD'),null);
  assert.ok(portal.includes("studentAccountsNav').hidden = true"));
  assert.ok(html.includes('id="studentAccountsTab"'));
  assert.ok(accounts.includes('School Admin approves all account operations'));
});

test('SF2 guidance respects adviser submission, personal copies and read-only monitoring',()=>{
  assert.equal(guide.match('How to generate SF2?','TEACHER')?.id,'sf2');
  assert.equal(guide.match('How to generate SF2?','DEPARTMENT_HEAD')?.id,'sf2');
  assert.equal(guide.match('How to generate SF2?','SCHOOL_ADMIN'),null);
  assert.equal(guide.match('How do I submit official SF2?','DEPARTMENT_HEAD'),null);
  const steps=guide.answer('How to generate SF2?','TEACHER').steps.join(' ');
  assert.match(steps,/Class Advisers/);
  assert.match(steps,/Subject Teachers/);
  assert.match(steps,/NR is not absence/);
  assert.ok(portal.includes('Generate personal copy'));
  assert.ok(portal.includes('Submit official SF2'));
  assert.ok(html.includes('holidays and suspensions are not yet connected to a calendar'));
});

test('gatekeeper and administrator Form 48 are not mixed with staff self-service',()=>{
  assert.equal(guide.match('How to scan a teacher QR?','GATE_KEEPER')?.id,'gatekeeper-scan');
  assert.equal(guide.match('Where is my DTR?','TEACHER')?.id,'dtr');
  assert.equal(guide.match('How to print employee DTR?','SCHOOL_ADMIN')?.id,'form48-admin');
  assert.equal(guide.match('How to print employee DTR?','TEACHER'),null);
  assert.ok(portal.includes("'Gate scanner'"));
  assert.ok(html.includes('id="form48ReportsNav"'));
  assert.ok(html.includes('id="myGateAttendanceNav"'));
});

test('OB, timetables and other restricted actions use current UI labels',()=>{
  assert.equal(guide.match('Official Business request','TEACHER')?.id,'official-business');
  assert.match(guide.answer('Official Business request','TEACHER').steps.join(' '),/Start \(Philippine time\)/);
  assert.ok(ob.includes('Submit My Official Business request'));
  assert.ok(ob.includes('Department Heads recommend; School Admin makes the final decision'));
  assert.equal(guide.match('school timetable settings','TEACHER'),null);
  assert.equal(guide.match('school timetable settings','SCHOOL_ADMIN')?.id,'school-settings');
  assert.match(guide.answer('school timetable settings','SCHOOL_ADMIN').steps.join(' '),/Class Schedules/);
  assert.ok(schedule.includes("label:'Timetable settings'"));
  assert.ok(schedule.includes('New department class'));
});

test('unverified/unauthorized questions never become guessed generative guidance',async()=>{
  assert.equal(guide.match('Please make a payroll deduction','TEACHER'),null);
  assert.match(guide.answer('Please make a payroll deduction','TEACHER').note,/will not guess/i);
  assert.ok(client.includes('response.topic && !unavailable'));
  assert.ok(client.includes('This feature is not available to your account'));
  assert.ok(aiRoutes.includes('if (!library.match(question, req.auth.role))'));
  assert.ok(aiRoutes.includes("status(422)"));
  assert.ok(aiRoutes.includes('Do not add any steps or UI names not stated'));
  assert.match(sw,/attendigo-v309-guide-accuracy/);
  assert.ok(sw.includes('"/attendigo-help-topics.js?v=2"'));
  assert.ok(sw.includes('"/attendigo-help-guide.js?v=4"'));
});
