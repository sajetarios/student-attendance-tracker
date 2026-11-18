'use strict';
const crypto = require('node:crypto');
const LUNCH_SLOTS = Object.freeze(['AM_OUT', 'PM_IN']);
const MAX_CHALLENGE_MS = 5 * 60 * 1000;
function validateLunchSlot(slot) {
  if (!LUNCH_SLOTS.includes(slot)) throw new RangeError('Invalid lunch attendance slot');
  return slot;
}
function createLunchChallenge({ slot, now = Date.now(), ttlMs = 60_000 } = {}) {
  validateLunchSlot(slot);
  if (!Number.isSafeInteger(now) || now < 0) throw new RangeError('Invalid issue time');
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_CHALLENGE_MS) throw new RangeError('Invalid challenge lifetime');
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, challengeHash: hashLunchChallenge(token), issuedAt: new Date(now), expiresAt: new Date(now + ttlMs) };
}
function hashLunchChallenge(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new TypeError('Invalid challenge token');
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}
function isLunchChallengeRedeemable(challenge, { now = Date.now(), slot, schoolDate } = {}) {
  if (!challenge || !LUNCH_SLOTS.includes(slot) || challenge.dtr_slot !== slot) return false;
  if (typeof schoolDate !== 'string' || challenge.school_date !== schoolDate) return false;
  const issued = Date.parse(challenge.issued_at), expires = Date.parse(challenge.expires_at);
  if (![issued, expires, now].every(Number.isFinite)) return false;
  if (expires <= issued || expires - issued > MAX_CHALLENGE_MS) return false;
  if (now < issued || now >= expires || challenge.revoked_at != null) return false;
  return true;
}
module.exports = { LUNCH_SLOTS, MAX_CHALLENGE_MS, validateLunchSlot, createLunchChallenge, hashLunchChallenge, isLunchChallengeRedeemable };
