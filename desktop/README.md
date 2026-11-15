# Student Attendance Tracker desktop

Installable teacher attendance companion for the existing Render portal. It opens without an internet connection and keeps an encrypted local roster and attendance queue in the operating system's application data directory. The existing full portal opens in the browser through **Open online portal**.

## First use
1. Install the Windows x64 EXE or the Mac DMG matching your computer (arm64 for Apple Silicon, x64 for Intel).
2. While connected, sign in using your school code and teacher credentials. Required password changes must be completed in the portal first.
3. Wait for the downloaded student count and roster date. This downloads only the roster/classes permitted by the server.
4. Without internet, use **Unlock offline** with the same credentials, select the attendance type/class, and enter a student ID or scan a static student QR using a USB keyboard scanner. Press Time in/out.
5. Reconnect and click **Sync attendance**. The app also retries pending attendance every minute while unlocked. If the server session expires, lock and sign in online again. Records are preserved.

An offline unlock is valid for 7 days from the last successful online sign-in. Each operating-system user profile supports one teacher account. Changing accounts is intentionally blocked to avoid mixing school records. Local data and bearer credentials are encrypted using the OS keychain, and tokens are never sent to the renderer. The app does not store the sign-in password. A salted verifier allows offline unlock. Pending attendance is provisional until the server accepts it; duplicate/rejected records remain visible with the server's explanation. Do not delete application data while attendance is pending.

## Scope
Offline: downloaded learner roster, assigned class selection, subject/advisory attendance capture, persistent queue and recent local history. Parent contact data is not downloaded. Server validation remains authoritative for enrolment, teacher assignment, dates, holidays and calendar changes.

Online only: full role dashboards, guardian requests/approvals, student/account management, official reports, SMS and initial enrolment on this computer. No offline gatekeeper mode, webcam scanning or rotating class-QR check-in in this release. This is not a full offline PostgreSQL server. Account revocation and schedule changes become known when the device next contacts the server; offline access expires after 7 days.

## Build and validation
`cd desktop && npm ci && npm test`
`npm run dist -- --win` on Windows; `npm run dist -- --mac` on macOS.
The **Desktop installers** GitHub Actions workflow builds both platforms and uploads installable artifacts with a 30-day retention. It runs on the feature/offline-desktop-packages branch, isolated from Render production.

Builds are unsigned and macOS builds are not notarized. They are evaluation builds, not signed production releases. Code-signing credentials are not bundled. OS reputation/Gatekeeper checks may block installation; use a properly signed/notarized release for managed deployment. Automated tests exercise queue persistence, offline authentication, account isolation, batching, retries, rejection handling and storage errors. Real-account server validation and installed Mac/Windows testing must still be completed before operational use.
