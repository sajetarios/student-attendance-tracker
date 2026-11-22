'use strict';

// Only deliberate, user-facing SF2 validation errors may reach the browser.
// Unexpected database, storage and code errors are logged on the server,
// never returned with connection strings, SQL, paths or stack information.
const USER_FACING_STATUSES = new Set([400, 403, 409]);
function publicSf2Failure(error, fallback) {
  const status = Number(error?.status);
  if (USER_FACING_STATUSES.has(status) &&
      typeof error?.message === 'string' && error.message.trim()) {
    return { status, error: error.message };
  }
  return { status: 500, error: fallback };
}
module.exports = { publicSf2Failure };
