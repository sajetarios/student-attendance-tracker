# Cloud Sync setup (foundation)

## What this release does

- Keeps the local school database as the attendance source of truth.
- Queues each newly accepted or duplicate attendance event in the same transaction that stores the event locally.
- Forwards queued events from the local server process to the configured cloud server, using retry/backoff and idempotent event IDs.
- Uses a separate server-to-server bearer credential. The cloud stores only its SHA-256 hash; the local server stores the outbound credential encrypted with AES-256-GCM.
- Does not create a second SMS outbox entry on the cloud server. Parent SMS remains a local-server responsibility.

This release does **not** automatically provision master data or backfill all historical attendance. Before enabling forwarding, the destination must already contain the matching school ID, student IDs, class-period IDs, and original school-user IDs used by the source events. Student, period, or actor records missing on the destination are rejected and shown as failed queue items. Provisioning and historical backfill are separate follow-up work.

## Encryption key on the local server

Set CLOUD_SYNC_ENCRYPTION_KEY in the environment of the **local/source server**. Generate a key with this command:

    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

The result must be a 64-character hexadecimal value. Put it in the local server's private environment configuration as CLOUD_SYNC_ENCRYPTION_KEY=... . Do not commit it to Git, paste it into the browser, or reuse it as the cloud receiving credential. Back it up securely: losing this key prevents the local server from decrypting the saved outbound credential.

The cloud/receiver server does not need this encryption key merely to verify inbound credentials; it stores only their hash.

## Pairing procedure

1. Apply the new database migration by starting the application or running the normal migration command.
2. On the **cloud/receiver** server, log in as the School Admin for the matching school and open Cloud Sync.
3. Select **Generate / rotate receiving credential** and copy the one-time token. Generating a new token revokes the previous active token for that school.
4. On the **local/source** server, log in as the School Admin, enter the cloud base address and paste the receiving credential, then save.
5. Select **Test connection**. The remote school ID must match the local school ID.
6. Confirm the matching master data has already been provisioned on the cloud server, then enable forwarding and save.
7. Review queue counts and recent results in the Cloud Sync panel. Requeue failed items after correcting missing or mismatched cloud data.

New events are queued after this release is deployed. Existing attendance history is not automatically copied by migration 013. The local server continues normal scanning and SMS delivery when the cloud is unreachable; the forwarder retries when connectivity returns.

## Retry behavior

- Network errors and temporary HTTP responses are retried with exponential backoff.
- Rejected records are marked FAILED with a reason. Use **Retry failed records** after fixing the cause.
- A process restart recovers stale SENDING queue claims. If the cloud accepted an event before a network interruption, the same event ID is safe to send again; the receiver returns ALREADY_SYNCED when the stored data matches.
- Never delete local attendance rows or queue rows to resolve a sync error. Correct the destination data or retry the event instead.
