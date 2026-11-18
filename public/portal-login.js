(() => {
  const form = document.getElementById('loginForm');
  const schoolMode = document.getElementById('schoolMode');
  const platformMode = document.getElementById('platformMode');
  const studentMode = document.getElementById('studentMode');
  const usernameLabel = document.getElementById('usernameLabel');
  const schoolCodeGroup = document.getElementById('schoolCodeGroup');
  const schoolCode = document.getElementById('schoolCode');
  const schoolCodeHint = document.getElementById('schoolCodeHint');
  const schoolCodeHelp = 'Your school code is required, even with a saved username and password.';
  function clearSchoolCodeError() {
    schoolCode.removeAttribute('aria-invalid');
    schoolCodeHint.textContent = schoolCodeHelp;
    schoolCodeHint.classList.remove('error');
  }
  schoolCode.addEventListener('input', () => {
    if (schoolCode.value.trim()) clearSchoolCodeError();
  });
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
    schoolMode.setAttribute('aria-pressed', String(isSchool));
    studentMode?.setAttribute('aria-pressed', String(isStudent));
    platformMode.setAttribute('aria-pressed', String(mode === 'platform'));
    schoolCodeGroup.hidden = mode === 'platform';
    schoolCode.disabled = mode === 'platform';
    schoolCode.setAttribute('aria-hidden', String(mode === 'platform'));
    document.getElementById('schoolAdminRecoveryLink').hidden = mode !== 'school';
    document.getElementById('schoolAdminRecoveryForm').hidden = true;
    form.hidden = false;
    if (document.getElementById('firstPlatformSetupLink')) document.getElementById('firstPlatformSetupLink').hidden = mode !== 'platform';
    schoolCode.required = mode !== 'platform';
    clearSchoolCodeError();
    const usernameInput = document.getElementById('username');
    usernameInput.placeholder = isStudent ? 'Enter your Student ID or username' : 'Enter your username';
    usernameInput.setAttribute('aria-label', isStudent ? 'Student ID or username' : 'Username');
    if (usernameLabel) { const nameText = usernameLabel.querySelector('span'); if (nameText) nameText.textContent = isStudent ? 'Student ID / username' : 'Username'; else usernameLabel.textContent = isStudent ? 'Student ID / username' : 'Username'; }
    if (accountTypeHint) accountTypeHint.textContent = isStudent
      ? 'Student account uses the school-issued student login. You can view only your own profile and attendance.'
      : mode === 'platform'
        ? 'Super Admin: enter your platform username and password. School code is not required.'
        : 'School account includes administrators, teachers, Gate Keepers, and approved Parent/Guardian accounts.';
    feedback.textContent = '';
    feedback.className = 'form-feedback';
  };

  schoolMode.addEventListener('click', () => setMode('school'));
  studentMode?.addEventListener('click', () => setMode('student'));
  platformMode.addEventListener('click', () => setMode('platform'));
  const loginParams=new URLSearchParams(window.location.search);
  if(loginParams.get('mode')==='platform')setMode('platform');
  if(loginParams.get('mode')==='student')setMode('student');

  function openRecovery(prefillCode = '') {
    if (mode !== 'school') return;
    form.hidden = true;
    recoveryForm.hidden = false;
    document.getElementById('recoverSchoolCode').value = schoolCode.value.trim();
    document.getElementById('recoverUsername').value = document.getElementById('username').value.trim();
    if (prefillCode) document.getElementById('recoverCode').value = prefillCode;
    recoveryFeedback.textContent = '';
    document.getElementById(prefillCode ? 'recoverNewPassword' : 'recoverCode').focus();
  }
  const looksLikeRecoveryCode = value => /^[A-F0-9]{6}(?:[-\\s]?[A-F0-9]{6}){3}$/i.test(value.trim());

  form.addEventListener('submit', async event => {
    event.preventDefault();
    feedback.textContent = '';
    feedback.className = 'form-feedback';
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    // A Super Admin recovery code is NOT a sign-in password.
    // Never submit a recovery-looking code to /login; failed attempts lock the account.
    if (mode === 'school' && looksLikeRecoveryCode(password)) {
      openRecovery(password.trim());
      feedback.textContent = 'This is a recovery code, not a temporary login password. Use it below to set a new password; a valid recovery also clears the temporary lock.';
      return;
    }
    const payload = mode !== 'platform'
      ? { schoolCode: schoolCode.value.trim(), username, password }
      : { username, password };
    if (mode !== 'platform' && !payload.schoolCode) {
      // Password managers often restore username/password but not the tenant code.
      schoolCode.setAttribute('aria-invalid', 'true');
      schoolCodeHint.textContent = 'Enter your school code to sign in.';
      schoolCodeHint.classList.add('error');
      feedback.textContent = 'School code is required for this account type.';
      feedback.className = 'form-feedback error';
      schoolCode.focus();
      return;
    }
    if (!username || !password) {
      feedback.textContent = 'Enter your username and password.';
      feedback.className = 'form-feedback error';
      document.getElementById(!username ? 'username' : 'password').focus();
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
      if (mode === 'school' && data.user.mustChangePassword) {
        window.location.assign('/force-password-change.html');
        return;
      }
      const returnTo=loginParams.get('returnTo');
      if(mode==='student'&&data.user.role==='STUDENT'&&returnTo){
        try{
          const target=new URL(returnTo,window.location.origin);
          if(target.origin===window.location.origin&&target.pathname==='/class-qr-checkin.html'){
            window.location.assign(target.pathname+target.search);
            return;
          }
        }catch{}
      }
      window.location.assign(destination);
    } catch (error) {
      const locked = mode === 'school' && /temporarily locked/i.test(error.message || '');
      feedback.textContent = locked
        ? 'Account temporarily locked after incorrect passwords. School Administrators can use a valid Super Admin recovery code through the recovery option below to reset their password and clear this lock; other users must wait for the lock to expire.'
        : (error.message || 'Unable to sign in. Check the local server connection.');
    } finally {
      button.disabled = false;
      button.querySelector('span:first-child').textContent = 'Sign in';
    }
  });

  const recoveryForm=document.getElementById('schoolAdminRecoveryForm');
  const recoveryFeedback=document.getElementById('recoveryFeedback');
  document.getElementById('openSchoolAdminRecovery').addEventListener('click',()=>openRecovery());
  document.getElementById('cancelSchoolAdminRecovery').addEventListener('click',()=>{
    recoveryForm.hidden=true;form.hidden=false;recoveryForm.reset();
    recoveryFeedback.textContent='';
  });
  recoveryForm.addEventListener('submit',async event=>{
    event.preventDefault();
    const submit=document.getElementById('recoverSubmit');
    const payload={
      schoolCode:document.getElementById('recoverSchoolCode').value.trim(),
      username:document.getElementById('recoverUsername').value.trim(),
      recoveryCode:document.getElementById('recoverCode').value.trim(),
      newPassword:document.getElementById('recoverNewPassword').value,
      confirmPassword:document.getElementById('recoverConfirmPassword').value
    };
    if(payload.newPassword!==payload.confirmPassword){recoveryFeedback.textContent='New passwords do not match.';return;}
    submit.disabled=true;recoveryFeedback.textContent='Checking recovery code…';
    try{
      const response=await fetch('/api/auth/school/recover-admin',{method:'POST',
        headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify(payload)});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(data.error||'Password recovery failed.');
      recoveryForm.reset();recoveryForm.hidden=true;form.hidden=false;
      schoolCode.value=payload.schoolCode;document.getElementById('username').value=payload.username;
      feedback.className='form-feedback success';
      feedback.textContent='Password reset successful. Sign in with your new School Admin password.';
    }catch(error){recoveryFeedback.textContent=error.message;}
    finally{submit.disabled=false;document.getElementById('recoverNewPassword').value='';document.getElementById('recoverConfirmPassword').value='';}
  });

  // Only auto-restore an existing student session when student mode was requested.
  if(loginParams.get('mode')==='student'){
    fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'}).then(async response=>{
      if(!response.ok)return;
      const data=await response.json();
      if(data.user?.role!=='STUDENT'||data.user.mustChangePassword)return;
      const returnTo=loginParams.get('returnTo');
      if(returnTo){
        const target=new URL(returnTo,location.origin);
        if(target.origin===location.origin&&target.pathname==='/class-qr-checkin.html'){
          location.replace(target.pathname+target.search);return;
        }
      }
      location.replace('/student-portal.html');
    }).catch(()=>{});
  }
  // Do not auto-redirect merely because a session token exists. A previous
  // Parent session must not prevent a teacher or administrator from signing in.

  
  // Visiting the login page also forces an update check. This replaces older
  // cache-first workers that may still hold the retired Attendance Desk index.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then(registration => registration.update())
      .catch(error => console.warn('Service worker update check failed:', error));
  }

  // Fail closed: only enable the submit button after the POST-based JavaScript
  // handler and recovery listeners are registered. If JavaScript fails or is
  // blocked, a native GET login is never possible.
  button.disabled = false;
  if (feedback.textContent === 'Preparing secure sign-in…') feedback.textContent = '';
})();
