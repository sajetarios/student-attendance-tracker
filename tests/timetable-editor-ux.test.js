'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('timetable editor has compact controls and accessible block organization', () => {
  const html = read('public/portal.html');
  const css = read('public/portal.css');
  assert.match(html, /id="timetableTemplateForm"/);
  assert.match(html, /id="templateBlockRows"/);
  assert.match(html, /id="templateBlockSummary"/);
  assert.match(html, /id="sortTemplateBlocks"/);
  assert.match(html, /data-add-template-type="BREAK"/);
  assert.match(html, /data-add-template-type="LUNCH"/);
  assert.match(css, /#timetableSettings \.template-block-row\{display:grid/);
  assert.match(css, /@media\(max-width:700px\)/);
});

test('timetable editor retains all API bindings and checks invalid times', () => {
  const js = read('public/portal.js');
  const routes = read('scheduling-config-routes.js');
  assert.match(js, /function updateTemplateBlockSummary\(\)/);
  assert.match(js, /function addTemplateBlock\(type = 'CLASS'\)/);
  assert.match(js, /data-block-label/);
  assert.match(js, /data-block-start/);
  assert.match(js, /data-block-end/);
  assert.match(js, /data-remove-block/);
  assert.match(js, /updateTemplateBlockSummary/);
  assert.match(js, /'Sort by time'/);
  assert.match(js, /overlaps/);
  assert.match(js, /api\('\/api\/scheduling-config\/templates'/);
  assert.match(routes, /Timetable blocks cannot overlap/);
});
