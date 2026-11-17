'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/student-portal-accounts.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'student-portal-account-routes.js'), 'utf8');

function browserFixture({failBatch = 0, role = 'SCHOOL_ADMIN', failRequestAt = 0} = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        value: '', hidden: ['sapRequestModal','sapReviewModal','sapSecretModal'].includes(id), checked: false, disabled: false,
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
  const requestPosts = [];
  const pending = [];
  const ok = body => ({ok: true, json: async () => body});
  const fetch = async (url, options = {}) => {
    if (url === '/api/student-portal/accounts' && !options.method) {
      return ok({students: learners.map(s => ({...s}))});
    }
    if (url === '/api/student-portal/requests' && !options.method) return ok({requests: pending.map(r=>({...r}))});
    if (url === '/api/student-portal/requests' && options.method === 'POST') {
      const body = JSON.parse(options.body);
      requestPosts.push(body);
      if (failRequestAt === requestPosts.length) return {ok:false,json:async()=>({error:'Simulated pending request conflict'})};
      pending.push({requestId:'request-'+requestPosts.length,studentId:body.studentId,requestType:body.requestType,
        status:'PENDING',fullName:learners.find(s=>s.studentId===body.studentId)?.fullName,requestedBy:'Teacher'});
      return ok({requestId:'request-'+requestPosts.length,status:'PENDING'});
    }
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
    return key === 'schoolAttendance.user' ? JSON.stringify({role,schoolCode:'TEST'}) : 'test-token';
  }};
  vm.runInNewContext(source, {
    document, window, sessionStorage, fetch, Headers, URL, Blob,
    MutationObserver: class {observe(){}},
    CustomEvent: class {constructor(type){this.type=type;}}
  }, {filename: 'student-portal-accounts.js'});
  return {
    element, posts, requestPosts, pending, learners,
    async ready() { await new Promise(resolve => setImmediate(resolve)); },
    selectAll() {
      const checkbox = element('sapSelectAll');
      checkbox.checked = true;
      checkbox.listeners.get('change')({target:checkbox});
    },
    async refresh() { await element('sapRefresh').listeners.get('click')(); },
    async apply() { await element('sapBulkCreate').listeners.get('click')(); },
    async submitRequest(reason = 'School requires these learners to access their attendance.') {
      element('sapReason').value = reason;
      await element('sapRequestForm').listeners.get('submit')({preventDefault(){}});
    }
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


test('teacher batch selection requests access for 28 existing learners, without issuing credentials', async () => {
  const app=browserFixture({role:'TEACHER'});
  await app.ready();
  assert.equal(app.element('sapBulkToolbar').hidden,false,'Teachers should see batch controls');
  app.selectAll();
  assert.match(app.element('sapSelectedCount').textContent,/28 selected.*28 eligible/);
  await app.apply();
  assert.equal(app.element('sapRequestModal').hidden,false);
  assert.match(app.element('sapRequestStudent').textContent,/School Admin approval/);
  assert.equal(app.requestPosts.length,0,'Opening review must not create requests');
  await app.submitRequest();
  assert.equal(app.requestPosts.length,28);
  assert.equal(new Set(app.requestPosts.map(r=>r.studentId)).size,28);
  assert.equal(app.requestPosts.every(r=>r.requestType==='CREATE'),true);
  assert.equal(app.posts.length,0,'Teachers must never call the credential provisioning endpoint');
  assert.equal(app.element('sapSecretModal').hidden,true);
  assert.equal(app.element('sapRequestModal').hidden,true);
  assert.match(app.element('sapListCount').textContent,/Sent 28 of 28 account requests/);
});

test('teacher partial batch failure preserves only failed learner for a safe retry', async () => {
  const app=browserFixture({role:'TEACHER',failRequestAt:21});
  await app.ready();
  app.selectAll();
  await app.apply();
  await app.submitRequest();
  assert.equal(app.requestPosts.length,28);
  assert.equal(app.pending.length,27);
  assert.equal(app.element('sapRequestModal').hidden,false);
  assert.match(app.element('sapSelectedCount').textContent,/1 selected.*1 eligible/);
  assert.match(app.element('sapRequestFeedback').textContent,/Sent 27 of 28/);
  await app.submitRequest();
  assert.equal(app.requestPosts.length,29,'Only the failed student should be retried');
  assert.equal(app.pending.length,28);
  assert.equal(app.element('sapRequestModal').hidden,true);
  assert.equal(app.posts.length,0);
});

test('new account creation needs no written explanation for a full class', async () => {
  const app=browserFixture({role:'TEACHER'});
  await app.ready();
  app.selectAll();
  await app.apply();
  assert.equal(app.element('sapReasonGroup').hidden,true);
  await app.submitRequest('');
  assert.equal(app.requestPosts.length,28);
  assert.equal(app.requestPosts.every(r=>r.reason===''),true);
  assert.equal(app.element('sapRequestModal').hidden,true);
});

test('disabled-account reactivation still requires a reason', async () => {
  const app=browserFixture({role:'TEACHER'});
  await app.ready();
  app.learners[0].hasAccount=true;
  app.learners[0].accountActive=false;
  await app.refresh();
  app.element('sapBatchAction').value='ACTIVATE';
  app.selectAll();
  await app.apply();
  assert.equal(app.element('sapReasonGroup').hidden,false);
  assert.equal(app.element('sapReason').required,true);
  await app.submitRequest('');
  assert.equal(app.requestPosts.length,0);
  assert.match(app.element('sapRequestFeedback').textContent,/reactivation reason/);
  await app.submitRequest('Reactivation authorized by the school.');
  assert.equal(app.requestPosts.length,1);
  assert.equal(app.requestPosts[0].requestType,'ACTIVATE');
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
