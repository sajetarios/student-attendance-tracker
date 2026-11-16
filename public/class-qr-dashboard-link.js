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
    a.innerHTML = '<span aria-hidden="true">▦</span><span class="class-qr-link-label">Class QR Attendance</span>'; a.setAttribute('aria-label','Class QR Attendance');
    a.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:1000;padding:13px 17px;border-radius:13px;background:#1767a5;color:white;text-decoration:none;font-weight:700;box-shadow:0 5px 22px #0003';
    const style=document.createElement('style');style.textContent='@media(max-width:650px){#classQrTeacherShortcut{right:12px!important;bottom:calc(12px + env(safe-area-inset-bottom))!important;width:52px!important;height:52px!important;box-sizing:border-box!important;padding:0!important;display:flex!important;align-items:center!important;justify-content:center!important;border-radius:50%!important;font-size:25px!important}#classQrTeacherShortcut .class-qr-link-label{display:none!important}#classAttendanceView{padding-bottom:72px!important}}';document.head.append(style);document.body.append(a);
  }).catch(() => remove());
})();
