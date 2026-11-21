'use strict';

// Behind a reverse proxy (Render) the real client address is in X-Forwarded-For. Without trusting the proxy,
// every visitor shares one IP, so per-IP limits would lock out the whole school at once.
function configureProxy(app) {
  const hops = process.env.TRUST_PROXY;
  if (hops === '0' || hops === 'false') return;
  if (hops && /^\d+$/.test(hops)) app.set('trust proxy', Number(hops));
  else if (process.env.RENDER || process.env.NODE_ENV === 'production' || hops) app.set('trust proxy', 1);
}

// Send plain-HTTP visitors to HTTPS in production. /health stays reachable for platform health checks.
function httpsRedirect(req, res, next) {
  const enforce = process.env.FORCE_HTTPS === 'true' || (process.env.FORCE_HTTPS !== 'false' && process.env.NODE_ENV === 'production');
  if (!enforce || req.secure || req.path === '/health') return next();
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(403).json({ error: 'HTTPS is required.' });
  return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
}

function createRateLimiter({ windowMs, max, message, keyFn }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, Math.max(30000, windowMs));
  timer.unref();
  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : (req.ip || req.socket?.remoteAddress || 'unknown');
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) { entry = { count: 0, resetAt: now + windowMs }; hits.set(key, entry); }
    entry.count += 1;
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    if (entry.count > max) {
      const retry = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({ error: message || 'Too many requests. Please wait a moment and try again.', retryAfterSeconds: retry });
    }
    return next();
  };
}

module.exports = { configureProxy, httpsRedirect, createRateLimiter };
