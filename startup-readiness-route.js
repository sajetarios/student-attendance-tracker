'use strict';

// Public, read-only readiness signal for the separately hosted Attendigo welcome screen.
// Never transmit authentication cookies, learner records, or database diagnostics.
const ALLOWED_STARTUP_ORIGINS = new Set([
  'https://attendigo-welcome-preview.onrender.com',
  'https://welcome.attendigo.tech'
]);

function registerStartupReadinessRoute(app, pool, { migrationReadOnly = false, logger = console } = {}) {
  if (!app || typeof app.get !== 'function') throw new TypeError('An app router is required');
  if (!pool || typeof pool.query !== 'function') throw new TypeError('A database pool is required');

  app.get('/api/startup-readiness', async (req, res) => {
    const origin = req.get('Origin');
    res.set('Cache-Control', 'no-store, private');
    res.set('Vary', 'Origin');
    if (ALLOWED_STARTUP_ORIGINS.has(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      // Deliberately no Access-Control-Allow-Credentials.
    }
    if (migrationReadOnly) {
      return res.status(503).json({ ready: false, service: 'attendigo' });
    }
    try {
      // A listening web process is not sufficient; verify its primary database.
      await pool.query({ text: 'SELECT 1', query_timeout: 5000 });
      return res.status(200).json({ ready: true, service: 'attendigo' });
    } catch (error) {
      // Do not expose the database host, connection string, SQL error, or credentials.
      logger.warn('Welcome startup readiness check unavailable');
      return res.status(503).json({ ready: false, service: 'attendigo' });
    }
  });
}

module.exports = { registerStartupReadinessRoute, ALLOWED_STARTUP_ORIGINS };
