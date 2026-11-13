'use strict';

const { decryptCloudToken } = require('./cloud-sync-security');

const BATCH_SIZE = 50;
const POLL_MS = Math.max(5000, Number(process.env.CLOUD_SYNC_POLL_INTERVAL_MS || 10000));
const MAX_ATTEMPTS = Math.max(3, Number(process.env.CLOUD_SYNC_MAX_ATTEMPTS || 12));
const REQUEST_TIMEOUT_MS = 20000;

function retryDelayMs(attempts) {
  return Math.min(6 * 60 * 60 * 1000, 5000 * Math.pow(2, Math.min(14, Math.max(0, attempts - 1))));
}

async function updateRows(pool, rows, status, error, remoteStatus, delayMs = 0) {
  for (const row of rows) {
    const nextAttempt = new Date(Date.now() + delayMs);
    await pool.query(
      `UPDATE cloud_sync_outbox
       SET status=$2, last_error=$3, remote_status=$4,
           next_attempt_at=$5, synced_at=CASE WHEN $2='SYNCED' THEN NOW() ELSE NULL END,
           updated_at=NOW()
       WHERE sync_id=$1`,
      [row.sync_id, status, error ? String(error).slice(0, 1000) : null,
       remoteStatus || null, nextAttempt]
    );
  }
}

async function syncSchool(pool, schoolId) {
  const setting = await pool.query(
    `SELECT cloud_base_url, enabled, cloud_auth_token_ciphertext,
            cloud_auth_token_iv, cloud_auth_token_tag
     FROM school_cloud_sync_settings
     WHERE school_id=$1 AND enabled=TRUE`,
    [schoolId]
  );
  if (!setting.rowCount || !setting.rows[0].cloud_base_url) return;
  let token;
  try {
    token = decryptCloudToken(setting.rows[0]);
  } catch (error) {
    console.error('Cloud sync credential unavailable for school ' + schoolId + ': ' + error.message);
    return;
  }

  const client = await pool.connect();
  let rows = [];
  try {
    await client.query('BEGIN');
    const selected = await client.query(
      `SELECT q.sync_id, q.attempts,
              e.event_id, e.school_id, e.device_id, e.student_id,
              e.attendance_scope, e.period_id, e.event_type,
              e.occurred_at_device, e.received_at_server, e.school_date,
              e.late, e.sync_status, e.duplicate_of, e.metadata,
              e.recorded_by_user_id
       FROM cloud_sync_outbox q
       JOIN attendance_events e
         ON e.school_id=q.school_id AND e.event_id=q.event_id
       WHERE q.school_id=$1 AND q.status='PENDING'
         AND q.next_attempt_at <= NOW()
       ORDER BY e.received_at_server, q.sync_id
       FOR UPDATE OF q SKIP LOCKED
       LIMIT $2`,
      [schoolId, BATCH_SIZE]
    );
    rows = selected.rows;
    if (!rows.length) {
      await client.query('COMMIT');
      return;
    }
    const ids = rows.map(row => row.sync_id);
    await client.query(
      `UPDATE cloud_sync_outbox
       SET status='SENDING', attempts=attempts+1,
           last_attempt_at=NOW(), updated_at=NOW()
       WHERE sync_id=ANY($1::bigint[])`,
      [ids]
    );
    rows.forEach(row => { row.attempts = Number(row.attempts) + 1; });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  if (!rows.length) return;

  const events = rows.map(row => ({
    eventId: row.event_id,
    schoolId: row.school_id,
    deviceId: row.device_id,
    studentId: row.student_id,
    attendanceScope: row.attendance_scope,
    periodId: row.period_id,
    eventType: row.event_type,
    occurredAt: row.occurred_at_device,
    receivedAtServer: row.received_at_server,
    schoolDate: row.school_date,
    late: Boolean(row.late),
    syncStatus: row.sync_status,
    duplicateOf: row.duplicate_of,
    metadata: row.metadata || {},
    recordedByUserId: row.recorded_by_user_id
  }));

  let response;
  let payload;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      response = await fetch(
        setting.rows[0].cloud_base_url.replace(/\\/+$/, '') + '/api/cloud-sync/receive-events',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ schoolId, events }),
          signal: controller.signal
        }
      );
    } finally {
      clearTimeout(timeout);
    }
    const raw = await response.text();
    try { payload = JSON.parse(raw); } catch { payload = { error: raw.slice(0, 500) }; }

    if (!response.ok) {
      const permanent = response.status >= 400 && response.status < 500 &&
        ![408, 409, 425, 429].includes(response.status);
      const message = payload.error || ('Cloud server returned HTTP ' + response.status);
      if (permanent) {
        await updateRows(pool, rows, 'FAILED', message, String(response.status));
      } else {
        const retryable = rows.filter(row => row.attempts < MAX_ATTEMPTS);
        const failed = rows.filter(row => row.attempts >= MAX_ATTEMPTS);
        if (retryable.length) await updateRows(pool, retryable, 'PENDING', message, String(response.status),
          Math.max(...retryable.map(row => retryDelayMs(row.attempts))));
        if (failed.length) await updateRows(pool, failed, 'FAILED', message, String(response.status));
      }
      return;
    }
  } catch (error) {
    const retryable = rows.filter(row => row.attempts < MAX_ATTEMPTS);
    const failed = rows.filter(row => row.attempts >= MAX_ATTEMPTS);
    if (retryable.length) await updateRows(pool, retryable, 'PENDING', error.message, 'NETWORK_ERROR',
      Math.max(...retryable.map(row => retryDelayMs(row.attempts))));
    if (failed.length) await updateRows(pool, failed, 'FAILED', error.message, 'NETWORK_ERROR');
    return;
  }

  const results = Array.isArray(payload.results) ? payload.results : [];
  const byEvent = new Map(results.map(item => [item.eventId, item]));
  const synced = [];
  const rejected = [];
  const retry = [];
  for (const row of rows) {
    const item = byEvent.get(row.event_id);
    if (item && ['ACCEPTED', 'ALREADY_SYNCED'].includes(item.status)) {
      synced.push({ ...row, reason: null, status: item.status });
    } else if (item && item.status === 'REJECTED') {
      rejected.push({ ...row, reason: item.reason || 'Cloud server rejected the event.' });
    } else if (row.attempts >= MAX_ATTEMPTS) {
      rejected.push({ ...row, reason: 'Cloud server returned no final result for this event.' });
    } else {
      retry.push(row);
    }
  }
  if (synced.length) {
    for (const row of synced) {
      await pool.query(
        `UPDATE cloud_sync_outbox
         SET status='SYNCED', synced_at=NOW(), last_error=NULL,
             remote_status=$2, updated_at=NOW()
         WHERE sync_id=$1`,
        [row.sync_id, row.status]
      );
    }
  }
  if (rejected.length) {
    for (const row of rejected) {
      await pool.query(
        `UPDATE cloud_sync_outbox
         SET status='FAILED', last_error=$2, remote_status='REJECTED', updated_at=NOW()
         WHERE sync_id=$1`,
        [row.sync_id, row.reason]
      );
    }
  }
  if (retry.length) {
    await updateRows(pool, retry, 'PENDING', 'Cloud response did not include a final result.', 'INCOMPLETE_RESPONSE',
      Math.max(...retry.map(row => retryDelayMs(row.attempts))));
  }
}

