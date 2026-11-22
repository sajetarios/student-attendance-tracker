'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {deriveLeaveStatus,gateVisibleLeave,requiresDtrReview,QUERY}=require('../staff-approved-leave-status');
const server=fs.readFileSync('server.js','utf8');
const gate=fs.readFileSync('public/portal.js','utf8');
const html=fs.readFileSync('public/portal.html','utf8');
const leave=fs.readFileSync('staff-leave-routes.js','utf8');
const dtr=fs.readFileSync('staff-gate-dtr-routes.js','utf8');
const worker=fs.readFileSync('public/sw.js','utf8');
const {assertCachedAsset}=require('./support/asset-contract');
const official={schoolDate:'2026-11-23',startDate:'2026-11-23',endDate:'2026-11-27',
 leaveType:'SICK',approvalReference:'AUTH-TEST-1',legacyStatus:'ACTIVE'};
test('confirmed leave is active inclusively through last date, then automatically expires',()=>{
 assert.equal(deriveLeaveStatus(official).status,'ACTIVE');
 assert.equal(deriveLeaveStatus({...official,schoolDate:'2026-11-27'}).status,'ACTIVE');
 assert.equal(deriveLeaveStatus({...official,schoolDate:'2026-11-28'}).status,'NONE');
 assert.equal(deriveLeaveStatus({...official,schoolDate:'2026-11-22'}).status,'UPCOMING');
 assert.equal(deriveLeaveStatus({...official,startDate:null,endDate:null}).status,'NONE');
});
test('legacy on-leave status is never confused with verified external approval',()=>{
 const legacy=deriveLeaveStatus({...official,startDate:null,endDate:null,legacyStatus:'ON_LEAVE',legacyStart:'2026-11-22',legacyEnd:'2026-11-30'});
 assert.equal(legacy.status,'ON_LEAVE_REVIEW');
 assert.equal(legacy.approvalReference,null);
 assert.equal(requiresDtrReview(legacy),true);
 assert.equal(requiresDtrReview(deriveLeaveStatus({...official,schoolDate:'2026-11-28'})),false);
});
test('gatekeeper sees only date, state and approval reference; not reasons or illness',()=>{
 const actual={...deriveLeaveStatus(official),reason:'Private illness',medicalNotes:'redacted'};
 const data=gateVisibleLeave(actual);
 assert.equal(data.status,'ACTIVE');
 assert.equal(data.endDate,'2026-11-27');
 assert.equal(data.approvalReference,'AUTH-TEST-1');
 assert.equal(JSON.stringify(data).includes('Private illness'),false);
 assert.equal(JSON.stringify(data).includes('SICK'),false);
 assert.ok(!Object.hasOwn(data,'leaveType'));
});
test('approved leave lookup is school-scoped, revoked records excluded and read only',()=>{
 assert.match(QUERY,/a\.school_id=s\.school_id AND a\.staff_user_id=s\.user_id/);
 assert.match(QUERY,/a\.revoked_at IS NULL/);
 assert.match(QUERY,/AT TIME ZONE 'Asia\/Manila'/);
 assert.doesNotMatch(QUERY,/\b(INSERT|UPDATE|DELETE)\b/i);
});
test('gatekeeper QR lookup annotates status without changing scan decisions',()=>{
 const route=server.slice(server.indexOf("app.post('/api/gate/teacher-lookup'"),server.indexOf("app.get('/api/gate/teacher/photo"));
 assert.match(route,/getStaffLeaveStatus/);
 assert.match(route,/gateVisibleLeave/);
 assert.match(route,/leaveStatus/);
 assert.doesNotMatch(route,/\b(INSERT|UPDATE|DELETE)\b/);
 assert.match(server,/autoRecordVerifiedGateDtr/);
 assert.match(gate,/showGateLeaveBanner\(person,isTeacherPerson\)/);
 assert.match(gate,/gateLeaveBlocksDtr\(person\)/);
 assert.match(gate,/recordTeacherAutomaticGatePunch/);
 assert.match(html,/id="studentScanNoticeLeave"/);
 assert.match(gate,/Physical gate movement may be recorded/);
});
test('manual DTR fallback blocks leave overlaps before any verified DTR slot insert',()=>{
 const start=dtr.indexOf("app.post('/api/staff-attendance/gatekeeper/dtr'");
 const block=dtr.slice(start,dtr.indexOf("app.get('/api/staff-attendance/my/dtr'",start));
 assert.ok(start>0);
 assert.match(block,/pg_advisory_xact_lock/);
 assert.match(block,/getStaffLeaveStatus/);
 assert.match(block,/requiresDtrReview/);
 assert.match(block,/code:'LEAVE_DTR_REVIEW_REQUIRED'/);
 assert.ok(block.indexOf('requiresDtrReview(leave)')<block.indexOf('INSERT INTO staff_attendance_events'));
 assert.match(block,/ROLLBACK/);
 assert.match(gate,/fallback\.hidden = gateLeaveBlocksDtr\(person\)/);
});
test('profile status uses self-scoped API and never toggles employee account state',()=>{
 const start=leave.indexOf("app.get('/api/staff-leave/my/status'");
 const end=leave.indexOf("app.get('/api/staff-leave/requests'",start);
 const block=leave.slice(start,end);
 assert.ok(start>0&&end>start);
 assert.match(block,/req\.auth\.schoolId,req\.auth\.userId/);
 assert.doesNotMatch(block,/\b(INSERT|UPDATE|DELETE)\b/);
 assert.match(html,/id="accountProfileLeaveStatus"/);
 const profile=fs.readFileSync('public/staff-leave-ui.js','utf8');
 assert.match(profile,/profileMenuButton/);
 assert.match(profile,/refreshProfileLeave/);
 assert.match(profile,/On Approved Leave/);
});
test('approved-leave gate overlaps appear in school admin read-only review list',()=>{
 const start=leave.indexOf("app.get('/api/staff-leave/overlaps'");
 const end=leave.indexOf("app.get('/api/staff-leave/requests/:id/form6'",start);
 const block=leave.slice(start,end);
 assert.ok(start>0&&end>start);
 assert.match(block,/req\.auth\.role!=='SCHOOL_ADMIN'/);
 assert.match(block,/staff_form48_approved_leaves/);
 assert.match(block,/GATE_MOVEMENT/);
 assert.doesNotMatch(block,/\b(INSERT|UPDATE|DELETE)\b/);
 const ui=fs.readFileSync('public/staff-leave-ui.js','utf8');
 assert.match(ui,/Gate visits during approved leave/);
});
test('PWA refreshes gate and leave status assets rather than trapping older cached versions',()=>{
 assertCachedAsset(html,worker,'portal.js',{minimumVersion:233});
 assertCachedAsset(html,worker,'staff-leave-ui.js',{minimumVersion:2});
 assertCachedAsset(html,worker,'leave-status-indicator.css',{minimumVersion:1});
});
