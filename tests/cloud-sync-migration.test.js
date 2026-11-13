'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migrationsDir = path.join(root, 'migrations');
const { REQUIRED_MIGRATIONS } = require('../scripts/migrate');

test('migration runner requires all fourteen migrations in exact order', () => {
  const actual = fs.readdirSync(migrationsDir)
    .filter(name => /^\d{3}_[a-z0-9_]+\.sql$/i.test(name))
    .sort();
  assert.equal(REQUIRED_MIGRATIONS.length, 14);
  assert.deepEqual(actual, REQUIRED_MIGRATIONS);
  assert.equal(REQUIRED_MIGRATIONS.at(-1), '014_cloud_master_data_replication.sql');
});

test('cloud master-data migration adds receipt tracking and pauses old forwarding', () => {
  const sql = fs.readFileSync(
    path.join(migrationsDir, '014_cloud_master_data_replication.sql'),
    'utf8'
  );
  assert.match(sql, /ADD COLUMN IF NOT EXISTS login_enabled BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.match(sql, /last_master_data_sync_url TEXT/);
  assert.match(sql, /last_master_data_sync_cloud_received_at TIMESTAMPTZ/);
  assert.match(sql, /last_master_data_sync_cloud_imported JSONB/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS cloud_sync_master_data_receipts/);
  assert.match(sql, /UPDATE school_cloud_sync_settings SET enabled=FALSE/);
});
