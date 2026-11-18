# Current student workspace permissions (November 18, 2026)

This document supplements the historical `docs/ROLE-DASHBOARD-BASELINE.md` (v0.8.0), which predates the department-scoped batch management and student portal request workflows. This is a UI consolidation only; it does not grant new privileges.

## Navigation

- School Admin: **Students** -> **Student Records** and **Portal Accounts**.
- Department Head: **Department Students** -> existing school-wide roster only, with existing department-scoped batch actions. No Portal Accounts tab.
- Teacher with Subject Teacher and/or Class Adviser designation: **My Students** -> **My Students** and **Account Requests**.
- Teacher with neither designation: no student roster/account-request tab.
- Gate Keeper: scanner-only screen; no roster/account tab.
- Parent, Student, and Platform Admin remain in their separate workspaces.
- Existing `?view=studentAccounts` deep links remain valid only for School Admin and eligible Teachers.

## School Admin

- Can view and manage school-wide learner records and student portal accounts.
- Can create, reset, activate, suspend, and bulk-create student logins, review Teacher account requests, and see temporary passwords once.
- Can view a student QR **on demand** from the roster Actions menu, not automatically for every learner in the table.
- The roster no longer duplicates portal-account management status/actions; the Portal Accounts tab is the appropriate interface.
- School Admin actions continue to use `/api/students`, `/api/students/batch`, and `/api/student-portal/*` with their existing server-side authorization.

## Department Head

- Can **view the school-wide roster** without privileged guardian-account fields, QR downloads, or portal-account management.
- Can perform `SET_SEX` and `ASSIGN` **batch changes only** when source learners and destination sections meet the server's current department / active-period checks.
- Can request special-program changes using existing authorized workflows, subject to School Admin review.
- Cannot perform account creation, reset, suspension, direct identity edits, or activate/deactivate/archive student records.
- This differs from the older v0.8.0 acceptance checklist that described the Department Head as entirely read-only. Do not silently remove existing scoped writes or broaden them during this UI change.

## Subject Teacher / Class Adviser

- Subject Teacher: sees learners in assigned classes/active substitute assignments, can correct a scoped learner name and view the scoped student QR; cannot move learners, upload photos, or issue/reset credentials.
- Class Adviser: in assigned advisory sections, may register learners, upload photos, perform authorized student edits and scoped `SET_SEX`/`ASSIGN` batch actions; cannot issue/reset credentials.
- Either permitted Teacher designation may request a student login, password reset, or reactivation for an assigned learner. School Admin approval remains required. Teachers see their **own** requests, never temporary passwords or admin credentials.
- A Teacher with both designations receives the union of those **existing scoped** privileges, not a promotion to School Admin.
- School ID, assigned section / active period / substitute scope, and approval state must be revalidated on the API, not just hidden in the interface.

## Safeguards for consolidated tabs

- Keep `studentAccounts` as an internally supported authorized view for deep links, notifications, and directory shortcuts; no duplicate sidebar link should remain visible.
- Tab visibility, route access, and action buttons must reflect server-validated role and designation, not static menu labels.
- Do not change student identities, QR tokens, attendance records, enrollments, session revocation, offline queue, existing audit logs, or database schema.
- Regressions must cover unauthorized direct API access, role-scoped teacher rosters, department batch edits, School Admin-only account operations, direct account links, mobile/dark-mode tabs, and service-worker cache freshness.
