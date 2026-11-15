# Secure cloud attendance sync

Cloud sync sends accepted attendance events from a school server to a second
deployment. It uses a durable database outbox, HMAC-SHA256 request signatures,
five-minute timestamp checks, replay protection, idempotent event IDs, and
automatic retry with backoff.

## Configure both servers

1. Register the same school code on the cloud server. Cloud sync creates a
   missing learner record and class schedule when it receives that school's
   first attendance event.
2. Generate a private random secret of at least 32 characters. Set it as
   `CLOUD_SYNC_SHARED_SECRET` in the local server and the cloud server's
   runtime environment. Keep it out of source control and logs.
3. Restart both services so they load the secret. Apply database migrations
   using the regular startup migration or `npm run db:migrate`.
4. In the local School Administrator workspace, open **Cloud Sync**, enter the
   cloud server base URL, enable forwarding, and save. Use **Test connection**
   to verify that the cloud endpoint accepts the shared secret.

Only newly accepted events are queued after forwarding is enabled. The pending
queue retries automatically every 15 seconds, and administrators can use
**Sync pending now** to request an immediate attempt. Events already accepted
on the cloud are not inserted again.

The signed event payload contains a learner's name, grade, section, attendance
time, and the class/subject details needed to interpret the record. It does not
send parent contact details, learner photos, passwords, or session tokens.
HTTPS is required for remote destinations. HTTP is permitted only for localhost
development.

## Deployment requirements

Both deployments need outbound/inbound connectivity to each other and the same
secret. The receiver must use the same application version with migration 022
applied. If a cloud record is rejected, inspect the local Cloud Sync status and
`school_cloud_sync_outbox.last_error`; retries continue with backoff.
