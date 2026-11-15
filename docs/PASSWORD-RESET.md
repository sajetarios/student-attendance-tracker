# Reset a school user's password (test database)

This utility resets an existing active school account. It does not create an account, change its role/designations, or delete attendance data. It hashes the new password with the same scrypt implementation used by login, clears failed-login lockout counters, and revokes active sessions for that account.

1. Stop the server with Ctrl+C.
2. Ensure the project's `.env` points to the intended test database. Do not share `.env`.
3. From the project folder, run `npm.cmd run account:reset-password`.
4. Enter the username (press Enter to use `sajeta`). If it exists in multiple schools, enter the exact school code shown by the utility.
5. Confirm the selected account by typing `RESET`.
6. Enter and confirm a new password. It must be at least 12 characters. Password input is hidden.
7. Restart the app with `npm.cmd start`, then sign in at `/portal-login.html`.

The utility only updates `school_users` for the selected school and user. It never prints or stores the new password in the database in plaintext.
