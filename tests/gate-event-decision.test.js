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
