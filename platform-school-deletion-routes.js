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


// Retain recovery snapshots for 30 days. A PostgreSQL transaction makes snapshot
// and row removal atomic; ON DELETE CASCADE removes the snapshot's child rows.
const BACKUP_RETENTION_DAYS = 30;
async function purgeExpiredSchoolDeletionBackups(pool) {
  const result = await pool.query(
    "DELETE FROM platform_school_deletion_backups WHERE created_at <= NOW() - INTERVAL '30 days' RETURNING backup_id,school_code,row_count"
  );
  if (result.rowCount) console.info('Expired school recovery snapshots permanently erased:', result.rows.map(row => ({schoolCode:row.school_code,rows:row.row_count})));
  return result.rowCount;
}

function registerPlatformSchoolDeletionRoutes(app, pool, { authenticatePlatform, requirePlatformAdmin }) {
  const guard = [authenticatePlatform, requirePlatformAdmin];

  app.get('/api/platform/deleted-school-backups', ...guard, async (_req, res) => {
    try {
      const result = await pool.query(`SELECT backup_id AS "backupId",school_code AS "schoolCode",
        school_name AS "schoolName",row_count AS "rowCount",created_at AS "deletedAt",
        created_at + INTERVAL '30 days' AS "eraseAt"
        FROM platform_school_deletion_backups ORDER BY created_at DESC LIMIT 100`);
      res.set('Cache-Control','no-store').json({retentionDays:BACKUP_RETENTION_DAYS,backups:result.rows});
    } catch (error) {
      console.error('School backup list:',error.message);
      res.status(500).json({error:'Could not load deleted school backups.'});
    }
  });

  app.delete('/api/platform/deleted-school-backups/:backupId', ...guard, async (req,res) => {
    if (!SCHOOL_ID.test(req.params.backupId)) return res.status(400).json({error:'Invalid backup ID.'});
    const {confirmationPhrase} = req.body || {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        'SELECT backup_id,school_code,school_name,row_count FROM platform_school_deletion_backups WHERE backup_id=$1 FOR UPDATE',
        [req.params.backupId]
      );
      if (!result.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({error:'Recovery backup not found.'}); }
      const backup = result.rows[0];
      if (confirmationPhrase !== 'ERASE ' + backup.school_code) {
        await client.query('ROLLBACK');
        return res.status(400).json({error:'Type the exact confirmation phrase to permanently erase the backup.'});
      }
      await client.query('DELETE FROM platform_school_deletion_backups WHERE backup_id=$1',[backup.backup_id]);
      await client.query(`INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
        VALUES(NULL,'PLATFORM',$1,'PLATFORM_ERASE_SCHOOL_BACKUP','school_backup',$2,$3::jsonb)`,
        [req.auth.userId,String(backup.backup_id),JSON.stringify({schoolCode:backup.school_code,rowsErased:backup.row_count})]
      );
      await client.query('COMMIT');
      return res.json({erased:true,rowsErased:backup.row_count});
    } catch (error) {
      await client.query('ROLLBACK').catch(()=>{});
      console.error('School backup erasure:',error.message);
      return res.status(500).json({error:'Could not permanently erase the recovery backup.'});
    } finally { client.release(); }
  });

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
      // Pilot attendance reset backups lack school_id and reference their run with
      // ON DELETE RESTRICT. Snapshot these archived rows too, before removal.
      const pilotArchive = await client.query(
        'INSERT INTO platform_school_deletion_backup_rows(backup_id,source_table,row_data) ' +
        "SELECT $1,'attendance_pilot_reset_backup_rows',to_jsonb(src) " +
        'FROM attendance_pilot_reset_backup_rows src ' +
        'JOIN attendance_pilot_reset_runs run ON run.reset_id=src.reset_id ' +
        'WHERE run.school_id=$2',
        [backupId, schoolId]
      );
      backedUpRows += pilotArchive.rowCount;
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
      // Delete child rows before their parents; PostgreSQL has RESTRICT/NO ACTION
      // relationships between departments, periods, learners and audit history.
      // Every deletion is scoped to the selected school in the same transaction.
      // A pilot reset's archived rows must be removed before its school-scoped
      // reset run, otherwise PostgreSQL rejects the delete (FK RESTRICT).
      await client.query(
        'DELETE FROM attendance_pilot_reset_backup_rows src ' +
        'USING attendance_pilot_reset_runs run ' +
        'WHERE src.reset_id=run.reset_id AND run.school_id=$1',
        [schoolId]
      );
      await client.query(
        'DELETE FROM sms_outbox WHERE event_id IN (SELECT event_id FROM attendance_events WHERE school_id=$1)',
        [schoolId]
      );
      const foreignKeys = await client.query(
        "SELECT child.relname AS child,parent.relname AS parent FROM pg_constraint c " +
        "JOIN pg_class child ON child.oid=c.conrelid " +
        "JOIN pg_class parent ON parent.oid=c.confrelid " +
        "JOIN pg_namespace child_ns ON child_ns.oid=child.relnamespace " +
        "JOIN pg_namespace parent_ns ON parent_ns.oid=parent.relnamespace " +
        "WHERE c.contype='f' AND child_ns.nspname='public' AND parent_ns.nspname='public'"
      );
      const scopedTables = new Set(tables.rows.map(row => row.table_name).filter(name => name !== 'schools'));
      const waitingOnChildren = new Map([...scopedTables].map(name => [name, 0]));
      const parentsForChild = new Map([...scopedTables].map(name => [name, new Set()]));
      for (const { child, parent } of foreignKeys.rows) {
        if (!scopedTables.has(child) || !scopedTables.has(parent) || child === parent) continue;
        if (parentsForChild.get(child).has(parent)) continue;
        parentsForChild.get(child).add(parent);
        waitingOnChildren.set(parent, waitingOnChildren.get(parent) + 1);
      }
      const ready = [...scopedTables].filter(name => waitingOnChildren.get(name) === 0).sort();
      const deletionOrder = [];
      while (ready.length) {
        const name = ready.shift();
        deletionOrder.push(name);
        for (const parent of parentsForChild.get(name)) {
          const remaining = waitingOnChildren.get(parent) - 1;
          waitingOnChildren.set(parent, remaining);
          if (remaining === 0) ready.push(parent);
        }
      }
      if (deletionOrder.length !== scopedTables.size) {
        throw new Error('School data has circular foreign key dependencies; deletion was cancelled.');
      }
      for (const name of deletionOrder) {
        const identifier = '"' + name.replace(/"/g, '""') + '"';
        await client.query('DELETE FROM public.' + identifier + ' WHERE school_id=$1', [schoolId]);
      }
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

module.exports = { registerPlatformSchoolDeletionRoutes, purgeExpiredSchoolDeletionBackups };
