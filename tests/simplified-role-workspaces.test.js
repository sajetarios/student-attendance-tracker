'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

const html = read('public/portal.html');
const script = read('public/simplified-workspace.js');
const css = read('public/simplified-workspace.css');
const sw = read('public/sw.js');
const portal = read('public/portal.js');

test('All four staff role layouts load without replacing existing navigation controllers', () => {
  assert.match(html, /href="\/simplified-workspace\.css\?v=1"/);
  assert.match(html, /src="\/simplified-workspace\.js\?v=3" defer/);
  assert.match(sw, /"\/simplified-workspace\.js\?v=3"/);
  assert.match(sw, /"\/simplified-workspace\.css\?v=1"/);
  for (const role of ['SCHOOL_ADMIN', 'DEPARTMENT_HEAD', 'TEACHER', 'SUPER_ADMIN']) {
    assert.match(script, new RegExp(role));
    assert.match(css, new RegExp(role));
  }
  assert.match(script, /addEventListener\('attendigo:portal-ready'/);
  assert.match(script, /window\.attendigoStaffIdentity\.then\(user/);
  assert.match(portal, /function applyRoleNavigation\(/);
  assert.match(portal, /function allowedViewsForUser\(/);
});

test('School Administrator retains all authorized links, including advanced management and reports', () => {
  for (const id of [
    'dashboardNav','studentsNav','staffNavWrapper','requestsApprovalsNav',
    'parentsNav','academicAdminNav','schedulesNav','myGateAttendanceNav',
    'officialBusinessNav','lunchQrAdminNav','form48ReportsNav',
    'cloudSyncNav','smsNav','schoolBrandingNav','offlineScanReviewsNav','classQrAdminMonitorNav'
  ]) assert.match(html, new RegExp('id="' + id + '"'), 'Missing legacy navigation entry: '+id);
  for (const section of ['directory','accounts','permissions','departments']) {
    assert.match(html, new RegExp('data-staff-section="' + section + '"'));
  }
  assert.match(script, /move\('studentsNav', 'users', true\)/);
  assert.match(script, /move\('requestsApprovalsNav', 'settings'\)/);
  assert.match(script, /move\('cloudSyncNav', 'settings'\)/);
  assert.match(script, /move\('offlineScanReviewsNav', 'attendanceManagement'\)/);
  assert.match(script, /link\.parentElement === target/);
  assert.doesNotMatch(script, /\.cloneNode\s*\(/);
  assert.doesNotMatch(script, /window\.location\s*=|window\.location\.assign|fetch\s*\(|\.removeChild\s*\(/);
});

test('Department Head and Teacher retain class schedules, QR, OB, personal DTR, SF2 and planning', () => {
  for (const view of [
    'schedules','students','teachers','classAttendance','myGateAttendance',
    'officialBusiness','sf2','planner','teacherLunchQr'
  ]) assert.match(html, new RegExp('data-view="' + view + '"'));
  assert.match(script, /move\('myGateAttendanceNav', 'operations'\)/);
  assert.match(script, /label\('personalAttendance', 'My Attendance'\)/);
  assert.match(portal, /if \(role === 'DEPARTMENT_HEAD'\) return \['dashboard', 'planner', 'students', 'teachers', 'schedules', 'sf2', 'officialBusiness', 'myGateAttendance'\]/);
  assert.match(portal, /if \(teacherHas\('SUBJECT_TEACHER'\) \|\| teacherHas\('CLASS_ADVISER'\)\) views\.push\('sf2'\)/);
});

test('Search filters existing visible links without changing authorizations or hiding server-allowed modules permanently', () => {
  assert.match(script, /\!link\.hidden/);
  assert.match(script, /if \(child\.hidden\) continue/);
  assert.match(script, /nav\.querySelectorAll\('\.simple-nav-filtered'\)/);
  assert.match(script, /before\.clear\(\)/);
  assert.match(script, /if \(!authorizedChildren\(wrapper\)\.length && !wrapper\.hidden\) wrapper\.hidden = true/);
  assert.doesNotMatch(script, /\b(?:link|item|button|wrapper)\.hidden\s*=\s*false/, 'No role-hidden feature may be programmatically made visible');
  assert.match(css, /\.simple-nav-filtered[\s\S]*?display: none !important/);
  assert.doesNotMatch(script, /collapseOtherGroups/);
  assert.match(script, /requestAnimationFrame\(focusActiveGroup\)/);
});

test('Dashboard shortcuts are moved, not deleted, and remain reachable through details', () => {
  for (const action of ['students','schedules','parents','academicAdmin','classQrMonitor']) {
    assert.match(html, new RegExp('data-admin-view="' + action + '"'));
  }
  for (const section of ['permissions','departments','accounts']) {
    assert.match(html, new RegExp('data-admin-go="' + section + '"'));
  }
  for (const type of ['student','guardian','photo']) assert.match(html, new RegExp('data-admin-inbox="' + type + '"'));
  assert.match(script, /contents\.forEach\(item => body\.append\(item\)\)/);
  assert.match(script, /simpleAdminExtraShortcuts/);
  assert.match(script, /simpleAdminApprovalCategories/);
  assert.match(script, /new MutationObserver\(showIfNeeded\)/);
  assert.match(portal, /#adminDashboardCard \[data-admin-view\]/);
  assert.match(portal, /#adminDashboardCard \[data-admin-inbox\]/);
});

test('Super Administrator keeps all five platform destinations and full storage analytics', () => {
  for (const view of ['platform','platformSchools','platformOnboard','platformPlans','platformSecurity']) {
    assert.match(portal, new RegExp("'" + view + "'"));
  }
  assert.match(html, /id="platformStorageCard"/);
  for (const field of ['platformStorageUsed','platformStorageRemaining','platformStorageProvider','platformStoragePercent']) {
    assert.match(html, new RegExp('id="' + field + '"'));
  }
  assert.match(script, /detailsBlock\('simplePlatformStorage'/);
});

test('Layout changes do not alter printed DTR or security checks on deleted schools', () => {
  const middleware = read('auth-middleware.js');
  assert.match(middleware, /JOIN schools s ON s\.school_id\s*=\s*us\.school_id AND s\.active\s*=\s*TRUE/);
  assert.match(portal, /api\('\/api\/auth\/me'\)/);
  assert.match(css, /@media print/);
  assert.doesNotMatch(script, /api\/|POST|PUT|PATCH|DELETE|\.innerHTML\s*=/);
});

test('Compact menus survive feature-entitlement refresh without repeating DOM moves', () => {
  assert.match(portal, /if \(next !== appliedNavigationFingerprint\) \{[\s\S]*?applyRoleNavigation\(\)/);
  assert.match(script, /monitorRoleNavigation\(role\)/);
  assert.match(script, /record\.target\.matches\?\.\('\.side-nav,\.nav-submenu'\)/);
  assert.match(script, /record\.attributeName === 'hidden'/);
  assert.match(script, /ordered\.some\(\(el, index\) => el !== current\[index\]\)/);
  assert.match(script, /move\('schoolSmsAccessNotice', 'settings'\)/);
  assert.match(css, /details\.simple-workspace-details:not\(\[open\]\) > \.simple-workspace-details-body/);
});
