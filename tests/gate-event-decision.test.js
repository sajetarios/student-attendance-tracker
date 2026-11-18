'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decideNextGateEvent } = require('../gate-event-decision');

test('first gate scan can record time-in', () => {
  assert.deepEqual(decideNextGateEvent([]), { status: 'READY', eventType: 'TIME_IN' });
});
test('verified existing time-in permits time-out', () => {
  assert.deepEqual(decideNextGateEvent(['TIME_IN']), { status: 'READY', eventType: 'TIME_OUT' });
});
test('completed day cannot be recorded again', () => {
  assert.deepEqual(decideNextGateEvent(['TIME_IN','TIME_OUT']), { status: 'COMPLETE', reason: 'DAY_ALREADY_COMPLETE' });
});
test('out-of-order or duplicate histories require review', () => {
  for (const events of [['TIME_OUT'],['TIME_IN','TIME_IN'],['TIME_OUT','TIME_IN'],['TIME_IN','TIME_OUT','TIME_IN'],['INVALID'],null]) {
    assert.equal(decideNextGateEvent(events).status, 'REVIEW');
  }
});

test('accepts authoritative database event objects', () => {
  assert.deepEqual(decideNextGateEvent([{ eventType: 'TIME_IN' }]), { status: 'READY', eventType: 'TIME_OUT' });
});
test('rejects missing, null and malformed event objects', () => {
  for (const events of [[{}],[null],[{eventType: null}],[{eventType: 'DTR_SLOT'}],[42]]) {
    assert.deepEqual(decideNextGateEvent(events), { status: 'REVIEW', reason: 'INVALID_HISTORY' });
  }
});
test('does not mutate supplied gate history', () => {
  const events = Object.freeze([Object.freeze({ eventType: 'TIME_IN' })]);
  decideNextGateEvent(events);
  assert.equal(events[0].eventType, 'TIME_IN');
});
