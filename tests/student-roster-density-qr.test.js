'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {assertCachedAsset}=require('./support/asset-contract');
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
  assert.match(sw, /attendigo-v296-compact-student-roster/);
});
