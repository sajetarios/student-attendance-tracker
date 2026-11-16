'use strict';

const crypto = require('node:crypto');

const SCHOOL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PREVIEW_LIFETIME_MS = 5 * 60 * 1000;
const pendingPreviews = new Map();

async function schoolImpact(client, schoolId) {
  const school = await client.query(
    'SELECT school_id AS "schoolId",school_code AS "schoolCode",school_name AS "schoolName",active FROM schools WHERE school_id=$1',
    [schoolId]
  );
  if (!school.rowCount) return null;
  const result = await client.query(
    'SELECT (SELECT count(*)::int FROM students WHERE school_id=$1) AS "students", ' +
    '(SELECT count(*)::int FROM school_users WHERE school_id=$1) AS "accounts", ' +
    '(SELECT count(*)::int FROM attendance_events WHERE school_id=$1) AS "attendanceEvents", ' +
    '(SELECT count(*)::int FROM sf2_submissions WHERE school_id=$1) AS "sf2Submissions", ' +
    '(SELECT count(*)::int FROM manual_attendance_marks WHERE school_id=$1) AS "manualMarks", ' +
    '(SELECT count(*)::int FROM manual_attendance_notes WHERE school_id=$1) AS "manualNotes", ' +
    '(SELECT count(*)::int FROM school_cloud_sync_outbox WHERE school_id=$1 AND status IN (\'PENDING\',\'RETRY\',\'PROCESSING\')) AS "pendingSync"',
    [schoolId]
  );
  return { ...school.rows[0], impact: result.rows[0] };
}

