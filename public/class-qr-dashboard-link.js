(() => {
  'use strict';
  const linkId = 'classQrTeacherShortcut';
  const remove = () => {
    document.querySelectorAll('a[href*="class-qr-teacher.html"]').forEach(link => link.remove());
  };
  // A shortcut is authorized by the current server session, never cached role data.
  remove();

  fetch('/api/auth/me', {
    cache: 'no-store'
  }).then(async response => {
    if (!response.ok) return null;
    return (await response.json()).user;
  }).then(user => {
    remove();
    if (!user) return;
    if (user.role === 'SCHOOL_ADMIN') {
      // Admins monitor class check-ins instead of presenting teacher QR codes.
      const academics = document.getElementById('academicNavChildren');
      if (academics && !document.getElementById('classQrAdminMonitorNav')) {
        const monitor = document.createElement('a');
        monitor.id = 'classQrAdminMonitorNav';
        monitor.className = 'nav-item';
        monitor.href = '/class-qr-monitor.html';
        monitor.title = 'Monitor school-wide class QR attendance';
        monitor.innerHTML = '<span class="nav-icon" aria-hidden="true">▤</span><span class="nav-label">Class Attendance Monitoring</span>';
        academics.insertBefore(monitor, document.getElementById('schedulesNav'));
      }
      return;
    }
    if (user.role !== 'TEACHER') return;
    const link = document.createElement('a');
    link.id = linkId;
    link.href = '/class-qr-teacher.html';
    link.innerHTML = '<span aria-hidden="true">▦</span><span class="class-qr-link-label">Class QR Attendance</span>';
    link.setAttribute('aria-label', 'Class QR Attendance');
    const panel = document.getElementById('studentsView');
    const dashboard = document.getElementById('dashboardView');
    const positionShortcut = () => {
      const rosterVisible = Boolean(panel && !panel.hidden && !panel.closest('[hidden]') && panel.getClientRects().length);
      const dashboardVisible = Boolean(dashboard && !dashboard.hidden && !dashboard.closest('[hidden]') && dashboard.getClientRects().length);
      const rosterHost = rosterVisible ? panel.querySelector('#studentRosterPanel .student-roster-viewbar') : null;
      // Teachers get a compact in-page shortcut instead of a floating overlay.
      const dashboardHost = user.role === 'TEACHER' && dashboardVisible
        ? dashboard.querySelector('.dashboard-quick-buttons') : null;
      const inlineHost = rosterHost || dashboardHost;
      const host = inlineHost || document.body;
      link.classList.toggle('is-roster-inline', Boolean(rosterHost));
      link.classList.toggle('is-dashboard-inline', Boolean(dashboardHost));
      link.hidden = (user.role === 'TEACHER' && !inlineHost) || (rosterVisible && !rosterHost);
      // Explicitly reset fixed offsets: a stale fixed position must never cover account controls.
      link.style.setProperty('position', inlineHost ? 'static' : 'fixed', 'important');
      for (const edge of ['top', 'left']) link.style.setProperty(edge, 'auto', 'important');
      link.style.setProperty('right', inlineHost ? 'auto' : '18px', 'important');
      link.style.setProperty('bottom', inlineHost ? 'auto' : '18px', 'important');
      link.style.setProperty('transform', 'none', 'important');
      if (link.parentElement !== host) host.append(link);
    };
    positionShortcut();
    const observer = new MutationObserver(positionShortcut);
    if (panel) observer.observe(panel, {
      attributes: true, attributeFilter: ['hidden', 'style', 'class']
    });
    if (dashboard) observer.observe(dashboard, {
      attributes: true, attributeFilter: ['hidden', 'style', 'class']
    });
    for (const id of ['schoolWorkspace', 'platformWorkspace']) {
      const section = document.getElementById(id);
      if (section) observer.observe(section, {
        attributes: true, attributeFilter: ['hidden', 'style', 'class']
      });
    }
    // Navigation handlers may update view visibility after the originating click.
    document.addEventListener('click', event => {
      if (event.target.closest?.('.nav-item[data-view], [data-view], #studentsNav')) {
        requestAnimationFrame(positionShortcut);
      }
    });
    window.addEventListener('pageshow', positionShortcut);
  }).catch(() => remove());
})();
