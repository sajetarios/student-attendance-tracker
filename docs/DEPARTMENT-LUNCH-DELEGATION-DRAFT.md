# Department lunch QR delegation — draft
This is an isolated implementation branch, not approved for production.
- Department Head presenter write access is school/department scoped; Admin can read assignments but cannot write them.
- QR availability is operational only, defaults to enabled for compatibility, and disabling revokes active codes without waiving DTR requirements.
- GPS activation validates fresh evidence, records prior and new location, and revokes active QR sessions. A fixed existing anchor prevents successive boundary expansion. First setup has no independent campus verification; separately authorized relocation and campus boundary handling require further design.
- School Admin location approval is retired. Existing approved locations and attendance rows are not rewritten.
- Routine pending teacher scans are scoped to the Department Head; the Principal backend can review Department Head scans. Principal UI, notification routing, and exceptions for legacy unassigned/Admin scans must be integrated before release.
- Operational lunch time windows, assignment rotation and notifications remain to implement; do not allow these to override prescribed school/employee hours, memoranda, calendar exceptions, or DTR.
- Existing tests encode the prior Admin approval workflow and require updates plus full isolated PostgreSQL regression verification before release.
