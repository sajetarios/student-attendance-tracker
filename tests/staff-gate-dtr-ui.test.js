'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const portal=fs.readFileSync('public/portal.js','utf8');
const html=fs.readFileSync('public/portal.html','utf8');
const worker=fs.readFileSync('public/sw.js','utf8');
const server=fs.readFileSync('server.js','utf8');
const route=fs.readFileSync('staff-gate-dtr-routes.js','utf8');

test('Gatekeeper scanner preserves physical movement actions and adds separate verified DTR',()=>{
 assert.match(portal,/recordTeacherGatePunch\('TIME_IN'\)/);
 assert.match(portal,/recordTeacherGatePunch\('TIME_OUT'\)/);
 assert.match(portal,/isTeacherPerson && user.role === 'GATE_KEEPER'/);
 assert.match(portal,/teacherQrToken: scannedTeacher.qrToken, slot, photoVerified: true/);
 assert.match(portal,/api\('\/api\/staff-attendance\/gatekeeper\/dtr'/);
 for(const slot of ['AM_IN','AM_OUT','PM_IN','PM_OUT'])assert.match(portal,new RegExp('value="'+slot+'"'));
 assert.match(portal,/if \(\$\('teacherDtrRecord'\)\) \$\('teacherDtrRecord'\)\.disabled = !verified/);
});
test('Gatekeeper DTR remains protected by role and school-bound photo verification',()=>{
 assert.match(route,/requireSchoolRoles\('GATE_KEEPER'\)/);
 assert.match(route,/req.body\?\.photoVerified!==true/);
 assert.match(route,/teacher_photo_path IS NOT NULL/);
 assert.match(route,/school_id=\$1 AND teacher_qr_token=\$2/);
 assert.match(route,/ON CONFLICT DO NOTHING/);
 assert.match(route,/INSERT INTO staff_attendance_audit/);
 assert.match(server,/registerStaffGateDtrRoutes\(app, pool/);
});
test('Teacher personal page distinguishes verified DTR from physical gate history',()=>{
 assert.match(html,/id="myGateDtrAmIn"/);
 assert.match(html,/id="myGateDtrAmOut"/);
 assert.match(html,/id="myGateDtrPmIn"/);
 assert.match(html,/id="myGateDtrPmOut"/);
 assert.match(portal,/api\/staff-attendance\/my\/dtr/);
 assert.match(portal,/api\/teacher\/my-gate-attendance/);
 assert.match(worker,/"\/portal\.js\?v=187"/);
 assert.match(html,/src="\/portal\.js\?v=187"/);
});
