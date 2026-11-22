'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {assertCachedAsset,assertCacheRevisionAtLeast}=require('./support/asset-contract');
const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const portal=read('public/portal.js');
const html=read('public/portal.html');
const css=read('public/teacher-learner-roster.css');
const sw=read('public/sw.js');

test('student roster reserves a short status column for a visible teacher QR shortcut',()=>{
  assert.match(css, /td\[data-label="Status"\]\s*\{\s*width:9%/);
  assert.match(css, /td\[data-label="Actions"\]\s*\{\s*width:23%/);
  assert.match(css, /\.teacher-roster-quick-actions\s*\{\s*display:inline-flex;flex-wrap:nowrap/);
  assert.match(css, /\.teacher-roster-status\s*\{\s*width:max-content/);
  assert.match(css, /\.teacher-roster-qr\s*\{\s*min-width:48px/);
  assert.match(portal, /data-view-qr/);
  assert.match(portal, /data-edit-student/);
  assert.match(portal, /student-actions-dropdown/);
});

test('missing special program does not take row width, unassigned section stays clear',()=>{
  assert.match(portal, /const sectionName = String\(student.section \|\| 'Unassigned'\)\.trim\(\)/);
  assert.match(portal, /const sectionUnassigned =/);
  assert.match(portal, /student\.specialProgramCode \? programCell : ''/);
  assert.match(portal, /data-label="Special program"/); // asynchronous request badges still attach
  assert.match(css, /\.teacher-roster-program:empty\{display:none!important;\}/);
  assert.match(css, /\.teacher-roster-section\.is-unassigned/);
});

test('teacher buttons remain reachable on mobile with keyboard and dark-mode states',()=>{
  assert.match(portal, /teacher \? "More" : "Actions"/);
  assert.match(css, /@media \(max-width:700px\)/);
  assert.match(css, /min-height:42px;height:42px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /html\[data-ui-theme="dark"\].*\.teacher-roster-section\.is-unassigned/);
});

test('service worker caches the updated roster assets',()=>{
  assertCachedAsset(html,sw,'portal.js',{minimumVersion:228});
  assertCachedAsset(html,sw,'teacher-learner-roster.css',{minimumVersion:6});
  assertCacheRevisionAtLeast(sw,296);
});


test('iPad Select header has an explicit narrow width instead of equal fifth-column sizing',()=>{
  assert.match(portal, /rosterTable\?\.classList\.toggle\('teacher-roster-with-selection', teacher && showSelectionColumn\)/);
  assert.match(css, /teacher-roster-compact\.teacher-roster-with-selection thead th:first-child\s*\{\s*width:48px;min-width:48px;max-width:48px/);
  assert.match(css, /teacher-roster-compact thead th:nth-last-child\(4\)\s*\{\s*width:39%/);
  assert.match(css, /teacher-roster-compact thead th:nth-last-child\(3\)\s*\{\s*width:24%/);
  assert.match(css, /teacher-roster-compact thead th:nth-last-child\(2\)\s*\{\s*width:9%/);
  assert.match(css, /teacher-roster-compact\.teacher-roster-with-selection tbody td\[data-label="Select"\]\s*\{/);
  assert.match(css, /tbody td\[data-label="Select"\] \.student-select-box\s*\{\s*display:block;margin:0 auto/);
  assert.match(css, /@media \(min-width:701px\)/);
  assert.match(css, /On phones, learner cards retain the existing top-right selection placement/);
});

test('new roster revision is versioned for online and cached iPad sessions',()=>{
  assertCachedAsset(html,sw,'portal.js',{minimumVersion:230});
  assertCachedAsset(html,sw,'teacher-learner-roster.css',{minimumVersion:7});
  assertCacheRevisionAtLeast(sw,298);
});
