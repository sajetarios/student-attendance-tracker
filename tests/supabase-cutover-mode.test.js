'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const starter = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'attendigo-start.js'), 'utf8');
const pack = require('../package.json');

test('Render stays authoritative unless an explicit Supabase cutover flag is set', () => {
  assert.match(server, /ATTENDIGO_PRIMARY_DATABASE === 'supabase'/);
  assert.match(server, /if \(!supabasePrimary\) return \{ connectionString: process\.env\.DATABASE_URL \}/);
  assert.match(server, /SUPABASE_DATABASE_URL/);
  assert.match(server, /inspectTarget\(url\)\.status !== 'configured'/);
  assert.equal(pack.scripts.start, 'node scripts/attendigo-start.js');
});

test('Cutover refuses an unverified CA and never weakens certificate checks', () => {
  assert.match(starter, /await downloadOfficialRootCa\(\)/);
  assert.match(server, /ATTENDIGO_VERIFIED_SUPABASE_ROOT_CA/);
  assert.match(server, /ssl: \{ ca, rejectUnauthorized: true \}/);
  assert.doesNotMatch(server + starter, /rejectUnauthorized\s*:\s*false/);
  assert.doesNotMatch(server + starter, /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*0/);
  assert.match(server, /parsed\.searchParams\.delete\('sslmode'\)/);
});

test('Maintenance freeze blocks API writes and suppresses background mutation workers', () => {
  assert.match(server, /ATTENDIGO_MIGRATION_MODE === 'read_only'/);
  assert.match(server, /res\.status\(503\)\.json\(/);
  assert.match(server, /code: 'DATABASE_MAINTENANCE'/);
  assert.match(server, /if \(migrationReadOnly\) \{\s*app\.listen\([\s\S]+?return;\s*\}/);
  const gate = server.indexOf('if (migrationReadOnly) {', server.indexOf('async function start()'));
  const worker = server.indexOf('startSmsWorker(pool)');
  assert(gate > 0 && gate < worker);
});
