const { hashPassword, verifyPassword, createOpaqueToken, hashToken } = require('./auth-security');

function validString(value, max = 160) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
}

function bearerToken(req) {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  return match ? match[1].trim() : '';
}

function registerAuthRoutes(app, pool) {
  const sessionHours = Math.min(24, Math.max(1, Number(process.env.AUTH_SESSION_HOURS || 12)));

  async function issueSession({ principalType, schoolId = null, schoolUserId = null, platformUserId = null }) {
    const token = createOpaqueToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + sessionHours * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO user_sessions
       (token_hash, principal_type, school_id, school_user_id, platform_user_id, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tokenHash, principalType, schoolId, schoolUserId, platformUserId, expiresAt]
    );
    return { accessToken: token, tokenType: 'Bearer', expiresAt: expiresAt.toISOString() };
  }

  async function recordFailedLogin(table, userId) {
    await pool.query(
      `UPDATE ${table}
       SET failed_login_attempts = LEAST(failed_login_attempts + 1, 5),
           locked_until = CASE
             WHEN failed_login_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes'
             ELSE locked_until
           END
       WHERE user_id = $1`,
      [userId]
    );
  }

  app.post('/api/auth/school/login', async (req, res) => {
    const { schoolCode, username, password } = req.body || {};
    if (![schoolCode, username, password].every(v => validString(v, 256))) {
      return res.status(400).json({ error: 'School code, username, and password are required.' });
    }
    try {
      const schoolResult = await pool.query(
        `SELECT school_id, school_code, school_name
         FROM schools WHERE lower(school_code)=lower($1) AND active=TRUE`,
        [schoolCode.trim()]
      );
      if (!schoolResult.rowCount) return res.status(401).json({ error: 'Invalid login credentials.' });
      const school = schoolResult.rows[0];
      const userResult = await pool.query(
        `SELECT su.user_id, su.username, su.display_name, su.password_hash, su.role, su.teacher_designations, su.department_id, d.department_code, su.active,
                failed_login_attempts, locked_until
         FROM school_users su
         LEFT JOIN school_departments d ON d.school_id=su.school_id AND d.department_id=su.department_id
         WHERE su.school_id=$1 AND lower(su.username)=lower($2)
         LIMIT 1`,
        [school.school_id, username.trim()]
      );
      if (!userResult.rowCount) return res.status(401).json({ error: 'Invalid login credentials.' });
      const user = userResult.rows[0];
      if (!user.active) return res.status(401).json({ error: 'Invalid login credentials.' });
      if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
        return res.status(423).json({ error: 'Account temporarily locked. Try again later.' });
      }
      const correct = await verifyPassword(password, user.password_hash);
      if (!correct) {
        await recordFailedLogin('school_users', user.user_id);
        return res.status(401).json({ error: 'Invalid login credentials.' });
      }
      await pool.query(
        `UPDATE school_users
         SET failed_login_attempts=0, locked_until=NULL, last_login_at=NOW()
         WHERE user_id=$1`,
        [user.user_id]
      );
      const session = await issueSession({
        principalType: 'SCHOOL', schoolId: school.school_id, schoolUserId: user.user_id
      });
      return res.json({
        ...session,
        user: {
          userId: user.user_id,
          username: user.username,
          displayName: user.display_name,
          role: user.role,
          teacherDesignations: Array.isArray(user.teacher_designations) ? user.teacher_designations : [],
          departmentId: user.department_id || null,
          departmentCode: user.department_code || null,
          schoolId: school.school_id,
          schoolCode: school.school_code,
          schoolName: school.school_name
        }
      });
    } catch (err) {
      console.error('School login failed:', err.message);
      return res.status(500).json({ error: 'Login service unavailable.' });
    }
  });

  // Student accounts are separate principals and never receive staff or parent permissions.
  app.post('/api/auth/student/login', async (req, res) => {
    const { schoolCode, username, password } = req.body || {};
    if (![schoolCode, username, password].every(v => validString(v, 256))) {
      return res.status(400).json({ error: 'School code, student ID/username, and password are required.' });
    }
    try {
      const schoolResult = await pool.query(
        `SELECT school_id, school_code, school_name
         FROM schools WHERE lower(school_code)=lower($1) AND active=TRUE`,
        [schoolCode.trim()]
      );
      if (!schoolResult.rowCount) return res.status(401).json({ error: 'Invalid login credentials.' });
      const school = schoolResult.rows[0];
      const accountResult = await pool.query(
        `SELECT sa.student_account_id, sa.student_id, sa.username, sa.password_hash,
                sa.active, sa.must_change_password, sa.failed_login_attempts, sa.locked_until,
                s.full_name, s.grade_level, s.section
         FROM student_accounts sa
         JOIN students s ON s.school_id=sa.school_id AND s.student_id=sa.student_id AND s.active=TRUE
         WHERE sa.school_id=$1 AND lower(sa.username)=lower($2)
         LIMIT 1`,
        [school.school_id, username.trim()]
      );
      if (!accountResult.rowCount) return res.status(401).json({ error: 'Invalid login credentials.' });
      const account = accountResult.rows[0];
      if (!account.active) return res.status(401).json({ error: 'Invalid login credentials.' });
      if (account.locked_until && new Date(account.locked_until).getTime() > Date.now()) {
        return res.status(423).json({ error: 'Account temporarily locked. Try again later.' });
      }
      const correct = await verifyPassword(password, account.password_hash);
      if (!correct) {
        await recordFailedLogin('student_accounts', account.student_account_id);
        return res.status(401).json({ error: 'Invalid login credentials.' });
      }
      await pool.query(
        `UPDATE student_accounts
         SET failed_login_attempts=0, locked_until=NULL, last_login_at=NOW(), updated_at=NOW()
         WHERE student_account_id=$1`,
        [account.student_account_id]
      );
      const token = createOpaqueToken();
      const expiresAt = new Date(Date.now() + sessionHours * 60 * 60 * 1000);
      await pool.query(
        `INSERT INTO student_sessions(token_hash, school_id, student_account_id, expires_at)
         VALUES($1,$2,$3,$4)`,
        [hashToken(token), school.school_id, account.student_account_id, expiresAt]
      );
      return res.json({
        accessToken: token, tokenType: 'Bearer', expiresAt: expiresAt.toISOString(),
        user: {
          userId: account.student_account_id,
          studentAccountId: account.student_account_id,
          studentId: account.student_id,
          username: account.username,
          displayName: account.full_name,
          role: 'STUDENT',
          gradeLevel: account.grade_level,
          section: account.section,
          mustChangePassword: Boolean(account.must_change_password),
          schoolId: school.school_id, schoolCode: school.school_code, schoolName: school.school_name
        }
      });
    } catch (err) {
      console.error('Student login failed:', err.message);
      return res.status(500).json({ error: 'Student login service unavailable.' });
    }
  });

  app.post('/api/auth/platform/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (![username, password].every(v => validString(v, 256))) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }
    try {
      const result = await pool.query(
        `SELECT user_id, username, display_name, password_hash, active, locked_until
         FROM platform_users WHERE lower(username)=lower($1) LIMIT 1`,
        [username.trim()]
      );
      if (!result.rowCount) return res.status(401).json({ error: 'Invalid login credentials.' });
      const user = result.rows[0];
      if (!user.active) return res.status(401).json({ error: 'Invalid login credentials.' });
      if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
        return res.status(423).json({ error: 'Account temporarily locked. Try again later.' });
      }
      const correct = await verifyPassword(password, user.password_hash);
      if (!correct) {
        await recordFailedLogin('platform_users', user.user_id);
        return res.status(401).json({ error: 'Invalid login credentials.' });
      }
      await pool.query(
        `UPDATE platform_users
         SET failed_login_attempts=0, locked_until=NULL, last_login_at=NOW()
         WHERE user_id=$1`,
        [user.user_id]
      );
      const session = await issueSession({ principalType: 'PLATFORM', platformUserId: user.user_id });
      return res.json({
        ...session,
        user: {
          userId: user.user_id,
          username: user.username,
          displayName: user.display_name,
          role: 'SUPER_ADMIN'
        }
      });
    } catch (err) {
      console.error('Platform login failed:', err.message);
      return res.status(500).json({ error: 'Login service unavailable.' });
    }
  });

  app.get('/api/auth/me', async (req, res) => {
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ error: 'Authentication required.' });
    try {
      const tokenHash = hashToken(token);
      const result = await pool.query(
        `SELECT us.session_id, us.principal_type, us.school_id,
                pu.user_id AS platform_user_id, pu.username AS platform_username,
                pu.display_name AS platform_display_name,
                su.user_id AS school_user_id, su.username AS school_username,
                su.display_name AS school_display_name, su.role AS school_role,
                su.teacher_designations AS school_teacher_designations,
                su.department_id AS school_department_id,
                sd.department_name AS school_department_name,
                sd.department_code AS school_department_code,
                s.school_code, s.school_name
         FROM user_sessions us
         LEFT JOIN platform_users pu ON pu.user_id=us.platform_user_id AND pu.active=TRUE
         LEFT JOIN school_users su ON su.user_id=us.school_user_id AND su.active=TRUE
         LEFT JOIN school_departments sd ON sd.school_id=su.school_id AND sd.department_id=su.department_id
         LEFT JOIN schools s ON s.school_id=us.school_id AND s.active=TRUE
         WHERE us.token_hash=$1 AND us.revoked_at IS NULL AND us.expires_at>NOW()
           AND ((us.principal_type='PLATFORM' AND pu.user_id IS NOT NULL)
             OR (us.principal_type='SCHOOL' AND su.user_id IS NOT NULL AND s.school_id IS NOT NULL))`,
        [tokenHash]
      );
      if (!result.rowCount) {
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
        if (!studentSession.rowCount) return res.status(401).json({ error: 'Session is invalid or expired.' });
        const student = studentSession.rows[0];
        await pool.query('UPDATE student_sessions SET last_seen_at=NOW() WHERE session_id=$1', [student.session_id]);
        return res.json({ user: {
          userId: student.student_account_id, studentAccountId: student.student_account_id,
          studentId: student.student_id, username: student.username, displayName: student.full_name,
          role: 'STUDENT', gradeLevel: student.grade_level, section: student.section,
          mustChangePassword: Boolean(student.must_change_password), schoolId: student.school_id,
          schoolCode: student.school_code, schoolName: student.school_name
        }});
      }
      const row = result.rows[0];
      await pool.query('UPDATE user_sessions SET last_seen_at=NOW() WHERE session_id=$1', [row.session_id]);
      if (row.principal_type === 'PLATFORM') {
        return res.json({ user: {
          userId: row.platform_user_id,
          username: row.platform_username,
          displayName: row.platform_display_name,
          role: 'SUPER_ADMIN'
        }});
      }
      return res.json({ user: {
        userId: row.school_user_id,
        username: row.school_username,
        displayName: row.school_display_name,
        role: row.school_role,
        teacherDesignations: Array.isArray(row.school_teacher_designations) ? row.school_teacher_designations : [],
        departmentId: row.school_department_id || null,
        departmentName: row.school_department_name || null,
        departmentCode: row.school_department_code || null,
        schoolId: row.school_id,
        schoolCode: row.school_code,
        schoolName: row.school_name
      }});
    } catch (err) {
      console.error('Session lookup failed:', err.message);
      return res.status(500).json({ error: 'Session service unavailable.' });
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    const token = bearerToken(req);
    if (!token) return res.status(204).end();
    try {
      await pool.query(
        'UPDATE user_sessions SET revoked_at=NOW() WHERE token_hash=$1 AND revoked_at IS NULL',
        [hashToken(token)]
      );
      await pool.query(
        'UPDATE student_sessions SET revoked_at=NOW() WHERE token_hash=$1 AND revoked_at IS NULL',
        [hashToken(token)]
      );
      return res.status(204).end();
    } catch (err) {
      console.error('Logout failed:', err.message);
      return res.status(500).json({ error: 'Logout service unavailable.' });
    }
  });
}

module.exports = { registerAuthRoutes };
