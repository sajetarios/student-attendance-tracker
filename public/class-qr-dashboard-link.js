(() => {
  'use strict';
  const linkId = 'classQrTeacherShortcut';
  const remove = () => {
    document.querySelectorAll('a[href*="class-qr-teacher.html"]').forEach(a => a.remove());
  };
  // Never trust the role cached in sessionStorage: it can be from an earlier login.
  // The server's current authenticated role is authoritative.
  remove();
  const token = sessionStorage.getItem('schoolAttendance.accessToken');
  if (!token) return;
  fetch('/api/auth/me', {
    headers: { Authorization: 'Bearer ' + token },
    cache: 'no-store'
  }).then(async response => {
    if (!response.ok) return null;
    return (await response.json()).user;
  }).then(user => {
    remove();
    if (!user || !['TEACHER', 'SCHOOL_ADMIN'].includes(user.role)) return;
    const a = document.createElement('a');
    a.id = linkId;
    a.href = '/class-qr-teacher.html';
    a.textContent = '▦ Class QR Attendance';
    a.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:1000;padding:13px 17px;border-radius:13px;background:#1767a5;color:white;text-decoration:none;font-weight:700;box-shadow:0 5px 22px #0003';
    document.body.append(a);
  }).catch(() => remove());
})();
