'use strict';

const { hashPassword, verifyPassword, hashToken } = require('./auth-security');
const { bearerToken } = require('./auth-middleware');

function registerAccountRoutes(app, pool, { authenticateSchoolClient }) {
  const requireSchoolAccount = (req, res, next) => {
    if (req.auth?.type !== 'SCHOOL_USER') return res.status(403).json({ error: 'A school account is required.' });
    return next();
  };

  app.get('/api/account/profile', authenticateSchoolClient, requireSchoolAccount, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT username, display_name AS "displayName", mobile, role
         FROM school_users WHERE school_id=$1 AND user_id=$2 AND active=TRUE`,
        [req.auth.schoolId, req.auth.userId]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'Account not found.' });
      return res.json({ profile: result.rows[0] });
    } catch (err) {
      console.error('Account profile load failed:', err.message);
      return res.status(500).json({ error: 'Could not load your account profile.' });
    }
  });

  app.patch('/api/account/profile', authenticateSchoolClient, requireSchoolAccount, async (req, res) => {
    const { displayName, mobile = '' } = req.body || {};
    if (typeof displayName !== 'string' || !displayName.trim() || displayName.trim().length > 160 ||
        typeof mobile !== 'string' || mobile.trim().length > 40) {
      return res.status(400).json({ error: 'Enter a display name (up to 160 characters) and mobile number (up to 40 characters).' });
    }
    try {
      const result = await pool.query(
        `UPDATE school_users SET display_name=$3, mobile=NULLIF($4,''), updated_at=NOW()
         WHERE school_id=$1 AND user_id=$2 AND active=TRUE
         RETURNING username, display_name AS "displayName", mobile, role`,
        [req.auth.schoolId, req.auth.userId, displayName.trim(), mobile.trim()]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'Account not found.' });
      await pool.query(
        `INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
         VALUES($1,'SCHOOL',$2,'ACCOUNT_UPDATE_OWN_PROFILE','school_user',$2::text,$3::jsonb)`,
        [req.auth.schoolId, req.auth.userId, JSON.stringify({ displayName: displayName.trim(), mobileUpdated: Boolean(mobile.trim()) })]
      );
      return res.json({ profile: result.rows[0] });
    } catch (err) {
      console.error('Account profile update failed:', err.message);
      return res.status(500).json({ error: 'Could not update your account profile.' });
    }
  });

  app.post('/api/account/change-password', authenticateSchoolClient, requireSchoolAccount, async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 256) {
      return res.status(400).json({ error: 'Enter your current password and a new password of at least 12 characters.' });
    }
    const current = await pool.query(
      'SELECT password_hash FROM school_users WHERE school_id=$1 AND user_id=$2 AND active=TRUE',
      [req.auth.schoolId, req.auth.userId]
    );
    if (!current.rowCount || !(await verifyPassword(currentPassword, current.rows[0].password_hash))) {
      return res.status(400).json({ error: 'Your current password is incorrect.' });
    }
    let passwordHash;
    try { passwordHash = await hashPassword(newPassword); }
    catch (err) { return res.status(400).json({ error: err.message || 'New password is not valid.' }); }
    const sessionTokenHash = hashToken(bearerToken(req));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE school_users SET password_hash=$3, must_change_password=FALSE,
           failed_login_attempts=0, locked_until=NULL, session_version=session_version+1, updated_at=NOW()
         WHERE school_id=$1 AND user_id=$2`, [req.auth.schoolId, req.auth.userId, passwordHash]
      );
      const revoked = await client.query(
        `UPDATE user_sessions SET revoked_at=NOW()
         WHERE principal_type='SCHOOL' AND school_id=$1 AND school_user_id=$2
           AND revoked_at IS NULL AND token_hash<>$3`,
        [req.auth.schoolId, req.auth.userId, sessionTokenHash]
      );
      await client.query(
        `INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
         VALUES($1,'SCHOOL',$2,'ACCOUNT_CHANGE_OWN_PASSWORD','school_user',$2::text,$3::jsonb)`,
        [req.auth.schoolId, req.auth.userId, JSON.stringify({ revokedOtherSessions: revoked.rowCount })]
      );
      await client.query('COMMIT');
      return res.json({ ok: true, message: 'Password changed. Other active sessions were signed out.' });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Account password change failed:', err.message);
      return res.status(500).json({ error: 'Could not change your password.' });
    } finally { client.release(); }
  });
}

module.exports = { registerAccountRoutes };
