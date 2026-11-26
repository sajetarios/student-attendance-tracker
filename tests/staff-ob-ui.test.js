'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const ui=fs.readFileSync('public/staff-ob-ui.js','utf8');
const portal=fs.readFileSync('public/portal.html','utf8');
const sw=fs.readFileSync('public/sw.js','utf8');
const routes=fs.readFileSync('staff-ob-routes.js','utf8');
test('staff OB portal view initializes only for authorized roles and uses same-origin credentials',()=>{
 assert.match(ui,/\['TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN'\]\.includes\(user\?\.role\)/);
 assert.match(ui,/window\.attendigoStaffIdentity\?\.then\(init\)/);
 assert.match(ui,/officialBusinessView/);
 assert.match(portal,/id="officialBusinessView"/);
 assert.match(portal,/id="officialBusinessNav"/);
 assert.match(ui,/credentials:'same-origin',cache:'no-store'/);
 assert.match(ui,/await window\.AppDialog\.prompt/);
 assert.doesNotMatch(ui,/window\.(?:prompt|confirm|alert)\s*\(/);
 assert.match(ui,/maxLength:1000/);
 assert.match(ui,/if\(note===null\)return/);
 assert.match(ui,/\{decision,note\}/);
 assert.match(ui,/finally\{busy=false;controls\.forEach/);
 assert.match(ui,/staff-ob-coverage/);
 assert.match(ui,/form\.reportValidity\(\)/);
 assert.match(ui,/const toManilaIso=s=>/);
 assert.match(portal,/staff-ob-ui\.js\?v=11/);
 assert.match(sw,/staff-ob-ui\.js\?v=11/);
});
test('substitute picker uses department-filtered names instead of manual user IDs',()=>{
 assert.ok(ui.includes("basePath+'/substitutes'"));
 assert.match(ui,/Select a department teacher/);
 assert.match(ui,/Confirm substitute/);
 assert.doesNotMatch(ui,/Enter the active teacher user ID/);
});
test('OB UI escapes API-provided fields and does not store private data in browser storage',()=>{
 assert.match(ui,/const esc=s=>/);
 assert.match(ui,/esc\(ob\.purpose\)/);
 assert.match(ui,/esc\(ob\.staffName/);
 assert.match(ui,/esc\(coverage\.periodName/);
 assert.doesNotMatch(ui,/localStorage|sessionStorage|innerHTML\s*=\s*[^\n]*\bdata\.coverage/);
});
test('OB write routes require role checks and audit all approval and substitute decisions',()=>{
 for(const value of ['STAFF_OB_SUBMITTED','STAFF_OB_RECOMMENDED','STAFF_OB_APPROVED',
  'STAFF_OB_AFFECTED_CLASSES_FLAGGED','STAFF_OB_SUBSTITUTE_ASSIGNED'])
  assert.ok(routes.includes(value),value);
 assert.match(routes,/pg_advisory_xact_lock/);
 assert.match(routes,/o.department_id=\$4/);
 assert.match(routes,/status='PENDING_ADMIN'/);
});

test('Principal approvals use server authority and explicit physical-signature confirmation',()=>{
 const principal=fs.readFileSync('public/principal-dashboard.js','utf8');
 const html=fs.readFileSync('public/principal.html','utf8');
 assert.match(principal,/\/api\/principal\/ob-approvals/);
 assert.match(principal,/signedAuthorization:approving/);
 assert.match(html,/id="principalObApprovalList"/);
 assert.match(html,/id="principalObHistory"/);
 assert.doesNotMatch(ui,/action\('Approve',\(\)=>decide\('decide'/);
 assert.match(routes,/requireSchoolRoles\('PRINCIPAL'\)/);
});


test('OB time input requires AM or PM and preserves canonical 24-hour values',()=>{
 const vm=require('node:vm');const source=ui.match(/ const displayClock=.*\n const parseClock=.*\n/)[0];
 const {displayClock,parseClock}=vm.runInNewContext(source+';({displayClock,parseClock})');
 for(const [input,stored] of [['12:00 AM','00:00'],['12:00 PM','12:00'],['5:45 PM','17:45'],['8:05 AM','08:05']]){
  assert.equal(parseClock(input),stored);assert.equal(displayClock(stored),input);
 }
 for(const invalid of ['17:45','0:00 AM','13:00 PM','5:60 PM','5:00'])assert.equal(parseClock(invalid),null);
 assert.match(ui,/Actual completion time \(AM\/PM\)/);assert.match(ui,/parseClock\(form.time\)/);
});
