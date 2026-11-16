/* Protected-page guard: never expose a restored dashboard until the current token is revalidated. */
(() => {
  const tokenKey = 'schoolAttendance.accessToken';
  const login = '/portal-login.html';
  const initialToken = sessionStorage.getItem(tokenKey);
  let checkSequence = 0;
  const hide = () => { document.documentElement.style.visibility = 'hidden'; };
  const show = () => { document.documentElement.style.visibility = ''; };
  const redirect = () => { hide(); window.location.replace(login); };
  hide();
  if (!initialToken) { redirect(); return; }
  async function verify() {
    const sequence = ++checkSequence;
    hide();
    const token = sessionStorage.getItem(tokenKey);
    if (!token || token !== initialToken) { redirect(); return; }
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
      const expected = document.documentElement.dataset.protectedRole;
      const role = payload?.user?.role;
      if (!role) { redirect(); return; }
      if (expected === 'STUDENT' && role !== 'STUDENT' ||
          expected === 'PARENT' && role !== 'PARENT' ||
          expected === 'STAFF' && (role === 'STUDENT' || role === 'PARENT')) {
        hide();
        window.location.replace(role === 'STUDENT' ? '/student-portal.html' :
          role === 'PARENT' ? '/parent-portal.html' : '/portal.html');
        return;
      }
      if (sessionStorage.getItem(tokenKey) !== initialToken) { redirect(); return; }
      show();
    } catch (error) {
      if (sequence !== checkSequence) return;
      hide();
      // Do not display private, previously rendered data when validation fails.
      let overlay = document.getElementById('sessionGuardError');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'sessionGuardError';
        overlay.setAttribute('role', 'alert');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#f8fafc;color:#172338;display:grid;place-content:center;text-align:center;padding:24px;font:16px system-ui';
        overlay.innerHTML = '<strong>Unable to verify your session</strong><p>Connect to the internet and reload this page to continue securely.</p><button type="button" style="padding:10px 20px;cursor:pointer">Retry</button>';
        document.body.appendChild(overlay);
        overlay.querySelector('button').addEventListener('click', verify);
      }
      // Make only the non-sensitive error message visible, not the old dashboard.
      document.documentElement.style.visibility = '';
      for (const child of document.body.children) if (child !== overlay) child.style.visibility = 'hidden';
    }
  }
  window.addEventListener('pagehide', () => { ++checkSequence; hide(); });
  window.addEventListener('pageshow', () => {
    for (const child of document.body.children) if (child.id !== 'sessionGuardError') child.style.visibility = '';
    const error = document.getElementById('sessionGuardError');
    if (error) error.remove();
    verify();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) verify(); });
})();
