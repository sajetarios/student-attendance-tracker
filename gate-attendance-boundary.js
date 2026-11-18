'use strict';

/**
 * A physical gate scan is never evidence of an approved OB request or an
 * official Form 48 DTR slot. Fail closed if an unsupported recording target
 * is requested by a new automatic Gatekeeper flow.
 */
const PHYSICAL_GATE = 'PHYSICAL_GATE';
function validateAutomaticGateRecording({ actorRole, photoVerified, recordingTarget, clientEventType } = {}) {
  if (actorRole !== 'GATE_KEEPER') return { allowed: false, reason: 'GATEKEEPER_REQUIRED' };
  if (photoVerified !== true) return { allowed: false, reason: 'PHOTO_VERIFICATION_REQUIRED' };
  if (recordingTarget !== PHYSICAL_GATE) return { allowed: false, reason: 'DTR_OB_ISOLATION' };
  if (clientEventType !== undefined) return { allowed: false, reason: 'CLIENT_EVENT_SELECTION_FORBIDDEN' };
  return { allowed: true };
}
module.exports = { validateAutomaticGateRecording, PHYSICAL_GATE };
