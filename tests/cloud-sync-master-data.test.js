'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const {
  validateMasterDataPayload,
  hashPayload,
  safeBootstrapKeyMatch,
  normalizeBootstrapCloudUrl,
  COLLECTIONS
} = require('../cloud-sync-master-data');

const schoolId = '11111111-1111-4111-8111-111111111111';

function validPayload() {
  const payload = {
    schemaVersion: 1,
    schoolId,
    generatedAt: '2026-11-13T12:00:00.000Z',
    school: {
      schoolId,
      schoolCode: 'TEST-SCHOOL',
      schoolName: 'Test School',
      active: true
    }
  };
  for (const collection of COLLECTIONS) payload[collection] = [];
  return payload;
}

test('cloud bootstrap key uses constant-time matching and requires a secure destination URL', () => {
  const key = 'a'.repeat(64);
  assert.equal(safeBootstrapKeyMatch(key, key), true);
  assert.equal(safeBootstrapKeyMatch(key, 'b'.repeat(64)), false);
  assert.equal(safeBootstrapKeyMatch(key, 'not-a-key'), false);
  assert.equal(normalizeBootstrapCloudUrl('https://cloud.example/'), 'https://cloud.example');
  assert.equal(normalizeBootstrapCloudUrl('http://localhost:3000/'), 'http://localhost:3000');
  assert.throws(() => normalizeBootstrapCloudUrl('http://cloud.example'), /Use HTTPS/);
});

test('master-data payload accepts all required collections for the authenticated school', () => {
  assert.equal(validateMasterDataPayload(validPayload(), schoolId), null);
});

test('master-data payload rejects a different school identity', () => {
  const payload = validPayload();
  payload.schoolId = '22222222-2222-4222-8222-222222222222';
  assert.match(validateMasterDataPayload(payload, schoolId), /does not belong/);
});

test('master-data payload rejects a missing collection and oversized collection', () => {
  const missing = validPayload();
  delete missing.schoolCalendar;
  assert.match(validateMasterDataPayload(missing, schoolId), /missing schoolCalendar/);

  const oversized = validPayload();
  oversized.students = Array.from({ length: 25001 }, () => ({}));
  assert.match(validateMasterDataPayload(oversized, schoolId), /exceeds the 25,000 record limit/);
});

test('master-data payload requires a supported schema and valid timestamp', () => {
  const payload = validPayload();
  payload.schemaVersion = 99;
  assert.match(validateMasterDataPayload(payload, schoolId), /Unsupported/);
  payload.schemaVersion = 1;
  payload.generatedAt = 'not-a-date';
  assert.match(validateMasterDataPayload(payload, schoolId), /timestamp is invalid/);
});

test('master-data snapshot hashes are deterministic and change when data changes', () => {
  const first = validPayload();
  const second = validPayload();
  assert.equal(hashPayload(first), hashPayload(second));
  second.school.schoolName = 'Updated School';
  assert.notEqual(hashPayload(first), hashPayload(second));
});

test('master-data snapshot excludes credentials, contacts, photos, and QR secrets', () => {
  const source = fs.readFileSync(path.join(root, 'cloud-sync-master-data.js'), 'utf8');
  const builder = source.slice(
    source.indexOf('async function buildMasterDataSnapshot'),
    source.indexOf('async function importCollection')
  );
  for (const forbidden of ['username', 'password_hash', 'parent_mobile', 'parent_name', 'photo_path', 'qr_token', 'teacher_photo_path', 'teacher_qr_token']) {
    assert.doesNotMatch(builder, new RegExp(forbidden, 'i'), `Snapshot builder must not query ${forbidden}`);
  }
  assert.match(source, /field\.replace\(\/\[A-Z\]\/g/);
  const staffQuery = builder.slice(builder.indexOf("['schoolUsers'"), builder.indexOf("['students'"));
  assert.doesNotMatch(staffQuery, /leave_type|leave_start_date|expected_return_date/i);
  const enrollmentQuery = builder.slice(builder.indexOf("['studentEnrollments'"), builder.indexOf("['studentMovements'"));
  assert.doesNotMatch(enrollmentQuery, /remarks/i);
  assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(source, /A newer master-data snapshot has already been received/);
});

test('cloud staff mirror rows are inserted as non-login identities', () => {
  const source = fs.readFileSync(path.join(root, 'cloud-sync-master-data.js'), 'utf8');
  assert.match(source, /'!CLOUD_SYNC_LOGIN_DISABLED!'/);
  assert.match(source, /FALSE,\s*COALESCE\(x\.created_at/);
  const auth = fs.readFileSync(path.join(root, 'auth-routes.js'), 'utf8');
  const middleware = fs.readFileSync(path.join(root, 'auth-middleware.js'), 'utf8');
  assert.match(auth, /user\.login_enabled === false/);
  assert.match(auth, /su\.login_enabled=TRUE/);
  assert.match(middleware, /su\.login_enabled = TRUE/);
});

test('master-data import endpoint and UI provide the guided sync controls', () => {
  const portalHtml = fs.readFileSync(path.join(root, 'public/portal.html'), 'utf8');
  const portalJs = fs.readFileSync(path.join(root, 'public/portal.js'), 'utf8');
  assert.match(portalHtml, /id="cloudSyncSchoolIdentity"/);
  assert.match(portalHtml, /id="cloudProvisionForm"/);
  assert.match(portalHtml, /id="cloudProvisionKey"/);
  assert.match(portalJs, /cloud-sync\/provision-destination/);
  assert.match(portalHtml, /id="cloudReceiverCredentialState"/);
  assert.match(portalHtml, /id="pushMasterData"/);
  assert.match(portalHtml, /id="masterDataReceiverStatus"/);
  assert.match(portalHtml, /id="cloudForwardingReadiness"/);
  assert.match(portalHtml, /does not propagate deletions/i);
  assert.match(portalJs, /cloud-sync\/master-data\/push/);
  assert.match(portalJs, /cloud-sync\/master-data\/status/);
  const masterRoutes = fs.readFileSync(path.join(root, 'cloud-sync-master-data.js'), 'utf8');
  assert.match(masterRoutes, /confirmedBySource: true/);
  assert.match(masterRoutes, /api\/cloud-sync\/bootstrap-school/);
  assert.match(masterRoutes, /CLOUD_SYNC_PROVISIONING_KEY/);
  assert.match(masterRoutes, /CLOUD_SYNC_BOOTSTRAP_CREATE_SCHOOL/);
  assert.match(masterRoutes, /last_master_data_sync_cloud_received_at=\$4/);
  assert.match(masterRoutes, /last_master_data_sync_cloud_imported=\$5::jsonb/);
});

test('attendance forwarding requires a master-data push to the current destination', () => {
  const routes = fs.readFileSync(path.join(root, 'cloud-sync-routes.js'), 'utf8');
  assert.match(routes, /last_master_data_sync_url === normalizedUrl/);
  assert.match(routes, /if \(enabled && !masterDataSynced\)/);
  assert.match(routes, /Push the current school master data to the verified cloud destination/);
});
