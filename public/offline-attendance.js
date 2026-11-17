/* Attendigo offline event outbox: only student scanner events, never credentials. */
(() => {
  'use strict';
  const DB = 'attendigo-device-attendance-v1';
  const STORE = 'events';
  const userKey = 'schoolAttendance.user';
  const tokenKey = 'schoolAttendance.accessToken';
  const owner = () => {
    try {
      const u = JSON.parse(sessionStorage.getItem(userKey) || '{}');
      return u.schoolId && u.userId ? String(u.schoolId) + ':' + String(u.userId) : null;
    } catch { return null; }
  };
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('owner', 'owner', { unique: false });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  async function transaction(mode, callback) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let result;
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || Error('Offline storage aborted'));
        try { result = callback(store); } catch (e) { tx.abort(); reject(e); }
      });
    } finally { db.close(); }
  }
  async function rows() {
    const id = owner();
    if (!id) return [];
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).index('owner').getAll(id);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } finally { db.close(); }
  }
  async function put(record) { await transaction('readwrite', store => { store.put(record); }); }
  async function remove(id) { await transaction('readwrite', store => { store.delete(id); }); }
  let syncing = false;
  const emit = async () => {
    const pending = await rows().catch(() => []);
    const el = document.getElementById('attendigoOfflineStatus');
    if (el) {
      const needsReview = pending.filter(x => x.status === 'REVIEW').length;
      // Keep the offline sync engine running, but never overlay dashboards when clear.
      el.hidden = pending.length === 0;
      el.style.display = pending.length ? '' : 'none';
      el.textContent = pending.length ? pending.length + ' on device' + (needsReview ? ' · ' + needsReview + ' need review' : ' · awaiting sync') : 'Device queue clear';
      el.title = pending.length ? 'Stored on this device, not yet accepted by the server. Keep this device until synchronized.' : 'No unsynchronized scanner records for this account.';
    }
    window.dispatchEvent(new CustomEvent('attendigo-offline-status', { detail: { pending: pending.length } }));
  };
  function networkFailure(error) {
    return error instanceof TypeError || (typeof navigator.onLine === 'boolean' && !navigator.onLine);
  }
  async function record(event, api) {
    if (!owner()) throw Error('Sign in online before recording offline attendance.');
    if (!event || !event.eventId) throw Error('Invalid attendance event.');
    try {
      const result = await api('/api/sync/events', { method: 'POST', body: JSON.stringify({ events: [event] }) });
      const item = result.results?.[0];
      if (!['ACCEPTED', 'ALREADY_SYNCED'].includes(item?.status)) throw Error(item?.reason || 'Attendance rejected by server.');
      return { status: 'SYNCED', result };
    } catch (error) {
      if (!networkFailure(error)) throw error;
      await put({ id: event.eventId, owner: owner(), event, status: 'PENDING', createdAt: Date.now() });
      await emit();
      return { status: 'PENDING' };
    }
  }
  async function sync() {
    if (syncing || !navigator.onLine || !owner()) return;
    const token = sessionStorage.getItem(tokenKey);
    if (!token) return;
    syncing = true;
    try {
      for (const record of (await rows()).filter(x => x.status === 'PENDING').slice(0, 50)) {
        if (record.owner !== owner() || token !== sessionStorage.getItem(tokenKey)) break;
        try {
          const response = await fetch('/api/sync/events', {
            method: 'POST', cache: 'no-store',
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ events: [record.event] })
          });
          if (response.status === 401 || response.status === 403) break;
          const data = await response.json().catch(() => ({}));
          const status = data.results?.[0]?.status;
          if (response.ok && ['ACCEPTED', 'ALREADY_SYNCED'].includes(status)) {
            await remove(record.id);
          } else if (response.ok && status === 'REJECTED') {
            await put({ ...record, status: 'REVIEW', reason: String(data.results[0]?.reason || 'Server rejected attendance').slice(0, 250) });
          } else if (!response.ok && response.status >= 400 && response.status < 500) {
            await put({ ...record, status: 'REVIEW', reason: String(data.error || 'Server rejected attendance').slice(0, 250) });
          } else break;
        } catch { break; }
      }
    } finally { syncing = false; await emit(); }
  }
  function init() {
    const status = document.createElement('button');
    status.id = 'attendigoOfflineStatus';
    status.type = 'button';
    status.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:9000;border:1px solid currentColor;border-radius:18px;padding:8px 12px;background:Canvas;color:CanvasText;font:600 12px system-ui;box-shadow:0 3px 14px #0002;max-width:70vw';
    status.addEventListener('click', async () => {
      await sync();
      const list = await rows();
      const review = list.filter(x => x.status === 'REVIEW');
      alert(review.length ? review.length + ' record(s) need review. ' + review.map(x => x.reason).slice(0, 3).join('; ') : list.length ? list.length + ' attendance record(s) still stored on this device. Reconnect and tap again to synchronize.' : 'No pending device attendance records.');
    });
    document.body.append(status);
    emit();
    window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
    setInterval(sync, 30000);
    sync();
  }
  window.AttendigoOffline = { record, sync, pending: rows };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
