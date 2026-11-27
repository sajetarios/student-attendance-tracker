# Unified DTR, Official Business and Leave reconciliation — release acceptance contract

Baseline: production v470, merge d7e98876acd8d202ac484b27a62aa94225b4640d (PR #356). One coordinated feature release; no production promotion until all gates below are met. This is a design/test contract, not proof of implementation or regulatory certification.

## Non-negotiable invariants
- Raw physical movements, verified Form 48 punches, authorization, and actual certified completion are distinct. Never manufacture a clock punch, silently backdate, overwrite or delete original evidence.
- School date in Asia/Manila controls attendance attribution; intervals are half-open; late/offline synchronization retains the original verified event date and idempotency key.
- Staff, school and department scope is server-enforced. No self-approval; retain Department Head recommendation, Principal final staff authorization and separate documented SDO authority for Principal requests. Preserve School Admin record verification and existing missing scan review authority.
- Student attendance, teaching-period attendance, employee DTR and class coverage remain separate. Preserve existing school/employee schedules and temporary date-specific memo effects. Class dismissal alone never changes employee prescribed hours.
- No automatic payroll, compensatory time, overtime, entitlement or credit grant. Credit changes require certified evidence, configured applicable policy, atomic ledger entries, sufficient verified balance, idempotent adjustments and independent authority.
- No destructive data migration or reset. Historical approvals remain readable; ambiguous records are review-only. Do not infer fractional leave periods from date-only or fractional-credit records.
- Unresolved conflicts and incomplete evidence block a prepared-for-signature report. Versioned revisions retain prior output and reasons; printed names are not digital signatures.

## Scenario acceptance matrix
Status: BASE = existing v470 capability to retain and reverify; DRAFT = this branch adds initial behavior, not verified; OPEN = additional design/implementation and end-to-end tests required.

| Area | Case | Expected | Status |
|---|---|---|---|
| DTR | Normal four scans | Actual four slots, no penalty | BASE |
| DTR | AM or PM late | Prescribed-hours tardiness, correct session | BASE |
| DTR | AM or PM early departure | Prescribed-hours undertime, correct session | BASE |
| DTR | One missing scan / no scans | Incomplete/pending absence review; no invented punch | BASE |
| DTR | Duplicate or replay | Idempotent, no duplicate verified slot | BASE |
| DTR | Lunch inside school | Existing authorized lunch QR slots, no invented gate movement | BASE |
| DTR | Multiple gate movements | Physical history preserved; ambiguous DTR mappings reviewed | BASE |
| DTR | Afternoon-only arrival | No fabricated morning punch; review morning absence separately | OPEN |
| DTR | After-midnight exit | Actual school date; prior day reviewed separately | BASE |
| DTR | Offline next-day sync | Original occurrence date and provenance; reject replay/clock conflict | OPEN |
| DTR | Holiday / unscheduled work | Review evidence without automatic overtime or credit | OPEN |
| DTR | After-hours work | Actual punches preserved, no automatic overtime | OPEN |
| DTR | Shortened classes only | Employee prescribed hours unaffected | BASE |
| DTR | Authorized office-hours memo | Effective dates only, no retrospective rule bleed | BASE |
| OB | Morning or afternoon OB | Separate gate movements, authorized interval, DTR remarks | BASE |
| OB | Whole-day or lunch-spanning OB | No invented clock punches; verify actual duty | BASE |
| OB | Early, exact or off-site completion | Record actual completion via authorized evidence; no forced campus return | BASE |
| OB | Same-day late return | Return movement distinguished from verified completion | BASE |
| OB | Overnight extension with next-day arrival | Arrival stays on next date; previous completion reviewed | BASE |
| OB | Multi-day extension | Verified extension only; pending/rejected claim confers no extra authorization | BASE |
| OB | Same-day early completion and unused interval | Explicit policy and amendment/review; no implied duty credit | OPEN |
| OB | Cancellation after approval | Preserve original authorization, reconcile coverage and remarks | OPEN |
| OB | Emergency retrospective request | Explicit authorization and evidence; no self-approval | OPEN |
| OB | Two same-day requests | Validate actual overlap at authorization; no double-counted coverage | OPEN |
| OB | Overlapping time intervals in reports | Union covered intervals, no duplicate deduction | DRAFT |
| OB | Approved OB and approved leave | Explicit conflict in Form 48, no silent attendance/excusal credit | DRAFT |
| OB | OB/leave submission or approval overlap | Transactional cross-workflow validation; authorized reconciliation | OPEN |
| OB | Late morning before afternoon OB | Independently verified uncovered morning tardiness preserved | DRAFT |
| OB | Early departure after morning OB | Independently verified uncovered undertime preserved | DRAFT |
| OB | Missing/malformed evidence on OB date | Review-only; no inferred penalty or attendance | DRAFT |
| OB | Ends exactly at midnight / month-end | No spill into following date; authorized cross-month interval supported | DRAFT |
| OB | Principal's own OB | Documented external authority, no class coverage or self-approval | OPEN |
| Leave | Whole-day or multiple-day SL | Official verified leave, applicable certified SL/VSC charge | BASE |
| Leave | Sick leave upon return | Pending until verified official decision; no premature charge | BASE |
| Leave | VL, VSC, maternity, paternity, SPL, wellness, other | Applicable verified entitlement and official reference | BASE |
| Leave | Insufficient credits | Block unsupported debit | BASE |
| Leave | Approved leave with verified punch | Conflict; retain evidence and original ledger | BASE |
| Leave | Department Head rejection / Principal denial | No credit deduction or approved remarks | BASE |
| Leave | AM-only / PM-only leave | Explicit authorized segment; uncovered session evaluated normally | OPEN |
| Leave | Fractional days with unequal session durations | Policy-defined certified quantity, not inferred from clock hours | OPEN |
| Leave | Leave without pay | Explicit authorized category and payable classification; no automatic payroll | OPEN |
| Leave | Extension or early return | New authorized revision; review credits and actual date/time | OPEN |
| Leave | Cancellation after approval | Idempotent reversal or replacement ledger entry, never delete history | OPEN |
| Leave | Weekends, holidays, suspensions | Applicable leave-specific counting rules and certified working days | OPEN |
| Leave | Multiple leave types on same date | Disjoint approved segments only, reject overlaps | OPEN |
| Combined | AM leave + PM OB | Disjoint authorization intervals; independent review and no double credit | OPEN |
| Combined | AM attendance + PM leave | Verified morning evidence, authorized afternoon interval | OPEN |
| Combined | AM OB + PM classes | Flag only date-specific overlapping teaching periods | BASE |
| Combined | OB and temporary teaching schedule | Coverage reflects actual affected periods; no office-hour change unless authorized | OPEN |
| Combined | Substitute becomes unavailable/on leave | Reopen affected coverage and notify responsible Department Head | OPEN |
| Combined | Employee becomes sick during OB | Certified transition, no overlapping authorizations | OPEN |
| Combined | DTR printed before leave or OB amendment | Superseding revision, old report retained, explicit review | OPEN |
| Combined | Approved missing scan after DTR printing | Audited revised report; preserve original evidence | OPEN |
| Combined | Incorrect gate direction | Authorized correction with linked original event and audit | OPEN |
| Combined | Offline/online conflict | Idempotent merge, no overwrite; review incompatible records | OPEN |
| Security | Cross-school, cross-department, self-approval | Reject on every read/write decision and migration path | BASE |
| Security | Concurrent approval, retries and ledger reversal | Atomic authorization and idempotency, no double charge | OPEN |
| UI | Review all exceptions by employee/date | Actionable scoped queue; no duplicate decisions across portals | OPEN |
| Reporting | Unresolved exceptions / missing evidence | Explicit draft watermark, not silently prepared for signature | BASE |

## Implementation boundaries
The initial branch supplies explicit OB timestamps, interval union and uncovered timing calculation on historical OB dates only with plausible verified session boundaries, and flags report-level OB/leave conflicts. It retains the existing policy that verified completion can extend the authorized interval and does not shrink authorization automatically for early completion. It does not change approval endpoints, leave credit ledger or gate slot matching. Date-only legacy OB records remain conservative. Existing dates with OB remain under review; provisional timing is not final payroll evidence.

Before the remaining cases can be implemented safely, specify fractional/partial-day entitlement and certified quantity, leave-without-pay handling, authorization revision and reversal rules, early completion policy, and Principal external approval evidence. Use additive migrations, explicit interval and revision fields, school-scoped locks and immutable ledger/audit events. Cross-workflow overlap detection must be transactional and must not block disjoint eligible segments.

## Release gates
1. All BASE and OPEN scenarios need deterministic behavior tests with concrete expected results, including missing evidence, Manila midnight, month end, weekends, school calendar, actual adjusted teaching periods and office-hours memoranda.
2. Test database migrations against disposable PostgreSQL with existing historical records, transaction rollback, overlapping authorization races, duplicate requests, credit debits/reversals, cross-tenant access, and concurrent offline synchronization.
3. Test authenticated teacher, department head, principal, school admin and gatekeeper flows on desktop/mobile; include actual off-site OB verification, partial-day leave, approved corrections and DTR print layout. No change to student or parent portal policies.
4. Run every applicable existing CI workflow and newly added scenarios on the exact final head. Preserve all existing security, role, schema and regression assertions; fix defects rather than weakening checks.
5. Deploy only to staging until authenticated pilot tests and policy review pass. Recheck exact head/base and production migration readiness before promotion; preserve rollback and backups. Verify Render live deployment and release version.

## Integration update
The first interval implementation passed all 12 PR workflows at head 3089ac7059bf4d4d1fa388a359d8a5fbb3a953d7. Rebased integration preserves teacher timetable v472; new candidate v473 adds non-working-day conflict visibility and explicit OB review of complete four-punch days. Reverify exact new head; OPEN cases are still release blockers.

### Authorization guard implementation (candidate)
- Added shared employee transaction lock and half-open Manila overlap checks at staff OB approval, completion verification, external principal OB recording, leave approval, and legacy Form 48 leave transcription. Conflicts return 409 before commit; date-only leave is conservatively treated as full civil days. Pending filings remain permitted for evidence review.
- Blocked direct revocation of Form 48 leave linked to an official request; it must use a future authorized amendment/credit reversal workflow. No automatic ledger restoration or partial-day approval is introduced by this change.
- New route and SQL-contract tests require CI and database scenario verification. Half-day leave, credit amendment/restoration and remaining unified exception workflows are still open.
