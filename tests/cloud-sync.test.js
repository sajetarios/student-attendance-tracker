'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const originalKey = process.env.CLOUD_SYNC_ENCRYPTION_KEY;
process.env.CLOUD_SYNC_ENCRYPTION_KEY = 'a'.repeat(64);
const { encryptCloudToken, decryptCloudToken } = require('../cloud-sync-security');
const { retryDelayMs } = require('../cloud-sync-worker');

test('cloud sync credential encryption round-trips using AES-256-GCM', () => {
  const token = 'example-token-that-is-long-enough-for-cloud-sync';
  const encrypted = encryptCloudToken(token);
  assert.equal(decryptCloudToken({
    cloud_auth_token_ciphertext: encrypted.ciphertext,
    cloud_auth_token_iv: encrypted.iv,
    cloud_auth_token_tag: encrypted.authTag
  }), token);
});

test('cloud sync credential decryption rejects modified authentication tags', () => {
  const encrypted = encryptCloudToken('another-example-token-that-is-long-enough');
  const changedTag = Buffer.from(encrypted.authTag);
  changedTag[0] ^= 0xff;
  assert.throws(() => decryptCloudToken({
    cloud_auth_token_ciphertext: encrypted.ciphertext,
    cloud_auth_token_iv: encrypted.iv,
    cloud_auth_token_tag: changedTag
  }));
});

test('cloud sync encryption key must be 32 bytes encoded as hexadecimal', () => {
  process.env.CLOUD_SYNC_ENCRYPTION_KEY = 'too-short';
  assert.throws(() => encryptCloudToken('a-long-enough-token-value-for-the-test'));
  process.env.CLOUD_SYNC_ENCRYPTION_KEY = 'a'.repeat(64);
});

test('cloud sync retry delay increases and remains capped', () => {
  assert.equal(retryDelayMs(1), 5000);
  assert.equal(retryDelayMs(2), 10000);
  assert.equal(retryDelayMs(30), 6 * 60 * 60 * 1000);
});

test.after(() => {
  if (originalKey === undefined) delete process.env.CLOUD_SYNC_ENCRYPTION_KEY;
  else process.env.CLOUD_SYNC_ENCRYPTION_KEY = originalKey;
});