function registerPlatformSchoolDeletionRoutes(app, pool, { authenticatePlatform, requirePlatformAdmin }) {
  const guard = [authenticatePlatform, requirePlatformAdmin];

  app.get('/api/platform/schools/:schoolId/deletion-preview', ...guard, async (req, res) => {
    if (!SCHOOL_ID.test(req.params.schoolId)) return res.status(400).json({ error: 'Invalid school ID.' });
    try {
      const school = await schoolImpact(pool, req.params.schoolId);
      if (!school) return res.status(404).json({ error: 'School not found.' });
      // The preview token makes reviewing the first warning a prerequisite for a delete request.
      for (const [token, preview] of pendingPreviews) {
        if (preview.expiresAt < Date.now()) pendingPreviews.delete(token);
      }
      const previewToken = crypto.randomBytes(32).toString('hex');
      pendingPreviews.set(previewToken, {
        schoolId: school.schoolId,
        actorId: req.auth.userId,
        schoolCode: school.schoolCode,
        schoolName: school.schoolName,
        impact: JSON.stringify(school.impact),
        expiresAt: Date.now() + PREVIEW_LIFETIME_MS
      });
      return res.json({ school, previewToken, expiresInSeconds: PREVIEW_LIFETIME_MS / 1000 });
    } catch (error) {
      console.error('School deletion preview failed:', error.message);
      return res.status(500).json({ error: 'Could not review the school for deletion.' });
    }
  });

  app.delete('/api/platform/schools/:schoolId', ...guard, async (req, res) => {
    const schoolId = req.params.schoolId;
    const { previewToken, confirmationPhrase } = req.body || {};
    if (!SCHOOL_ID.test(schoolId) || typeof previewToken !== 'string' ||
        typeof confirmationPhrase !== 'string') {
      return res.status(400).json({ error: 'Complete both school deletion confirmations.' });
    }
    const preview = pendingPreviews.get(previewToken);
    if (!preview || preview.expiresAt <= Date.now() || preview.schoolId !== schoolId ||
        preview.actorId !== req.auth.userId ||
        confirmationPhrase !== 'DELETE ' + preview.schoolCode) {
      return res.status(409).json({ error: 'Deletion confirmation is invalid or expired. Review the school again.' });
    }
    // One-time token: duplicate requests may never delete another school or re-run the operation.
    pendingPreviews.delete(previewToken);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT school_id FROM schools WHERE school_id=$1 FOR UPDATE', [schoolId]);
      if (!locked.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'School not found.' });
      }
      const school = await schoolImpact(client, schoolId);
      if (school.schoolCode !== preview.schoolCode || school.schoolName !== preview.schoolName ||
          JSON.stringify(school.impact) !== preview.impact) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'School data changed after the preview. Review the school again before deleting.' });
      }

      // A database-held, row-by-row recovery snapshot is written and verified BEFORE deletion.
      // An error (including insufficient database storage) rolls back the entire transaction.
      const backup = await client.query(
        'INSERT INTO platform_school_deletion_backups(school_id,school_code,school_name,deleted_by,impact) ' +
        'VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING backup_id AS "backupId"',
        [schoolId, school.schoolCode, school.schoolName, req.auth.userId, JSON.stringify(school.impact)]
      );
      const backupId = backup.rows[0].backupId;
      const tables = await client.query(
        "SELECT c.table_name FROM information_schema.columns c " +
        "JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name " +
        "WHERE c.table_schema='public' AND c.column_name='school_id' AND t.table_type='BASE TABLE' " +
        "AND c.table_name NOT IN ('platform_school_deletion_backups','platform_school_deletion_backup_rows') " +
        "ORDER BY c.table_name"
      );
      let backedUpRows = 0;
      for (const row of tables.rows) {
        const identifier = '"' + row.table_name.replace(/"/g, '""') + '"';
        const result = await client.query(
          'INSERT INTO platform_school_deletion_backup_rows(backup_id,source_table,row_data) ' +
          'SELECT $1,$2,to_jsonb(src) FROM public.' + identifier + ' src WHERE src.school_id=$3',
          [backupId, row.table_name, schoolId]
        );
        backedUpRows += result.rowCount;
      }
      const sms = await client.query(
        'INSERT INTO platform_school_deletion_backup_rows(backup_id,source_table,row_data) ' +
        'SELECT $1,\'sms_outbox\',to_jsonb(src) FROM sms_outbox src ' +
        'WHERE EXISTS (SELECT 1 FROM attendance_events e WHERE e.event_id=src.event_id AND e.school_id=$2)',
        [backupId, schoolId]
      );
      backedUpRows += sms.rowCount;
      const verified = await client.query(
        'SELECT COUNT(*)::int AS count FROM platform_school_deletion_backup_rows WHERE backup_id=$1',
        [backupId]
      );
      if (Number(verified.rows[0].count) !== backedUpRows || backedUpRows < 1) {
        throw new Error('Recovery snapshot verification failed.');
      }
      await client.query(
        'UPDATE platform_school_deletion_backups SET row_count=$2 WHERE backup_id=$1', [backupId, backedUpRows]
      );
      // These two history tables have non-cascading foreign keys to schools.
      await client.query('DELETE FROM audit_logs WHERE school_id=$1', [schoolId]);
      await client.query('DELETE FROM demo_reset_maintenance_runs WHERE school_id=$1', [schoolId]);
      const deleted = await client.query('DELETE FROM schools WHERE school_id=$1', [schoolId]);
      if (deleted.rowCount !== 1) throw new Error('School deletion was not completed.');
      await client.query(
        'INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details) ' +
        'VALUES(NULL,\'PLATFORM\',$1,\'PLATFORM_DELETE_SCHOOL\',\'school\',$2,$3::jsonb)',
        [req.auth.userId, schoolId, JSON.stringify({ schoolCode: school.schoolCode, schoolName: school.schoolName, backupId, backedUpRows })]
      );
      await client.query('COMMIT');
      return res.json({ deleted: true, schoolId, schoolCode: school.schoolCode, backupId, backedUpRows });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Platform school deletion failed:', error.message);
      return res.status(500).json({ error: 'School was not deleted. The recovery snapshot or database checks failed; no partial deletion was committed.' });
    } finally {
      client.release();
    }
  });
}

module.exports = { registerPlatformSchoolDeletionRoutes };
