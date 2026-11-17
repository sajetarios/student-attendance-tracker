/* Revalidate restored pages before displaying account data without flashing an already-verified dashboard. */
(() => {
  const tokenKey = 'schoolAttendance.accessToken';
  const login = '/portal-login.html';
  const initialToken = sessionStorage.getItem(tokenKey);
  let checkSequence = 0;
  let checkInFlight = false;
  let validated = false;
  // Management navigation must be role-scoped before it is first revealed.
  let roleReady = document.documentElement.dataset.protectedRole !== 'STAFF';
  const hide = () => { document.documentElement.style.visibility = 'hidden'; };
  const show = () => {
    if (!validated || !roleReady) return;
    const error = document.getElementById('sessionGuardError');
    if (error) error.remove();
    for (const child of document.body.children) child.style.visibility = '';
    document.documentElement.style.visibility = '';
  };
  const redirect = () => { hide(); window.location.replace(login); };
  hide();
  if (!initialToken) { redirect(); return; }

  async function verify({ block = false } = {}) {
    // Block a first visit or browser-history restoration, not every tab-focus check.
    if (block || !validated) hide();
    const token = sessionStorage.getItem(tokenKey);
    if (!token || token !== initialToken) { redirect(); return; }
    if (checkInFlight) return;
    const sequence = ++checkSequence;
    checkInFlight = true;
    try {
      const response = await fetch('/api/auth/me', {
        cache: 'no-store',
        headers: { Authorization: 'Bearer ' + token }
      });
      if (sequence !== checkSequence) return;
      if (response.status === 401) {
        if (sessionStorage.getItem(tokenKey) === token) {
          for (const key of [tokenKey, 'schoolAttendance.user', 'schoolAttendance.expiresAt']) sessionStorage.removeItem(key);
        }
        redirect();
        return;
      }
      if (!response.ok) throw new Error('Session validation unavailable.');
      const payload = await response.json();
      if (sequence !== checkSequence) return;
      const expected = document.documentElement.dataset.protectedRole;
      const role = payload?.user?.role;
      if (!role) { redirect(); return; }
      if ((expected === 'STUDENT' && role !== 'STUDENT') ||
          (expected === 'PARENT' && role !== 'PARENT') ||
          (expected === 'STAFF' && (role === 'STUDENT' || role === 'PARENT'))) {
        hide();
        window.location.replace(role === 'STUDENT' ? '/student-portal.html' :
          role === 'PARENT' ? '/parent-portal.html' : '/portal.html');
        return;
      }
      if (sessionStorage.getItem(tokenKey) !== initialToken) { redirect(); return; }
      validated = true;
      show();
    } catch (error) {
      if (sequence !== checkSequence) return;
      validated = false;
      hide();
      // Never expose stale protected content when the session cannot be verified.
      let overlay = document.getElementById('sessionGuardError');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'sessionGuardError';
        overlay.setAttribute('role', 'alert');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#f8fafc;color:#172338;display:grid;place-content:center;text-align:center;padding:24px;font:16px system-ui';
        overlay.innerHTML = '<strong>Unable to verify your session</strong><p>Connect to the internet and reload this page to continue securely.</p><button type="button" style="padding:10px 20px;cursor:pointer">Retry</button>';
        document.body.appendChild(overlay);
        overlay.querySelector('button').addEventListener('click', () => verify({ block: true }));
      }
      document.documentElement.style.visibility = '';
      for (const child of document.body.children) if (child !== overlay) child.style.visibility = 'hidden';
    } finally {
      if (sequence === checkSequence) checkInFlight = false;
    }
  }

  document.addEventListener('attendigo:portal-ready', () => {
    roleReady = true;
    show();
  });
  window.addEventListener('pagehide', () => {
    ++checkSequence;
    checkInFlight = false;
    validated = false;
    hide();
  });
  window.addEventListener('pageshow', event => {
    // A history-restored document may belong to an account that already logged out.
    if (event.persisted) { validated = false; hide(); }
    verify({ block: event.persisted || !validated });
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) verify({ block: false });
  });
})();
