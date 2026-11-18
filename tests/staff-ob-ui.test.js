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
 assert.match(ui,/window\.prompt/);
 assert.match(ui,/staff-ob-coverage/);
 assert.match(ui,/form\.reportValidity\(\)/);
 assert.match(ui,/const toManilaIso=s=>/);
 assert.match(portal,/staff-ob-ui\.js\?v=5/);
 assert.match(sw,/staff-ob-ui\.js\?v=5/);
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
