# Attendigo — secured school-to-cloud attendance synchronization

This feature relays **accepted** QR attendance, manual classroom corrections, and register FINALIZE/REOPEN events from an optional local school server to a separately managed cloud service. It does not generate attendance or reconstruct missing historical section movements.

## Data flow and failure behavior

1. Offline device stores an encrypted event until the local school server is reachable. A school with no local network can keep using each prepared device's encrypted offline sheet and synchronize directly to its configured server later.
2. The local school server commits manual corrections / register sign-offs **and** their replication operation in the same database transaction; accepted QR scans use the existing durable QR outbox.
3. Every 15 seconds, or when the School Admin presses **Sync pending now**, the server forwards pending records in order using an HMAC-signed HTTPS request.
4. The cloud verifies the school-specific secret, validates active school/teacher/class identities and role assignment, checks manual-mark revisions, and applies records in a transaction with an idempotency receipt.
5. If the cloud returns `NEEDS_REVIEW` or `REJECTED`, the local record remains in **Needs review**, and later same-school operations are blocked. Network outages and HTTP timeouts preserve the queue for retry. School Admins can inspect **Cloud synchronization review**, correct the underlying school record or mapping, and explicitly retry.
6. Register sign-offs are not accepted until the exact cloud roster has confirmed attendance and no unresolved QR/manual conflict. A late QR scan cannot modify a finalized cloud register.

**Important:** A device saying "Synced" confirms the *local school server* accepted the event; it does not guarantee that cloud replication has finished. Check School Admin → Cloud Sync for cloud status.

## Required configuration

- Run migrations through `npm run db:migrate` on both environments (migration **046_cloud_mixed_attendance_operations.sql** is required).
- Deploy the same compatible Attendigo version to both the local school server and cloud.
- Register each school on the cloud using the same **school code**, with active teacher user accounts with matching **usernames**, accurate class period names, subject, grade, section, start/end times, and teacher assignments. Do not copy passwords. The replication layer does **not** silently create a new teacher or class schedule.
- Generate a **different** random HMAC secret of at least 32 characters for each school. On that school's **local server**, set `CLOUD_SYNC_SHARED_SECRET` to its secret.
- On the **cloud receiver**, set `CLOUD_SYNC_SCHOOL_SECRETS_JSON` to a JSON mapping of *school codes → school-specific secrets*. Example shape (not an actual key):

  ```text
  CLOUD_SYNC_SCHOOL_SECRETS_JSON={"SCHOOL001":"replace-with-unique-random-secret-at-least-32-chars","SCHOOL002":"use-another-independent-random-secret-at-least-32-chars"}
  ```

  Store this in your deployment's secret environment settings, **never** in GitHub, screenshots, or logs.
- The cloud receiver needs the school-scoped secret map even for QR replication. The existing global-only `/api/cloud-sync/health` endpoint is retained for older diagnostic callers, but the School Admin's **Test connection** button uses the school-scoped signed POST `/api/cloud-sync/health-school`.
- In the local School Admin → Cloud Sync settings, enter the cloud HTTPS base URL, enable forwarding, save, then press **Test connection**. The school server must be capable of outbound HTTPS. Remote HTTP URLs remain forbidden.

## Review types and recovery

| Reason | Safe resolution |
|---|---|
| `ACTOR_MAPPING` / `TEACHER_ASSIGNMENT` | Provision the correctly authorized teacher on the cloud |
| `PERIOD_MAPPING` | Match the exact class period details on the cloud |
| `LEARNER_MAPPING` | Confirm the active student and correct school-year enrollment on the cloud |
| `STALE_CLOUD_MARK` | Compare school paper register and cloud correction history; resolve the conflict through the authorized attendance editor |
| `FINALIZED_REGISTER` / `REGISTER_STATE` | Verify the register sign-off and whether it needs an authorized reopen |
| `ROSTER_MISMATCH` / `QR_MANUAL_CONFLICT` | Complete verified attendance and resolve contradictions before finalizing |

Click **Retry after resolving** only after correcting the underlying cause. There is deliberately no "force overwrite" option and no automatic deletion of rejected events.

## Security and operational limitations

- Payloads may contain student IDs, attendance status/notes, dates, and class metadata. Credentials, photos and parent contact information are excluded. Use HTTPS, school-scoped HMAC keys, least-privilege database roles, backups, and careful log retention.
- A local server is **not** provided by Render itself. A school wishing to work on a LAN needs an actual server or workstation running the same Attendigo application and a persistent local PostgreSQL database. Offline devices without a school LAN still sync after they individually regain connectivity.
- Student and teacher creation, roster provisioning, dated enrollment transfers, and staff permissions are not automatically replicated. Those records must be provisioned on each server before manual corrections or sign-offs can be confirmed.
- Device IndexedDB and locally queued operations may be lost if browser data is cleared or the device is damaged. Do not erase pending data before confirmed synchronization. Back up local PostgreSQL independently.
- This module does **not** implement fully automated bidirectional conflict merging, mobile installer packaging, or automatic retroactive movement history. In particular, older local records may remain for authorized review if the cloud cannot establish the same class/roster.

## Pilot acceptance tests before enabling production

1. Snapshot and verify recoverable backups for both databases, then use a separate staging school with synthetic students.
2. Prepare offline devices, record a QR scan, manual correction, and sign-off without internet; reconnect and verify event ordering, local acknowledgment and cloud receipt.
3. Send the same signed operation twice with a fresh nonce; verify one audit/mark and an `ALREADY_SYNCED` acknowledgment.
4. Change a cloud mark between the local edit and relay; verify `NEEDS_REVIEW` and no overwrite.
5. Transfer/rename a learner after an old scan; ensure current identity and enrollment are preserved and stale class mapping is reviewed.
6. Finalize a class and replay a late QR; ensure the cloud register remains locked.
7. Sign in as two school accounts and verify no record crosses tenant/account boundaries.
8. Simulate WAN loss, timeouts, malformed signatures and cloud restart; check queue preservation, review badges and audit trails.
9. Validate teacher, student, parent and SF2 reports against cloud-**accepted** data. Do not claim that unconfirmed records have synchronized.

**Rollout gate:** Keep the PR in draft, run all CI and PostgreSQL migration tests, execute two-server integration tests, then manually deploy with a documented rollback plan.
