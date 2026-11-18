'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const server=fs.readFileSync('server.js','utf8');
const portal=fs.readFileSync('public/portal.js','utf8');
const form48=fs.readFileSync('public/form48-report.js','utf8');
const dtr=fs.readFileSync('staff-gate-dtr-routes.js','utf8');
const {decideNextGateEvent}=require('../gate-event-decision');
const {buildObDtrRemarks}=require('../ob-dtr-remarks');
test('student Gatekeeper AUTO requires photo verification and server decision',()=>{
 const route=server.slice(server.indexOf("app.post('/api/sync/events'"),server.indexOf('// School dashboard:',server.indexOf("app.post('/api/sync/events'")));
 assert.match(route,/req\.auth\.role === 'GATE_KEEPER'/);
 assert.match(route,/event\.metadata\?\.photoVerified === true/);
 assert.match(route,/pg_advisory_xact_lock/);
 assert.match(route,/clock_timestamp\(\)/);
 assert.match(route,/event\.eventType=valid\.eventType/);
 assert.match(route,/attendanceScope === 'CLASS'/);
});
test('staff Gatekeeper records append-only verified physical movements with retry key',()=>{
 const route=server.slice(server.indexOf("app.post('/api/gate/teacher-auto-event'"),server.indexOf('// Roster: school-scoped',server.indexOf("app.post('/api/gate/teacher-auto-event'")));
 assert.match(route,/requireSchoolRoles\('GATE_KEEPER'\)/);
 assert.match(route,/validateAutomaticGateRecording/);
 assert.match(route,/pg_advisory_xact_lock/);
 assert.match(route,/clientEventKey/);
 assert.match(route,/event_kind='GATE_MOVEMENT'/);
 assert.match(route,/INSERT INTO staff_attendance_events/);
 assert.match(route,/photo_verified|photoVerified/);
 assert.doesNotMatch(route,/INSERT INTO teacher_gate_events/);
 assert.doesNotMatch(route,/DTR_SLOT/);
});
test('OB remarks annotate 6 PM return, do not create DTR slots',()=>{
 const ob={requestId:'1',startsAt:'2026-11-19T09:00:00+08:00',endsAt:'2026-11-19T17:00:00+08:00'};
 const gate=[{schoolDate:'2026-11-19',eventType:'TIME_IN',occurredAt:'2026-11-19T18:00:00+08:00'}];
 const a=buildObDtrRemarks('2026-11-19',[ob],gate);
 assert.equal(a[0].exception,'RETURN_AFTER_APPROVED_END_REVIEW');
 assert.deepEqual(decideNextGateEvent(['TIME_IN','TIME_OUT','TIME_IN']),{status:'READY',eventType:'TIME_OUT'});
 assert.match(form48,/obMarkup/);
 assert.match(dtr,/obRemarks/);
 assert.match(dtr,/event_kind='DTR_SLOT'/);
});
test('Gatekeeper scanner uses one verify button and idempotent retry keys',()=>{
 assert.match(portal,/Verify & Record/);
 assert.match(portal,/recordStudentAutomaticGatePunch/);
 assert.match(portal,/recordTeacherAutomaticGatePunch/);
 assert.match(portal,/scan\.autoEventId/);
 assert.match(portal,/student\.autoEventId/);
});
