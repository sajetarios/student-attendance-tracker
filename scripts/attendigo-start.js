'use strict';
// Explicit opt-in only. The existing Render DATABASE_URL remains the default.
require('dotenv').config();
async function main() {
  if (process.env.ATTENDIGO_PRIMARY_DATABASE === 'supabase') {
    if (!process.env.SUPABASE_DATABASE_URL) {
      throw new Error('Supabase cutover refused: database connection not configured');
    }
    const { inspectTarget, downloadOfficialRootCa } = require('./supabase-connection-preflight');
    if (inspectTarget(process.env.SUPABASE_DATABASE_URL).status !== 'configured') {
      throw new Error('Supabase cutover refused: unexpected database connection target');
    }
    // Verify the official CA using HTTPS and X.509 checks before loading the app.
    // Never use rejectUnauthorized=false or NODE_TLS_REJECT_UNAUTHORIZED=0.
    process.env.ATTENDIGO_VERIFIED_SUPABASE_ROOT_CA = await downloadOfficialRootCa();
    console.log('[Database] Verified Supabase TLS certificate for primary connection.');
  }
  require('../server');
}
main().catch(() => {
  // Do not log native connection errors: some include private connection strings.
  console.error('[Database] Startup failed; cannot establish secure primary configuration.');
  process.exitCode = 1;
});
