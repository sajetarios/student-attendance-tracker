const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const asset = name => fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');

test('opening Student List with empty tab storage lets the server identify the browser session', async () => {
  const requests = [];
  const redirects = [];
  const element = {addEventListener() {}, querySelector() { return element; }, querySelectorAll() { return []; }};
  vm.runInNewContext(asset('parent-dashboard.js'), {
    sessionStorage: {getItem: () => null},
    location: {replace: url => redirects.push(url)},
    document: {getElementById: () => element},
    Headers,
    fetch: async (url, options) => {
      requests.push(url);
      assert.equal(options.headers.has('Authorization'), false);
      return {ok: true, json: async () => ({user: {role: 'TEACHER'}})};
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(redirects, []);
  assert.deepEqual(requests, ['/api/auth/me']);
});

test('visible staff sidebar destinations have native URLs before module scripts execute', () => {
  const sidebar = asset('portal.html').match(/<nav class="side-nav"[\s\S]*?<\/nav>/)[0];
  const items = sidebar.match(/<(?:a|button)\b[^>]*class="nav-item\b[^>]*>/g);
  assert.ok(items.length > 15);
  for (const item of items) {
    if (item.includes('id="guardianApprovalsNav"') && item.includes('hidden')) continue;
    if (item.includes('id="offlineScanReviewsNav"')) {
      assert.match(item, /href="\/portal\.html\?view=offlineScanReviews"/);
      assert.match(item, /hidden/);
      continue;
    }
    assert.match(item, /^<a\b/);
    assert.match(item, /href="\/(portal\.html\?view=|sms\.html)/);
  }
});
