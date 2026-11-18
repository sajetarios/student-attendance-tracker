'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('admin activity has a bounded keyboard-scrollable table with persistent headers', () => {
  const html = read('public/portal.html');
  const css = read('public/user-management-readability.css');
  assert.match(html, /id="securityAuditScroll" role="region" aria-label="[^"]+" tabindex="0"/);
  assert.match(html, /class="security-audit-table security-history-table"/);
  assert.match(css, /#teachersView #securityAuditScroll\s*\{[^}]*max-height:clamp\(280px,46vh,440px\)/);
  assert.match(css, /#teachersView #securityAuditScroll\s*\{[^}]*overflow:auto!important/);
  assert.match(css, /#teachersView #securityAuditScroll \.security-history-table thead th\s*\{[^}]*position:sticky/);
  assert.match(css, /#teachersView #securityAuditScroll \.security-history-table tbody td\s*\{[^}]*padding:9px 12px!important/);
  assert.match(css, /@media\(max-width:700px\)/);
});

test('audit record IDs stay complete in expandable details; existing audit and refresh remain', () => {
  const portal = read('public/portal.js');
  const html = read('public/portal.html');
  assert.match(portal, /async function loadSecurityAudit\(force = false\)/);
  assert.match(portal, /api\('\/api\/admin\/security\/audit'\)/);
  assert.match(portal, /const shortId = recordId\.length > 18/);
  assert.match(portal, /<details class="security-audit-record-details"><summary/);
  assert.match(portal, /<code>' \+ esc\(recordId\) \+ '<\/code><\/details>/);
  assert.match(portal, /\$\('refreshSecurityAudit'\)\?\.addEventListener\('click', \(\) => loadSecurityAudit\(true\)\)/);
  assert.match(html, /id="securityAuditRows"/);
  assert.match(html, /id="refreshSecurityAudit"/);
});

test('updated styles are versioned and cached for offline navigation', () => {
  const html = read('public/portal.html');
  const sw = read('public/sw.js');
  assert.match(html, /user-management-readability\.css\?v=5/);
  assert.match(sw, /"\/user-management-readability\.css\?v=5"/);
});
