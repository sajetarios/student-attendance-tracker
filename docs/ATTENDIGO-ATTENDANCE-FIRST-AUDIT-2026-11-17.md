# Attendigo attendance-first alignment audit (2026-11-17)

Source of truth: `fix/render-login-landing` (Render service `student-attendance-tracker`), not `main`.

## Product boundary
- Attendance, QR/manual capture, offline queue/sync, student/guardian records, class scheduling, role-based dashboards, SF2, and parent notifications.
- No electronic grading/class record, grade calculation, or report-card functionality.

## Verified current implementation
- The deployed branch contains migrations through `044_class_attendance_finalizations.sql`, including manual attendance, guardians, planner, SARDO, and finalization.
- `role-permissions.js` gives Department Heads department-scoped student/schedule permissions and teacher assignment permissions; teacher roles have subject/advisory attendance permissions.
- `tests/department-head-scope.test.js` expects Department Heads to have a read-only roster UI and department-restricted schedule writes.
- `tests/offline-attendance-foundation.test.js` checks school/user queue isolation, stable event IDs, and account verification before sync.

## Required implementation review (not yet completed)
1. Trace every student mutation endpoint and Department Head authorization; resolve any difference between `students.manage.department` and the read-only roster UI without widening privileges.
2. Trace school-day advisory attendance vs subject-period attendance vs gate scans vs manual offline events. Define the authoritative SF2 source and deduplication/idempotency rules; preserve event/audit history.
3. Confirm teacher-to-class linking derives from active assignments and enrollment, not copied student rows; separate adviser and subject-teacher views.
4. Review role-specific navigation, compact roster UI, mobile and dark-mode accessibility, loading/error/empty states, and modal consistency.
5. Validate offline conflict review, retries, finalization locks, and changes after finalization.
6. Run tests and migration checks in a nonproduction environment before merge/deploy.

## Deployment guardrails
- Do not run reset scripts, delete schools/records, overwrite production data, or introduce destructive migrations.
- Do not change the Render production branch or deploy this audit-only PR.
- Implement changes in small tested PRs based on the live branch; verify production readiness before rollout.
