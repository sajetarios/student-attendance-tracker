'use strict';

const crypto = require('node:crypto');

function getEncryptionKey() {
  const value = process.env.CLOUD_SYNC_ENCRYPTION_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error('CLOUD_SYNC_ENCRYPTION_KEY must be a 64-character hexadecimal key.');
  }
  return Buffer.from(value, 'hex');
}

function encryptCloudToken(token) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) {
    throw new Error('Cloud sync credential is invalid.');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

function decryptCloudToken(row) {
  if (!row || !row.cloud_auth_token_ciphertext || !row.cloud_auth_token_iv || !row.cloud_auth_token_tag) {
    throw new Error('Cloud sync credential has not been configured.');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(row.cloud_auth_token_iv)
  );
  decipher.setAuthTag(Buffer.from(row.cloud_auth_token_tag));
  return Buffer.concat([
    decipher.update(Buffer.from(row.cloud_auth_token_ciphertext)),
    decipher.final()
  ]).toString('utf8');
}

module.exports = { encryptCloudToken, decryptCloudToken };
