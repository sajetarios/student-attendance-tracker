# Attendigo production readiness and recovery runbook

Updated 2026-11-22. This runbook does not certify production readiness or replace a successful restore test against a protected off-site backup.

## 1. Production data authority

- Web application: Render service `srv-dbq25k6k1f9s73dd36i0`, production branch `fix/render-login-landing`.
- Configured production primary: `ATTENDIGO_PRIMARY_DATABASE=supabase`; never infer the active database solely from a stale `DATABASE_URL`.
- The standalone migration command now selects and verifies the same primary target before opening a connection.
- Never point maintenance commands at an unknown database or use a production URL for test restore.
- Never overwrite source data, archived migration copies, attendance records, or school accounts as part of a restore drill.

## 2. Independent encrypted backups

The production free database plan must **not** be assumed to include recoverable daily backups. Backup creation and retention require an independent protected off-site destination.

Required operator-managed secrets, supplied through a secure scheduler or secret store (never Git):
- `SUPABASE_DATABASE_URL` — approved production project connection string.
- `ATTENDIGO_PRIMARY_DATABASE=supabase`
- `ATTENDIGO_BACKUP_KEY_BASE64` — 32 random bytes base64-encoded. Store separately from the archived files; losing this key makes backups unreadable.
- `ATTENDIGO_BACKUP_SIGNED_PUT_URL` — newly generated HTTPS pre-signed PUT URL for a **private, independent** object store. This URL can expire and must be regenerated for each scheduled run.
- PostgreSQL client compatible with the source database major version.

Run from a secure, isolated backup worker, **not** the Render Free web process:

```sh
node scripts/verified-database-backup.js backup
```

The script verifies the PostgreSQL custom-format archive, encrypts it with AES-256-GCM, uploads only encrypted bytes, and destroys its temporary unencrypted archive. A successful upload is **not** proof of full recovery.

Recommended retention policy (subject to the school's privacy policy): at least seven daily protected snapshots and four weekly snapshots; alert on any missing or failed job. Check available storage and ongoing costs. Never put the encryption key in the same storage bucket as the encrypted backup.

**Current external dependency:** Configure the off-site destination, secure key custody, and a reliable scheduler separately. No operator credentials or backup destination are included in code. Until a real production snapshot is downloaded and fully restored into an isolated environment, production backup recovery remains unverified.

## 3. Restore rehearsal

Use a disposable PostgreSQL database whose **name ends with** `_restore_test` and cannot connect back to production users. Provision it yourself and download the encrypted snapshot from your private backup store.

```sh
ATTENDIGO_RESTORE_TEST_DATABASE_URL=postgres://.../attendigo_restore_test \
  node scripts/verified-database-backup.js restore-test /private/backups/date.attbk
```

The command refuses restore to a database without the required test suffix and verifies the GCM authentication tag before running `pg_restore`.

After restoration, confirm: migration count, school/learner and staff totals, DTR audit references, official SF2 submission bytes and checksums, and representative SF1/SF2/Form 48 report results, **without exporting real student names to logs**. Record the restore test date, archive ID/hash, operator, completion status, and any discrepancies. Apply recoveries to production only through a separately approved incident-response procedure.

The repository CI runs a synthetic backup+restore against an isolated PostgreSQL 16 service and contains no production records.

## 4. SF2 document durability

From migration 072 onward, new official SF2 submissions store the complete XLSX as `sf2_submissions.file_bytes`, the size and a SHA-256 integrity checksum in the same transaction. New downloads re-check the checksum before returning a workbook. This no longer depends on Render's temporary filesystem.

Legacy file-path submissions, if any, remain readable only while their old local files exist. They require a separate evidence-based archival migration; do not delete them automatically. The database stores the workbook bytes, so watch database growth and migrate to private object storage with lifecycle/versioning as scale increases.

## 5. Live service and health

The application exposes `GET /health` and `GET /api/health`. These perform a read-only `SELECT 1` and return HTTP 503 when the database is unavailable.

Render's service configuration currently has no health-check path set. **Operator action:** configure `/health` as the Render health check and verify status. This setting cannot be applied from the available Render integration.

Render Free services may sleep, so timers in the app cannot guarantee continuous background work. Teacher-return checks catch up at startup; cloud forwarding also now checks pending outbox records immediately on startup. For guaranteed scheduled jobs and minimal gate-scan delays, use an always-on web plan or an independently scheduled worker; verify recurring subscription cost before changing a plan.

## 6. Security controls

- Staff and student attendance changes require server-side authentication and role authorization.
- Cookie-authenticated mutating API calls require same-origin evidence; device bearer-only clients are unaffected.
- CSP blocks embedded objects, unsafe base URLs, and framing. A Report-Only policy measures legacy script/style usage before enabling stricter script CSP.
- Password hashes use scrypt and sessions are revoked server-side. Browser JavaScript still receives a legacy bearer token in some flows; cookie-only migration and phishing-resistant MFA for privileged accounts are follow-up work.
- Supabase public application tables have RLS enabled, with no direct anonymous/authenticated SELECT grants observed at review. Re-check Data API grants after schema changes.

## 7. Controlled pilot checklist

Before declaring a school fully operational:
1. Test four real scans on an approved 7–4, 8–5, and separately authorized temporary schedule without changing the school's active policy for the test.
2. Compare each original server-time gate movement to the audited AM/PM DTR slot.
3. Verify missing scans are **not** declared absent without authorized review.
4. Test lunch departures/returns, approved OB including late returns, duplicates, disconnected devices, altered local clocks, and denied photo matches.
5. Validate Form 48's one-page A4 portrait printing on iPad and a desktop printer.
6. Generate, submit, collect, and download an official SF2 workbook; verify checksum and successful download after a new deployment.
7. Verify tenant isolation across two fictional schools, teacher/department rights, and restore from an off-site snapshot.

Do not use actual student personal data in automated CI, or conduct destructive record resets for a routine pilot.

## 8. Release gates and escalation

The hardening quality gate runs `npm test`, database migrations, gate/OB/DTR integration, and encrypted backup+restore. Do not deploy when the new gate is red. Use explicit versioned browser assets on every UI change; do not weaken semantic tests to hide real regressions.

Escalate: lost backup, wrong primary database, repeated 5xx/database authentication errors, unsigned/missing DTR evidence, lost SF2 document, cross-school access, or repeated cold-start disruption at school opening. Keep deployment and rollback SHAs recorded.
