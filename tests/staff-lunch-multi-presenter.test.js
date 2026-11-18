'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const routes=fs.readFileSync('staff-lunch-routes.js','utf8');
const migration=fs.readFileSync('migrations/053_multi_department_lunch_presenters.sql','utf8');
const client=fs.readFileSync('public/staff-lunch-ui.js','utf8');
const html=fs.readFileSync('public/portal.html','utf8');
const original=fs.readFileSync('migrations/051_staff_smart_attendance_foundation.sql','utf8');

test('per-teacher unique active lunch grants allow simultaneous presenters',()=>{
 assert.match(migration,/DROP INDEX IF EXISTS staff_lunch_one_active_presenter_per_slot/);
 assert.match(migration,/\(school_id,school_date,dtr_slot,presenter_user_id\)/);
 assert.match(migration,/WHERE revoked_at IS NULL/);
});
test('School Admin can enumerate presenters but teachers receive only their own grant status',()=>{
 assert.match(routes,/isCurrentPresenter:presenters\.some/);
 assert.match(routes,/req\.auth\.role==='SCHOOL_ADMIN'\?\{presenterUserId:.*?,presenters\}/);
});
test('presenter grants do not revoke other presenter's authorization',()=>{
 assert.match(routes,/presenter_user_id=\$4 AND revoked_at IS NULL FOR UPDATE/);
 const grant=routes.slice(routes.indexOf("app.put('/api/staff-attendance/lunch/presenter'"),routes.indexOf("app.delete('/api/staff-attendance/lunch/presenter'"));
 assert.doesNotMatch(grant,/UPDATE staff_lunch_presenter_assignments SET revoked_at/);
});
test('rotating a challenge revokes only that presenter’s old challenge',()=>{
 const issue=routes.slice(routes.indexOf("app.post('/api/staff-attendance/lunch/challenges'"),routes.indexOf("app.post('/api/staff-attendance/lunch/redeem'"));
 assert.match(issue,/presenter_user_id=\$4 AND revoked_at IS NULL/);
 assert.match(issue,/\[req.auth.schoolId,date,slot,req.auth.userId\]/);
});
test('revocation targets one assigned presenter and preserves audit',()=>{
 const revoke=routes.slice(routes.indexOf("app.delete('/api/staff-attendance/lunch/presenter'"),routes.indexOf("app.post('/api/staff-attendance/lunch/challenges'"));
 assert.match(revoke,/presenter_user_id=\$4 AND revoked_at IS NULL/);
 assert.match(revoke,/LUNCH_PRESENTER_REVOKED/);
 assert.match(revoke,/req.body\?\.presenterUserId/);
});
test('verified staff DTR remains unique across all presenter QRs',()=>{
 assert.match(original,/CREATE UNIQUE INDEX staff_dtr_one_verified_slot_per_day/);
 assert.match(routes,/ON CONFLICT DO NOTHING RETURNING event_id,occurred_at/);
});
test('admin screen filters presenters by department and supports multiple selection',()=>{
 assert.match(html,/id="staffLunchDepartment"/);
 assert.match(html,/id="staffLunchTeacher" multiple/);
 assert.match(client,/selectedOptions/);
 assert.match(client,/presenterUserId:presenter.presenterUserId/);
});
