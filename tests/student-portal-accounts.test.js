'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const routeSource = fs.readFileSync(path.join(root, 'student-portal-account-routes.js'), 'utf8');
const {registerStudentPortalAccountRoutes} = require('../student-portal-account-routes');

function fixture(rows = []) {
  const routes = new Map();
  const calls = [];
  const query = async (sql, params = []) => {
    calls.push({sql: String(sql), params});
    return {rows, rowCount: rows.length};
  };
  const pool = {
    query,
    async connect() { return {query,release() {}}; }
  };
  const app = {};
  for (const verb of ['get','post','patch']) {
    app[verb] = (url, ...handlers) => routes.set(verb.toUpperCase() + ' ' + url, handlers);
  }
  const authenticateSchoolClient = (_req, _res, next) => next();
  const requireSchoolRoles = (...allowed) => (req, res, next) => {
    if (!allowed.includes(req.auth.role)) return res.status(403).json({error:'Denied'});
    return next();
  };
  registerStudentPortalAccountRoutes(app, pool, {authenticateSchoolClient,requireSchoolRoles});
  const invoke = async (verb, url, role = 'TEACHER', body = {}, params = {}) => {
    const handlers = routes.get(verb.toUpperCase() + ' ' + url);
    assert.ok(handlers, 'Missing endpoint '+verb+' '+url);
    const req = {
      auth:{role, schoolId:'school-test', userId:'teacher-test'},
      body, params
    };
    let status = 200, payload = null;
    const res = {
      status(code) { status=code; return this; },
      json(value) { payload=value; return this; }
    };
    for (const handler of handlers) {
      if (handler.length >= 3) {
        let passed=false;
        await handler(req,res,()=>{passed=true;});
        if (!passed) break;
      } else {
        await handler(req,res);
      }
    }
    return {status,payload};
  };
  return {invoke,calls,routes};
}

test('School Admin only: issuing, bulk issuing, reviews and suspension are forbidden to teachers', async()=>{
  const {invoke,calls} = fixture();
  for (const [method,url,body,params] of [
    ['POST','/api/student-portal/accounts/:studentId/provision',{action:'CREATE'},{studentId:'001'}],
    ['POST','/api/student-portal/accounts/bulk-provision',{studentIds:['001']},{}],
    ['POST','/api/student-portal/requests/:requestId/review',{decision:'APPROVE'},{requestId:'00000000-0000-4000-8000-000000000001'}],
    ['PATCH','/api/student-portal/accounts/:studentId/status',{active:false},{studentId:'001'}]
  ]) {
    const result=await invoke(method,url,'TEACHER',body,params);
    assert.equal(result.status,403,method+' '+url);
  }
  assert.equal(calls.length,0,'Denied actions must not query the database');
});

test('Teacher directory uses existing school and assignment permissions',async()=>{
  const {invoke,calls}=fixture();
  const response=await invoke('GET','/api/student-portal/accounts');
  assert.equal(response.status,200);
  assert.deepEqual(response.payload.students,[]);
  assert.deepEqual(calls[0].params,['school-test','teacher-test']);
  assert.match(calls[0].sql,/s\.school_id=\$1/);
  assert.match(calls[0].sql,/teacher_period_assignments/);
  assert.match(calls[0].sql,/class_adviser_assignments/);
  assert.match(calls[0].sql,/teacher_period_substitutions/);
});

test('Teacher requests cannot reference an unassigned learner',async()=>{
  const {invoke,calls}=fixture();
  const response=await invoke('POST','/api/student-portal/requests','TEACHER',
    {studentId:'unknown', requestType:'CREATE',reason:'Learner needs portal login'});
  assert.equal(response.status,403);
  assert.match(response.payload.error,/assigned/);
  assert.equal(calls.filter(call => /INSERT INTO student_account_requests/.test(call.sql)).length,0,
    'No unauthorized request should be inserted');
  assert.match(calls.find(call => /FROM students s/.test(call.sql)).sql,/s\.school_id=\$1/);
});

test('Teacher pending queue is restricted to own request IDs',async()=>{
  const {invoke,calls}=fixture();
  const response=await invoke('GET','/api/student-portal/requests');
  assert.equal(response.status,200);
  assert.deepEqual(calls[0].params,['school-test','teacher-test']);
  assert.match(calls[0].sql,/r\.requested_by_user_id=\$2/);
});

test('Migration preserves existing students and only allows one pending request per learner',()=>{
  const sql=fs.readFileSync(path.join(root,'migrations','031_student_portal_account_requests.sql'),'utf8');
  assert.match(sql,/CREATE TABLE IF NOT EXISTS student_account_requests/);
  assert.match(sql,/student_account_requests_one_pending/);
  assert.match(sql,/status='PENDING'/);
  assert.match(sql,/FOREIGN KEY \(school_id, student_id\) REFERENCES students/);
  assert.doesNotMatch(sql,/DELETE FROM students|UPDATE students SET|TRUNCATE TABLE students/i);
});

test('Portal navigation and account modal are connected to the new API',()=>{
  const portal=fs.readFileSync(path.join(root,'public','portal.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'public','portal.html'),'utf8');
  const ui=fs.readFileSync(path.join(root,'public','student-portal-accounts.js'),'utf8');
  assert.match(portal,/SCHOOL_ADMIN'\) return \['dashboard', 'students', 'studentAccounts'/);
  assert.match(portal,/studentAccountsNav/);
  assert.match(html,/id="studentAccountsView"/);
  for(const id of ['sapRequestModal','sapReviewModal','sapSecretModal','sapRows','sapRequestRows']) {
    assert.ok(html.includes('id="'+id+'"'),'Missing '+id);
  }
  assert.match(ui,/api\/student-portal\/accounts\/bulk-provision/);
  assert.match(ui,/api\/student-portal\/requests/);
  assert.match(routeSource,/mustChangePassword:true/);
  assert.match(routeSource,/UPDATE student_sessions SET revoked_at=NOW/);
});
