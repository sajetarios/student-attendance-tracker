'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createIpRateLimiter } = require('../request-limiter');

function invoke(middleware, ip, username, status = 200, defer = false) {
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200, headers: {}, passed: false,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json() { this.emit('finish'); return this; }
  });
  const finish = () => { res.statusCode = status; res.emit('finish'); };
  middleware({ ip, body: { username } }, res, () => {
    res.passed = true;
    if (!defer) finish();
  });
  return { res, finish };
}
const opts = { windowMs: 900000, maxRequests: 10, countOnlyFailures: true };

test('successful logins do not exhaust shared network budget', () => {
  const limit = createIpRateLimiter(opts);
  for (let i = 0; i < 500; i++) assert.equal(invoke(limit, 'shared', 'user'+i).res.passed, true);
});

test('failed credentials remain limited and return retry time', () => {
  const limit = createIpRateLimiter(opts);
  for (let i = 0; i < 10; i++) assert.equal(invoke(limit, 'shared', 'user', 401).res.passed, true);
  const blocked = invoke(limit, 'shared', 'user').res;
  assert.equal(blocked.statusCode, 429);
  assert.ok(Number(blocked.headers['Retry-After']) > 0);
  assert.equal(invoke(limit, 'different', 'user').res.passed, true);
});

test('account budget is independent of shared network and rotating IPs', () => {
  const limit = createIpRateLimiter({ ...opts, keyForRequest: req => req.body.username });
  for (let i = 0; i < 10; i++) invoke(limit, 'ip'+i, 'a', 401);
  assert.equal(invoke(limit, 'new', 'a').res.statusCode, 429);
  assert.equal(invoke(limit, 'new', 'b').res.passed, true);
});

test('pending requests reserve capacity; success releases it', () => {
  const limit = createIpRateLimiter({ ...opts, maxRequests: 2 });
  const first = invoke(limit, 'shared', 'a', 200, true);
  const second = invoke(limit, 'shared', 'b', 401, true);
  assert.equal(invoke(limit, 'shared', 'c').res.statusCode, 429);
  first.finish(); second.finish();
  assert.equal(invoke(limit, 'shared', 'c').res.passed, true);
});

test('legacy IP limiter still counts successful requests', () => {
  const limit = createIpRateLimiter({ windowMs: 900000, maxRequests: 2 });
  invoke(limit, 'shared', 'a'); invoke(limit, 'shared', 'b');
  assert.equal(invoke(limit, 'shared', 'c').res.statusCode, 429);
});
