'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { registerPlatformSchoolDeletionRoutes } = require('../platform-school-deletion-routes');

const schoolId = '12345678-1234-4123-8123-123456789012';
const userId = '76543210-1234-4123-8123-123456789012';
const backupId = 'aaaaaaaa-1234-4123-8123-123456789012';

function setup({ failSnapshot = false } = {}) {
  const routes = {};
  const actions = [];
  const app = {
    get(path, ...handlers) { routes['GET ' + path] = handlers.at(-1); },
    delete(path, ...handlers) { routes['DELETE ' + path] = handlers.at(-1); }
  };
  const impact = {
    students: 2, accounts: 1, attendanceEvents: 3,
    sf2Submissions: 0, manualMarks: 1, manualNotes: 0, pendingSync: 0
  };
  async function query(sql) {
    actions.push(sql);
    if (sql.startsWith('SELECT school_id AS')) return { rowCount: 1, rows: [{
      schoolId, schoolCode: 'TEST2026', schoolName: 'Test School', active: true
    }] };
    if (sql.startsWith('SELECT (SELECT count')) return { rowCount: 1, rows: [impact] };
    if (sql.includes('FOR UPDATE')) return { rowCount: 1, rows: [{ school_id: schoolId }] };
    if (sql.startsWith('INSERT INTO platform_school_deletion_backups')) return { rowCount: 1, rows: [{ backupId }] };
    if (sql.startsWith('SELECT c.table_name')) return { rows: [
      { table_name: 'schools' }, { table_name: 'students' }
    ] };
    if (sql.startsWith('INSERT INTO platform_school_deletion_backup_rows')) {
      if (failSnapshot) throw new Error('backup storage unavailable');
      return { rowCount: sql.includes('sms_outbox') ? 0 : 1 };
    }
    if (sql.startsWith('SELECT COUNT(*)::int AS count FROM platform_school_deletion_backup_rows'))
      return { rows: [{ count: 2 }] };
    if (sql.startsWith('SELECT child.relname')) return { rows: [] };
    if (sql.startsWith('DELETE FROM schools')) return { rowCount: 1 };
    return { rowCount: 1, rows: [] };
  }
  const pool = { query, connect: async () => ({ query, release() {} }) };
  registerPlatformSchoolDeletionRoutes(app, pool, {
    authenticatePlatform(_req, _res, next) { next(); },
    requirePlatformAdmin(_req, _res, next) { next(); }
  });
  async function call(method, body = {}) {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(result) { this.body = result; return this; }
    };
    await routes[method + ' /api/platform/schools/:schoolId' +
      (method === 'GET' ? '/deletion-preview' : '')]({
      params: { schoolId }, body, auth: { userId }
    }, res);
    return res;
  }
  return { call, actions };
}

test('deletion requires a preview, then exact second confirmation', async () => {
  const { call, actions } = setup();
  const withoutPreview = await call('DELETE', { previewToken: 'invalid', confirmationPhrase: 'DELETE TEST2026' });
  assert.equal(withoutPreview.statusCode, 409);
  assert.equal(actions.length, 0);
  const preview = await call('GET');
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.body.school.impact.attendanceEvents, 3);
  const incorrect = await call('DELETE', {
    previewToken: preview.body.previewToken, confirmationPhrase: 'DELETE WRONG'
  });
  assert.equal(incorrect.statusCode, 409);
  assert.equal(actions.some(sql => sql.includes('DELETE FROM schools')), false);
  const deleted = await call('DELETE', {
    previewToken: preview.body.previewToken, confirmationPhrase: 'DELETE TEST2026'
  });
  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.body.backupId, backupId);
  assert.equal(deleted.body.backedUpRows, 2);
  assert.ok(actions.some(sql => sql === 'COMMIT'));
  assert.ok(actions.some(sql => sql.includes('DELETE FROM public."students"')));
  const duplicate = await call('DELETE', {
    previewToken: preview.body.previewToken, confirmationPhrase: 'DELETE TEST2026'
  });
  assert.equal(duplicate.statusCode, 409);
});

test('failure to store recovery data rolls back without deleting the school', async () => {
  const { call, actions } = setup({ failSnapshot: true });
  const preview = await call('GET');
  const result = await call('DELETE', {
    previewToken: preview.body.previewToken, confirmationPhrase: 'DELETE TEST2026'
  });
  assert.equal(result.statusCode, 500);
  assert.ok(actions.includes('ROLLBACK'));
  assert.equal(actions.some(sql => sql.startsWith('DELETE FROM schools')), false);
});
