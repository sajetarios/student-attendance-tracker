'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('authenticated portal checks for service-worker updates without interrupting the dashboard', async () => {
  const html = read('public/portal.html');
  const worker = read('public/sw.js');
  const updater = read('public/sw-refresh.js');
  const script = html.match(/src="(\/sw-refresh\.js\?v=[^"]+)"/)?.[1];
  assert.ok(script && worker.includes(JSON.stringify(script)));

  const calls = [];
  const vm = require('node:vm');
  await vm.runInNewContext(updater, {
    navigator: {
      serviceWorker: {
        register(url, options) {
          calls.push([url, options.updateViaCache]);
          return Promise.resolve({ update: async () => { calls.push('update'); } });
        },
      },
    },
    window: { location: { reload() { calls.push('reload'); } } },
  });
  assert.deepEqual(calls, [['/sw.js', 'none'], 'update']);
});
