# Passwordless classroom QR check-in — implementation and test gate

Status: **design / implementation pending**. This branch is intentionally isolated from production.

## Intended behavior
- A student scans a teacher's live, rotating classroom QR, enters their unique student ID and a separate six-digit attendance PIN, and confirms without signing into the portal.
- The PIN is enrolled/reset only through an authenticated student flow or authorized, audited school recovery flow. Never derive a PIN from student ID, birthdate, or a default.
- PINs must be stored as salted slow hashes, never plaintext, logs, URLs, or browser storage. Six-digit PINs are low entropy: enforce persistent per-student and per-IP throttling, temporary lockouts, and generic failure responses.
- Bind each check-in to a verified school + student identity, valid active session and fresh QR, eligible enrollment, and the existing unique(session_id,student_id) constraint. Never trust a school ID supplied by the browser.
- Require explicit confirmation. Retain teacher review, audit trails, attendance event insertion, and existing manual/portal routes.
- The QR link is not evidence of physical presence; do not advertise this workflow as fraud-proof.
- Do not add offline PIN verification using a locally cached hash. If server verification is unavailable, show an unrecorded status and teacher-assisted fallback.
- Do not reveal whether a student ID exists on an unauthenticated endpoint.
- Use a dedicated database migration for PIN credentials and lockout state. Avoid changing existing student passwords.
- Use a feature flag defaulting OFF; only enable after migration, security review, and tests.

## Baseline source observations (fix/render-login-landing)
- `class-qr-routes.js` protects POST `/api/class-qr/check-in` with `authenticateSchoolClient`, then checks `req.auth.type==='STUDENT'`.
- `public/class-qr-checkin.html` calls `/api/auth/me` and directs students to sign in.
- QR HMAC rotates every 30 seconds; current check-in accepts the current or previous bucket.
- `saveAttendance` inserts into both `class_qr_checkins` and `attendance_events` within a transaction.
- Existing `tests/class-qr.test.js` covers time helpers and HMAC generation, not passwordless authentication.

## Required test cases (must pass before rollout)
1. Enrollment and reset: authorized setup succeeds, unauthorized setup fails, no default PIN, PIN hashes differ for same input, plaintext never returned.
2. Unauthenticated check-in with correct ID+PIN+fresh QR succeeds once, produces exactly one check-in and one attendance event.
3. Wrong PIN, unknown ID, wrong school, wrong section, inactive enrollment, revoked PIN, and missing PIN are rejected without enumeration.
4. Expired, forged, closed, future, or reopened-with-old-secret QR is rejected.
5. Concurrent duplicate submissions yield exactly one recorded event.
6. Brute-force attempts are rate-limited across requests and server restarts (persistent state), including across school IDs.
7. Existing authenticated student check-in, teacher manual recording, role restrictions, status endpoints, and staff QR session management still work.
8. Attendance totals, teacher sheet, sync queue, and audit history remain consistent.
9. Network failure must never display a successful check-in; test mobile Safari, Android Chrome, dark mode, and narrow layouts.
10. Run `npm test` plus database-backed integration tests against a disposable database. Record commit SHA, results, and deployment ID.

## Release criteria
No production deployment until the new endpoints, enrollment UI, migration, and tests are implemented and verified. Preserve existing production service, branch, domain, and database records.
