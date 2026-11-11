(() => {
  const $ = id => document.getElementById(id);
  $('registerForm').addEventListener('submit', async event => {
    event.preventDefault();
    const feedback = $('feedback'); const button = $('submitButton');
    feedback.textContent = ''; feedback.className = 'form-feedback';
    const password = $('password').value;
    if (password !== $('confirmPassword').value) { feedback.textContent = 'Passwords do not match.'; return; }
    if (password.length < 12) { feedback.textContent = 'Password must be at least 12 characters.'; return; }
    const payload = { schoolCode: $('schoolCode').value.trim(), studentId: $('studentId').value.trim(), displayName: $('displayName').value.trim(), mobile: $('mobile').value.trim(), relationship: $('relationship').value, username: $('username').value.trim(), password };
    button.disabled = true; button.textContent = 'Submitting…';
    try {
      const response = await fetch('/api/parents/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify(payload) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Registration failed.');
      $('registerForm').reset(); feedback.textContent = data.message || 'Registration submitted. Wait for school approval.'; feedback.className = 'form-feedback success';
    } catch (error) { feedback.textContent = error.message; feedback.className = 'form-feedback error'; }
    finally { button.disabled = false; button.textContent = 'Submit registration'; }
  });
})();
