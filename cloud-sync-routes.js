'use strict';

function registerCloudSyncRoutes(app, pool, { authenticateSchoolClient, requireSchoolAdmin }) {
  app.get('/api/cloud-sync/status', authenticateSchoolClient, async (req, res) => {
    if (req.auth?.type !== 'SCHOOL_USER' ||
        !['SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER','GATE_KEEPER'].includes(req.auth.role)) {
      return res.status(403).json({ error: 'School staff access is required.' });
    }
    try {
      const result = await pool.query(
        `SELECT cloud_base_url AS "cloudBaseUrl",enabled,updated_at AS "updatedAt"
         FROM school_cloud_sync_settings WHERE school_id=$1`,
        [req.auth.schoolId]
      );
      const row = result.rows[0] || {};
      return res.json({
        configured: Boolean(row.cloudBaseUrl),
        enabled: Boolean(row.enabled),
        connectionStatus: 'NOT_CONNECTED',
        updatedAt: row.updatedAt || null,
        message: row.enabled
          ? 'Cloud forwarding is enabled in settings, but a live replication connection has not been verified.'
          : row.cloudBaseUrl
            ? 'Cloud destination is saved, but cloud forwarding is not active.'
            : 'Cloud destination is not configured. Attendance is stored on this server.'
      });
    } catch (err) {
      console.error('Cloud sync status failed:', err.message);
      return res.status(500).json({ error: 'Could not check cloud sync status.' });
    }
  });

  app.get('/api/cloud-sync/settings', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT cloud_base_url AS "cloudBaseUrl", enabled, updated_at AS "updatedAt"
         FROM school_cloud_sync_settings WHERE school_id=$1`,
        [req.auth.schoolId]
      );
      const row = result.rows[0] || {};
      return res.json({
        cloudBaseUrl: row.cloudBaseUrl || '',
        enabled: Boolean(row.enabled),
        configured: Boolean(row.cloudBaseUrl),
        updatedAt: row.updatedAt || null,
        connectionStatus: 'NOT_CONNECTED',
        message: 'Destination saved. Secure cloud authentication and event forwarding are not enabled yet.'
      });
    } catch (err) {
      console.error('Cloud sync settings load failed:', err.message);
      return res.status(500).json({ error: 'Could not load cloud sync settings.' });
    }
  });

  app.put('/api/cloud-sync/settings', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
    const rawUrl = typeof req.body?.cloudBaseUrl === 'string' ? req.body.cloudBaseUrl.trim() : '';
    const enabled = false; // Destination configuration does not activate forwarding.
    let normalizedUrl = null;
    if (rawUrl) {
      if (rawUrl.length > 500) return res.status(400).json({ error: 'Cloud address must be 500 characters or fewer.' });
      let parsed;
      try { parsed = new URL(rawUrl); }
      catch { return res.status(400).json({ error: 'Enter a valid cloud server address.' }); }
      const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
      if (!(parsed.protocol === 'https:' || (parsed.protocol === 'http:' && localHost)) ||
          parsed.username || parsed.password || parsed.search || parsed.hash) {
        return res.status(400).json({ error: 'Use an HTTPS cloud address. HTTP is allowed only for localhost testing; credentials, query strings, and fragments are not allowed.' });
      }
      normalizedUrl = parsed.toString().replace(/\/+$/, '');
    }
    try {
      await pool.query(
        `INSERT INTO school_cloud_sync_settings
           (school_id, cloud_base_url, enabled, updated_by_user_id, updated_at)
         VALUES ($1,$2,$3,$4,NOW())
         ON CONFLICT (school_id) DO UPDATE
           SET cloud_base_url=EXCLUDED.cloud_base_url,
               enabled=EXCLUDED.enabled,
               updated_by_user_id=EXCLUDED.updated_by_user_id,
               updated_at=NOW()`,
        [req.auth.schoolId, normalizedUrl, enabled, req.auth.userId]
      );
      await pool.query(
        `INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details)
         VALUES($1,'SCHOOL',$2,'SCHOOL_ADMIN_UPDATE_CLOUD_SYNC_SETTINGS','cloud_sync_settings',$1::text,$3::jsonb)`,
        [req.auth.schoolId, req.auth.userId, JSON.stringify({ cloudBaseUrl: normalizedUrl, enabled })]
      );
      return res.json({
        ok: true,
        cloudBaseUrl: normalizedUrl || '',
        enabled,
        configured: Boolean(normalizedUrl),
        connectionStatus: 'NOT_CONNECTED',
        message: 'Cloud destination saved. Attendance forwarding remains disabled until secure cloud credentials and the replication queue are configured.'
      });
    } catch (err) {
      console.error('Cloud sync settings save failed:', err.message);
      return res.status(500).json({ error: 'Could not save cloud sync settings.' });
    }
  });
}

module.exports = registerCloudSyncRoutes;
