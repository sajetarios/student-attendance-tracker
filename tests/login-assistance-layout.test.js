'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('login assistance remains compact, accessible, and scoped to correct account modes', () => {
  const html = read('public/portal-login.html');
  const css = read('public/attendigo-login-refinement.css');
  const js = read('public/portal-login.js');
  const sw = read('public/sw.js');
  for (const id of ['schoolAdminRecoveryLink','openSchoolAdminRecovery','schoolAdminRecoveryForm',
    'parentRegistrationLink','firstPlatformSetupLink']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /class="login-assistance" role="group" aria-label="Account assistance"/);
  assert.match(html, /href="\/parent-register\.html"/);
  assert.match(html, /href="\/platform-setup\.html"/);
  assert.match(html, /class="login-security-note"[\s\S]*?<svg[^>]*aria-hidden="true"/);
  assert.doesNotMatch(html, /<span class="lock-icon">▣<\/span>/);
  assert.match(js, /getElementById\('schoolAdminRecoveryLink'\)\.hidden = mode !== 'school'/);
  assert.match(js, /getElementById\('parentRegistrationLink'\)\.hidden = !isSchool/);
  assert.match(js, /getElementById\('firstPlatformSetupLink'\).*hidden = mode !== 'platform'/);
  assert.match(css, /\.login-assistance-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\.login-assistance-item\[hidden\]\{display:none!important\}/);
  assert.match(css, /@media\(max-width:600px\)/);
  assert.match(html, /<span>Recover or unlock access<\/span>\s*<svg/);
  assert.match(html, /<span>Create parent account<\/span>\s*<svg/);
  assert.match(css, /\.login-assistance-action>span\{min-width:0/);
  assert.match(css, /\.login-security-note\{display:flex;align-items:center/);
  assert.match(html, /attendigo-login-refinement\.css\?v=7/);
  assert.match(sw, /attendigo-login-refinement\.css\?v=7/);
});

test('primary account choices precede credentials and platform access follows the form', () => {
  const html = read('public/portal-login.html');
  const picker = html.match(/<div class="login-mode"[^>]*>([\s\S]*?)<\/div>/)[1];
  assert.match(picker, /Staff &amp; guardians/);
  assert.match(picker, />Students</);
  assert.doesNotMatch(picker, /platformMode/);
  assert.ok(html.indexOf('id="platformMode"') > html.indexOf('id="signInButton"'));
});
