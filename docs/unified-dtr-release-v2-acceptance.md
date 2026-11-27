# Attendigo DTR computation and reconciliation — focused release gate

User clarified scope on 2026-11-28: strengthen DTR calculation and reconciliation only. The school already has its own leave-credit administration. Attendigo is not an HRMS. Do not add signed DTR PDF storage, report archives, additional leave-credit or entitlement management, payroll, or new leave/OB approval workflows. Retain the existing approved leave, OB and missing-scan mechanisms and current Form 48 printing without alteration of historical records. No new database migrations are required by the focused candidate.

## Acceptance

- Compute ordinary verified duty by complete plausible AM/PM sessions; distinguish evidence days from full verified duty. Check independent tardiness and undertime, chronological anomalies, missing/duplicate events and no fabricated punches.
- Reflect only existing authorized leave and OB records in Form 48. Show pending, approved, conflicting or missing evidence and correct date-specific remarks; do not approve leave, infer entitlement or debit/restore balances in DTR calculation. Preserve half-day handling and approved completion evidence. Overnight or late OB must not consume the next day's arrival.
- Apply prescribed employee hours, valid date-specific office-hour memoranda, closed/open days and exceptions; ambiguous or missing schedules block readiness. Teaching-only changes must not change DTR hours.
- Offline captures remain observations, not official punches. Preserve their claimed Manila date, flag clock anomalies, compare same-date verified entries and require existing authorized missing-scan/logbook reconciliation. Serialize identical event retries. Never silently promote device timestamps.
- Keep the existing one-page Form 48 printable output and role-scoped access; no signed PDF upload or storage. DTR review flags and calculations must agree.
- Verify exact-head CI including unit, real disposable PostgreSQL, security and browser workflows; exercise synthetic DTR scenarios, regression and isolated staging. No production test data, no weakening tests. Verify current production base and deploy only after the focused release gate passes.

## Candidate checkpoint

The signed PDF archive, migrations 102/103, future leave amendments and additional OB authorization workflows proposed in earlier draft commits are withdrawn from this PR. Existing production leave credit and OB workflows remain unchanged. Current candidate retains DTR calculation improvements, pending leave visibility, conflicting/shortened schedule review, offline replay and original date review. Further DTR-only scenario verification remains required; passing earlier commits is not proof. No production promotion or data changes have been made.
