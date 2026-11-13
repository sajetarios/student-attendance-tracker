# Cloud Sync setup

Cloud Sync keeps the local school server authoritative and sends a replica to the matching cloud school. The Cloud Sync screen is available to School Administrators on both instances.

## What is replicated

The local-to-cloud master-data push is a one-way, repeatable upsert. It provisions the matching school identity; non-parent staff identity references and teacher designations; learner identity, LRN, grade, section and sex; school reporting settings; class periods; teacher subject assignments and substitutions; class-adviser assignments; school years and enrollments; learner movement references; school calendar entries; and special-program types and assignments.

The receiver does not delete records. Source-side deletions and unassignments are not propagated in this release, so records removed locally may remain on the cloud copy and require review. The push is designed to be retried safely and is committed as one database transaction. Existing records with mismatched tenant IDs or incompatible unique records stop the import rather than moving data between schools.

The following are deliberately not copied: staff login usernames or passwords, staff leave reasons/dates, free-text enrollment remarks, staff login sessions, parent accounts and contact details, student portal accounts and sessions, student QR tokens, learner or teacher photos, device credentials, SMS outbox records, confirmed daily-absence overrides, and the files and local file paths for SF2 submissions. Newly created cloud staff identity rows are marked as non-login records. Existing cloud account password hashes are never replaced. Local parent SMS remains the responsibility of the local server.

Attendance events are sent separately through the retry queue. The source event IDs are preserved, and the cloud receiver does not enqueue duplicate SMS messages. Historical attendance-event backfill is not included in this release.

## Encryption key on the local server

Set `CLOUD_SYNC_ENCRYPTION_KEY` in the environment of the **local/source server**. Generate a key with:

    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

The result must be a 64-character hexadecimal value (32 bytes). Put it in the local server's private environment configuration as `CLOUD_SYNC_ENCRYPTION_KEY=...`. Do not commit it to Git, paste it into the browser, or reuse it as the cloud receiving credential. Back it up securely: losing this key prevents the local server from decrypting the saved outbound credential.

The cloud/receiver server does not need this encryption key merely to verify inbound credentials; it stores only their hash.

## Pairing and first synchronization

1. Deploy this release to both the local and cloud instances. Migration 014 is applied by the normal migration runner when the application starts. Back up both databases before applying it.
2. On the **cloud/receiver** instance, sign in as School Administrator and open **Academics → Cloud Sync**.
3. Select **Generate / rotate receiving credential**. Copy the one-time credential. Rotating it immediately revokes the previous credential.
4. On the **local/source** instance, open **Academics → Cloud Sync**, enter the cloud HTTPS base address and paste the receiving credential, then save the pairing settings.
5. Select **Test secure connection**. The remote school ID must exactly match the local school ID.
6. Select **Sync master data to cloud**. Review the local counts, last push timestamp, and cloud receipt. The import is additive/upsert-only and does not delete cloud records.
7. Only after the successful push, enable **automatic attendance forwarding**. The server enforces this order even if someone tries to bypass the UI.
8. Review queue counts and recent event responses. Use retry actions after correcting the reason shown for a failed item.

Migration 014 pauses any previously enabled attendance forwarding so an old pairing cannot begin sending events before master data is provisioned. The forwarding switch becomes available after a current connection test and successful master-data push to the current destination.

## Retry behavior

- Network errors and temporary HTTP responses are retried with exponential backoff.
- Rejected events are marked FAILED with a reason. Use **Retry failed events** after fixing the cause.
- A process restart recovers stale SENDING queue claims. If the cloud accepted an event before a network interruption, the same event ID is safe to send again; the receiver returns ALREADY_SYNCED when the stored data matches.
- Never delete local attendance rows or queue rows to resolve a sync error. Correct the destination data or retry the event instead.

## Deployment and limitations

The JSON request body limit for this app is 8 MB. Schools with unusually large exports that exceed this limit need a future chunked snapshot implementation rather than increasing the limit without review.

Migration 014 has not been run automatically by editing this repository. It runs only when the updated app is started against a database. Test it first against a backup/staging database. Do not enable attendance forwarding in a production school until the receiver status confirms the intended school and snapshot.
