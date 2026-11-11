# Install v0.8.0 using the existing test database

This release is based on v0.7.8 and includes the new optional Student Portal account tables. It is designed to upgrade the existing test database in place; it does not reset the database.

## 1. Stop the current server

In the PowerShell window running the old application, press `Ctrl + C`.

## 2. Extract to a new folder

For example:

`C:\SchoolAttendance-Test-v080`

Do not extract over the current project folder.

## 3. Copy local configuration and school files

From the latest working project folder, copy these into the new folder:

- `.env` — keeps the current `DATABASE_URL`, server ports and service settings. Do not share it.
- `storage` — preserves learner photos and already-generated SF2 files.
- `localhost+ip.pem` and `localhost+ip-key.pem` if you use the local HTTPS certificate. Keep the `-key.pem` private.

The ZIP intentionally does not include your `.env`, private HTTPS key, student photos, or generated reports.

Confirm `DATABASE_URL` still points to the existing test database `school_attendance_backup_test`.

## 4. Install dependencies and run tests

Open PowerShell in `C:\SchoolAttendance-Test-v080` and run:

```powershell
npm.cmd install
npm.cmd test
```

Expected automated result for this source release: 34 tests pass, 0 fail.

## 5. Apply the additive Student Portal migration

Run:

```powershell
npm.cmd run db:migrate
```

Your existing test database has already adopted migrations 001–006. The migration runner should report those as already applied and apply only `007_student_portal_accounts.sql`. Do not run `db:reset:test` or `db:adopt-existing-test` again.

If the runner reports a checksum mismatch, stop and send the complete error. Do not manually delete rows from `schema_migrations`.

## 6. Start and open the app

```powershell
npm.cmd start
```

Use the port shown in the server output. With the current test configuration, the usual links are:

- Attendance Desk: `http://localhost:3001/`
- Management Portal login: `http://localhost:3001/portal-login.html`
- Parent registration: `http://localhost:3001/parent-register.html`

Select the correct login type: School account, Student account, or Platform admin. Parent accounts use the parent registration/approval process.

For phone/tablet camera scanning, use your trusted local HTTPS address and ensure the device is on the same school network. HTTP on a LAN IP is not a secure camera context on modern mobile browsers.

## 7. First acceptance pass

1. Sign in as School Administrator and verify Students, Teachers, Parents, Academics/Schedules, and SF2 are available.
2. Sign in as Department Head and verify no Students roster or QR scanner is available; verify Teacher Monitoring, Schedule Monitoring and read-only SF2 submissions are available.
3. Sign in as a Subject Teacher and verify only assigned subjects/learners appear, with a personal SF2 copy.
4. Sign in as a Class Adviser and verify only assigned advisory sections appear and official SF2 submission is available.
5. Sign in as a teacher with both designations and verify both sets of tools.
6. Sign in as Gate Keeper and verify only the gate scanner is available; it must not download the roster.
7. Sign in as Parent and verify only approved linked children appear.
8. Create a Student login from the School Administrator's student roster, then sign in through Student account. The student must change the initial password before viewing attendance.
9. Sign in as Platform Super Administrator and verify the page is labelled as a placeholder; school onboarding/subscription functions are not yet implemented.

## Verification boundary

The packaged Node test suite checks role routing, route/permission definitions, dashboard visibility contracts, migration ordering and teacher grade/section display. It does not execute PostgreSQL migrations against your local database or perform physical camera/offline/SMS testing. Those must be completed in your local environment.
