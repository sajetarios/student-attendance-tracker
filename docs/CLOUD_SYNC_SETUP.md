# Cloud Sync setup

Cloud Sync keeps the local school server authoritative and sends a replica to the matching cloud school. The Cloud Sync screen is available to School Administrators on both instances.

## What is replicated

The local-to-cloud master-data push is a one-way, repeatable upsert. It provisions the matching school identity; non-parent staff identity references and teacher designations; learner identity, LRN, grade, section and sex; selected school reporting settings; class periods; teacher subject assignments and substitutions; class-adviser assignments; school years and enrollments; learner movement references; school calendar entries; and special-program types and assignments.

The receiver does not delete records. Source-side deletions and unassignments are not propagated in this release, so records removed locally may remain on the cloud copy and require review. The push is designed to be retried safely and is committed as one database transaction. Existing records with mismatched tenant IDs or incompatible unique records stop the import rather than moving data between schools. A source snapshot is taken from one consistent database view, and the cloud receiver rejects an older snapshot.

The following are deliberately not copied: staff login usernames or passwords, staff leave reasons/dates, staff login sessions, parent accounts and contact details, student portal accounts and sessions, student QR tokens, learner or teacher photos, device credentials, SMS outbox records, confirmed daily-absence overrides, free-text enrollment remarks, staff leave details, and SF2 submission files or local file paths. Newly created cloud staff identity rows are marked as non-login records. Existing cloud account credentials are not overwritten. Local parent SMS remains the responsibility of the local server.

Attendance events are sent separately through the retry queue. The source event IDs are preserved, and the cloud receiver does not enqueue duplicate SMS messages. Historical attendance-event backfill is not included in this release.

## Server environment keys

The local/source server must have `CLOUD_SYNC_ENCRYPTION_KEY`. Generate a 32-byte key with:

    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

Set the resulting 64-character hexadecimal value as `CLOUD_SYNC_ENCRYPTION_KEY=...` in the local server's private environment configuration. Do not commit it to Git or paste it into the browser. Back it up securely: losing this key prevents the local server from decrypting the saved outbound credential.

For **new cloud-school provisioning**, set `CLOUD_SYNC_PROVISIONING_KEY` on the cloud/receiver server. Generate it with the same command above, set the 64-character hexadecimal value in the cloud service's private environment settings, and enter that same value into the one-time provisioning form on the local server. It is only used for the provisioning request and is not saved by the local app. Remove or rotate it after provisioning the intended cloud tenant(s).

The cloud/receiver server does not need `CLOUD_SYNC_ENCRYPTION_KEY` merely to verify inbound credentials; it stores only their hashes. The provisioning key is separate from both the encrypted outbound key and the receiving credential.

## First-time setup in the UI

1. Deploy this release to both the local and cloud instances. Back up both databases before migration 014 is applied; the normal migration runner includes it.
2. On the cloud server, set `CLOUD_SYNC_PROVISIONING_KEY` in its private environment settings and restart/redeploy the cloud application so the setting is loaded.
3. On the local/source server, set `CLOUD_SYNC_ENCRYPTION_KEY` in its private environment settings and restart/redeploy the local application.
4. Sign in as School Administrator on the local/source server and open **Academics → Cloud Sync**. Confirm the displayed school code, name, and immutable school ID.
5. Expand **Create a new matching cloud school from this local server**. Enter the cloud HTTPS address, the cloud provisioning key, and the initial cloud administrator username, display name, and password (minimum 12 characters). Select **Create matching cloud school and pair it**.
6. The cloud creates a school row with the exact local `school_id`, creates the initial cloud School Administrator, creates a hashed inbound credential, and returns that credential directly to the local server. The local server encrypts and saves the credential. The raw credential, bootstrap key, and initial cloud admin password are not saved or returned to the browser by the provisioning endpoint.
7. Test the secure connection. The cloud school ID must exactly match the local ID. Sign in to the cloud instance using the initial cloud administrator credentials and confirm the Cloud Sync receiver screen shows an active credential.
8. On the local/source Cloud Sync screen, select **Sync master data to cloud**. Review the local counts, last push timestamp, and cloud receipt. The import is additive/upsert-only and does not delete cloud records.
9. Only after the successful push, enable **automatic attendance forwarding**. The server enforces this order even if someone tries to bypass the UI.
10. Review queue counts and recent event responses. Use retry actions after correcting the reason shown for a failed item.

### Pairing an existing cloud school

Do not use the new-school provisioning form when the school already exists on the cloud. Sign in to that existing cloud school with its School Administrator account, use **Generate / rotate receiving credential**, then paste the one-time credential and cloud address into the local pairing form. The cloud school ID must be the same as the local school ID. Provisioning refuses to overwrite an existing school ID or school code.

## Updating school master data

Repeat **Sync master data to cloud** after adding or changing learners, staff identities, schedules, school years, enrollments, teacher/adviser assignments, calendar entries, or special-program assignments. This release does not automatically detect and push every later master-data change. New attendance events for records not yet present on the cloud may be rejected until the next master-data push. Source-side deletions/unassignments are not propagated yet; review removed records on the cloud separately.

## Retry behavior

- Network errors and temporary HTTP responses are retried with exponential backoff.
- Rejected events are marked FAILED with a reason. Use **Retry failed events** after fixing the cause.
- A process restart recovers stale SENDING queue claims. If the cloud accepted an event before a network interruption, the same event ID is safe to send again; the receiver returns ALREADY_SYNCED when the stored data matches.
- Never delete local attendance rows or queue rows to resolve a sync error. Correct the destination data or retry the event instead.

## Deployment and limitations

The JSON request body limit for this app is 8 MB. Schools with unusually large snapshots that exceed this limit need a future chunked snapshot implementation rather than increasing the limit without review.

Migration 014 pauses any previously enabled attendance forwarding so an old pairing cannot begin sending events before master data is provisioned. Migration 014 has not been applied by changing repository files alone; it runs when the updated app starts or when `npm run db:migrate` is executed. Test it first against a backup/staging database. Do not enable attendance forwarding in production until the receiver confirms the intended school and master-data snapshot.
