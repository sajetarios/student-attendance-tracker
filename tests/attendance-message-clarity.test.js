'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {summarizePersonalAttendance}=require('../personal-attendance-insights');
const {assertCachedAsset,assertCacheRevisionAtLeast}=require('./support/asset-contract');

const portal=fs.readFileSync('public/portal.js','utf8');
const html=fs.readFileSync('public/portal.html','utf8');
const css=fs.readFileSync('public/my-gate-insights.css','utf8');
const worker=fs.readFileSync('public/sw.js','utf8');
const gate=schoolDate=>({eventType:'TIME_IN',schoolDate,
  occurredAt:schoolDate+'T07:52:00+08:00'});
const schedule={workdays:[1,2,3,4,5],
 regularHours:{AM_IN:'07:30',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'17:00'},
 saturdayHours:{}};

test('missing work schedule and genuinely unscheduled Saturday are different, safe review reasons',()=>{
 const workDate='2026-11-20',weekend='2026-11-21';
 const missing=summarizePersonalAttendance({from:workDate,to:workDate,gateEvents:[gate(workDate)],
  schedule:null,calendar:[]});
 const offday=summarizePersonalAttendance({from:weekend,to:weekend,gateEvents:[gate(weekend)],
  schedule,calendar:[]});
 assert.deepEqual(missing[0].review,['SCHEDULE_UNAVAILABLE']);
 assert.deepEqual(offday[0].review,['NOT_SCHEDULED_WORKDAY']);
 assert.deepEqual(missing[0].suggestions,{});
 assert.deepEqual(offday[0].suggestions,{});
 assert.equal(missing[0].safeToApply,false);
 assert.equal(offday[0].safeToApply,false);
});
test('daily cards clearly distinguish gate scan evidence and verified official DTR',()=>{
 assert.match(portal,/Work schedule not available/);
 assert.match(portal,/Your gate scan was saved and photo-verified/);
 assert.match(portal,/Official DTR: no times recorded/);
 assert.match(portal,/Work hours need setup/);
 assert.match(portal,/gate scan only; this is not an official DTR time/);
 assert.match(portal,/Saving the schedule will not fill missing official DTR times/);
 assert.match(html,/Missing lunch scans, OB, and uncertain movements are not guessed/);
 assert.match(html,/A clear, photo-verified gate scan can automatically fill its matching official DTR time/);
});
test('next step is appropriate to staff role and does not expose an attendance edit action',()=>{
 assert.match(portal,/user\.role==='SCHOOL_ADMIN'/);
 assert.match(portal,/href="\/portal\.html\?view=form48Reports"/);
 assert.match(portal,/Ask your School Admin to set your official working days and hours/);
 assert.doesNotMatch(portal,/No official DTR records or OB approvals were changed/);
});
test('current wording and responsive CSS are correctly precached for mobile',()=>{
 assertCachedAsset(html,worker,'portal.js',{minimumVersion:219});
 assertCachedAsset(html,worker,'my-gate-insights.css',{minimumVersion:2});
 assertCacheRevisionAtLeast(worker,273);
 assert.match(css,/my-gate-insight-help/);
 assert.match(css,/@media\(max-width:760px\)/);
});
