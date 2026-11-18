'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('employee account security layout contains long labels and responds to panel width', () => {
  const css = read('public/user-management-readability.css');
  assert.match(css, /#teachersView \.security-account-section\s*\{[^}]*container-type:inline-size/s);
  assert.match(css, /#teachersView \.security-accounts-table td:first-child :is\(strong,\.table-subtext\)/);
  assert.match(css, /#teachersView \.security-accounts-table \.security-role-cell/);
  assert.match(css, /#teachersView \.security-accounts-table \.department-line/);
  assert.match(css, /@container \(max-width:1450px\)/);
  assert.match(css, /@container \(max-width:920px\)/);
  assert.match(css, /@container \(max-width:440px\)/);
  assert.match(css, /content:attr\(data-label\)/);
  assert.match(css, /#teachersView \.security-accounts-table td \.action-row button/);
});

test('security account action controls and labels remain available', () => {
  const html = read('public/portal.html');
  const js = read('public/portal.js');
  assert.match(html, /user-management-readability\.css\?v=6/);
  assert.match(html, /class="security-audit-table security-accounts-table"/);
  for (const label of ['Employee', 'Role / department', 'Access status', 'Last sign-in', 'Failed attempts', 'Sessions', 'Security actions']) {
    assert.ok(js.includes('data-label="' + label + '"'), label + ' responsive card label');
  }
  for (const action of ['data-reset-staff-password', 'data-revoke-staff-sessions', 'data-unlock-staff-account']) {
    assert.ok(js.includes(action), action + ' action hook preserved');
  }
  const sw = read('public/sw.js');
  assert.match(sw, /"\/user-management-readability\.css\?v=6"/);
});
