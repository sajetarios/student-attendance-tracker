'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { publicSf2Failure } = require('../sf2-error-guard');
const registerSf2Routes = require('../sf2-routes');

test('SF2 keeps intended validation messages but redacts unexpected server errors', () => {
  for (const status of [400, 403, 409]) {
    assert.deepEqual(publicSf2Failure({ status, message: 'Review the selected SF2 section.' }, 'Try again.'), {
      status, error: 'Review the selected SF2 section.'
    });
  }
  for (const status of [undefined, 500, 503, 599, 200]) {
    const result = publicSf2Failure({ status, message: 'SQL password=secret host=internal' }, 'Could not prepare SF2.');
    assert.deepEqual(result, { status: 500, error: 'Could not prepare SF2.' });
  }
  assert.deepEqual(publicSf2Failure(null, 'SF2 unavailable.'), { status: 500, error: 'SF2 unavailable.' });
});

test('SF2 submission handles failed DB pool acquisition without uncaught rejection or leaked SQL', async () => {
  const routes = new Map();
  const app = Object.fromEntries(['get', 'put', 'post', 'patch', 'delete'].map(method =>
    [method, (path, ...handlers) => routes.set(method.toUpperCase() + ' ' + path, handlers.at(-1))]));
  const pool = {
    query: async () => ({ rows: [], rowCount: 0 }), // migrations installed in isolated test
    connect: async () => { throw new Error('private DSN and SQL statement must never reach client'); }
  };
  const noop = () => {};
  registerSf2Routes(app, pool, {
    authenticateSchoolClient: noop,
    requireSchoolUser: noop,
    requireSchoolAdmin: noop,
    requireSchoolAdminOrDepartmentHead: noop
  });
  const handler = routes.get('POST /api/sf2/submissions');
  assert.equal(typeof handler, 'function');
  const response = {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; }
  };
  const request = {
    auth: { role: 'TEACHER', teacherDesignations: ['CLASS_ADVISER'] },
    body: { month: '2026-11', gradeLevel: 'Grade 8', section: 'Synthetic' }
  };
  const originalError = console.error;
  console.error = () => {}; // Do not print fabricated internal error details in test logs
  try {
    await handler(request, response);
  } finally {
    console.error = originalError;
  }
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.payload, { error: 'Could not submit the official SF2.' });
});
