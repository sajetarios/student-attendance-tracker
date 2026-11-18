'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { destinationForRole } = require('../login-routing');

test('Class Adviser and Subject Teacher accounts enter the Management Portal', () => {
  assert.equal(destinationForRole('TEACHER'), '/portal.html');
});

test('school management roles enter the Management Portal', () => {
  for (const role of ['SCHOOL_ADMIN', 'DEPARTMENT_HEAD', 'GATE_KEEPER', 'SUPER_ADMIN']) {
    assert.equal(destinationForRole(role), '/portal.html', `${role} should enter the Management Portal`);
  }
});

test('Parent accounts enter the Parent Portal', () => {
  assert.equal(destinationForRole('PARENT'), '/parent-portal.html');
});

test('Student accounts enter the separate Student Portal', () => {
  assert.equal(destinationForRole('STUDENT'), '/student-portal.html');
});

test('unknown or missing roles are not routed', () => {
  assert.equal(destinationForRole(''), null);
  assert.equal(destinationForRole(undefined), null);
  assert.equal(destinationForRole('CLASS_ADVISER'), null);
});

test('login page and offline cache agree on fresh login assets', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync('public/portal-login.html', 'utf8');
  const sw = fs.readFileSync('public/sw.js', 'utf8');
  const asset = html.match(new RegExp('src="(/portal-login[.]js[?]v=[0-9]+)"'));
  assert.ok(asset, 'Login script must be versioned');
  assert.ok(sw.includes(JSON.stringify(asset[1])), 'Cache must include live login script');
  assert.ok(sw.includes('const CACHE = "attendigo-v'));
  assert.ok(sw.includes("'/portal-login.js', '/login-routing.js'"));
  assert.ok(sw.includes("fetch(request, { cache: 'no-store' })"));
});

test('one canonical login route and explicit school code validation for all devices', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync('public/portal-login.html', 'utf8');
  const client = fs.readFileSync('public/portal-login.js', 'utf8');
  const styles = fs.readFileSync('public/attendigo-login-refinement.css', 'utf8');
  const server = fs.readFileSync('server.js', 'utf8');
  const manifest = JSON.parse(fs.readFileSync('public/manifest.webmanifest', 'utf8'));
  assert.equal(manifest.start_url, '/portal-login.html');
  assert.ok(server.includes("function canonicalLoginUrl(req)"));
  assert.ok(server.includes("app.get('/', (req, res) => {"));
  assert.ok(server.includes("res.redirect(302, canonicalLoginUrl(req));"));
  assert.match(html, /id="schoolCodeHint"/);
  assert.match(client, /schoolCode\.setAttribute\('aria-invalid', 'true'\)/);
  assert.match(client, /schoolCode\.focus\(\)/);
  assert.match(styles, /#schoolCodeHint\.error/);
});
