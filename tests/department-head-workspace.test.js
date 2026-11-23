'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registerDepartmentWorkspaceRoutes } = require('../department-workspace-routes');
const { registerStaffObRoutes } = require('../staff-ob-routes');

const schoolId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const departmentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const userId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
function register(registerFunction, pool) {
  const routes = new Map();
  const app = {
    get(url, ...handlers) { routes.set('GET ' + url, handlers); },
    post(url, ...handlers) { routes.set('POST ' + url, handlers); }
  };
  const authenticate = (_req, _res, next) => next();
  const requireRoles = (...roles) => (req, res, next) => {
    if (!roles.includes(req.auth?.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
  registerFunction(app, pool, { authenticateSchoolClient: authenticate, requireSchoolRoles: requireRoles });
  return routes;
}
async function invoke(routes, method, url, req = {}) {
  const handlers = routes.get(method + ' ' + url);
  assert.ok(handlers, method + ' ' + url + ' is registered');
  const request = {
    auth: { type: 'SCHOOL_USER', role: 'DEPARTMENT_HEAD', schoolId, departmentId, userId },
    query: {}, body: {}, headers: {}, ip: '127.0.0.1', method, path: url, ...req
  };
  const response = {
    statusCode: 200, body: undefined, headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    set(k, v) { this.setHeader(k, v); return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
    end() { this.body = null; return this; }
  };
  for (const handler of handlers) {
    if (response.body !== undefined) break;
    if (handler.length >= 3) {
      await new Promise((resolve, reject) => {
        try {
          const result = handler(request, response, resolve);
          if (result?.then) result.catch(reject);
          if (response.body !== undefined) resolve();
        } catch (error) { reject(error); }
      });
    } else {
      await handler(request, response);
    }
  }
  return response;
}

test('Department Head-only overview never queries another school or department', async () => {
  const calls = [];
  const pool = { async query(sql, args) {
    calls.push({ sql, args });
    if (sql.includes('FROM school_users u')) return { rows: [{
      userId, displayName: 'Sample teacher', active: true,
      teacherStatus: 'ACTIVE', assignedPeriods: 4, activeSubstitutions: 1
    }] };
    if (sql.includes('verifiedGateArrivals')) return { rows: [{ verifiedGateArrivals: 1 }] };
    return { rows: [{ count: 0 }] };
  }};
  const routes = register(registerDepartmentWorkspaceRoutes, pool);
  const response = await invoke(routes, 'GET', '/api/department-head/overview', {
    query: { schoolId: 'UNTRUSTED', departmentId: 'UNTRUSTED' }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.teachers[0].assignedPeriods, 4);
  assert.equal(response.body.summary.verifiedGateArrivals, 1);
  assert.match(response.body.attendanceNote, /not official attendance/i);
  assert.equal(calls.length, 4);
  for (const call of calls) assert.deepEqual(call.args, [schoolId, departmentId]);
  assert.ok(calls.every(call => call.sql.includes('$1') && call.sql.includes('$2')));
});

test('Missing department or unauthorized role cannot access monitoring or notices', async () => {
  const pool = { async query() { throw new Error('Should not query database'); } };
  const routes = register(registerDepartmentWorkspaceRoutes, pool);
  for (const route of ['GET /api/department-head/overview', 'GET /api/department-head/announcements',
      'POST /api/department-head/announcements']) {
    const [method, url] = route.split(' ');
    const missing = await invoke(routes, method, url, {
      auth: { role: 'DEPARTMENT_HEAD', schoolId, departmentId: null, userId }
    });
    assert.equal(missing.statusCode, 403);
    const teacher = await invoke(routes, method, url, {
      auth: { role: 'TEACHER', schoolId, departmentId, userId }
    });
    assert.equal(teacher.statusCode, 403);
  }
});

test('Announcements are always scoped to current authenticated department', async () => {
  const calls = [];
  const routes = register(registerDepartmentWorkspaceRoutes, {
    async query(sql, args) {
      calls.push({ sql, args });
      return { rows: [], rowCount: 2 };
    }
  });
  const list = await invoke(routes, 'GET', '/api/department-head/announcements');
  assert.equal(list.statusCode, 200);
  assert.deepEqual(calls[0].args, [schoolId, userId, departmentId]);
  const body = { title: 'Meeting reminder', body: 'Please attend the subject meeting.' };
  const send = await invoke(routes, 'POST', '/api/department-head/announcements', {
    body, headers: { 'content-type': 'application/json', host: 'attendigo.tech', origin: 'https://attendigo.tech' }
  });
  assert.equal(send.statusCode, 201);
  assert.equal(send.body.recipients, 2);
  assert.deepEqual(calls[1].args.slice(0, 2), [schoolId, departmentId]);
  assert.match(calls[1].sql, /u\.department_id=\$2/);
  assert.match(calls[1].sql, /u\.active=TRUE/);
  assert.match(calls[1].args[2], /^DEPT_NOTICE:/);
});

test('Cross-origin department announcements fail before any write', async () => {
  let writes = 0;
  const routes = register(registerDepartmentWorkspaceRoutes, {
    async query() { writes++; return { rows: [], rowCount: 0 }; }
  });
  const result = await invoke(routes, 'POST', '/api/department-head/announcements', {
    headers: { 'content-type': 'application/json', host: 'attendigo.tech', origin: 'https://untrusted.test' },
    body: { title: 'A notice', body: 'Some information' }
  });
  assert.equal(result.statusCode, 403);
  assert.equal(writes, 0);
});

test('OB personal scope uses authenticated user instead of client supplied user', async () => {
  const calls = [];
  const routes = register(registerStaffObRoutes, {
    async query(sql, args) {
      calls.push({ sql, args });
      return { rows: [], rowCount: 0 };
    }
  });
  const own = await invoke(routes, 'GET', '/api/staff-attendance/official-business', {
    query: { scope: 'mine', userId: 'UNTRUSTED' }
  });
  assert.equal(own.statusCode, 200);
  assert.deepEqual(calls[0].args, [schoolId, userId]);
  assert.match(calls[0].sql, /o\.staff_user_id=\$2/);
  const department = await invoke(routes, 'GET', '/api/staff-attendance/official-business', {
    query: { scope: 'department' }
  });
  assert.equal(department.statusCode, 200);
  assert.deepEqual(calls[1].args, [schoolId, departmentId, userId]);
  assert.match(calls[1].sql, /o\.staff_user_id<>\$3/);
  assert.match(calls[1].sql, /o\.department_id=\$2/);
});

test('Department Head DTR and QR require backend role permission and physical photo checks', () => {
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const dtr = fs.readFileSync(path.join(__dirname, '../staff-gate-dtr-routes.js'), 'utf8');
  const frontend = fs.readFileSync(path.join(__dirname, '../public/portal.js'), 'utf8');
  assert.match(server, /my-gate-attendance'[\s\S]{0,100}requireSchoolRoles\('TEACHER', 'DEPARTMENT_HEAD', 'SCHOOL_ADMIN','PRINCIPAL'\)/);
  assert.match(server, /my\/badge'[\s\S]{0,100}requireSchoolRoles\('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN','PRINCIPAL'\)/);
  assert.match(server, /teacher_qr_token=\$2 AND role IN \('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN','PRINCIPAL'\)/);
  assert.match(dtr, /my\/dtr-history'[\s\S]{0,110}requireSchoolRoles\('TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN','PRINCIPAL'\)/);
  assert.match(dtr, /photoVerified!==true/);
  assert.match(frontend, /if \(role === 'DEPARTMENT_HEAD'\) return \[[^\]]*'myGateAttendance'/);
});

test('Department Head navigation stays separated and other roles keep their routes', () => {
  const portal = fs.readFileSync(path.join(__dirname, '../public/portal.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(portal, /relocate\('myGateAttendanceNav', 'personalAttendance'\)/);
  assert.match(portal, /relocate\('officialBusinessNav', 'operations'\)/);
  assert.match(portal, /'Requests & Approvals'/);
  assert.match(portal, /'My Attendance'/);
  assert.match(server, /const ownDepartment = req\.auth\.role === 'DEPARTMENT_HEAD'/);
  assert.match(server, /su\.department_id=\$2::uuid/);
  assert.match(server, /substitute\.department_id=\$2::uuid/);
});

test('Universal notifications restore from server-verified cookie rather than a cached role', () => {
  const notice = fs.readFileSync(path.join(__dirname, '../public/universal-notifications.js'), 'utf8');
  assert.match(notice, /fetch\('\/api\/auth\/me'/);
  assert.match(notice, /credentials: 'same-origin'/);
  assert.match(notice, /const user = verified\?\.user/);
  assert.doesNotMatch(notice, /if \(!token\) return;/);
});
