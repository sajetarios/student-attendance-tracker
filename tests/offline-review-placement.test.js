'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = file => fs.readFileSync(file, 'utf8');
const portal = read('public/portal.html');
const navigation = read('public/portal.js');
const iconMap = read('public/attendigo-unified-navigation.js');
const review = read('public/gate-offline-review.html');
const sw = read('public/sw.js');

test('offline scan reviews live under School Admin Attendance Management, not on the dashboard', () => {
  assert.match(portal, /id="attendanceManagementNavGroup" hidden/);
  assert.match(portal, /data-nav-group="attendanceManagement"/);
  assert.match(portal, /id="attendanceManagementNavChildren" data-submenu="attendanceManagement"/);
  assert.match(portal, /id="offlineScanReviewsNav" href="\/gate-offline-review\.html"[^>]*hidden/);
  assert.ok(portal.indexOf('attendanceManagementNavGroup') < portal.indexOf('operationsNavGroup'));
  assert.doesNotMatch(portal, /Review offline Gatekeeper observations \(not official attendance\)/);
});

test('review navigation is only visible for School Admin and uses the existing authenticated route', () => {
  assert.ok(navigation.includes("if ($('offlineScanReviewsNav')) $('offlineScanReviewsNav').hidden = !admin;"));
  assert.ok(navigation.includes("['attendanceManagement', 'operations', 'reports', 'settings'].forEach(group => {"));
  assert.ok(iconMap.includes("attendanceManagementNavGroup:'clock',offlineScanReviewsNav:'clipboard'"));
  assert.match(review, /\/api\/gate\/offline\/review/);
  assert.match(review, /School Admin access required/);
});

test('compact review screen preserves the unverified-only safeguard and audited close workflow', () => {
  assert.match(review, /No offline scans to review/);
  assert.match(review, /id="summaryCount"/);
  assert.match(review, /id="summaryMeta"/);
  assert.match(review, /Closing a review does not record attendance/);
  assert.match(review, /existing approval workflow/);
  assert.match(review, /\['REVIEW_REQUIRED','INVALID_BADGE'\]/);
  assert.match(review, /note\.value\.trim\(\)\.length<8/);
  assert.match(review, /CLOSED_REVIEWED/);
  assert.match(review, /DISMISSED/);
  assert.doesNotMatch(review, /INSERT INTO attendance_events/);
});

test('new portal navigation is versioned for the service worker', () => {
  assert.match(portal, /\/portal\.js\?v=213/);
  assert.match(sw, /"\/portal\.js\?v=213"/);
  assert.match(sw, /const CACHE = "attendigo-v262-form48-a4-gate-evidence"/);
});
