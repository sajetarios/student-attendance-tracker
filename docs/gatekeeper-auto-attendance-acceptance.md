# Gatekeeper automatic verified attendance — security acceptance criteria

Status: implementation pending; do not deploy until all criteria pass.

## Workflow
- Scan a QR; identify student or authorized staff by school-scoped token lookup.
- Require a registered photo and explicit Gatekeeper photo-match confirmation.
- Present exactly one "Verify & Record" action; disable while saving.
- Server decides whether the next physical gate event is TIME_IN, TIME_OUT, or requires review; never trust a client-selected event type.
- On successful commit show the event, official Asia/Manila timestamp, and return to continuous scanning.
- When uncertain, fail closed and require authorized review. Never infer a DTR slot from time of day alone.

## Security invariants
- Enforce authenticated GATE_KEEPER role and school-scoped identity on the server.
- Keep student school gate events distinct from class/advisory attendance.
- Keep staff physical gate events distinct from Form 48 DTR slots.
- Prevent duplicate scans, races, replay, and time-of-day manipulation using transactional locking or database constraints and server timestamps.
- Retain existing offline attendance events and syncing; do not label queued events as server-recorded.
- Preserve audit trails, registered-photo requirements, calendar closures, and attendance history.

## Required tests before deployment
- Student first scan, valid departure, duplicate, race, no photo, invalid token, wrong school, closed day, offline and sync.
- Teacher/staff first scan, valid departure, duplicate, race, no photo, wrong school, closed day, DTR separation.
- Repeated clicks and scanner decoding during pending verification must not double-submit.
- Verify accessibility, mobile layout, and no regressions to teacher class attendance.

## Official Business (OB) and Form 48 DTR isolation
- An OB request, even when School Admin approved, authorizes a defined interval; it does not prove physical arrival/departure and must not generate gate TIME_IN/TIME_OUT.
- Gatekeeper physical gate records must never auto-create Form 48 AM_IN/AM_OUT/PM_IN/PM_OUT slots merely because an OB request exists.
- Keep existing Department Head recommendation, School Admin final approval, substitute coverage and immutable audit history intact.
- If an approved OB interval overlaps a DTR slot, display the verified OB authorization as separate context for authorized DTR review. Never fill the slot with an invented clock time.
- Pending, rejected, canceled or expired OB must not be treated as approved attendance.
- Where the school's official DTR accounting rules for OB are not configured, flag the period for authorized review instead of guessing or marking absence/presence.
- Add regression tests for OB pending/approved/rejected states, overlap, gate time-in/out during OB, duplicate scans, and no phantom DTR slot.
