'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const portal = fs.readFileSync(path.join(root, 'public', 'portal.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'portal.html'), 'utf8');

test('Teacher monitoring table has dedicated Grade level and Section columns', () => {
  assert.match(html, /<th>Grade level<\/th><th>Section<\/th>/);
  assert.match(html, /class=\"teacher-monitor-table\"/);
  assert.match(html, /id=\"teacherRows\"[\s\S]*?colspan=\"7\"/);
});

test('Teacher monitoring combines adviser, permanent schedule, and substitute grade-section assignments', () => {
  assert.match(portal, /\(teacher\.adviserSections \|\| \[\]\)\.forEach\(item => addClassScope\(item\.gradeLevel, item\.section\)\)/);
  assert.match(portal, /assigned\.forEach\(item => addClassScope\(item\.gradeLevel, item\.section\)\)/);
  assert.match(portal, /substitutionAssignments\.forEach\(item => addClassScope\(item\.gradeLevel, item\.section\)\)/);
});

test('Teacher monitoring displays a clear unassigned state when no grade or section exists', () => {
  assert.match(portal, /'<span class=\"muted-inline\">Not assigned<\/span>'/);
});

test('Grade and section values are escaped before being rendered', () => {
  assert.match(portal, /classScopes\.map\(item => `<span class=\"teacher-scope-item\">\$\{esc\(item\.gradeLevel\)\}<\/span>`\)/);
  assert.match(portal, /classScopes\.map\(item => `<span class=\"teacher-scope-item\">\$\{esc\(item\.section\)\}<\/span>`\)/);
});
