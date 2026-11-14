'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const portal = fs.readFileSync(path.join(root, 'public', 'portal.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'portal.html'), 'utf8');

test('Department Head roster shows only useful read-only learner columns', () => {
  assert.match(portal, /rosterHeader\.innerHTML = '<th>Student ID<\/th><th>Full name<\/th><th>Sex<\/th><th>Grade<\/th><th>Section<\/th><th>Status<\/th>'/);
  assert.match(portal, /if \(departmentHead\) \{\s*return `<tr><td data-label="Student ID"/);
  assert.match(portal, /colspan="' \+ \(departmentHead \? '6' : '11'\)/);
  assert.match(portal, /departmentHead \? '' : await photoDataUrl\(student\.photoUrl\)/);
  assert.match(portal, /departmentHead\s*\? 'Review learner identity, sex, and current grade and section placement\.'/);
  assert.match(html, /id="studentRosterDescription"/);
});

test('School Administrator keeps the full student management columns', () => {
  assert.match(portal, /else if \(rosterHeader\) \{\s*rosterHeader\.innerHTML = '<th>Select<\/th><th>Photo<\/th>/);
  assert.match(portal, /data-label="QR code"/);
  assert.match(portal, /data-label="Actions"/);
  assert.match(portal, /data-label="Student account"/);
});
