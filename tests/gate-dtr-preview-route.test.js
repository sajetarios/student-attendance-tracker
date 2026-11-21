'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../staff-gate-dtr-routes.js'),'utf8');
test('reconciliation preview is school-admin protected and read-only',()=>{
 const start=src.indexOf("app.get('/api/staff-attendance/admin/dtr-reconciliation-preview'");
 const end=src.indexOf("app.post('/api/staff-attendance/gatekeeper/dtr'",start);
 assert.ok(start>0&&end>start);
 const route=src.slice(start,end);
 assert.match(route,/requireSchoolRoles\('SCHOOL_ADMIN'\)/);
 assert.match(route,/school_id=\$1/);
 assert.match(route,/status='APPROVED'/);
 assert.match(route,/reconcileGateDay/);
 assert.doesNotMatch(route,/INSERT INTO|UPDATE staff_attendance_events|DELETE FROM/);
});
