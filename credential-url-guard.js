'use strict';

// Reject legacy GET submissions that put credentials in the request URL.
// Redirect to a query-free page; never echo or log the sensitive values.
const CREDENTIAL_KEYS = new Set([
  'password', 'passwd', 'pwd', 'pass',
  'currentpassword', 'newpassword', 'confirmpassword',
  'recoverycode', 'setupcode', 'accesstoken'
]);
const ACCOUNT_PAGES = new Set([
  '/', '/index.html', '/portal-login.html', '/force-password-change.html',
  '/parent-register.html', '/platform-setup.html',
  '/portal.html', '/student-portal.html', '/parent-portal.html'
]);

function containsCredentialsInQuery(url) {
  if (typeof url !== 'string' || !url.includes('?')) return false;
  try {
    const query = url.slice(url.indexOf('?') + 1).split('#')[0];
    for (const key of new URLSearchParams(query).keys()) {
      if (CREDENTIAL_KEYS.has(key.toLowerCase())) return true;
    }
  } catch (_) {
    return false;
  }
  return false;
}

function redirectLeakedCredentials(req, res, next) {
  if (req.method !== 'GET' || !ACCOUNT_PAGES.has(req.path) ||
      !containsCredentialsInQuery(req.originalUrl || req.url)) {
    return next();
  }
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.redirect(303, req.path === '/' || req.path === '/index.html'
    ? '/portal-login.html' : req.path);
}

module.exports = { containsCredentialsInQuery, redirectLeakedCredentials };
