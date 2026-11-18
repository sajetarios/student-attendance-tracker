'use strict';

/**
 * Conservative next-event decision for school gate attendance.
 * Only committed, server-authoritative events may be passed here.
 * Ambiguous or repeated events are never silently converted into a punch.
 */
function decideNextGateEvent(events) {
  if (!Array.isArray(events)) return { status: 'REVIEW', reason: 'INVALID_HISTORY' };
  const normalized = events.map(e => String(typeof e === 'string' ? e : e?.eventType || '').toUpperCase());
  if (normalized.some(e => !['TIME_IN', 'TIME_OUT'].includes(e))) return { status: 'REVIEW', reason: 'INVALID_HISTORY' };
  if (normalized.length === 0) return { status: 'READY', eventType: 'TIME_IN' };
  if (normalized.length === 1 && normalized[0] === 'TIME_IN') return { status: 'READY', eventType: 'TIME_OUT' };
  if (normalized.length === 2 && normalized[0] === 'TIME_IN' && normalized[1] === 'TIME_OUT')
    return { status: 'COMPLETE', reason: 'DAY_ALREADY_COMPLETE' };
  return { status: 'REVIEW', reason: 'AMBIGUOUS_HISTORY' };
}

module.exports = { decideNextGateEvent };
