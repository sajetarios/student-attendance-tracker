'use strict';

/**
 * Small process-local IP limiter for the single-instance school server.
 * Keep the bucket map bounded and prune expired entries so public endpoints
 * cannot grow memory usage indefinitely. Use a shared store if the server is
 * later deployed with multiple workers or instances.
 */
function createIpRateLimiter({ windowMs, maxRequests, message, maxKeys = 10000 }) {
  if (!Number.isFinite(windowMs) || windowMs < 1 || !Number.isInteger(maxRequests) || maxRequests < 1) {
    throw new TypeError('A positive windowMs and maxRequests are required.');
  }

  const buckets = new Map();
  let requestsSinceSweep = 0;

  return function ipRateLimit(req, res, next) {
    const now = Date.now();
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    requestsSinceSweep += 1;

    if (requestsSinceSweep >= 256) {
      requestsSinceSweep = 0;
      for (const [address, entry] of buckets) {
        if (entry.resetAt <= now) buckets.delete(address);
      }
    }

    while (buckets.size > maxKeys) {
      const oldest = buckets.keys().next().value;
      if (oldest === undefined) break;
      buckets.delete(oldest);
    }

    if (bucket.count > maxRequests) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({ error: message || 'Too many requests. Please try again later.' });
    }
    return next();
  };
}

module.exports = { createIpRateLimiter };
