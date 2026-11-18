'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { containsCredentialsInQuery, redirectLeakedCredentials } = require('../credential-url-guard');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

test('credential query detection handles encoded and mixed-case legacy query keys', () => {
  for (const url of [
    '/?schoolCode=EXAMPLE&username=sample&password=example-value',
    '/portal-login.html?PASSWORD=example',
    '/portal-login.html?pa%73sword=example',
    '/platform-setup.html?setupCode=example',
    '/?recoveryCode=example'
  ]) {
    assert.equal(containsCredentialsInQuery(url), true, url.split('?')[0]);
  }
  for (const url of ['/', '/portal-login.html?mode=platform', '/?schoolCode=EXAMPLE',
    '/portal-login.html?username=sample', '/portal-login.html']) {
    assert.equal(containsCredentialsInQuery(url), false, url);
  }
});

test('credential query login navigation redirects to a clean path with no reflection', () => {
  const headers = {};
  let redirected;
  const req = { method:'GET', path:'/', originalUrl:'/?password=example-value&username=sample' };
  const res = {
    setHeader:(k,v)=>{ headers[k]=v; },
    redirect:(status,location)=>{ redirected={status,location}; }
  };
  redirectLeakedCredentials(req,res,()=>{ throw Error('query must not reach the app'); });
  assert.deepEqual(redirected,{status:303,location:'/portal-login.html'});
  assert.match(headers['Cache-Control'],/no-store/);
  assert.equal(headers['Referrer-Policy'],'no-referrer');
  assert.doesNotMatch(JSON.stringify(redirected),/example-value|username/i);
});

test('normal login page and API navigation are unaffected', () => {
  for (const req of [
    {method:'GET',path:'/portal-login.html',originalUrl:'/portal-login.html?mode=platform'},
    {method:'POST',path:'/api/auth/school/login',originalUrl:'/api/auth/school/login'},
    {method:'GET',path:'/api/auth/school/login',originalUrl:'/api/auth/school/login?password=example'}
  ]) {
    let continued = false;
    redirectLeakedCredentials(req,{setHeader:()=>{},redirect:()=>{throw Error('unexpected redirect');}},()=>{continued=true;});
    assert.ok(continued);
  }
});

test('sign-in cannot submit credentials via GET when JavaScript fails', () => {
  const html = read('public/portal-login.html');
  const js = read('public/portal-login.js');
  assert.match(html, /<form id="loginForm" method="post" action="\/api\/auth\/school\/login"/);
  assert.match(html, /<form id="schoolAdminRecoveryForm" method="post" action="\/api\/auth\/school\/recover-admin"/);
  assert.match(html, /id="signInButton" type="submit" disabled/);
  assert.match(js, /form\.addEventListener\('submit', async event => \{\s*event\.preventDefault\(\)/);
  assert.match(js, /method: 'POST'/);
  assert.match(js, /button\.disabled = false/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
});

test('account and password forms never default to GET on JavaScript failure', () => {
  for (const filename of [
    'public/portal.html', 'public/force-password-change.html',
    'public/parent-register.html', 'public/platform-setup.html',
    'public/student-portal.html'
  ]) {
    const html = read(filename);
    const forms = [...html.matchAll(/<form\b[^>]*>/gi)].map(x=>x[0]);
    assert.ok(forms.length > 0, filename);
    for (const form of forms) assert.match(form,/\bmethod="post"/i,filename);
  }
});

test('server and service worker remove sensitive URL queries and prevent credential cache entries', () => {
  const server = read('server.js');
  const worker = read('public/sw.js');
  const html = read('public/portal-login.html');
  assert.ok(server.includes('app.use(redirectLeakedCredentials)'));
  assert.ok(server.includes("'/portal-login.html'"));
  assert.ok(worker.includes('const CACHE = "attendigo-v'));
  const version = html.match(new RegExp('src="(/portal-login[.]js[?]v=[0-9]+)"'));
  assert.ok(version, 'Login script must be versioned');
  assert.ok(worker.includes(JSON.stringify(version[1])), 'Offline cache must match current login script');
  assert.ok(worker.includes('credentialKey.test(key)'));
  assert.ok(worker.includes("Response.redirect(new URL('/portal-login.html', url.origin).href, 303)"));
  assert.ok(worker.includes('response.ok && !url.search'));
});

test('legacy index redirect never forwards incoming credentials', () => {
  const index = read('public/index.html');
  assert.ok(!index.includes('location.replace(location.search)'));
  assert.ok(index.includes("const requestedMode = params.get('mode')"));
  assert.ok(index.includes("requestedMode === 'platform' ? '?mode=platform'"));
  assert.ok(index.includes('go(loginUrl)'));
  assert.ok(!index.includes('loginUrl = location.search'));
  assert.ok(index.includes('name="referrer" content="no-referrer"'));
});
