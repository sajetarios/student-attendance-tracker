'use strict';

const { createOpaqueToken, hashToken } = require('./auth-security');
const { encryptCloudToken, decryptCloudToken } = require('./cloud-sync-security');

function validText(value, max = 200) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
}

function isUuid(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isValidSchoolDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validTimestamp(value) {
  return typeof value === 'string' || value instanceof Date
    ? Number.isFinite(Date.parse(value))
    : false;
}

function normalizeCloudUrl(rawUrl) {
  if (!rawUrl) return null;
  if (typeof rawUrl !== 'string' || rawUrl.trim().length > 500) {
    throw new Error('Cloud address must be 500 characters or fewer.');
  }
  let parsed;
  try { parsed = new URL(rawUrl.trim()); }
  catch { throw new Error('Enter a valid cloud server address.'); }
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (!(parsed.protocol === 'https:' || (parsed.protocol === 'http:' && localHost)) ||
      parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Use an HTTPS cloud address. HTTP is allowed only for localhost testing; credentials, query strings, and fragments are not allowed.');
  }
  let normalized = parsed.toString();
  while (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
}

function connectionMessage(row) {
  if (!row.cloudBaseUrl) return 'Set the cloud address and save it.';
  if (!row.tokenConfigured) return 'Generate an inbound credential on the cloud server, then save it here.';
  if (!row.connectionVerified) return 'Test the cloud connection before enabling forwarding.';
  if (!row.enabled) return 'Connection verified. Forwarding is currently disabled.';
  return 'Cloud event forwarding is enabled. Confirm master data is synchronized on the cloud server.';
}

function registerCloudSyncRoutes(app, pool, {
  authenticateSchoolClient,
  authenticateCloudSync,
  requireSchoolAdmin
}) {
  app.get('/api/cloud-sync/settings', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT cloud_base_url AS "cloudBaseUrl", enabled, ' +
        'cloud_auth_token_ciphertext IS NOT NULL AS "tokenConfigured", ' +
        'last_connection_test_at AS "lastConnectionTestAt", ' +
        'last_connection_test_url AS "lastConnectionTestUrl", ' +
        'last_master_data_sync_at AS "lastMasterDataSyncAt", ' +
        'last_master_data_sync_counts AS "lastMasterDataSyncCounts", ' +
        'last_master_data_sync_url AS "lastMasterDataSyncUrl", ' +
        'last_master_data_sync_error AS "lastMasterDataSyncError" ' +
        'FROM school_cloud_sync_settings WHERE school_id=$1',
        [req.auth.schoolId]
      );
      const receiverCredential = await pool.query(
        'SELECT created_at AS "createdAt" FROM cloud_sync_credentials ' +
        'WHERE school_id=$1 AND active=TRUE AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1',
        [req.auth.schoolId]
      );
      const row = result.rows[0] || {};
      const data = {
        receiverCredentialActive: Boolean(receiverCredential.rowCount),
        receiverCredentialCreatedAt: receiverCredential.rows[0]?.createdAt || null,
        cloudBaseUrl: row.cloudBaseUrl || '',
        enabled: Boolean(row.enabled),
        configured: Boolean(row.cloudBaseUrl),
        tokenConfigured: Boolean(row.tokenConfigured),
        lastConnectionTestAt: row.lastConnectionTestAt || null,
        lastMasterDataSyncAt: row.lastMasterDataSyncAt || null,
        lastMasterDataSyncCounts: row.lastMasterDataSyncCounts || null,
        lastMasterDataSyncError: row.lastMasterDataSyncError || null,
        masterDataSynced: Boolean(row.cloudBaseUrl && row.tokenConfigured &&
          row.lastConnectionTestUrl === row.cloudBaseUrl && row.lastConnectionTestAt &&
          row.lastMasterDataSyncUrl === row.cloudBaseUrl && row.lastMasterDataSyncAt),
        connectionVerified: Boolean(row.cloudBaseUrl && row.tokenConfigured &&
          row.lastConnectionTestUrl === row.cloudBaseUrl && row.lastConnectionTestAt),
        connectionStatus: 'NOT_CONNECTED'
      };
      data.connectionStatus = data.enabled ? 'ENABLED' : (data.connectionVerified ? 'VERIFIED' : 'NOT_CONNECTED');
      data.message = connectionMessage({
        cloudBaseUrl: data.cloudBaseUrl,
        tokenConfigured: data.tokenConfigured,
        connectionVerified: data.connectionVerified,
        enabled: data.enabled
      });
      return res.json(data);
    } catch (err) {
      console.error('Cloud sync settings load failed:', err.message);
      return res.status(500).json({ error: 'Could not load cloud sync settings.' });
    }
  });

  app.put('/api/cloud-sync/settings', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
    let normalizedUrl;
    try { normalizedUrl = normalizeCloudUrl(req.body?.cloudBaseUrl || ''); }
    catch (err) { return res.status(400).json({ error: err.message }); }

    const tokenInput = typeof req.body?.cloudAuthToken === 'string' ? req.body.cloudAuthToken.trim() : '';
    const clearToken = req.body?.clearAuthToken === true;
    let encrypted = null;
    if (tokenInput) {
      try { encrypted = encryptCloudToken(tokenInput); }
      catch (err) { return res.status(400).json({ error: err.message }); }
    }

    try {
      const current = await pool.query(
        'SELECT cloud_base_url, cloud_auth_token_ciphertext, cloud_auth_token_iv, cloud_auth_token_tag, ' +
        'last_connection_test_at, last_connection_test_url, last_master_data_sync_at, ' +
        'last_master_data_sync_url, last_master_data_sync_counts, last_master_data_sync_hash, last_master_data_sync_error ' +
        'FROM school_cloud_sync_settings WHERE school_id=$1',
        [req.auth.schoolId]
      );
      const existing = current.rows[0] || {};
      const tokenChanged = Boolean(encrypted || clearToken);
      const destinationChanged = existing.cloud_base_url !== normalizedUrl || tokenChanged;
      const tokenConfigured = clearToken ? false : Boolean(encrypted || existing.cloud_auth_token_ciphertext);
      const enabled = req.body?.enabled === true;
      const connectionVerified = !tokenChanged && existing.last_connection_test_at &&
        existing.last_connection_test_url === normalizedUrl;
      if (enabled && (!normalizedUrl || !tokenConfigured)) {
        return res.status(400).json({ error: 'Save the cloud address and inbound credential before enabling forwarding.' });
      }
      if (enabled && !connectionVerified) {
        return res.status(409).json({ error: 'Test the connection after saving the current cloud address and credential before enabling forwarding.' });
      }
      const masterDataSynced = !destinationChanged && existing.last_master_data_sync_at &&
        existing.last_master_data_sync_url === normalizedUrl;
      if (enabled && !masterDataSynced) {
        return res.status(409).json({ error: 'Push the current school master data to the verified cloud destination before enabling attendance forwarding.' });
      }

      const ciphertext = clearToken ? null : (encrypted ? encrypted.ciphertext : existing.cloud_auth_token_ciphertext || null);
      const iv = clearToken ? null : (encrypted ? encrypted.iv : existing.cloud_auth_token_iv || null);
      const tag = clearToken ? null : (encrypted ? encrypted.authTag : existing.cloud_auth_token_tag || null);
      const testAt = (!tokenChanged && existing.last_connection_test_url === normalizedUrl)
        ? existing.last_connection_test_at || null : null;
      const testUrl = testAt ? normalizedUrl : null;

      await pool.query(
        'INSERT INTO school_cloud_sync_settings ' +
        '(school_id, cloud_base_url, enabled, updated_by_user_id, cloud_auth_token_ciphertext, ' +
        'cloud_auth_token_iv, cloud_auth_token_tag, last_connection_test_at, last_connection_test_url, ' +
        'last_master_data_sync_at, last_master_data_sync_counts, last_master_data_sync_hash, ' +
        'last_master_data_sync_url, last_master_data_sync_error, updated_at) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW()) ' +
        'ON CONFLICT (school_id) DO UPDATE SET ' +
        'cloud_base_url=EXCLUDED.cloud_base_url, enabled=EXCLUDED.enabled, ' +
        'updated_by_user_id=EXCLUDED.updated_by_user_id, ' +
        'cloud_auth_token_ciphertext=EXCLUDED.cloud_auth_token_ciphertext, ' +
        'cloud_auth_token_iv=EXCLUDED.cloud_auth_token_iv, cloud_auth_token_tag=EXCLUDED.cloud_auth_token_tag, ' +
        'last_connection_test_at=EXCLUDED.last_connection_test_at, ' +
        'last_connection_test_url=EXCLUDED.last_connection_test_url, ' +
        'last_master_data_sync_at=EXCLUDED.last_master_data_sync_at, ' +
        'last_master_data_sync_counts=EXCLUDED.last_master_data_sync_counts, ' +
        'last_master_data_sync_hash=EXCLUDED.last_master_data_sync_hash, ' +
        'last_master_data_sync_url=EXCLUDED.last_master_data_sync_url, ' +
        'last_master_data_sync_error=EXCLUDED.last_master_data_sync_error, updated_at=NOW()',
        [req.auth.schoolId, normalizedUrl, enabled, req.auth.userId,
          ciphertext, iv, tag, testAt, testUrl,
          destinationChanged ? null : existing.last_master_data_sync_at || null,
          destinationChanged ? null : existing.last_master_data_sync_counts || null,
          destinationChanged ? null : existing.last_master_data_sync_hash || null,
          destinationChanged ? null : existing.last_master_data_sync_url || null,
          destinationChanged ? null : existing.last_master_data_sync_error || null]
      );
      await pool.query(
        'INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details) ' +
        'VALUES($1,\'SCHOOL\',$2,\'SCHOOL_ADMIN_UPDATE_CLOUD_SYNC_SETTINGS\',\'cloud_sync_settings\',$1::text,$3::jsonb)',
        [req.auth.schoolId, req.auth.userId,
          JSON.stringify({ cloudBaseUrl: normalizedUrl, enabled, tokenConfigured })]
      );
      return res.json({
        ok: true,
        cloudBaseUrl: normalizedUrl || '',
        enabled,
        configured: Boolean(normalizedUrl),
        tokenConfigured,
        connectionVerified: Boolean(testAt),
        message: enabled
          ? 'Cloud forwarding enabled. Review sync status and failed records.'
          : 'Cloud settings saved. Forwarding is disabled until enabled after a successful connection test.'
      });
    } catch (err) {
      console.error('Cloud sync settings save failed:', err.message);
      return res.status(500).json({ error: 'Could not save cloud sync settings: ' + err.message });
    }
  });

  app.post('/api/cloud-sync/inbound-credential', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
    const token = createOpaqueToken();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'UPDATE cloud_sync_credentials SET active=FALSE, revoked_at=NOW() ' +
        'WHERE school_id=$1 AND active=TRUE AND revoked_at IS NULL',
        [req.auth.schoolId]
      );
      await client.query(
        'INSERT INTO cloud_sync_credentials(school_id, token_hash, label, created_by_user_id) ' +
        'VALUES($1,$2,$3,$4)',
        [req.auth.schoolId, hashToken(token), 'Local school attendance server', req.auth.userId]
      );
      await client.query(
        'INSERT INTO audit_logs(school_id, actor_type, actor_user_id, action, entity_type, entity_id, details) ' +
        'VALUES($1,\'SCHOOL\',$2,\'SCHOOL_ADMIN_ROTATE_CLOUD_SYNC_CREDENTIAL\',\'cloud_sync_credential\',$1::text,$3::jsonb)',
        [req.auth.schoolId, req.auth.userId, JSON.stringify({ credentialRotated: true })]
      );
      await client.query('COMMIT');
      return res.status(201).json({
        ok: true,
        token,
        message: 'Copy this credential now. It will not be displayed again. Paste it into the local school server Cloud Sync settings.'
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Cloud sync credential generation failed:', err.message);
      return res.status(500).json({ error: 'Could not generate the inbound credential.' });
    } finally {
      client.release();
    }
  });

  app.get('/api/cloud-sync/health', authenticateCloudSync, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT school_code AS "schoolCode", school_name AS "schoolName" FROM schools WHERE school_id=$1 AND active=TRUE',
        [req.auth.schoolId]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'Registered school is not active.' });
      return res.json({
        ok: true,
        service: 'school-attendance-cloud-sync',
        schoolId: req.auth.schoolId,
        schoolCode: result.rows[0].schoolCode,
        schoolName: result.rows[0].schoolName
      });
    } catch (err) {
      console.error('Cloud sync health check failed:', err.message);
      return res.status(500).json({ error: 'Cloud sync health check failed.' });
    }
  });

  app.post('/api/cloud-sync/test', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT cloud_base_url, cloud_auth_token_ciphertext, cloud_auth_token_iv, cloud_auth_token_tag ' +
        'FROM school_cloud_sync_settings WHERE school_id=$1',
        [req.auth.schoolId]
      );
      if (!result.rowCount || !result.rows[0].cloud_base_url) {
        return res.status(400).json({ error: 'Save the cloud server address first.' });
      }
      const token = decryptCloudToken(result.rows[0]);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      let response;
      try {
        response = await fetch(
          result.rows[0].cloud_base_url.replace(/\/+$/, '') + '/api/cloud-sync/health',
          { headers: { Authorization: 'Bearer ' + token }, signal: controller.signal }
        );
      } finally { clearTimeout(timeout); }
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) {
        return res.status(502).json({ error: data.error || ('Cloud server returned HTTP ' + response.status) });
      }
      if (data.schoolId !== req.auth.schoolId) {
        return res.status(409).json({
          error: 'The cloud server is connected, but its school ID does not match this local school. Do not enable forwarding until the correct school is provisioned.'
        });
      }
      await pool.query(
        'UPDATE school_cloud_sync_settings SET last_connection_test_at=NOW(), ' +
        'last_connection_test_url=cloud_base_url, updated_at=NOW() WHERE school_id=$1',
        [req.auth.schoolId]
      );
      return res.json({
        ok: true,
        schoolCode: data.schoolCode,
        schoolName: data.schoolName,
        message: 'Secure connection verified for the matching school. Before enabling forwarding, ensure the cloud has the matching student roster, class periods, teacher accounts, and adviser/subject assignments.'
      });
    } catch (err) {
      console.error('Cloud sync connection test failed:', err.message);
      return res.status(502).json({ error: 'Connection test failed: ' + err.message });
    }
  });

  app.get('/api/cloud-sync/status', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
    try {
      const [counts, recent, settings] = await Promise.all([
        pool.query(
          'SELECT status, COUNT(*)::int AS count FROM cloud_sync_outbox ' +
          'WHERE school_id=$1 GROUP BY status',
          [req.auth.schoolId]
        ),
        pool.query(
          'SELECT q.event_id AS "eventId", q.status, q.attempts, q.last_error AS "lastError", ' +
          'q.remote_status AS "remoteStatus", q.last_attempt_at AS "lastAttemptAt", q.synced_at AS "syncedAt" ' +
          'FROM cloud_sync_outbox q WHERE q.school_id=$1 ' +
          'ORDER BY q.updated_at DESC, q.sync_id DESC LIMIT 10',
          [req.auth.schoolId]
        ),
        pool.query(
          'SELECT enabled, cloud_base_url AS "cloudBaseUrl", ' +
          'cloud_auth_token_ciphertext IS NOT NULL AS "tokenConfigured" ' +
          'FROM school_cloud_sync_settings WHERE school_id=$1',
          [req.auth.schoolId]
        )
      ]);
      const summary = { PENDING: 0, SENDING: 0, SYNCED: 0, FAILED: 0 };
      for (const row of counts.rows) summary[row.status] = Number(row.count);
      return res.json({
        summary,
        recent: recent.rows,
        enabled: Boolean(settings.rows[0]?.enabled),
        configured: Boolean(settings.rows[0]?.cloudBaseUrl && settings.rows[0]?.tokenConfigured)
      });
    } catch (err) {
      console.error('Cloud sync status load failed:', err.message);
      return res.status(500).json({ error: 'Could not load cloud sync status.' });
    }
  });

  app.post('/api/cloud-sync/sync-now', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
    try {
      const configured = await pool.query(
        'SELECT enabled FROM school_cloud_sync_settings WHERE school_id=$1',
        [req.auth.schoolId]
      );
      if (!configured.rows[0]?.enabled) {
        return res.status(409).json({ error: 'Enable cloud forwarding after the connection test and master-data preparation.' });
      }
      const result = await pool.query(
        'UPDATE cloud_sync_outbox SET status=\'PENDING\', attempts=0, last_error=NULL, remote_status=NULL, ' +
        'next_attempt_at=NOW(), updated_at=NOW() WHERE school_id=$1 AND status = ANY($2::text[]) RETURNING sync_id',
        [req.auth.schoolId, ['PENDING', 'FAILED']]
      );
      return res.json({ ok: true, queued: result.rowCount, message: 'Pending and failed records are ready for retry.' });
    } catch (err) {
      console.error('Cloud sync manual retry failed:', err.message);
      return res.status(500).json({ error: 'Could not queue cloud sync retry.' });
    }
  });

  app.post('/api/cloud-sync/retry-failed', authenticateSchoolClient, requireSchoolAdmin, async (req, res) => {
    try {
      const configured = await pool.query(
        'SELECT enabled FROM school_cloud_sync_settings WHERE school_id=$1',
        [req.auth.schoolId]
      );
      if (!configured.rows[0]?.enabled) {
        return res.status(409).json({ error: 'Enable cloud forwarding after the connection test and master-data preparation.' });
      }
      const result = await pool.query(
        'UPDATE cloud_sync_outbox SET status=\'PENDING\', attempts=0, last_error=NULL, remote_status=NULL, ' +
        'next_attempt_at=NOW(), updated_at=NOW() WHERE school_id=$1 AND status=\'FAILED\' RETURNING sync_id',
        [req.auth.schoolId]
      );
      return res.json({ ok: true, queued: result.rowCount, message: 'Failed records were requeued.' });
    } catch (err) {
      console.error('Cloud sync failed-record retry failed:', err.message);
      return res.status(500).json({ error: 'Could not requeue failed cloud sync records.' });
    }
  });

  app.post('/api/cloud-sync/receive-events', authenticateCloudSync, async (req, res) => {
    const events = req.body?.events;
    if (req.body?.schoolId !== req.auth.schoolId) {
      return res.status(403).json({ error: 'The submitted school does not match this credential.' });
    }
    if (!Array.isArray(events) || events.length < 1 || events.length > 250) {
      return res.status(400).json({ error: 'events must contain 1 to 250 records.' });
    }

    const client = await pool.connect();
    const results = [];
    try {
      await client.query('BEGIN');
      for (const event of events) {
        const eventId = event?.eventId;
        if (!event || !isUuid(eventId) || !validText(event.studentId, 120) ||
            !validText(event.deviceId, 200) ||
            !['TIME_IN', 'TIME_OUT'].includes(event.eventType) ||
            !['SCHOOL', 'CLASS', 'ADVISORY'].includes(event.attendanceScope) ||
            (event.attendanceScope === 'CLASS' && !isUuid(event.periodId)) ||
            (event.attendanceScope !== 'CLASS' && event.periodId != null) ||
            !isValidSchoolDate(event.schoolDate) || !validTimestamp(event.occurredAt) ||
            !validTimestamp(event.receivedAtServer) ||
            !['ACCEPTED', 'DUPLICATE'].includes(event.syncStatus) ||
            (event.syncStatus === 'DUPLICATE' && !isUuid(event.duplicateOf)) ||
            (event.syncStatus === 'ACCEPTED' && event.duplicateOf != null) ||
            (event.duplicateOf && event.duplicateOf === eventId) ||
            (event.recordedByUserId != null && !isUuid(event.recordedByUserId))) {
          results.push({ eventId: eventId || null, status: 'REJECTED', reason: 'Invalid or incomplete replicated event.' });
          continue;
        }

        const existing = await client.query(
          'SELECT school_id, student_id, device_id, attendance_scope, period_id, event_type, ' +
          'occurred_at_device, school_date, sync_status, duplicate_of, recorded_by_user_id ' +
          'FROM attendance_events WHERE event_id=$1',
          [eventId]
        );
        if (existing.rowCount) {
          const row = existing.rows[0];
          const same = row.school_id === req.auth.schoolId &&
            row.student_id === event.studentId &&
            row.device_id === event.deviceId &&
            row.attendance_scope === event.attendanceScope &&
            String(row.period_id || '') === String(event.periodId || '') &&
            row.event_type === event.eventType &&
            new Date(row.occurred_at_device).getTime() === Date.parse(event.occurredAt) &&
            String(row.school_date).slice(0, 10) === event.schoolDate &&
            row.sync_status === event.syncStatus &&
            String(row.duplicate_of || '') === String(event.duplicateOf || '') &&
            String(row.recorded_by_user_id || '') === String(event.recordedByUserId || '');
          results.push(same
            ? { eventId, status: 'ALREADY_SYNCED' }
            : { eventId, status: 'REJECTED', reason: 'Event ID already exists with different attendance data.' });
          continue;
        }

        const student = await client.query(
          'SELECT 1 FROM students WHERE school_id=$1 AND student_id=$2',
          [req.auth.schoolId, event.studentId]
        );
        if (!student.rowCount) {
          results.push({ eventId, status: 'REJECTED', reason: 'Student is not provisioned on the cloud server.' });
          continue;
        }
        if (event.attendanceScope === 'CLASS') {
          const period = await client.query(
            'SELECT 1 FROM class_periods WHERE school_id=$1 AND period_id=$2',
            [req.auth.schoolId, event.periodId]
          );
          if (!period.rowCount) {
            results.push({ eventId, status: 'REJECTED', reason: 'Class period is not provisioned on the cloud server.' });
            continue;
          }
        }
        if (event.recordedByUserId) {
          const actor = await client.query(
            'SELECT 1 FROM school_users WHERE school_id=$1 AND user_id=$2',
            [req.auth.schoolId, event.recordedByUserId]
          );
          if (!actor.rowCount) {
            results.push({ eventId, status: 'REJECTED', reason: 'Original recording account is not provisioned on the cloud server.' });
            continue;
          }
        }
        if (event.duplicateOf) {
          const parentEvent = await client.query(
            'SELECT 1 FROM attendance_events WHERE school_id=$1 AND event_id=$2',
            [req.auth.schoolId, event.duplicateOf]
          );
          if (!parentEvent.rowCount) {
            results.push({ eventId, status: 'REJECTED', reason: 'The original event referenced by this duplicate has not arrived yet.' });
            continue;
          }
        }

        if (event.syncStatus === 'ACCEPTED') {
          const semanticDuplicate = await client.query(
            'SELECT event_id FROM attendance_events WHERE school_id=$1 AND student_id=$2 AND school_date=$3 ' +
            'AND attendance_scope=$4 AND COALESCE(period_id::text, \'SCHOOL\')=COALESCE($5::text, \'SCHOOL\') ' +
            'AND event_type=$6 AND sync_status=\'ACCEPTED\' LIMIT 1',
            [req.auth.schoolId, event.studentId, event.schoolDate, event.attendanceScope, event.periodId || null, event.eventType]
          );
          if (semanticDuplicate.rowCount) {
            results.push({ eventId, status: 'REJECTED', reason: 'A different accepted attendance punch already exists for this learner and attendance scope on the cloud server.' });
            continue;
          }
        }

        const metadata = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
          ? event.metadata : {};
        await client.query(
          'INSERT INTO attendance_events ' +
          '(event_id, school_id, device_id, student_id, attendance_scope, period_id, event_type, ' +
          'occurred_at_device, received_at_server, school_date, late, sync_status, duplicate_of, metadata, recorded_by_user_id) ' +
          'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
          [eventId, req.auth.schoolId, event.deviceId, event.studentId, event.attendanceScope,
            event.periodId || null, event.eventType, event.occurredAt, event.receivedAtServer,
            event.schoolDate, Boolean(event.late), event.syncStatus, event.duplicateOf || null,
            metadata, event.recordedByUserId || null]
        );
        // Deliberately do not insert into sms_outbox: the local server owns parent SMS delivery.
        results.push({ eventId, status: 'ACCEPTED', mirroredStatus: event.syncStatus });
      }
      await client.query('COMMIT');
      return res.json({ results, serverTime: new Date().toISOString() });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Cloud replicated event ingestion failed:', err.message);
      return res.status(500).json({ error: 'Cloud event replication failed.' });
    } finally {
      client.release();
    }
  });
}

module.exports = registerCloudSyncRoutes;
