'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('school-scoped administrative activity route uses the audit timestamp column and UI alias', () => {
  const migration = read('migrations/002_authentication_foundation.sql');
  const server = read('server.js');
  const portal = read('public/portal.js');
  const start = server.indexOf("app.get('/api/admin/security/audit'");
  const end = server.indexOf('// Gate Keeper monitoring', start);
  assert.ok(start !== -1 && end > start, 'audit route is defined');
  const route = server.slice(start, end);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS audit_logs\s*\(/);
  assert.match(migration, /created_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
  assert.match(route, /authenticateSchoolClient, requireSchoolAdmin/);
  assert.match(route, /a\.created_at AS "createdAt"/);
  assert.doesNotMatch(route, /a\.updated_at|a\.created_at AS "appliedAt"/);
  assert.match(route, /WHERE a\.school_id=\$1/);
  assert.match(route, /ORDER BY a\.created_at DESC/);
  assert.match(route, /LIMIT 50/);
  assert.match(route, /\[req\.auth\.schoolId\]/);
  assert.match(route, /res\.json\(\{ events: result\.rows \}\)/);
  assert.match(portal, /const when = item\.createdAt \?/);
  assert.match(portal, /const events = result\.events \|\| \[\]/);
});
