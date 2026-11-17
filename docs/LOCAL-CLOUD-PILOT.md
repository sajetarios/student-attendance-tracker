# Attendigo pilot: local server, device offline capture, and Render/Supabase cloud

## Current implementation boundary

The local server container and durable server-to-server cloud attendance outbox are available.
**Browser/device offline attendance capture and later authenticated replay are not yet implemented.**
The service worker caches static assets but deliberately does not cache authenticated dashboards or API responses. Never claim an attendance mark is saved offline until the browser has actually stored it and shows a pending status.

## Topology and data ownership

- **Cloud:** existing Render service with its configured Supabase PostgreSQL `DATABASE_URL`. Do not create a second Render database.
- **Local:** one separate PostgreSQL instance per school, using `compose.local.yml`. Never point local and cloud servers at the same `DATABASE_URL`.
- **Forwarding:** local server -> cloud via signed HTTPS `/api/cloud-sync/receive`; cloud is the receiver. Avoid enabling forwarding on cloud back to local.
- **Devices:** until an audited device offline queue is implemented, teachers must use an online local/cloud server to submit attendance. Do not store passwords or auth tokens in offline queues.

## Start a local instance (on a school-owned computer)

Install Docker Engine / Docker Desktop and Compose. From the project directory:

1. Copy `.env.local.example` to `.env.local`; replace both placeholders with strong random values. Do not share the secrets or commit them.
2. Set the same `CLOUD_SYNC_SHARED_SECRET` in the **Render service environment**. This is a manual secure configuration step; secrets must not be placed in GitHub.
3. Run `docker compose --env-file .env.local -f compose.local.yml up -d --build`.
4. Open `http://localhost:3000` **on the local server computer only**. Check migrations and server logs: `docker compose --env-file .env.local -f compose.local.yml logs --tail=100 app`.
5. Register the matching school code on both servers, and provision staff accounts on the local server separately. Existing cloud accounts are not automatically copied locally.
6. In local School Admin -> Cloud Sync, set the destination to `https://student-attendance-tracker-jmp4.onrender.com`, enable forwarding, save, and run **Test connection**.
7. Create a synthetic learner and test attendance record on the local server. Confirm one accepted event in the cloud, and retry the same event to verify duplicate prevention. Do not use live student records before passing this test.

## LAN access security

The Compose file intentionally binds only to `127.0.0.1:3000`. To use phones on a school Wi-Fi/LAN, provide an HTTPS reverse proxy with a trusted certificate and private network/firewall controls, then explicitly configure its upstream to the local service. Browser camera/QR functions often require a secure context. Do **not** change the port binding to `0.0.0.0` and expose attendance or credentials over plain HTTP.

## Offline and reconciliation acceptance criteria (not yet passed)

- A teacher can prepare a class attendance session while online and record attendance with no network.
- Each offline event is persisted durably per device and school, with a stable UUID, original timestamp, school date and correct attendance scope.
- Offline data is isolated by authenticated user/school; logout and account switching cannot expose another user's pending attendance.
- The UI displays **Pending on device**, **Syncing**, **Synced**, or **Needs review** without marking unsent events as saved to the server.
- On reconnection, only an authorized, currently authenticated user can submit events. Server validates class/teacher permissions and resolves duplicate UUIDs idempotently.
- Rejected/conflicting events stay in a review queue; they are not silently dropped or overwritten.
- SF2 is generated only from server-accepted attendance, and manual/QR events use the same authoritative record model.
- Test airplane mode, interrupted uploads, app restart, token expiry, account switching, duplicate delivery, device loss, and time-zone changes.

## Operational precautions

Keep a tested backup of the local Postgres volume and Supabase cloud database. Monitor pending outbox count and last error in the School Admin Cloud Sync panel. Never remove a local server/database until all events are confirmed received and backups verified. The server-to-server sync forwards attendance events, **not** general bidirectional school data, timetable edits, account updates, or photos. Render free instances may sleep; verify service availability and plan limits during pilot.
