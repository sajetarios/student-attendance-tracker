(() => {
  'use strict';
  const linkId = 'classQrTeacherShortcut';
  const remove = () => {
    document.querySelectorAll('a[href*="class-qr-teacher.html"]').forEach(link => link.remove());
  };
  // Verify the signed-in role with the server; never rely on the stale cached session role.
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
    const link = document.createElement('a');
    link.id = linkId;
    link.href = '/class-qr-teacher.html';
    link.innerHTML = '<span aria-hidden="true">▦</span><span class="class-qr-link-label">Class QR Attendance</span>';
    link.setAttribute('aria-label', 'Class QR Attendance');
    const panel = document.getElementById('studentsView');
    const positionShortcut = () => {
      const inlineHost = panel && !panel.hidden ? panel.querySelector('.student-roster-viewbar') : null;
      const host = inlineHost || document.body;
      link.classList.toggle('is-roster-inline', Boolean(inlineHost));
      if (link.parentElement !== host) host.append(link);
    };
    positionShortcut();
    if (panel) new MutationObserver(positionShortcut).observe(panel, {
      attributes: true,
      attributeFilter: ['hidden', 'style', 'class']
    });
  }).catch(() => remove());
})();
