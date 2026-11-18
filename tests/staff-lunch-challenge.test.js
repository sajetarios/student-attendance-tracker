'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLunchChallenge, hashLunchChallenge, isLunchChallengeRedeemable, validateLunchSlot } = require('../staff-lunch-challenge');
const issued = Date.parse('2026-11-18T04:00:00Z');
test('only approved lunch DTR slots may receive rotating challenges', () => {
 for (const slot of ['AM_OUT', 'PM_IN']) assert.equal(validateLunchSlot(slot), slot);
 for (const slot of ['AM_IN', 'PM_OUT', 'GATE_MOVEMENT', '', null]) assert.throws(() => validateLunchSlot(slot));
});
test('lunch tokens are random, hashed, and expire within five minutes', () => {
 const a = createLunchChallenge({slot:'AM_OUT',now:issued});
 const b = createLunchChallenge({slot:'AM_OUT',now:issued});
 assert.notEqual(a.token,b.token);
 assert.equal(a.token.length,43);
 assert.equal(hashLunchChallenge(a.token),a.challengeHash);
 assert.notEqual(a.challengeHash,a.token);
 assert.equal(a.expiresAt.getTime()-issued,60_000);
 for(const ttlMs of [0,-1,300_001,Infinity,1.5]) assert.throws(()=>createLunchChallenge({slot:'PM_IN',now:issued,ttlMs}));
 assert.throws(()=>hashLunchChallenge('weak'));
});
test('challenge validation fails closed for expiry, revocation, slot, date and clock anomalies', () => {
 const base = {dtr_slot:'AM_OUT',school_date:'2026-11-18',issued_at:new Date(issued).toISOString(),expires_at:new Date(issued+60_000).toISOString(),revoked_at:null};
 const check=(challenge,now=issued+1000,slot='AM_OUT',schoolDate='2026-11-18')=>isLunchChallengeRedeemable(challenge,{now,slot,schoolDate});
 assert.equal(check(base),true);
 assert.equal(check(base,issued-1),false);
 assert.equal(check(base,issued+60_000),false);
 assert.equal(check({...base,revoked_at:new Date().toISOString()}),false);
 assert.equal(check(base,issued+1000,'PM_IN'),false);
 assert.equal(check(base,issued+1000,'AM_OUT','2026-11-19'),false);
 assert.equal(check({...base,expires_at:new Date(issued+300_001).toISOString()}),false);
 assert.equal(check({...base,issued_at:'invalid'}),false);
});
