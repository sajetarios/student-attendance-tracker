'use strict';

const { hashToken } = require('./auth-security');
const { hasPermission } = require('./role-permissions');

function bearerToken(req) {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  return match ? match[1].trim() : '';
}

function createAuthMiddleware(pool) {
  async function authenticateSchoolClient(req, res, next) {
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ error: 'Authentication required.' });
    const tokenHash = hashToken(token);
    try {
      const session = await pool.query(
        `SELECT us.session_id, us.principal_type, us.school_id,
                su.user_id, su.role, su.username, su.display_name, su.teacher_designations,
                s.school_code, s.school_name
         FROM user_sessions us
         JOIN school_users su
           ON su.user_id = us.school_user_id
          AND su.school_id = us.school_id
          AND su.active = TRUE
         JOIN schools s ON s.school_id = us.school_id AND s.active = TRUE
         WHERE us.token_hash = $1
           AND us.principal_type = 'SCHOOL'
           AND us.revoked_at IS NULL
           AND us.expires_at > NOW()
         LIMIT 1`,
        [tokenHash]
      );
      if (session.rowCount) {
        const row = session.rows[0];
        await pool.query('UPDATE user_sessions SET last_seen_at=NOW() WHERE session_id=$1', [row.session_id]);
        req.auth = {
          type: 'SCHOOL_USER',
          principalType: 'SCHOOL',
          schoolId: row.school_id,
          userId: row.user_id,
          role: row.role,
          teacherDesignations: Array.isArray(row.teacher_designations) ? row.teacher_designations : [],
          username: row.username,
          displayName: row.display_name,
          schoolCode: row.school_code,
          schoolName: row.school_name
        };
        return next();
      }

      const studentSession = await pool.query(
        `SELECT ss.session_id, ss.school_id, sa.student_account_id, sa.student_id,
                sa.username, sa.must_change_password, st.full_name, st.grade_level, st.section,
                s.school_code, s.school_name
         FROM student_sessions ss
         JOIN student_accounts sa ON sa.school_id=ss.school_id AND sa.student_account_id=ss.student_account_id AND sa.active=TRUE
         JOIN students st ON st.school_id=sa.school_id AND st.student_id=sa.student_id AND st.active=TRUE
         JOIN schools s ON s.school_id=ss.school_id AND s.active=TRUE
         WHERE ss.token_hash=$1 AND ss.revoked_at IS NULL AND ss.expires_at>NOW()
         LIMIT 1`, [tokenHash]
      );
      if (studentSession.rowCount) {
        const row = studentSession.rows[0];
        await pool.query('UPDATE student_sessions SET last_seen_at=NOW() WHERE session_id=$1', [row.session_id]);
        req.auth = {
          type: 'STUDENT', principalType: 'STUDENT', schoolId: row.school_id,
          studentAccountId: row.student_account_id, studentId: row.student_id,
          role: 'STUDENT', username: row.username, displayName: row.full_name,
          mustChangePassword: Boolean(row.must_change_password), gradeLevel: row.grade_level, section: row.section,
          schoolCode: row.school_code, schoolName: row.school_name
        };
        return next();
      }

      const device = await pool.query(
        `SELECT c.credential_id, c.school_id, c.device_id, c.device_name,
                s.school_code, s.school_name
         FROM device_api_credentials c
         JOIN schools s ON s.school_id=c.school_id AND s.active=TRUE
         JOIN attendance_devices d
           ON d.school_id=c.school_id AND d.device_id=c.device_id AND d.active=TRUE
         WHERE c.token_hash=$1 AND c.active=TRUE AND c.revoked_at IS NULL
         LIMIT 1`,
        [tokenHash]
      );
      if (!device.rowCount) return res.status(401).json({ error: 'Invalid or expired credentials.' });
      const row = device.rows[0];
      await pool.query(
        'UPDATE device_api_credentials SET last_used_at=NOW() WHERE credential_id=$1',
        [row.credential_id]
      );
      await pool.query(
        'UPDATE attendance_devices SET last_seen_at=NOW() WHERE school_id=$1 AND device_id=$2',
        [row.school_id, row.device_id]
      );
      req.auth = {
        type: 'DEVICE',
        principalType: 'DEVICE',
        schoolId: row.school_id,
        deviceId: row.device_id,
        deviceName: row.device_name,
        schoolCode: row.school_code,
        schoolName: row.school_name
      };
      return next();
    } catch (err) {
      console.error('Authentication middleware failed:', err.message);
      return res.status(500).json({ error: 'Authentication service unavailable.' });
    }
  }

  async function authenticateCloudSync(req, res, next) {
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ error: 'Cloud sync credential required.' });
    try {
      const result = await pool.query(
        'SELECT c.credential_id, c.school_id, s.school_code, s.school_name ' +
        'FROM cloud_sync_credentials c ' +
        'JOIN schools s ON s.school_id=c.school_id AND s.active=TRUE ' +
        'WHERE c.token_hash=$1 AND c.active=TRUE AND c.revoked_at IS NULL ' +
        'LIMIT 1',
        [hashToken(token)]
      );
      if (!result.rowCount) {
        return res.status(401).json({ error: 'Invalid or revoked cloud sync credential.' });
      }
      const row = result.rows[0];
      await pool.query(
        'UPDATE cloud_sync_credentials SET last_used_at=NOW() WHERE credential_id=$1',
        [row.credential_id]
      );
      req.auth = {
        type: 'CLOUD_SYNC',
        principalType: 'CLOUD_SYNC',
        schoolId: row.school_id,
        credentialId: row.credential_id,
        schoolCode: row.school_code,
        schoolName: row.school_name
      };
      return next();
    } catch (err) {
      console.error('Cloud sync authentication failed:', err.message);
      return res.status(500).json({ error: 'Cloud sync authentication service unavailable.' });
    }
  }

  function requireSchoolRoles(...roles) {
    return (req, res, next) => {
      if (!req.auth || req.auth.type !== 'SCHOOL_USER') {
        return res.status(401).json({ error: 'A school user session is required.' });
      }
      if (!roles.includes(req.auth.role)) {
        return res.status(403).json({ error: 'You do not have permission to perform this action.' });
      }
      return next();
    };
  }

  function requireSchoolPermission(permission) {
    return (req, res, next) => {
      if (req.auth?.type === 'DEVICE' && permission === 'students.view.all') return next();
      if (!req.auth || req.auth.type !== 'SCHOOL_USER') {
        return res.status(401).json({ error: 'A school user session is required.' });
      }
      const scopedRosterPermission = permission === 'students.view.all' && hasPermission(req.auth.role, 'students.view.assigned');
      if (!hasPermission(req.auth.role, permission) && !scopedRosterPermission) {
        return res.status(403).json({ error: 'You do not have permission to perform this action.' });
      }
      return next();
    };
  }

  function requireTeacherDesignations(...designations) {
    return (req, res, next) => {
      if (!req.auth || req.auth.type !== 'SCHOOL_USER' || req.auth.role !== 'TEACHER') {
        return res.status(403).json({ error: 'A teacher account is required for this action.' });
      }
      const granted = Array.isArray(req.auth.teacherDesignations) ? req.auth.teacherDesignations : [];
      if (!designations.every(item => granted.includes(item))) {
        return res.status(403).json({ error: 'Your teacher account does not have the required designation.' });
      }
      return next();
    };
  }

  function requireSchoolClient(req, res, next) {
    if (!req.auth || !['SCHOOL_USER', 'DEVICE'].includes(req.auth.type)) {
      return res.status(401).json({ error: 'School authentication is required.' });
    }
    return next();
  }

  return { authenticateSchoolClient, authenticateCloudSync, requireSchoolRoles, requireSchoolPermission, requireTeacherDesignations, requireSchoolClient };
}

module.exports = { createAuthMiddleware, bearerToken };
