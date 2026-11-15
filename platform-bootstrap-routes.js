'use strict';

/**
 * One-time, token-protected bootstrap for the first platform owner.
 *
 * The token is configured as PLATFORM_BOOTSTRAP_CODE in the Render service
 * environment, never stored in the database or public repository.
 * The endpoint closes permanently as soon as any platform account exists.
 */
const crypto = require('node:crypto');
const { hashPassword } = require('./auth-security');
const { createIpRateLimiter } = require('./request-limiter');

function bootstrapEnabled() {
  const token = process.env.PLATFORM_BOOTSTRAP_CODE;
  const expires = process.env.PLATFORM_BOOTSTRAP_EXPIRES_AT;
  return typeof token === 'string' && token.length >= 24 &&
    typeof expires === 'string' &&
    Number.isFinite(Date.parse(expires)) && Date.now() < Date.parse(expires);
}

function constantTimeTokenCheck(input) {
  if (typeof input !== 'string' || input.length > 512) return false;
  const expected = process.env.PLATFORM_BOOTSTRAP_CODE || '';
  if (!bootstrapEnabled()) return false;
  const hash = value => crypto.createHash('sha256').update(value,'utf8').digest();
  return crypto.timingSafeEqual(hash(input),hash(expected));
}

function registerPlatformBootstrapRoutes(app, pool) {
  const rateLimit = createIpRateLimiter({
    windowMs:15 * 60 * 1000, maxRequests:6,
    message:'Too many setup attempts from this connection. Try again later.'
  });

  app.get('/api/platform/bootstrap/status', async (_req,res) => {
    try {
      const result = await pool.query('SELECT EXISTS (SELECT 1 FROM platform_users) AS "hasOwner"');
      res.json({available:bootstrapEnabled() && !result.rows[0].hasOwner});
    } catch (error) {
      console.error('Platform setup status failed:', error.message);
      res.status(503).json({available:false});
    }
  });

  app.post('/api/platform/bootstrap/first-admin',rateLimit,async (req,res) => {
    if (!bootstrapEnabled()) return res.status(404).json({error:'First-time platform setup is not available.'});
    const { setupCode, username, displayName, password, confirmPassword } = req.body || {};
    if (!constantTimeTokenCheck(setupCode)) {
      return res.status(403).json({error:'The private setup code is invalid or expired.'});
    }
    // Never accept secrets in URL query strings; the form sends a POST JSON body.
    const name=typeof username==='string' ? username.trim() : '';
    const display=typeof displayName==='string' ? displayName.trim() : '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,78}$/.test(name)) {
      return res.status(400).json({error:'Choose a username with 3–79 letters, numbers, dots, hyphens or underscores.'});
    }
    if (!display || display.length>159) {
      return res.status(400).json({error:'Enter a display name up to 159 characters.'});
    }
    if (typeof password!=='string' || password.length<14 || password.length>256 || password!==confirmPassword) {
      return res.status(400).json({error:'Use a matching password of 14–256 characters.'});
    }
    if (password.toLowerCase()===name.toLowerCase() || /^(password|123456|admin123)/i.test(password)) {
      return res.status(400).json({error:'Choose a stronger password unrelated to your username.'});
    }

    let client;
    try {
      client=await pool.connect();
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(120261115)');
      const existing=await client.query('SELECT EXISTS (SELECT 1 FROM platform_users) AS "exists"');
      if (existing.rows[0].exists) {
        await client.query('ROLLBACK');
        return res.status(409).json({error:'The first Super Admin account has already been created. Sign in instead.'});
      }
      // Hash only after the locked table check; no plaintext password stored.
      const digest=await hashPassword(password);
      if (!bootstrapEnabled()) {
        await client.query('ROLLBACK');
        return res.status(410).json({error:'The private setup window has expired.'});
      }
      await client.query(
        'INSERT INTO platform_users (username,display_name,password_hash) VALUES ($1,$2,$3)',
        [name,display,digest]
      );
      await client.query('COMMIT');
      return res.status(201).json({created:true,username:name});
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(()=>{});
      console.error('First platform owner setup failed:',error.code||error.message);
      return res.status(500).json({error:'Unable to create Super Admin account. No account was created.'});
    } finally { if (client) client.release(); }
  });
}

module.exports={registerPlatformBootstrapRoutes};