function startCloudSyncWorker(pool) {
  let running = false;
  async function run() {
    if (running) return;
    running = true;
    try {
      await pool.query(
        `UPDATE cloud_sync_outbox q
         SET status='PENDING', last_error=COALESCE(q.last_error, 'Recovered stale in-flight sync after server restart'),
             next_attempt_at=NOW(), updated_at=NOW()
         FROM school_cloud_sync_settings s
         WHERE q.school_id=s.school_id AND s.enabled=TRUE AND q.status='SENDING'
           AND q.last_attempt_at < NOW() - INTERVAL '2 minutes'`
      );
      const schools = await pool.query(
        `SELECT school_id FROM school_cloud_sync_settings
         WHERE enabled=TRUE AND cloud_base_url IS NOT NULL
         ORDER BY school_id`
      );
      for (const row of schools.rows) {
        try { await syncSchool(pool, row.school_id); }
        catch (error) {
          console.error('Cloud sync worker failed for school ' + row.school_id + ': ' + error.message);
        }
      }
    } catch (error) {
      console.error('Cloud sync worker could not inspect the queue: ' + error.message);
    } finally {
      running = false;
    }
  }
  const timer = setInterval(run, POLL_MS);
  timer.unref();
  run();
  return { stop: () => clearInterval(timer), run };
}

module.exports = { startCloudSyncWorker, syncSchool, retryDelayMs };
