'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

const roster=read('public/portal.js');
const programs=read('public/special-program-ui.js');
const programRoutes=read('special-program-routes.js');
const programCss=read('public/special-program-ui.css');
const accounts=read('public/student-portal-accounts.js');
const accountsCss=read('public/student-portal-accounts.css');
const html=read('public/portal.html');
const worker=read('public/sw.js');

test('teacher and department head request program changes through Actions, not program badges',()=>{
  assert.doesNotMatch(programs,/button\.textContent='Request change'/);
  assert.match(programs,/const actionCell=row\.querySelector\('\[data-label="Actions"\]'\)/);
  assert.match(programs,/menu\.append\(button\)/);
  assert.match(programs,/button\.textContent='Request Program Change'/);
  assert.match(roster,/<th>Status<\/th><th>Actions<\/th>/);
  assert.match(roster,/td data-label="Actions"><span class="muted-inline">View only<\/span>/);
  assert.match(programs,/student-program-action-menu/);
});

test('program requests show current program and pending status without duplicate submissions',()=>{
  assert.match(html,/id="specialProgramRequestCurrent"/);
  assert.match(programs,/specialProgramRequestCurrent/);
  assert.match(programs,/pendingInScope=new Set/);
  assert.match(programs,/pendingMine=new Set/);
  assert.match(programs,/if\(isPendingProgram\(id\)\)/);
  assert.match(programs,/special-program-row-pending/);
  assert.match(programs,/pendingEnrollments|pendingEnrollmentIds/);
  assert.match(programRoutes,/pendingEnrollmentIds/);
  assert.match(programRoutes,/r\.status='PENDING'/);
  assert.match(read('migrations/047_special_program_approvals.sql'),/special_program_one_pending_per_learner_year/);
});

test('student login resets are clearly named and reviewed requests move to history for admin and teachers',()=>{
  assert.match(accounts,/Request Password Reset/);
  assert.doesNotMatch(accounts,/'Request reset'/);
  assert.match(accounts,/Account & Access Requests/);
  assert.match(accounts,/const active = pending/);
  assert.match(accounts,/history\.hidden = !reviewed\.length/);
  assert.match(accounts,/reviewed\.map\(renderRequestRow\)/);
  assert.match(html,/id="sapRequestHistory"/);
});

test('dark-mode improvements cover learner menu, pending state, account table and credential dialog',()=>{
  for(const selector of ['student-program-action-menu','special-program-row-pending','special-program-current'])
    assert.ok(programCss.includes(selector),'Missing '+selector);
  for(const selector of ['sap-table th','sap-chip.pending','sap-modal','sap-request-row','sap-bulk-toolbar'])
    assert.ok(accountsCss.includes(selector),'Missing '+selector);
  assert.match(programCss,/html\[data-ui-theme="dark"\]/);
  assert.match(accountsCss,/html\[data-ui-theme="dark"\]/);
  assert.match(programCss,/:focus-visible/);
  assert.match(accountsCss,/:focus-visible/);
});

test('cache versions match the live learner and account scripts and styles',()=>{
  for(const asset of [
    '/portal.js?v=192',
    '/student-portal-accounts.css?v=6','/student-portal-accounts.js?v=11',
    '/special-program-ui.css?v=5','/special-program-ui.js?v=6',
    '/teacher-roster-popover.js?v=2'
  ]) {
    assert.ok(html.includes(asset),'HTML missing '+asset);
    assert.ok(worker.includes(JSON.stringify(asset)),'PWA cache missing '+asset);
  }
});
