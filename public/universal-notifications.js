/* Attendigo universal inbox — intentionally no service-worker/private-record persistence. */
(async () => {
  'use strict';
  const tokenKey = 'schoolAttendance.accessToken';
  const token = sessionStorage.getItem(tokenKey);
  // An HttpOnly browser cookie is authoritative, including after browser restarts.
  // Never trust a cached role when choosing a notification inbox.
  let verified;
  let useBearer = false;
  try {
    let response = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 401 && token) {
      response = await fetch('/api/auth/me', {
        credentials: 'same-origin', cache: 'no-store',
        headers: { Authorization: 'Bearer ' + token }
      });
      useBearer = response.ok;
    }
    if (!response.ok) return;
    verified = await response.json();
  } catch { return; }
  const user = verified?.user;
  if (!user) return;
  const anchor = document.querySelector('.topbar-right') ||
    document.querySelector('.student-actions') || document.querySelector('.parent-head');
  if (!anchor) return;
  const base = user.role === 'SUPER_ADMIN' ? '/api/platform/notifications' : '/api/notifications';
  const shell = document.createElement('div');
  shell.className = 'universal-notifications';
  shell.innerHTML = '<button type="button" class="universal-bell" aria-label="Notifications" title="Notifications" aria-expanded="false" aria-controls="universalNotificationPanel">' +
    '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path stroke-linejoin="round" stroke-linecap="round" d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></svg>' +
    '<span class="universal-bell-count" hidden></span></button>' +
    '<section id="universalNotificationPanel" class="universal-panel" aria-label="Notifications" hidden>' +
    '<div class="universal-panel-head"><div><strong>Notifications</strong><small>Requests, decisions and system updates</small></div>' +
    '<button type="button" class="universal-refresh" aria-label="Refresh notifications" title="Refresh">↻</button></div>' +
    '<div class="universal-preview" role="status" aria-live="polite">Loading notifications…</div>' +
    '<p class="universal-feedback" role="status" aria-live="polite"></p>' +
    '<div class="universal-panel-actions"><button type="button" class="universal-read-all">Mark all read</button><button type="button" class="universal-delete-read">Delete read</button><button type="button" class="universal-view-all">View all</button></div>' +
    '</section>';
  anchor.prepend(shell);
  const bell = shell.querySelector('.universal-bell');
  const badge = shell.querySelector('.universal-bell-count');
  const panel = shell.querySelector('.universal-panel');
  const preview = shell.querySelector('.universal-preview');
  const panelStatus = shell.querySelector('.universal-feedback');
  let unread = 0, data = [], busy = false, removing = false, currentFilter = 'ALL', currentQuery = '', nextOffset = null;
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
    const headers = new Headers(options.headers || {});
    headers.delete('Authorization');
    if (useBearer) {
      const key = sessionStorage.getItem(tokenKey);
      if (!key) throw Error('Your session has ended. Sign in to view notifications.');
      headers.set('Authorization', 'Bearer ' + key);
    }
    const res = await fetch(base + path, {
      ...options, credentials: 'same-origin', headers, cache: 'no-store'
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
  function navigate(item) {
    const link = String(item.actionUrl || '');
    if (!/^\/(?:portal|student-portal|parent-portal)\.html(?:#[A-Za-z0-9_-]+)?$/.test(link)) return;
    const target = new URL(link, location.origin);
    if (target.pathname === location.pathname) {
      const view = target.hash.slice(1);
      const nav = view && (document.querySelector('[data-view="' + view + '"]') ||
        ({guardians:document.getElementById('guardianApprovalsNav'),
          specialPrograms:document.getElementById('academicAdminNav'),
          platformSchools:document.querySelector('[data-view="platformSchools"]')})[view]);
      if (nav && !nav.hidden) nav.click();
      else if (view === 'guardians') window.AttendigoGuardian?.openApprovals?.();
    } else location.assign(link);
  }
  let detail = null;
  function showDetails(item) {
    if (!detail) {
      detail = document.createElement('div');
      detail.className = 'universal-detail';
      detail.setAttribute('role', 'dialog');
      detail.setAttribute('aria-modal', 'true');
      detail.setAttribute('aria-label', 'Notification details');
      document.body.append(detail);
      detail.addEventListener('click', e => { if (e.target === detail) detail.hidden = true; });
    }
    const card = text('section', 'universal-detail-card', '');
    const heading = text('h2', null, item.title);
    const message = text('p', null, item.body);
    const when = text('small', null, fmt(item.updatedAt || item.createdAt));
    card.append(heading, message);
    if (item.status) card.append(text('p', 'universal-detail-status', 'Status: ' + item.status.replace(/_/g, ' ')));
    if (item.requestId) card.append(text('p', 'universal-detail-ref', 'Request reference: ' + item.requestId));
    card.append(when);
    const actions = text('div', 'universal-detail-actions', '');
    const closeButton = text('button', null, 'Close');
    closeButton.type = 'button';
    closeButton.addEventListener('click', () => { detail.hidden = true; bell.focus(); });
    actions.append(closeButton);
    if (item.actionUrl && /^\/(?:portal|student-portal|parent-portal)\.html(?:#[A-Za-z0-9_-]+)?$/.test(item.actionUrl)) {
      const goto = text('button', 'primary', 'Open related module');
      goto.type = 'button';
      goto.addEventListener('click', () => { detail.hidden = true; navigate(item); });
      actions.append(goto);
    }
    const removeButton = text('button', 'universal-detail-delete', 'Delete');
    removeButton.type = 'button';
    removeButton.addEventListener('click', async () => {
      if (await deleteOne(item, removeButton)) { detail.hidden = true; bell.focus(); }
    });
    actions.append(removeButton);
    card.append(actions);
    detail.replaceChildren(card);
    detail.hidden = false;
    closeButton.focus();
  }
  async function openItem(item) {
    if (!item.readAt) {
      try { await api('/' + encodeURIComponent(item.notificationId) + '/read', {method: 'PATCH'}); }
      catch { /* Preserve notification content during a temporary outage. */ }
    }
    closePanel();
    if (modal) modal.hidden = true;
    showDetails(item);
    await refresh(false).catch(() => {});
  }
  function actionStatus(message) {
    const dest = modal && !modal.hidden ? modalStatus : panelStatus;
    if (dest) dest.textContent = message;
  }
  async function deleteOne(item, control) {
    if (removing) return false;
    if (!window.confirm('Delete this notification? This does not remove any related school records or decisions.')) return false;
    removing = true;
    if (control) control.disabled = true;
    try {
      await api('/' + encodeURIComponent(item.notificationId) , { method: 'DELETE' });
      await refresh(false);
      actionStatus('Notification deleted.');
      return true;
    } catch (error) {
      actionStatus(error.message);
      return false;
    } finally {
      removing = false;
      if (control) control.disabled = false;
    }
  }
  async function deleteRead() {
    if (removing) return;
    if (!window.confirm('Delete all READ notifications from your inbox? Unread messages will be kept.')) return;
    removing = true;
    try {
      const result = await api('/delete-read', { method: 'POST' });
      await refresh(false);
      actionStatus(result.deleted ? result.deleted + ' read notification(s) deleted.' : 'No read notifications to delete.');
    } catch (error) {
      actionStatus(error.message);
    } finally { removing = false; }
  }
  function makeItem(item) {
    const row = document.createElement('div');
    row.className = 'universal-notice-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'universal-notice' + (!item.readAt ? ' is-unread' : '');
    const glyph = item.status === 'APPROVED' ? '✓' : item.status === 'REJECTED' ? '!' :
      item.category === 'SYSTEM' ? '⚙' : item.category === 'APPROVAL' ? '⌛' : '●';
    button.append(text('span', 'universal-notice-icon', glyph));
    const content = text('span', 'universal-notice-content', '');
    content.append(text('strong', null, item.title), text('small', null, item.body));
    if (item.requestId) content.append(text('small', 'universal-request-reference', 'Request ' + item.requestId));
    if (item.status) content.append(text('small', 'universal-request-status', item.status.replace(/_/g, ' ')));
    content.append(text('time', null, fmt(item.updatedAt || item.createdAt)));
    button.append(content);
    button.addEventListener('click', () => openItem(item));
    const removeButton = text('button', 'universal-delete', '✕');
    removeButton.type = 'button';
    removeButton.title = 'Delete notification';
    removeButton.setAttribute('aria-label', 'Delete notification: ' + item.title);
    removeButton.addEventListener('click', () => deleteOne(item, removeButton));
    row.append(button, removeButton);
    return row;
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
  shell.querySelector('.universal-delete-read').addEventListener('click', deleteRead);
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
      '<button type="button" class="universal-delete-read-center">Delete read</button>' +
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
    modal.querySelector('.universal-delete-read-center').addEventListener('click', deleteRead);
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
    if (e.key === 'Escape') { if (detail && !detail.hidden) { detail.hidden = true; bell.focus(); } else if (modal && !modal.hidden) closeCenter(); else closePanel(); }
  });
  document.addEventListener('attendigo:requests-changed', () => refresh(false));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(false); });
  window.addEventListener('focus', () => refresh(false));
  setInterval(() => { if (!document.hidden) refresh(false); }, 45000);
  refresh(false);
})();
