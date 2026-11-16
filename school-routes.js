'use strict';

function detectLogo(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { mime: 'image/png', ext: '.png' };
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: '.webp' };
  return null;
}

function registerSchoolRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles }) {
  const staff = requireSchoolRoles('SCHOOL_ADMIN', 'DEPARTMENT_HEAD', 'TEACHER', 'GATE_KEEPER');
  const admin = requireSchoolRoles('SCHOOL_ADMIN');
  const schoolMember = requireSchoolRoles('SCHOOL_ADMIN', 'DEPARTMENT_HEAD', 'TEACHER', 'GATE_KEEPER', 'STUDENT', 'PARENT');

  app.get('/api/school/branding', authenticateSchoolClient, schoolMember, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT school_name AS "schoolName", school_code AS "schoolCode", brand_color AS "brandColor",
                (logo_data IS NOT NULL) AS "hasLogo"
         FROM schools WHERE school_id=$1 AND active=TRUE`, [req.auth.schoolId]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'School not found.' });
      return res.json({ branding: { ...result.rows[0], logoUrl: result.rows[0].hasLogo ? '/api/school/logo' : null } });
    } catch (err) {
      console.error('School branding load failed:', err.message);
      return res.status(500).json({ error: 'Could not load school branding.' });
    }
  });

  const { requireSchoolFeature } = require('./school-feature-guard');
  const canCustomizeBranding = requireSchoolFeature(pool, 'custom_branding');

  app.put('/api/school/branding', authenticateSchoolClient, admin, canCustomizeBranding, async (req, res) => {
    const { schoolName, brandColor } = req.body || {};
    if (typeof schoolName !== 'string' || schoolName.trim().length < 2 || schoolName.trim().length > 200 ||
        typeof brandColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(brandColor)) {
      return res.status(400).json({ error: 'Enter a school name up to 200 characters and a six-digit hex theme color.' });
    }
    try {
      const result = await pool.query(
        `UPDATE schools SET school_name=$2, brand_color=$3, updated_at=NOW()
         WHERE school_id=$1 AND active=TRUE
         RETURNING school_name AS "schoolName",school_code AS "schoolCode",brand_color AS "brandColor",(logo_data IS NOT NULL) AS "hasLogo"`,
        [req.auth.schoolId, schoolName.trim(), brandColor.toLowerCase()]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'School not found.' });
      await pool.query(
        `INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
         VALUES($1,'SCHOOL',$2,'SCHOOL_UPDATE_BRANDING','school',$1::uuid::text,$3::jsonb)`,
        [req.auth.schoolId, req.auth.userId, JSON.stringify({ schoolName: schoolName.trim(), brandColor: brandColor.toLowerCase() })]
      );
      return res.json({ branding: { ...result.rows[0], logoUrl: result.rows[0].hasLogo ? '/api/school/logo' : null } });
    } catch (err) {
      console.error('School branding update failed:', err.message);
      return res.status(500).json({ error: 'Could not save school branding.' });
    }
  });

  // School logos live in PostgreSQL, not Render's ephemeral local filesystem.
  app.get('/api/school/logo', authenticateSchoolClient, schoolMember, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT logo_data FROM schools WHERE school_id=$1 AND active=TRUE', [req.auth.schoolId]
      );
      const buffer = result.rows[0]?.logo_data;
      const type = detectLogo(buffer);
      if (!type) return res.status(404).end();
      res.setHeader('Content-Type', type.mime);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.send(buffer);
    } catch (err) {
      console.error('School logo retrieval failed:', err.message);
      return res.status(500).json({ error: 'Could not load school logo.' });
    }
  });

  app.put('/api/school/branding/logo', authenticateSchoolClient, admin, canCustomizeBranding,
    require('express').raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '2mb' }), async (req, res) => {
      const buffer = req.body;
      if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 2 * 1024 * 1024)
        return res.status(400).json({ error: 'Choose a PNG, JPG, or WebP logo (maximum 2 MB).' });
      const detected = detectLogo(buffer);
      if (!detected) return res.status(400).json({ error: 'The uploaded file is not a valid supported image.' });
      try {
        const updated = await pool.query(
          'UPDATE schools SET logo_data=$2,logo_path=NULL,updated_at=NOW() WHERE school_id=$1 AND active=TRUE RETURNING school_id',
          [req.auth.schoolId, buffer]
        );
        if (!updated.rowCount) return res.status(404).json({ error: 'School not found.' });
        await pool.query(
          `INSERT INTO audit_logs(school_id,actor_type,actor_user_id,action,entity_type,entity_id,details)
           VALUES($1,'SCHOOL',$2,'SCHOOL_UPDATE_LOGO','school',$1::uuid::text,$3::jsonb)`,
          [req.auth.schoolId, req.auth.userId, JSON.stringify({ mimeType: detected.mime, bytes: buffer.length })]
        );
        return res.json({ ok: true, logoUrl: '/api/school/logo?v=' + Date.now() });
      } catch (err) {
        console.error('School logo upload failed:', err.message);
        return res.status(500).json({ error: 'Could not save school logo.' });
      }
    });

  app.delete('/api/school/branding/logo', authenticateSchoolClient, admin, canCustomizeBranding, async (req, res) => {
    try {
      const result = await pool.query(
        'UPDATE schools SET logo_data=NULL,logo_path=NULL,updated_at=NOW() WHERE school_id=$1 AND active=TRUE RETURNING school_id',
        [req.auth.schoolId]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'School not found.' });
      return res.json({ ok: true });
    } catch (err) {
      console.error('School logo removal failed:', err.message);
      return res.status(500).json({ error: 'Could not remove school logo.' });
    }
  });

}

module.exports = { registerSchoolRoutes };
