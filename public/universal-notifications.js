/* Attendigo universal inbox — intentionally no service-worker/private-record persistence. */
(() => {
  'use strict';
  const tokenKey = 'schoolAttendance.accessToken';
  const token = sessionStorage.getItem(tokenKey);
  if (!token) return;
  let user;
  try { user = JSON.parse(sessionStorage.getItem('schoolAttendance.user') || 'null'); } catch { user = null; }
  const anchor = document.querySelector('.topbar-right') ||
    document.querySelector('.student-actions') || document.querySelector('.parent-head');
  if (!anchor) return;
  const base = user?.role === 'SUPER_ADMIN' ? '/api/platform/notifications' : '/api/notifications';
  const shell = document.createElement('div');
  shell.className = 'universal-notifications';
  shell.innerHTML = '<button type="button" class="universal-bell" aria-label="Notifications" title="Notifications" aria-expanded="false" aria-controls="universalNotificationPanel">' +
    '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path stroke-linejoin="round" stroke-linecap="round" d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></svg>' +
    '<span class="universal-bell-count" hidden></span></button>' +
    '<section id="universalNotificationPanel" class="universal-panel" aria-label="Notifications" hidden>' +
    '<div class="universal-panel-head"><div><strong>Notifications</strong><small>Requests, decisions and system updates</small></div>' +
    '<button type="button" class="universal-refresh" aria-label="Refresh notifications" title="Refresh">↻</button></div>' +
    '<div class="universal-preview" role="status" aria-live="polite">Loading notifications…</div>' +
    '<div class="universal-panel-actions"><button type="button" class="universal-read-all">Mark all read</button><button type="button" class="universal-view-all">View all</button></div>' +
    '</section>';
  anchor.prepend(shell);
  const bell = shell.querySelector('.universal-bell');
  const badge = shell.querySelector('.universal-bell-count');
  const panel = shell.querySelector('.universal-panel');
  const preview = shell.querySelector('.universal-preview');
  let unread = 0, data = [], busy = false, currentFilter = 'ALL', currentQuery = '', nextOffset = null;
  let modal = null, modalList = null, modalStatus = null;
  const text = (tag, cls, content) => {
    const item = document.createElement(tag);
    if (cls) item.className = cls;
    item.textContent = content ?? '';
    return item;
  };
  function updateCount(count) {
    unread = Math.max(0, Number(count) || 0);
    badge.hidden = unread === 0;
    badge.textContent = unread > 99 ? '99+' : String(unread);
    bell.setAttribute('aria-label', unread ? unread + ' unread notifications' : 'Notifications');
  }
  async function api(path = '', options = {}) {
    const key = sessionStorage.getItem(tokenKey);
    if (!key) throw Error('Your session has ended. Sign in to view notifications.');
    const res = await fetch(base + path, {
      ...options, headers: { Authorization: 'Bearer ' + key, ...(options.headers || {}) }, cache: 'no-store'
    });
    const value = await res.json().catch(() => ({}));
    if (!res.ok) throw Error(res.status === 401 ? 'Session expired. Sign in again.' : value.error || 'Unable to load notifications.');
    return value;
  }
  const fmt = iso => {
    if (!iso) return '';
    const date = new Date(iso);
    return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'}) : '';
  };
  async function openItem(item) {
    if (!item.readAt) {
      try { await api('/' + encodeURIComponent(item.notificationId) + '/read', {method: 'PATCH'}); }
      catch { /* Keep the notification in the inbox when offline. */ }
    }
    closePanel();
    if (modal) modal.hidden = true;
    await refresh(false).catch(() => {});
    const link = String(item.actionUrl || '');
    // Only server-maintained same-site routes; no user-supplied external URLs.
    if (!/^\/(?:portal|student-portal|parent-portal)\.html(?:#[A-Za-z0-9_-]+)?$/.test(link)) return;
    const target = new URL(link, location.origin);
    if (target.pathname === location.pathname) {
      const view = decodeURIComponent(target.hash.slice(1));
      const nav = view && (document.querySelector('[data-view="' + view + '"]') ||
        ({
          guardians: document.getElementById('guardianApprovalsNav'),
          specialPrograms: document.getElementById('academicAdminNav'),
          platformSchools: document.querySelector('[data-view="platformSchools"]')
        })[view]);
      if (nav && !nav.hidden) nav.click();
      else if (view === 'guardians') window.AttendigoGuardian?.openApprovals?.();
      return;
    }
    location.assign(link);
  }
  function makeItem(item) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'universal-notice' + (!item.readAt ? ' is-unread' : '');
    const glyph = item.status === 'APPROVED' ? '✓' : item.status === 'REJECTED' ? '!' :
      item.category === 'SYSTEM' ? '⚙' : item.category === 'APPROVAL' ? '⌛' : '●';
    button.append(text('span', 'universal-notice-icon', glyph));
    const content = text('span', 'universal-notice-content', '');
    content.append(text('strong', null, item.title), text('small', null, item.body));
    content.append(text('time', null, fmt(item.updatedAt || item.createdAt)));
    button.append(content);
    button.addEventListener('click', () => openItem(item));
    return button;
  }
  function fillList(root, items, emptyText) {
    root.replaceChildren();
    if (!items.length) root.append(text('p', 'universal-empty', emptyText));
    else items.forEach(item => root.append(makeItem(item)));
  }
  async function refresh(showError = true) {
    if (busy || document.hidden) return;
    busy = true;
    try {
      const params = new URLSearchParams({ limit: modal && !modal.hidden ? '25' : '6',
        filter: currentFilter, q: currentQuery });
      const result = await api('?' + params.toString());
      data = result.notifications || [];
      updateCount(result.unreadCount);
      nextOffset = result.nextOffset;
      fillList(preview, data.slice(0, 5), 'You are all caught up.');
      if (modal && !modal.hidden) {
        fillList(modalList, data, 'No notifications match this filter.');
        modal.querySelector('.universal-load-more').hidden = nextOffset == null;
      }
    } catch (error) {
      if (showError) {
        preview.textContent = error.message;
        if (modalStatus) modalStatus.textContent = error.message;
      }
    } finally { busy = false; }
  }
  async function more() {
    if (busy || nextOffset == null) return;
    busy = true;
    try {
      const params = new URLSearchParams({ limit: '25', filter: currentFilter, q: currentQuery, offset: String(nextOffset) });
      const result = await api('?' + params);
      data.push(...(result.notifications || []));
      updateCount(result.unreadCount);
      nextOffset = result.nextOffset;
      fillList(modalList, data, 'No notifications match this filter.');
      modal.querySelector('.universal-load-more').hidden = nextOffset == null;
    } catch (e) { modalStatus.textContent = e.message; }
    finally { busy = false; }
  }
  const closePanel = () => { panel.hidden = true; bell.setAttribute('aria-expanded', 'false'); };
  bell.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    bell.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) refresh();
  });
  shell.querySelector('.universal-refresh').addEventListener('click', () => refresh());
  async function markAll() {
    try {
      await api('/read-all', { method: 'POST' });
      updateCount(0);
      await refresh();
    } catch (e) { preview.textContent = e.message; }
  }
  shell.querySelector('.universal-read-all').addEventListener('click', markAll);
  function makeCenter() {
    if (modal) return;
    modal = document.createElement('section');
    modal.className = 'universal-center';
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Notification center');
    modal.innerHTML = '<div class="universal-center-card"><div class="universal-center-head">' +
      '<div><h2>Notification Center</h2><p>Track your requests and decisions.</p></div>' +
      '<button class="universal-center-close" type="button" aria-label="Close notifications">✕</button></div>' +
      '<div class="universal-center-controls"><label>Search notifications<input class="universal-search" type="search" maxlength="100" placeholder="Search notifications"></label>' +
      '<label>Category<select class="universal-filter"><option value="ALL">All</option><option value="UNREAD">Unread</option><option value="REQUEST">Requests</option><option value="APPROVAL">Approvals</option><option value="SYSTEM">System updates</option></select></label></div>' +
      '<div class="universal-center-list"></div><p class="universal-center-status" role="status" aria-live="polite"></p>' +
      '<div class="universal-center-actions"><button type="button" class="universal-read-center">Mark all read</button>' +
      '<button type="button" class="universal-load-more" hidden>Load more</button></div></div>';
    document.body.append(modal);
    modalList = modal.querySelector('.universal-center-list');
    modalStatus = modal.querySelector('.universal-center-status');
    modal.querySelector('.universal-center-close').addEventListener('click', closeCenter);
    modal.addEventListener('click', event => { if (event.target === modal) closeCenter(); });
    modal.querySelector('.universal-filter').addEventListener('change', e => {
      currentFilter = e.target.value; refresh();
    });
    modal.querySelector('.universal-search').addEventListener('input', e => {
      currentQuery = e.target.value; refresh();
    });
    modal.querySelector('.universal-read-center').addEventListener('click', markAll);
    modal.querySelector('.universal-load-more').addEventListener('click', more);
  }
  function closeCenter() { if (modal) modal.hidden = true; bell.focus(); }
  shell.querySelector('.universal-view-all').addEventListener('click', () => {
    makeCenter();
    closePanel();
    modal.hidden = false;
    modalStatus.textContent = '';
    refresh();
    modal.querySelector('.universal-center-close').focus();
  });
  document.addEventListener('pointerdown', e => {
    if (!shell.contains(e.target) && !panel.hidden) closePanel();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (modal && !modal.hidden) closeCenter(); else closePanel(); }
  });
  document.addEventListener('attendigo:requests-changed', () => refresh(false));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(false); });
  window.addEventListener('focus', () => refresh(false));
  setInterval(() => { if (!document.hidden) refresh(false); }, 45000);
  refresh(false);
})();
