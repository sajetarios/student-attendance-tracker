'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {assertCachedAsset,assertCacheRevisionAtLeast}=require('./support/asset-contract');

const read = file => fs.readFileSync(file, 'utf8');
const html = read('public/portal.html');
const portal = read('public/portal.js');
const monitor = read('public/class-qr-dashboard-link.js');
const sw = read('public/sw.js');

test('School Admin attendance category has the offline queue while academics keeps enrollment and schedule links', () => {
  const academic = html.match(/id="academicNavChildren"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '';
  const attendance = html.match(/id="attendanceManagementNavChildren"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '';
  assert.match(academic, /id="schedulesNav"/);
  assert.match(attendance, /id="offlineScanReviewsNav"/);
  assert.doesNotMatch(academic, /classQrAdminMonitorNav|Offline Scan Reviews/);
  assert.match(attendance, /id="classQrAdminMonitorNav"/);
  assert.match(attendance, /data-view="classQrMonitor"/);
  assert.doesNotMatch(monitor, /getElementById\('attendanceManagementNavChildren'\)/);
  assert.doesNotMatch(monitor, /getElementById\('academicNavChildren'\)/);
});

test('Class QR monitoring has one role-filtered in-workspace link and no dynamic duplicate', async () => {
  const attendance=html.match(/id="attendanceManagementNavChildren"[^>]*>([\s\S]*?)<\/div>/)?.[1]||'';
  assert.equal((attendance.match(/id="classQrAdminMonitorNav"/g)||[]).length,1);
  assert.match(attendance,/href="\/portal\.html\?view=classQrMonitor"/);
  assert.match(attendance,/id="classQrAdminMonitorNav"[^>]*hidden/);
  assert.match(portal,/\$\('classQrAdminMonitorNav'\)\) \$\('classQrAdminMonitorNav'\)\.hidden = !admin/);
  let created=0;
  const document={querySelectorAll:()=>[],getElementById:()=>null,createElement:()=>{created++;return {};}};
  vm.runInNewContext(monitor,{document,fetch:async()=>({ok:true,json:async()=>({user:{role:'SCHOOL_ADMIN'}})})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(created,0,'School Admin must not dynamically create a duplicate monitor link');
  assert.doesNotMatch(attendance,/class-qr-teacher\.html/);
});

test('pending badge is hidden by default and depends on school-scoped review-only API', () => {
  assert.match(html, /id="offlineScanReviewsNavBadge" hidden/);
  assert.match(portal, /if \(user\?\.role !== 'SCHOOL_ADMIN'\) \{ badge\.hidden = true; return; \}/);
  assert.match(portal, /api\('\/api\/gate\/offline\/review'\)/);
  assert.match(portal, /item\.status === 'REVIEW_REQUIRED' \|\| item\.status === 'INVALID_BADGE'/);
  assert.match(portal, /badge\.hidden = pending === 0/);
  assert.doesNotMatch(monitor, /POST|attendance\/record|dtr\/punch/);
});

test('Admin-only desktop density keeps mobile touch sizes and existing workflows', () => {
  assert.match(html, /id="school-admin-sidebar-density"/);
  assert.match(html, /@media screen and \(min-width:861px\)/);
  assert.match(html, /data-attendigo-role="SCHOOL_ADMIN"/);
  assert.match(html, /font-size:13px!important/);
  assert.match(html, /font-size:12\.5px!important/);
  assert.match(html, /id="offlineScanReviewsNav" href="\/portal\.html\?view=offlineScanReviews"/);
  assert.match(portal, /\$\('offlineScanReviewsNav'\)\.hidden = !admin/);
});

test('portal and worker use the same bumped UI cache revisions', () => {
  assert.match(html, /class-qr-dashboard-link\.js\?v=13/);
  assertCachedAsset(html,sw,'portal.js',{minimumVersion:213});
  assert.match(sw, /class-qr-dashboard-link\.js\?v=13/);
  assertCachedAsset(html,sw,'portal.js',{minimumVersion:213});
  assertCacheRevisionAtLeast(sw,263);
});
