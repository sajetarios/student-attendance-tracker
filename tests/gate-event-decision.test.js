'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {decideNextGateEvent}=require('../gate-event-decision');
test('arrival, OB exit, late return and final departure alternate correctly',()=>{
  assert.deepEqual(decideNextGateEvent([]),{status:'READY',eventType:'TIME_IN'});
  assert.deepEqual(decideNextGateEvent(['TIME_IN']),{status:'READY',eventType:'TIME_OUT'});
  assert.deepEqual(decideNextGateEvent(['TIME_IN','TIME_OUT']),{status:'READY',eventType:'TIME_IN'});
  assert.deepEqual(decideNextGateEvent(['TIME_IN','TIME_OUT','TIME_IN']),{status:'READY',eventType:'TIME_OUT'});
  assert.deepEqual(decideNextGateEvent(['TIME_IN','TIME_OUT','TIME_IN','TIME_OUT']),{status:'READY',eventType:'TIME_IN'});
});
test('invalid and ambiguous histories fail closed',()=>{
  for(const events of [null,['TIME_OUT'],['TIME_IN','TIME_IN'],['TIME_OUT','TIME_IN'],['INVALID'],[{}],[null],[42],[{eventType:'DTR_SLOT'}]]){
    assert.equal(decideNextGateEvent(events).status,'REVIEW');
  }
});
test('accepts frozen authoritative rows without mutation',()=>{
  const events=Object.freeze([Object.freeze({eventType:'TIME_IN'}),Object.freeze({eventType:'TIME_OUT'})]);
  assert.equal(decideNextGateEvent(events).eventType,'TIME_IN');
  assert.equal(events.length,2);
});
