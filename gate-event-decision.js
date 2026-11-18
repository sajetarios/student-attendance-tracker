'use strict';

/**
 * Pure, fail-closed physical gate-event state machine.
 * The caller MUST load authoritative, ordered, committed school-scoped events
 * under a transaction lock. This helper never reads client-supplied history.
 * Form 48 DTR slots and classroom attendance must not be passed to it.
 */
function decideNextGateEvent(events) {
  if (!Array.isArray(events)) return { status: 'REVIEW', reason: 'INVALID_HISTORY' };
  const normalized = events.map(event => {
    if (typeof event === 'string') return event.toUpperCase();
    if (!event || typeof event !== 'object') return null;
    return typeof event.eventType === 'string' ? event.eventType.toUpperCase() : null;
  });
  if (normalized.some(event => !['TIME_IN', 'TIME_OUT'].includes(event))) {
    return { status: 'REVIEW', reason: 'INVALID_HISTORY' };
  }
  if (normalized.length === 0) return { status: 'READY', eventType: 'TIME_IN' };
  if (normalized.length === 1 && normalized[0] === 'TIME_IN') {
    return { status: 'READY', eventType: 'TIME_OUT' };
  }
  if (normalized.length === 2 && normalized[0] === 'TIME_IN' && normalized[1] === 'TIME_OUT') {
    return { status: 'COMPLETE', reason: 'DAY_ALREADY_COMPLETE' };
  }
  return { status: 'REVIEW', reason: 'AMBIGUOUS_HISTORY' };
}

module.exports = { decideNextGateEvent };
