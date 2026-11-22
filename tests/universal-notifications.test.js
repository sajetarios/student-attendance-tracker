'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = file => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');

test('All dashboard roles use the new notification bell without replacing the approval inbox', () => {
  const portals = ['public/portal.html', 'public/parent-portal.html', 'public/student-portal.html'];
  for (const file of portals) {
    const html = load(file);
    assert.match(html, new RegExp('universal-notifications\\.js\\?v='+(file==='public/portal.html'?'7':'5')));
    assert.match(html, /universal-notifications\.css\?v=4/);
  }
  assert.match(load('public/portal.html'), /id="adminNotificationBell"/);
  assert.match(load('public/universal-notifications.js'), /SUPER_ADMIN/);
  assert.match(load('public/universal-notifications.js'), /universal-center/);
});
test('Notification APIs authorize through server sessions, never client-supplied tenant IDs', () => {
  const route = load('notification-routes.js');
  assert.match(route, /mount\('\/api\/notifications', auth\.authenticateSchoolClient\)/);
  assert.match(route, /mount\('\/api\/platform\/notifications', auth\.authenticatePlatform\)/);
  assert.match(route, /a\.studentAccountId/);
  assert.match(route, /a\.schoolId/);
  assert.match(route, /school_id IS NOT DISTINCT FROM \$3/);
  assert.match(route, /notification_id=\$4/);
  assert.doesNotMatch(route, /req\.body\.(?:schoolId|userId|recipientId)/);
});
test('Approval notifications are transaction-bound, unique and handle batch requests', () => {
  const sql = load('migrations/049_universal_request_notifications.sql');
  for (const table of ['student_account_requests', 'guardian_change_requests', 'profile_photo_requests',
    'special_program_change_requests', 'parent_student_links']) {
    assert.match(sql, new RegExp('ON ' + table + '\\b'));
  }
  assert.match(sql, /ON CONFLICT\(recipient_kind,recipient_id,event_key\)/);
  assert.match(sql, /special-program-batch:/);
  assert.match(sql, /PARTIALLY_APPROVED/);
  assert.match(load('scripts/migrate.js'), /049_universal_request_notifications\.sql/);
  assert.match(load('server.js'), /registerNotificationRoutes\(app, pool/);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\s+(?:students|attendance_events|student_enrollments)\b/i);
});
