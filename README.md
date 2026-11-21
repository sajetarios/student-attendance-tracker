# student-attendance-tracker
Student Attendance Tracker - Node.js, PostgreSQL, QR Attendance and SF2


## Deploying to Render

1. In Render choose **New → Blueprint**, pick this repository, and apply `render.yaml`. It creates the web service, a PostgreSQL database and (optionally) the SMS worker, and wires `DATABASE_URL` automatically.
2. The web service mounts a persistent disk at `/var/data` (`STORAGE_DIR`). Student photos and submitted SF2 files are stored there; without a disk they are erased on every deploy.
3. Database migrations run automatically on start. Render uses `/health` (which also checks the database) to decide whether a new version is healthy, and keeps the previous version live if it fails.
4. Create the first school and admin from the Render shell: `npm run school:create` then `node create-account.js`.
5. Set `SEMAPHORE_API_KEY` on the worker if you use SMS.

Environment variables are listed in `.env.example`. Sign-in is rate limited per IP address and per account; the app trusts Render's proxy so limits apply per visitor, not per school.

## Tests

```
npm ci
npm test
```
