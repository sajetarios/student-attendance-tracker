# Department lunch QR delegation — draft
This is an isolated implementation branch, not approved for production.
- Department Head presenter write access is school/department scoped; Admin can read assignments but cannot write them.
- QR availability is operational only, defaults to enabled for compatibility, and disabling revokes active codes without waiving DTR requirements.
- GPS activation validates fresh evidence, records prior and new location, and revokes active QR sessions. A fixed existing anchor prevents successive boundary expansion. First setup has no independent campus verification; separately authorized relocation and campus boundary handling require further design.
- School Admin location approval is retired. Existing approved locations and attendance rows are not rewritten.
- Routine pending teacher scans are scoped to the Department Head; the Principal backend can review Department Head scans. Principal UI, notification routing, and exceptions for legacy unassigned/Admin scans must be integrated before release.
- Operational lunch time windows, assignment rotation and notifications remain to implement; do not allow these to override prescribed school/employee hours, memoranda, calendar exceptions, or DTR.
- Existing tests encode the prior Admin approval workflow and require updates plus full isolated PostgreSQL regression verification before release.

## Safety revision after first failed CI run
- Migration 089 registered without relaxing the migration manifest or checksums.
- Existing presenter grants are bound to recorded department provenance; unprovable or transferred grants are revoked, not deleted. Fresh QR required at cutover. Transfer, deactivation or role change revokes grants and outstanding challenges.
- First location activation fails closed without a trusted pre-existing point; independent one-time onboarding/relocation workflow remains to implement (no routine School Admin approval). Gatekeeper remains available.
- Still not ready to deploy: merge with the advanced production branch, verify transfer concurrency and reviewer paths, align legacy tests and complete operational schedule constraints. No historical DTR rows modified.

## Trusted campus extension
- Principal registers an independently verified campus circle with documented institutional reference; no routine school-admin or department approval queue. Circle radii 100–5000 m, department radii remain 60–250 m. Browser GPS is not institutional proof; require smallest suitable boundary.
- Department Head can enroll a location inside a registered campus. The full radius plus GPS uncertainty must fit; the campus binding cannot be switched by a head. Legacy independently approved points remain unchanged unless deliberately linked to a containing campus. Campus records are immutable; retirement prevents further issue/redeem and leaves Gatekeeper fallback.
- Automated geometry cases cover 10, 50 and 100 overlapping departments; this is not a concurrent load benchmark. Actual multi-department load, cross-campus exceptional relocation workflow, frontend/browser validation, and latest-production integration remain release blockers. Principal campus registration relies on institutional verification by the authorized person, not automatic proof.

A separate disposable-PostgreSQL concurrency test now exercises 10, 50 and 100 departments across two campuses, with 100, 500 and 1,000 concurrent authenticated redemptions, overlapping geofence rejection and unique verified punches. It reports latency and fails on unverified/duplicate punches. It is a synthetic benchmark, not a production capacity guarantee. Department-level lock refactoring remains contingent on measured contention and a separate race-condition review.

Exceptional relocation now has Principal-only documented authorization, suspends the previous point and revokes outstanding department QR codes, and requires fresh GPS within the authorized destination campus. Principal's existing Approvals view now offers scoped lunch QR exception review. Further regression and explicit operational schedule/notification validation remain required before release.
