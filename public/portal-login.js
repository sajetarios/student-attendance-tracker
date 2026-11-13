(() => {
  const form = document.getElementById('loginForm');
  const schoolMode = document.getElementById('schoolMode');
  const platformMode = document.getElementById('platformMode');
  const studentMode = document.getElementById('studentMode');
  const usernameLabel = document.getElementById('usernameLabel');
  const schoolCodeGroup = document.getElementById('schoolCodeGroup');
  const schoolCode = document.getElementById('schoolCode');
  const accountTypeHint = document.getElementById('accountTypeHint');
  const feedback = document.getElementById('loginFeedback');
  const button = document.getElementById('signInButton');
  let mode = 'school';

  const setMode = next => {
    mode = next;
    const isSchool = mode === 'school';
    const isStudent = mode === 'student';
    schoolMode.classList.toggle('active', isSchool);
    studentMode?.classList.toggle('active', isStudent);
    platformMode.classList.toggle('active', mode === 'platform');
    schoolMode.setAttribute('aria-selected', String(isSchool));
    studentMode?.setAttribute('aria-selected', String(isStudent));
    platformMode.setAttribute('aria-selected', String(mode === 'platform'));
    schoolCodeGroup.hidden = mode === 'platform';
    schoolCode.required = mode !== 'platform';
    if (usernameLabel) usernameLabel.textContent = isStudent ? 'Student ID / username' : 'Username';
    if (accountTypeHint) accountTypeHint.textContent = isStudent
      ? 'Student account uses the school-issued student login. You can view only your own profile and attendance.'
      : mode === 'platform'
        ? 'Platform Administrator accounts are separate from school accounts.'
        : 'School account includes administrators, teachers, Gate Keepers, and approved Parent/Guardian accounts.';
    feedback.textContent = '';
    feedback.className = 'form-feedback';
  };

  schoolMode.addEventListener('click', () => setMode('school'));
  studentMode?.addEventListener('click', () => setMode('student'));
  platformMode.addEventListener('click', () => setMode('platform'));

  form.addEventListener('submit', async event => {
    event.preventDefault();
    feedback.textContent = '';
    feedback.className = 'form-feedback';
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const payload = mode !== 'platform'
      ? { schoolCode: schoolCode.value.trim(), username, password }
      : { username, password };
    if (!username || !password || (mode !== 'platform' && !payload.schoolCode)) {
      feedback.textContent = 'Complete all required fields.';
      return;
    }

    button.disabled = true;
    button.querySelector('span:first-child').textContent = 'Signing in…';
    try {
      const endpoint = mode === 'school' ? '/api/auth/school/login' : mode === 'student' ? '/api/auth/student/login' : '/api/auth/platform/login';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Sign-in failed (${response.status}).`);
      if (!data.accessToken || !data.user) throw new Error('The server returned an incomplete sign-in response.');

      // Keep bearer tokens in tab-scoped session storage, not localStorage.
      const destination = window.AttendanceLoginRouting?.destinationForRole(data.user.role);
      if (!destination) throw new Error(`This account has an unsupported role (${data.user.role || 'unknown'}). Please contact the school administrator.`);

      // Replace any prior account session only after the new credentials succeed.
      sessionStorage.setItem('schoolAttendance.accessToken', data.accessToken);
      sessionStorage.setItem('schoolAttendance.user', JSON.stringify(data.user));
      sessionStorage.setItem('schoolAttendance.expiresAt', data.expiresAt || '');
      window.location.assign(destination);
    } catch (error) {
      feedback.textContent = error.message || 'Unable to sign in. Check the local server connection.';
    } finally {
      button.disabled = false;
      button.querySelector('span:first-child').textContent = 'Sign in';
    }
  });

  // Do not auto-redirect merely because a session token exists. A previous
  // Parent session must not prevent a teacher or administrator from signing in.

  
  // Visiting the login page also forces an update check. This replaces older
  // cache-first workers that may still hold the retired Attendance Desk index.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then(registration => registration.update())
      .catch(error => console.warn('Service worker update check failed:', error));
  }
})();
