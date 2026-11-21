'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('unstructured legacy learner names are shown unchanged without a verification warning', () => {
  const portal = read('public/portal.js');
  const start = portal.indexOf('function studentRosterName(');
  const end = portal.indexOf('function updateStructuredStudentNameMode()', start);
  assert.ok(start > 0 && end > start, 'student name renderer present');
  const render = portal.slice(start, end);
  assert.match(render, /esc\(student\.fullName\)/);
  assert.match(render, /learner-roster-original/);
  assert.match(render, /parsed\?\.verified/);
  assert.doesNotMatch(render, /Surname not verified|learner-roster-unverified/);
  assert.match(portal, /studentRosterName\(student, ordinal\)/);
});

test('guardian actions are placed in the Actions dropdown, not next to direct Edit', () => {
  const script = read('public/guardian-ui.js');
  assert.match(script, /row\.querySelector\('\.student-actions-dropdown \.student-row-actions'\)/);
  assert.match(script, /anchor\.closest\('\.student-row-actions'\)/);
  assert.doesNotMatch(script, /anchor\.parentElement/);
  assert.match(script, /row\.querySelector\('\[data-guardian-open\]'\)/);
  assert.match(script, /action\.append\(button\)/);
});

test('updated guardian and roster assets are versioned and revalidated by service worker', () => {
  const html = read('public/portal.html');
  const sw = read('public/sw.js');
  for (const asset of ['portal.js?v=218','guardian-ui.js?v=7']) {
    assert.ok(html.includes('/' + asset), 'HTML includes ' + asset);
    assert.ok(sw.includes('"/' + asset + '"'), 'SW caches ' + asset);
  }
  assert.match(sw, /'\/guardian-ui\.js'/);
  assert.match(sw, /attendigo-v272-student-roster-cleanup/);
});
