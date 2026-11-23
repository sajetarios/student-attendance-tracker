'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {timeOk,dateOk,recentDate,canHeadReview,canView,evidenceFormat,chronological}=
 require('../missing-scan-routes');

test('validated Philippine time and calendar date; future and stale corrections are blocked',()=>{
 assert.equal(timeOk('17:03'),true);
 assert.equal(timeOk('24:00'),false);
 assert.equal(timeOk('17:99'),false);
 assert.equal(dateOk('2026-02-29'),false);
 assert.equal(dateOk('2028-02-29'),true);
 assert.equal(recentDate('2026-11-22','2026-11-23'),true);
 assert.equal(recentDate('2026-11-24','2026-11-23'),false);
 assert.equal(recentDate('2026-05-01','2026-11-23'),false);
});

test('department review never crosses department or allows self approval',()=>{
 const request={department_id:'dept-a',staff_user_id:'teacher-a'};
 assert.equal(canHeadReview({role:'DEPARTMENT_HEAD',departmentId:'dept-a',userId:'head-a'},request),true);
 assert.equal(canHeadReview({role:'DEPARTMENT_HEAD',departmentId:'dept-b',userId:'head-b'},request),false);
 assert.equal(canHeadReview({role:'DEPARTMENT_HEAD',departmentId:'dept-a',userId:'teacher-a'},request),false);
 assert.equal(canHeadReview({role:'TEACHER',departmentId:'dept-a',userId:'teacher-b'},request),false);
 assert.equal(canView({role:'TEACHER',userId:'teacher-a'},request),true);
 assert.equal(canView({role:'TEACHER',userId:'teacher-b'},request),false);
 assert.equal(canView({role:'SCHOOL_ADMIN',userId:'admin-a'},request),true);
});

test('evidence rejects wrong content, empty files and magic header mismatch',()=>{
 assert.equal(evidenceFormat('application/pdf',Buffer.concat([Buffer.from('%PDF-1.6'),Buffer.alloc(100)])),true);
 assert.equal(evidenceFormat('image/png',Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(100)])),true);
 assert.equal(evidenceFormat('image/jpeg',Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(100)])),true);
 assert.equal(evidenceFormat('application/pdf',Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(100)])),false);
 assert.equal(evidenceFormat('image/svg+xml',Buffer.alloc(100)),false);
 assert.equal(evidenceFormat('image/png',Buffer.alloc(4)),false);
 assert.equal(evidenceFormat('application/pdf',Buffer.alloc(3*1024*1024+1)),false);
});

test('corrected times must be chronologically consistent with verified slots',()=>{
 const slots={AM_IN:'07:30',AM_OUT:'12:00',PM_IN:'13:00'};
 assert.equal(chronological(slots,'PM_OUT','17:03'),true);
 assert.equal(chronological(slots,'PM_OUT','12:59'),false);
 assert.equal(chronological({AM_IN:'07:30',PM_IN:'13:00'},'AM_OUT','12:00'),true);
 assert.equal(chronological({AM_IN:'07:30',PM_IN:'13:00'},'AM_OUT','14:00'),false);
 assert.equal(chronological({PM_IN:'13:00',PM_OUT:'17:00'},'AM_IN','18:00'),false);
});
