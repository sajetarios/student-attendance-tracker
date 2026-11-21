'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function fakeRes() {
  return {
    headers: {}, statusCode: 200, body: null, redirected: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    redirect(c, url) { this.statusCode = c; this.redirected = url; return this; }
  };
}

test('rate limiter allows the limit, then blocks with Retry-After', () => {
  const { createRateLimiter } = require('../http-security');
  const limiter = createRateLimiter({ windowMs: 60000, max: 2 });
  const req = { ip: '1.2.3.4' };
  let passed = 0;
  for (let i = 0; i < 2; i++) limiter(req, fakeRes(), () => { passed += 1; });
  assert.equal(passed, 2);
  const res = fakeRes();
  limiter(req, res, () => assert.fail('third request must be blocked'));
  assert.equal(res.statusCode, 429);
  assert.ok(Number(res.headers['Retry-After']) >= 1);
  const other = fakeRes();
  let ok = false;
  limiter({ ip: '9.9.9.9' }, other, () => { ok = true; });
  assert.ok(ok, 'a different client is not affected');
});

test('https redirect only applies in production and never to /health', () => {
  const { httpsRedirect } = require('../http-security');
  const saved = { env: process.env.NODE_ENV, force: process.env.FORCE_HTTPS };
  try {
    process.env.NODE_ENV = 'production'; delete process.env.FORCE_HTTPS;
    const res = fakeRes();
    httpsRedirect({ secure: false, path: '/', method: 'GET', headers: { host: 'a.example' }, originalUrl: '/x?y=1' }, res, () => assert.fail('should redirect'));
    assert.equal(res.statusCode, 308);
    assert.equal(res.redirected, 'https://a.example/x?y=1');
    let next = false;
    httpsRedirect({ secure: false, path: '/health', method: 'GET', headers: {}, originalUrl: '/health' }, fakeRes(), () => { next = true; });
    assert.ok(next);
    process.env.NODE_ENV = 'development';
    next = false;
    httpsRedirect({ secure: false, path: '/', method: 'GET', headers: {}, originalUrl: '/' }, fakeRes(), () => { next = true; });
    assert.ok(next);
  } finally {
    if (saved.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved.env;
    if (saved.force === undefined) delete process.env.FORCE_HTTPS; else process.env.FORCE_HTTPS = saved.force;
  }
});

test('storage directory is configurable for persistent disks', () => {
  process.env.STORAGE_DIR = '/var/data';
  delete require.cache[require.resolve('../storage-paths')];
  const paths = require('../storage-paths');
  assert.equal(paths.SF2_STORAGE, path.join('/var/data', 'sf2'));
  assert.equal(paths.STUDENT_PHOTO_ROOT, path.join('/var/data', 'student-photos'));
  delete process.env.STORAGE_DIR;
  delete require.cache[require.resolve('../storage-paths')];
});

test('server wires proxy trust, https redirect, login limiter and shared pool', () => {
  const server = read('server.js');
  assert.match(server, /configureProxy\(app\)/);
  assert.match(server, /app\.use\(httpsRedirect\)/);
  assert.match(server, /loginLimiter/);
  assert.match(server, /createPool\(\)/);
  assert.match(read('sms-worker.js'), /createPool\(\)/);
});

test('every page loads the shared reliability and responsive layer', () => {
  for (const file of fs.readdirSync(path.join(root, 'public')).filter(f => f.endsWith('.html'))) {
    const html = read(`public/${file}`);
    assert.match(html, /app-enhance\.css/, file);
    assert.match(html, /app-enhance\.js/, file);
  }
});

test('service worker is network-first so deploys reach users', () => {
  const sw = read('public/sw.js');
  assert.doesNotMatch(sw, /caches\.match\(request\)\.then\(cached => \{\s*if \(cached\) return cached;/);
  assert.match(sw, /fetch\(request\)\.then/);
});

test('render blueprint targets the health check and persistent storage', () => {
  const yaml = read('render.yaml');
  assert.match(yaml, /healthCheckPath: \/health/);
  assert.match(yaml, /STORAGE_DIR/);
  assert.match(yaml, /mountPath: \/var\/data/);
});
