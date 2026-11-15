# Attendigo SMS notifications

School Admin → SMS notifications opens `/sms.html` with settings and school-scoped masked history. SMS uses Semaphore. Configure the Render environment with `SEMAPHORE_API_KEY`, `SMS_DELIVERY_ENABLED=true`, and optionally `SEMAPHORE_SENDER_NAME` (an approved sender). The provider account requires credits and an approved/default sender. Redeploy, then activate the school's selected event types and time-in/time-out notifications in the UI. Keys stay on the server.

Delivery is disabled by default. Migration 030 marks old pending/sending rows as legacy failures, preventing historical test messages from being sent on activation. New outbox records are inserted by a transactional database trigger for accepted events, including class-QR and cloud-synced attendance. One outbox row per event prevents repeat synchronization from duplicating messages. Only the current primary guardian number in the student record is used; pending guardian changes do not alter it. Changed recipients are blocked before delivery. Extra guardians do not receive SMS in this version.

SMS is sent after offline records synchronize, and only for attendance less than 24 hours old. Message timestamps include the event date/time in the Philippines. There are no inferred absence notifications: a missing attendance record is not proof of absence.

The worker runs with the web server and uses PostgreSQL row locking for parallel safety. The free Render web service may sleep, pausing queue processing until it wakes. An always-on paid worker is required for uninterrupted background processing; `npm run worker` uses the same worker code. Do not enable multiple separate local/cloud servers to send SMS for the same attendance; activate SMS only at the central notification server.

Rate limits retry with backoff up to five attempts. Network timeouts, malformed responses, server errors and interrupted in-flight sends are held as uncertain failures, not automatically resent: the provider has no documented idempotency key. Check the provider console before manually sending another message. Accepted requests are shown as “Provider accepted”, not “delivered” or “read”. Provider status is the initial submission response; this release does not poll handset delivery receipts.

Tests use fake provider responses and a disposable PostgreSQL database. Deployment does not send a test message, purchase credits or enable any school's notifications.
