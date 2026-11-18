'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname,'..');
const routes = fs.readFileSync(path.join(root,'platform-routes.js'),'utf8');
const portal = fs.readFileSync(path.join(root,'public/portal.html'),'utf8');
const client = fs.readFileSync(path.join(root,'public/portal.js'),'utf8');
const worker = fs.readFileSync(path.join(root,'public/sw.js'),'utf8');

test('database storage endpoint is protected by Super Admin guard', () => {
  assert.match(routes,/app\.get\('\/api\/platform\/storage', \.\.\.guard,/);
  assert.match(routes,/const guard = \[authenticatePlatform, requirePlatformAdmin\]/);
  assert.match(routes,/pg_database_size\(current_database\(\)\)/);
  assert.match(routes,/DATABASE_STORAGE_LIMIT_BYTES/);
  assert.match(routes,/capacitySource: limitBytes === null \? 'not-configured'/);
  assert.match(routes,/remainingBytes = limitBytes === null \? null/);
});
test('storage widget is within platform overview only', () => {
  const overview = portal.indexOf('data-platform-tab="overview"');
  const storage = portal.indexOf('id="platformStorageCard"');
  const schools = portal.indexOf('data-platform-tab="schools"');
  assert.ok(overview >= 0 && overview < storage && storage < schools);
  assert.match(portal,/id="platformStorageRefresh"/);
  assert.match(portal,/prefers-reduced-motion:reduce/);
  assert.match(client,/user\?\.role !== 'SUPER_ADMIN'/);
  assert.match(client,/api\('\/api\/platform\/storage'\)/);
  assert.match(client,/Remaining space cannot be calculated/);
});
test('new portal bundle matches offline shell', () => {
  assert.match(portal,/\/portal\.js\?v=199/);
  assert.match(worker,/"\/portal\.js\?v=199"/);
  assert.match(worker,/attendigo-v225-platform-storage-analytics/);
});
