# Attendigo Smart Staff Attendance / Official Business — implementation review

Status: **design and source review only**. No production migration, runtime behavior, or DTR rules have been changed.

## Baseline
- Branch based on production Render commit `2b3eb0f49d5535f9b479afc2c3bd744c513d290e` (branch `fix/render-login-landing`).
- `migrations/008_teacher_gate_attendance.sql` provides `teacher_gate_events`, with only `TIME_IN` and `TIME_OUT`, unique per teacher/day/event type. This cannot directly represent four DTR slots, repeat gate movements, or OB departures and returns.
- `server.js` has Gatekeeper lookup and teacher attendance endpoints around lines 1973–2140. Gate events require photo verification; a TIME_OUT checks for TIME_IN.
- `migrations/003_teacher_management_and_devices.sql` includes `teacher_period_substitutions`; inspect existing scheduling and department permission rules before reusing.
- `migrations/049_universal_request_notifications.sql` contains a notification system and request triggers; new OB approvals should integrate with this, not create a second notification inbox.
- `tests/migration-chain.test.js` explicitly checks migration 008's unique two-event index. Preserve compatibility; add an additive event ledger instead of changing historic gate rows in place.

## Agreed acceptance requirements
1. Four DTR slots: AM_IN, AM_OUT, PM_IN, PM_OUT. Distinguish DTR slots from physical gate IN/OUT and from OB duty credits. Never invent timestamps.
2. Option A Gatekeeper: scan QR, display registered photo, require guard confirmation, preserve capture timestamp, resume camera; do not infer event solely by alternating state.
3. Lunch: time-windowed rotating challenge displayed by any authorized presenter; teacher signs in and scans using own phone. Rate limits, one-time redemption, per-slot idempotency and presenter audit. Guard scanner fallback.
4. Unverifiable offline events remain PENDING_VERIFICATION; offline time is not authoritative until reconciliation. Queue securely and retain device-captured and server-received times.
5. OB requests: Teacher submits; Department Head recommends; School Admin makes final decision. Separate approval and actual gate movement. No-return scenarios must not create fake PM_OUT.
6. On final OB approval, find overlapping teaching periods and flag coverage; Department Head assigns substitutes only within authorized department scope and with conflict checks. Never mark a class completed merely because OB is approved.
7. Preserve existing student attendance and offline queues; avoid altering existing migration checksums.
8. Preserve Civil Service Form 48 printable layout and separately show detailed remarks and provenance.
9. Every attendance mutation and approval transition needs actor, source, original event ID, timestamp, reason, and append-only audit trail.
10. Apply migration only after schema review and test against a disposable database; no production deploy before verified regression results.

## Proposed incremental build sequence
- Inventory existing gate API payloads, staff role scopes, scheduling tables, offline service worker, DTR rendering, and request notification patterns.
- Add new additive schema: staff_attendance_events (typed physical/slot events), staff_attendance_verifications, staff_ob_requests + decisions, staff_ob_coverage, staff_attendance_corrections. Composite school foreign keys, state constraints, and indexes.
- Add role-checked API handlers, transactionally idempotent event ingestion, and approval transitions.
- Add Gatekeeper camera flow, Teacher self-service challenge UI, authorized presenter screen, Department Head review/coverage, School Admin final approval.
- Add DTR projection and remarks, with no inferred actual scans.
- Add unit, integration, authorization, concurrency, offline reconciliation, migration and UI tests; verify against Render's actual deployed branch before promotion.

## Test cases required
- Four normal slots and gate movement source mapping
- Duplicate/early/out-of-order scans, timezone boundary and repeated entry/exit
- Two concurrent presenters; replayed/expired QR; stolen QR; nonpresenter cannot issue challenges
- Teacher attempts to submit for another teacher; guard attempts to approve OB; department-crossing substitute assignment
- Pending/rejected OB, approved partial day, no return, emergency change, revoked approval
- Offline unverified pending; duplicate retry; conflict on reconciliation; clock manipulation
- Class coverage overlap and substitute conflicts; coverage not equivalent to completed class
- DTR source provenance, remarks and no fabricated timestamps
- Student attendance and existing request notification regression

**This document does not imply features are implemented or tested.**
