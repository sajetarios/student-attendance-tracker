'use strict';

const { hashPassword } = require('./auth-security');

function registerPlatformRoutes(app, pool, { authenticatePlatform, requirePlatformAdmin }) {
  const guard = [authenticatePlatform, requirePlatformAdmin];
  require('./platform-school-deletion-routes').registerPlatformSchoolDeletionRoutes(app, pool, { authenticatePlatform, requirePlatformAdmin });

  app.get('/api/platform/overview', ...guard, async (_req, res) => {
    try {
      const result = await pool.query(`
        SELECT (SELECT COUNT(*)::int FROM schools) AS "schoolCount",
               (SELECT COUNT(*)::int FROM schools WHERE active=TRUE) AS "activeSchoolCount",
               (SELECT COUNT(*)::int FROM school_users WHERE active=TRUE) AS "activeAccountCount",
               (SELECT COUNT(*)::int FROM students WHERE active=TRUE) AS "activeLearnerCount",
               (SELECT COUNT(*)::int FROM school_cloud_sync_outbox WHERE status IN ('PENDING','RETRY','PROCESSING')) AS "queuedSyncCount"`);
      return res.json({ overview: result.rows[0] });
    } catch (err) {
      console.error('Platform overview failed:', err.message);
      return res.status(500).json({ error: 'Could not load platform overview.' });
    }
  });

  app.get('/api/platform/schools', ...guard, async (_req, res) => {
    try {
      const result = await pool.query(`
        SELECT s.school_id AS "schoolId",s.school_code AS "schoolCode",s.school_name AS "schoolName",
               s.active,s.created_at AS "createdAt",s.updated_at AS "updatedAt",
               (SELECT COUNT(*)::int FROM school_users u WHERE u.school_id=s.school_id AND u.active=TRUE) AS "activeAccounts",
               (SELECT COUNT(*)::int FROM students st WHERE st.school_id=s.school_id AND st.active=TRUE) AS "activeLearners",
               c.enabled AS "cloudSyncEnabled",c.last_success_at AS "lastCloudSyncAt",c.last_error AS "cloudSyncError"
        FROM schools s LEFT JOIN school_cloud_sync_settings c ON c.school_id=s.school_id
        ORDER BY s.active DESC,s.school_name`);
      return res.json({ schools: result.rows });
    } catch (err) {
      console.error('Platform school list failed:', err.message);
      return res.status(500).json({ error: 'Could not load schools.' });
    }
  });

  app.post('/api/platform/schools', ...guard, async (req, res) => {
    const { schoolCode, schoolName, adminUsername, adminDisplayName, adminPassword } = req.body || {};
    if (typeof schoolCode !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$/.test(schoolCode.trim()) ||
        typeof schoolName !== 'string' || schoolName.trim().length < 2 || schoolName.trim().length > 200 ||
        typeof adminUsername !== 'string' || !adminUsername.trim() || adminUsername.trim().length > 80 ||
        typeof adminDisplayName !== 'string' || !adminDisplayName.trim() || adminDisplayName.trim().length > 160 ||
        typeof adminPassword !== 'string' || adminPassword.length < 12 || adminPassword.length > 256) {
      return res.status(400).json({ error: 'Enter a valid school code, name, and first administrator account with a password of at least 12 characters.' });
    }
    let passwordHash;
    try { passwordHash = await hashPassword(adminPassword); }
    catch (err) { return res.status(400).json({ error: err.message || 'Administrator password is not valid.' }); }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const school = await client.query(
        `INSERT INTO schools(school_code,school_name) VALUES($1,$2)
         RETURNING school_id AS "schoolId",school_code AS "schoolCode",school_name AS "schoolName",active`,
        [schoolCode.trim(), schoolName.trim()]
      );
      // Department ownership is mandatory after migration 013.
      // Provision the school's default department before creating its first admin,
      // in the SAME transaction so failures never leave an orphan school.
      const department = await client.query(
        `INSERT INTO school_departments
           (school_id,department_code,department_name,description)
         VALUES($1,'UNASSIGNED','Unassigned',
           'Default department for initial School Admin and pending staff assignments.')
         RETURNING department_id AS "departmentId"`,
        [school.rows[0].schoolId]
      );
      const admin = await client.query(
        `INSERT INTO school_users(school_id,username,display_name,password_hash,role,department_id)
         VALUES($1,$2,$3,$4,'SCHOOL_ADMIN',$5)
         RETURNING user_id AS "userId",username,display_name AS "displayName",role`,
        [school.rows[0].schoolId,adminUsername.trim(),adminDisplayName.trim(),passwordHash,department.rows[0].departmentId]
      );
      await client.query(
        `INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
         VALUES($1,'PLATFORM',$2,'PLATFORM_CREATE_SCHOOL','school',$1::uuid::text,$3::jsonb)`,
        [school.rows[0].schoolId, req.auth.userId, JSON.stringify({ schoolCode: schoolCode.trim(), initialAdmin: adminUsername.trim() })]
      );
      await client.query('COMMIT');
      return res.status(201).json({ school: school.rows[0], administrator: admin.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err.code === '23505') return res.status(409).json({ error: 'The school code or administrator username is already in use.' });
      if (err.code === '23503' || err.code === '23502') return res.status(500).json({ error: 'School setup failed while creating its required department or administrator account. No school was created.' });
      console.error('Platform school creation failed:', err.message);
      return res.status(500).json({ error: 'Could not create school and administrator.' });
    } finally { client.release(); }
  });

  app.patch('/api/platform/schools/:schoolId/status', ...guard, async (req, res) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.schoolId) || typeof req.body?.active !== 'boolean') {
      return res.status(400).json({ error: 'Provide a valid school and active status.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE schools SET active=$2,updated_at=NOW() WHERE school_id=$1
         RETURNING school_id AS "schoolId",school_code AS "schoolCode",school_name AS "schoolName",active`,
        [req.params.schoolId, req.body.active]
      );
      if (!result.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'School not found.' }); }
      if (!req.body.active) {
        await client.query(`UPDATE user_sessions SET revoked_at=NOW() WHERE school_id=$1 AND revoked_at IS NULL`, [req.params.schoolId]);
        await client.query(`UPDATE student_sessions SET revoked_at=NOW() WHERE school_id=$1 AND revoked_at IS NULL`, [req.params.schoolId]);
        await client.query(`UPDATE device_api_credentials SET active=FALSE,revoked_at=COALESCE(revoked_at,NOW()) WHERE school_id=$1`, [req.params.schoolId]);
      }
      await client.query(
        `INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
         VALUES($1,'PLATFORM',$2,'PLATFORM_UPDATE_SCHOOL_STATUS','school',$1::uuid::text,$3::jsonb)`,
        [req.params.schoolId,req.auth.userId,JSON.stringify({ active:req.body.active })]
      );
      await client.query('COMMIT');
      return res.json({ school: result.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Platform school status update failed:', err.message);
      return res.status(500).json({ error: 'Could not update school status.' });
    } finally { client.release(); }
  });
}

module.exports = { registerPlatformRoutes };
