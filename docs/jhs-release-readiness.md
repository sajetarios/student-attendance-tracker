# Attendigo JHS release readiness — evidence and remaining gates

**Release scope:** existing JHS workflows, Grades 7–10. SHS is out of scope. Do not imply an operational reliability rate from the number of passing automated tests.

## Automated evidence (run on every candidate release)
- Run `npm test` against the candidate SHA; require **0 failures**. Includes deterministic fictional attendance, five staff/learner role families, permissions, gate events, OB/DTR boundaries, Form 48 calculations, and school-closed dates (`tests/jhs-pilot-synthetic-matrix.test.js`).
- Run `Node.js tests` GitHub workflow, including recovery-flow validation and temporary PostgreSQL migrations, with a clean `*_test` database. Do not use production credentials for synthetic fixtures.
- Run QR attendance, Department Head and SARDO, Gate/OB/DTR workflows on the **same** candidate SHA. Assess all failures, including skipped integration tests.
- Verify portal HTML and service-worker shell cache **the same versioned assets**. Tests must resolve actual HTML version, not hardcode historic versions.
- Before release: check app logs, DB migration status, version/commit parity, Render health, and repository HEAD.
- Prove no leaked cross-school data via database-backed isolation tests (`tests/class-qr-synthetic-postgres.test.js` and other role isolation cases).
- Preserve existing staff and student records; never wipe production to pass a test.

## Role-based browser acceptance (NOT proven by unit/CI alone)
| Role | Required operational journey |
|---|---|
| Super Admin | Sign in → create isolated school → inspect status → manage school safely → logout |
| School Admin | Sign in → school year → teacher account → subject/class → timetable → register/import learners → monitor SF2 and Form 48 → logout |
| Department Head | Sign in → only assigned department → assign teacher, section and class → verify conflict denial → monitoring → logout |
| Subject Teacher | Sign in → assigned schedule → assigned learners → class check-in → finalize/reopen as authorized → SF2 personal copy → logout |
| Class Adviser | Sign in → advisory subjects, including other subject teachers → assigned roster → confirm absences/excusals → SARDO threshold → logout |
| Gatekeeper | Sign in → registered photo match → learner/staff badge → gate IN/OUT → OB departure/return → duplicate blocking → logout |
| Student/Parent | Sign in → own authorized record only → no staff/other-school records → logout |

## Device and failure acceptance (NOT proven by unit/CI alone)
1. Real Android Chrome and iOS Safari camera permission and QR scans.
2. Offline Gatekeeper prepared device, airplane mode, browser reopen, local encrypted queue, connection restoration, same-user sync; never claim offline capture is official DTR/attendance.
3. Stale PWA cache and service-worker update, local browser data loss, failed sync, rapid double scans and poor signal.
4. Two schools with same-named sections and teachers; no cross-tenant leakage or privilege escalation.
5. Form 48 calculations against office-approved signed examples; verify weekends, approved OB after hours, partial punches, late/undertime, authorized absence reviews, holidays.
6. Generated official SF2 exports visually reviewed against current applicable DepEd template with real dates.
7. Backup **and demonstrated restoration**, not just backup creation; confirm recovery time and no mismatched schema.
8. Render PostgreSQL Free expiry and Supabase migration/cutover must be handled independently before school rollout.

## Release go/no-go
- **Automated gate:** no failing required workflows for the exact deployed SHA, no unresolved critical security or correctness defects, all migrations up-to-date.
- **Pilot gate:** representative browser/device tests have recorded evidence, synthetic roster/schedules reproduce key real workflows; production storage and database lifespan are safe.
- **Wider rollout gate:** supervised operational pilot with staff and real authorization + report reconciliations, evidence for backups/restore, issue monitoring and rollback plan.

**Coverage note:** "90% confidence" requires an agreed checklist with pass/fail evidence, not a percentage of tests. Even 100% CI pass cannot guarantee the absence of security vulnerabilities or operational bugs.
