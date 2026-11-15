(() => {
  const tokenKey = 'schoolAttendance.accessToken';
  const userKey = 'schoolAttendance.user';
  const token = sessionStorage.getItem(tokenKey);
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  let currentUser = null;
  let profile = null;

  if (!token) { location.replace('/portal-login.html'); return; }

  function clearSession() {
    sessionStorage.removeItem(tokenKey);
    sessionStorage.removeItem(userKey);
    sessionStorage.removeItem('schoolAttendance.expiresAt');
  }
  async function api(url, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(url, {...options, headers, cache: 'no-store'});
    if (response.status === 401) { clearSession(); location.replace('/portal-login.html'); throw new Error('Your session expired. Please sign in again.'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }
  function formatDate(value) {
    const clean = String(value || '').slice(0, 10);
    const [y,m,d] = clean.split('-').map(Number);
    if (!y || !m || !d) return clean || '—';
    return new Date(y, m - 1, d).toLocaleDateString('en-PH', {year:'numeric',month:'short',day:'numeric'});
  }
  function formatTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('en-PH', {timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'});
  }
  async function loadAttendance() {
    const result = await api('/api/student/attendance');
    const records = result.attendance || [];
    $('studentRecordCount').textContent = String(records.length);
    $('studentSubjectCount').textContent = String(records.filter(record => record.scope === 'CLASS').length);
    $('studentGateCount').textContent = String(records.filter(record => record.scope === 'SCHOOL').length);
    $('studentAttendanceRows').innerHTML = records.length ? records.map(record => {
      const gate = record.scope === 'SCHOOL';
      return `<tr><td>${esc(formatDate(record.schoolDate))}</td><td>${gate ? 'School gate' : 'Subject class'}</td><td>${esc(record.periodName || record.subjectName || (gate ? 'Gate entrance' : 'Class period'))}</td><td>${esc(String(record.eventType || '').replaceAll('_',' '))}</td><td>${esc(formatTime(record.occurredAt))}</td><td>${record.late ? '<span class="status-tag late">LATE</span>' : `<span class="status-tag">${esc(record.syncStatus || 'ACCEPTED')}</span>`}</td></tr>`;
    }).join('') : '<tr><td colspan="6" class="empty-cell">No accepted attendance records have been recorded yet.</td></tr>';
  }
  async function loadProfile() {
    const data = await api('/api/student/profile');
    profile = data.student;
    $('studentSchoolLabel').textContent = data.school?.schoolName || currentUser?.schoolName || 'STUDENT PORTAL';
    $('studentWelcome').textContent = `Welcome, ${profile.fullName || currentUser?.displayName || 'Student'}`;
    $('studentIdValue').textContent = profile.studentId || '—';
    $('studentGradeValue').textContent = profile.gradeLevel || '—';
    $('studentSectionValue').textContent = profile.section || '—';
  }
  async function refresh() {
    $('studentRefresh').disabled = true;
    try { await loadProfile(); if (!currentUser?.mustChangePassword) await loadAttendance(); $('studentPortalFeedback').textContent = 'Information refreshed.'; }
    catch (error) { $('studentPortalFeedback').textContent = error.message; }
    finally { $('studentRefresh').disabled = false; }
  }
  $('studentPasswordForm').addEventListener('submit', async event => {
    event.preventDefault();
    const feedback = $('studentPasswordFeedback');
    const currentPassword = $('studentCurrentPassword').value;
    const newPassword = $('studentNewPassword').value;
    if (newPassword !== $('studentConfirmPassword').value) { feedback.textContent = 'The new passwords do not match.'; return; }
    if (newPassword.length < 12) { feedback.textContent = 'Use at least 12 characters for your new password.'; return; }
    $('studentSavePassword').disabled = true;
    try {
      await api('/api/student/change-password', {method:'POST',body:JSON.stringify({currentPassword,newPassword})});
      currentUser.mustChangePassword = false;
      sessionStorage.setItem(userKey, JSON.stringify(currentUser));
      $('studentPasswordRequired').hidden = true;
      $('studentAttendanceSummary').hidden = false;
      $('studentAttendanceCard').hidden = false;
      $('studentPasswordForm').reset();
      feedback.textContent = 'Password changed successfully.';
      await loadAttendance();
    } catch (error) { feedback.textContent = error.message; }
    finally { $('studentSavePassword').disabled = false; }
  });
  $('studentRefresh').addEventListener('click', refresh);
  $('studentLogout').addEventListener('click', async () => {
    try { await api('/api/auth/logout', {method:'POST'}); } catch {}
    clearSession(); location.replace('/portal-login.html');
  });
  async function init() {
    const me = await api('/api/auth/me');
    if (me.user.role !== 'STUDENT') { location.replace(me.user.role === 'PARENT' ? '/parent-portal.html' : '/portal.html'); return; }
    currentUser = me.user;
    sessionStorage.setItem(userKey, JSON.stringify(currentUser));
    await loadProfile();
    $('studentAttendanceSummary').hidden = Boolean(currentUser.mustChangePassword);
    $('studentAttendanceCard').hidden = Boolean(currentUser.mustChangePassword);
    $('studentPasswordRequired').hidden = !currentUser.mustChangePassword;
    if (!currentUser.mustChangePassword) await loadAttendance();
  }
  init().catch(error => { $('studentPortalFeedback').textContent = error.message || 'Could not load the Student Portal.'; });
})();
