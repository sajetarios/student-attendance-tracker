'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/student-portal-accounts.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'student-portal-account-routes.js'), 'utf8');

function browserFixture({failBatch = 0} = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        value: '', hidden: false, checked: false, disabled: false,
        textContent: '', innerHTML: '', style: {}, listeners: new Map(),
        classList: {toggle(){}, add(){}, remove(){}},
        addEventListener(name, fn) { this.listeners.set(name, fn); },
        focus(){}, select(){}, reset(){}
      });
    }
    return elements.get(id);
  };
  const learners = Array.from({length: 28}, (_, i) => ({
    studentId: 'S-' + String(i + 1).padStart(3,'0'),
    fullName: 'Learner ' + (i + 1),
    gradeLevel: 'Grade 8', section: 'SPJ', hasAccount: false, accountActive: false
  }));
  const posts = [];
  const ok = body => ({ok: true, json: async () => body});
  const fetch = async (url, options = {}) => {
    if (url === '/api/student-portal/accounts' && !options.method) {
      return ok({students: learners.map(s => ({...s}))});
    }
    if (url === '/api/student-portal/requests' && !options.method) return ok({requests: []});
    if (url === '/api/student-portal/accounts/bulk-provision' && options.method === 'POST') {
      const ids = JSON.parse(options.body).studentIds;
      posts.push(ids);
      if (failBatch && posts.length === failBatch) {
        return {ok: false, json: async () => ({error: 'Simulated server error'})};
      }
      const credentials = ids.map(id => {
        const learner = learners.find(s => s.studentId === id);
        learner.hasAccount = true;
        learner.accountActive = true;
        return {studentId: id, fullName: learner.fullName, username: id, temporaryPassword: 'Secret-' + id};
      });
      return ok({credentials});
    }
    throw new Error('Unexpected request: ' + url);
  };
  const document = {
    hidden: false, getElementById: element,
    addEventListener(){}, dispatchEvent(){}
  };
  const window = {
    AppDialog: {confirm: async () => true},
    setInterval(){}, confirm: () => true,
    location: {origin:'https://example.test'}
  };
  const sessionStorage = {getItem(key) {
    return key === 'schoolAttendance.user' ? '{"role":"SCHOOL_ADMIN","schoolCode":"TEST"}' : 'test-token';
  }};
  vm.runInNewContext(source, {
    document, window, sessionStorage, fetch, Headers, URL, Blob,
    MutationObserver: class {observe(){}},
    CustomEvent: class {constructor(type){this.type=type;}}
  }, {filename: 'student-portal-accounts.js'});
  return {
    element, posts, learners,
    async ready() { await new Promise(resolve => setImmediate(resolve)); },
    selectAll() {
      const checkbox = element('sapSelectAll');
      checkbox.checked = true;
      checkbox.listeners.get('change')({target:checkbox});
    },
    async refresh() { await element('sapRefresh').listeners.get('click')(); },
    async apply() { await element('sapBulkCreate').listeners.get('click')(); }
  };
}

test('all 28 selected student accounts are actionable and provision in server-safe 20 + 8 requests', async () => {
  const app = browserFixture();
  await app.ready();
  app.selectAll();
  assert.equal(app.element('sapBulkCreate').disabled, false);
  assert.match(app.element('sapSelectedCount').textContent,/28 selected.*28 eligible.*2 batches/);
  await app.refresh();
  assert.equal(app.element('sapBulkCreate').disabled, false);
  await app.apply();
  assert.deepEqual(app.posts.map(batch=>batch.length),[20,8]);
  assert.equal(new Set(app.posts.flat()).size,28);
  assert.match(app.element('sapSecrets').value,/Secret-S-028/);
  assert.equal((app.element('sapSecrets').value.match(/Temporary password:/g)||[]).length,28);
  assert.equal(app.element('sapSecretModal').hidden,false);
  assert.match(app.element('sapListCount').textContent,/Created logins for 28 of 28/);
});

test('failed second request retains the first batch credentials and leaves unsuccessful students selected', async () => {
  const app = browserFixture({failBatch: 2});
  await app.ready();
  app.selectAll();
  await app.apply();
  assert.deepEqual(app.posts.map(batch=>batch.length),[20,8]);
  assert.equal((app.element('sapSecrets').value.match(/Temporary password:/g)||[]).length,20);
  assert.equal(app.element('sapSecretModal').hidden,false);
  assert.match(app.element('sapSelectedCount').textContent,/8 selected.*8 eligible/);
  assert.equal(app.element('sapBulkCreate').disabled,false);
  assert.match(app.element('sapListCount').textContent,/Created logins for 20 of 28.*Batch 2/);
});

test('server retains the 20-account transaction limit, and asset versions match', () => {
  assert.match(routes,/ids\.length>20/);
  assert.match(source,/offset\+=SERVER_BATCH_LIMIT/);
  assert.doesNotMatch(source,/actionable\.length\s*>\s*20/);
  const html = fs.readFileSync(path.join(root,'public/portal.html'),'utf8');
  const sw = fs.readFileSync(path.join(root,'public/sw.js'),'utf8');
  const url = html.match(/src="(\/student-portal-accounts\.js\?v=[^"]+)"/)?.[1];
  assert.ok(url && sw.includes(JSON.stringify(url)));
});
