/* Attendigo typed device outbox: QR scans, manual corrections, and register sign-offs.
 * Legacy scanner records are retained. New payloads are AES-GCM encrypted at rest
 * with a per-account, non-extractable device key. Do not store bearer tokens here. */
(() => {
  'use strict';
  const DB = 'attendigo-device-attendance-v1';
  const STORE = 'events', KEYS = 'keys';
  const userKey = 'schoolAttendance.user', tokenKey = 'schoolAttendance.accessToken';
  const TYPES = new Set(['QR_SCAN', 'MANUAL_MARKS', 'REGISTER_SIGNOFF']);
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  const owner = () => {
    try {
      const u = JSON.parse(sessionStorage.getItem(userKey) || '{}');
      return u.schoolId && u.userId ? String(u.schoolId) + ':' + String(u.userId) : null;
    } catch { return null; }
  };
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      const store = db.objectStoreNames.contains(STORE) ? req.transaction.objectStore(STORE)
        : db.createObjectStore(STORE, { keyPath: 'id' });
      if (!store.indexNames.contains('owner')) store.createIndex('owner', 'owner', { unique: false });
      if (!db.objectStoreNames.contains(KEYS)) db.createObjectStore(KEYS, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  async function transaction(storeName, mode, action) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode), store = tx.objectStore(storeName);
        let value;
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || Error('Offline storage aborted'));
        try { action(store, result => { value = result; }); }
        catch (e) { tx.abort(); reject(e); }
      });
    } finally { db.close(); }
  }
  const put = record => transaction(STORE, 'readwrite', store => store.put(record));
  const remove = id => transaction(STORE, 'readwrite', store => store.delete(id));
  async function rows() {
    const id = owner();
    if (!id) return [];
    return transaction(STORE, 'readonly', (store, done) => {
      const req = store.index('owner').getAll(id);
      req.onsuccess = () => done(req.result || []);
    });
  }
  const getStoredKey = id => transaction(KEYS, 'readonly', (store, done) => {
    const req = store.get(id);
    req.onsuccess = () => done(req.result?.key || null);
  });
  const keyCreations = new Map();
  async function deviceKey(id) {
    const saved = await getStoredKey(id);
    if (saved) return saved;
    // Concurrency across tabs is resolved by add()'s unique key constraint.
    if (!keyCreations.has(id)) keyCreations.set(id, (async () => {
      const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt','decrypt']);
      try { await transaction(KEYS, 'readwrite', store => store.add({ id, key: candidate })); return candidate; }
      catch (error) {
        const winner = await getStoredKey(id);
        if (winner) return winner;
        throw error;
      }
    })().finally(() => { keyCreations.delete(id); }));
    return keyCreations.get(id);
  }
  async function encrypt(id, payload) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({
      name: 'AES-GCM', iv, additionalData: encoder.encode(id)
    }, await deviceKey(id), encoder.encode(JSON.stringify(payload)));
    return { iv: Array.from(iv), ciphertext: Array.from(new Uint8Array(ciphertext)) };
  }
  async function decrypt(record) {
    if (record.event && !record.encrypted) return record.event; // Existing scanner queue.
    if (!record.encrypted) throw Error('Missing encrypted attendance payload.');
    const id = record.owner, key = await getStoredKey(id);
    if (!key) throw Error('Device encryption key is unavailable; preserve this record for recovery.');
    const plaintext = await crypto.subtle.decrypt({
      name: 'AES-GCM', iv: new Uint8Array(record.encrypted.iv), additionalData: encoder.encode(id)
    }, key, new Uint8Array(record.encrypted.ciphertext));
    return JSON.parse(decoder.decode(plaintext));
  }
  async function emit() {
    const pending = await rows().catch(() => []);
    const review = pending.filter(record => record.status === 'REVIEW').length;
    const el = document.getElementById('attendigoOfflineStatus');
    if (el) {
      el.hidden = pending.length === 0;
      el.style.display = pending.length ? '' : 'none';
      el.textContent = pending.length
        ? pending.length + ' on device' + (review ? ' · ' + review + ' need review' : ' · waiting to sync')
        : 'Device queue clear';
      el.title = pending.length ? 'Device attendance is not fully synchronized. Open to review details.'
        : 'No pending device attendance for this signed-in account.';
    }
    window.dispatchEvent(new CustomEvent('attendigo-offline-status', {
      detail: { pending: pending.length, needsReview: review }
    }));
  }
  async function enqueueOperation({ type, operationId, payload }) {
    const id = owner();
    if (!id) throw Error('Sign in as the correct school user before queuing attendance.');
    if (!TYPES.has(type) || typeof operationId !== 'string' || !operationId || !payload || typeof payload !== 'object') {
      throw Error('Invalid attendance synchronization operation.');
    }
    const current = await rows();
    const found = current.find(row => row.id === operationId);
    if (found) {
      const existing = await decrypt(found);
      if ((found.type || 'QR_SCAN') !== type || JSON.stringify(existing) !== JSON.stringify(payload)) {
        throw Error('Operation ID was reused for different attendance data.');
      }
      return { operationId, status: found.status };
    }
    // Avoid duplicate sign-off or manual batch operations when the user taps
    // Sync repeatedly during a connection outage. A changed payload gets a
    // new UUID and is never substituted into an already-sent request.
    for (const queued of current) {
      if (queued.type !== type || queued.status !== 'PENDING') continue;
      try {
        if (JSON.stringify(await decrypt(queued)) === JSON.stringify(payload)) {
          return { operationId: queued.id, status: queued.status };
        }
      } catch {} // Unreadable records remain on device for review.
    }
    const encrypted = await encrypt(id, payload);
    const createdAt = Math.max(Date.now(), ...current.map(r => Number(r.createdAt) || 0), 0) + 1;
    await put({ id: operationId, owner: id, type, encrypted, status: 'PENDING',
      attempts: 0, createdAt });
    await emit();
    return { operationId, status: 'PENDING' };
  }
  let syncing = false;
  async function sync() {
    const id = owner(), token = sessionStorage.getItem(tokenKey);
    const confirmations = {};
    if (syncing || !navigator.onLine || !id || !token) return { confirmations };
    syncing = true;
    try {
      const records = (await rows())
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).slice(0, 50);
      for (const record of records) {
        // A conflict is a barrier: never sign off while an earlier correction
        // or QR scan remains unresolved on this device.
        if (record.status === 'REVIEW') break;
        if (record.status !== 'PENDING') continue;
        if (record.owner !== owner() || token !== sessionStorage.getItem(tokenKey)) break;
        let payload;
        try { payload = await decrypt(record); }
        catch (error) {
          await put({ ...record, status: 'REVIEW', reason: String(error.message).slice(0, 250) });
          continue;
        }
        const type = record.type || 'QR_SCAN';
        const endpoint = type === 'QR_SCAN' ? '/api/sync/events'
          : type === 'MANUAL_MARKS' ? '/api/manual-attendance/sync'
          : '/api/manual-attendance/finalization';
        const body = type === 'QR_SCAN' ? { events: [payload] }
          : type === 'REGISTER_SIGNOFF' ? { ...payload, operationId: record.id } : payload;
        try {
          const response = await fetch(endpoint, {
            method: 'POST', cache: 'no-store',
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          if (response.status === 401 || response.status === 403) break;
          const data = await response.json().catch(() => ({}));
          const item = type === 'QR_SCAN' ? data.results?.[0] : null;
          let acknowledged = response.ok && (
            type === 'QR_SCAN' ? ['ACCEPTED', 'ALREADY_SYNCED', 'DUPLICATE'].includes(item?.status) :
            type === 'MANUAL_MARKS' ? data.saved === payload.marks?.length :
            data.finalized === (payload.action === 'FINALIZE')
          );
          if (acknowledged && type === 'MANUAL_MARKS') {
            // Ack only when the authoritative register confirms all statuses AND notes.
            const query = new URLSearchParams({periodId: payload.periodId, date: payload.date});
            const verified = await fetch('/api/manual-attendance?' + query, {
              cache: 'no-store', headers: { Authorization: 'Bearer ' + token }
            });
            if (verified.status === 401 || verified.status === 403) break;
            if (!verified.ok) break;
            const remote = await verified.json();
            const marks = new Map((remote.marks || []).map(m => [m.studentId, m]));
            acknowledged = payload.marks.every(m => marks.get(m.studentId)?.status === m.status &&
              (marks.get(m.studentId)?.note || '') === (m.note || ''));
          }
          if (acknowledged) {
            await remove(record.id);
            confirmations[record.id] = { status: type === 'QR_SCAN' ? item.status : 'ACCEPTED',
              result: type === 'QR_SCAN' ? data : data };
          } else if (response.ok && type === 'QR_SCAN' && item?.status === 'REJECTED') {
            await put({ ...record, status: 'REVIEW', reason: String(item.reason || 'Scan rejected by server').slice(0, 250) });
          } else if (response.status === 409 || (response.status >= 400 && response.status < 500)) {
            await put({ ...record, status: 'REVIEW', reason: String(data.error || item?.reason || 'Server requires review').slice(0, 250) });
          } else if (!response.ok) {
            break; // Keep queued for retry after temporary server failure.
          } else {
            break; // Incomplete or unverifiable acknowledgment: never discard.
          }
        } catch { break; } // Network failure: preserve the queued payload.
      }
    } finally { syncing = false; await emit(); }
    return { confirmations };
  }
  async function record(event, _api) {
    if (!event || !event.eventId) throw Error('Invalid attendance event.');
    await enqueueOperation({type: 'QR_SCAN', operationId: event.eventId, payload: event});
    const result = await sync();
    const confirmation = result.confirmations[event.eventId];
    if (confirmation) return {status:'SYNCED',result:confirmation.result};
    const record = (await rows()).find(r => r.id === event.eventId);
    if (record?.status === 'REVIEW') throw Error(record.reason || 'Attendance needs review; record retained on device.');
    return {status:'PENDING'};
  }
  function describe(record) {
    const type = record.type || 'QR_SCAN';
    return (type === 'QR_SCAN' ? 'QR scan' : type === 'MANUAL_MARKS' ? 'Manual attendance' : 'Register sign-off') +
      ': ' + (record.status === 'REVIEW' ? 'Needs review' : 'Waiting to sync');
  }
  async function showQueue() {
    await sync();
    const list = (await rows()).sort((a,b) => (a.createdAt||0)-(b.createdAt||0));
    if (!list.length) {
      if (window.AppDialog?.alert) await window.AppDialog.alert('All queued attendance is synchronized.', {title:'Device attendance queue'});
      else window.alert('All queued attendance is synchronized.');
      return;
    }
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Attendance synchronization queue');
    dialog.style.cssText = 'border:1px solid #8193aa;border-radius:16px;padding:22px;max-width:min(94vw,520px);max-height:85vh;overflow:auto;background:Canvas;color:CanvasText;box-shadow:0 12px 40px #0005';
    const title = document.createElement('h2');
    title.textContent = 'Device attendance queue'; title.style.margin = '0 0 6px';
    const hint = document.createElement('p');
    hint.textContent = 'Records stay on this device until the school server confirms them. Resolve earlier conflicts before sending later records.';
    const entries = document.createElement('div');
    for (const record of list.slice(0, 30)) {
      const line = document.createElement('section');
      line.style.cssText = 'padding:12px 0;border-bottom:1px solid #8193aa55';
      const label = document.createElement('strong');
      label.textContent = describe(record);
      const reason = document.createElement('p');
      reason.textContent = record.reason || 'Stored securely on this device.';
      reason.style.margin = '6px 0'; line.append(label, reason);
      if (record.status === 'REVIEW') {
        const retry = document.createElement('button');
        retry.type = 'button'; retry.textContent = 'Retry after review';
        retry.style.cssText = 'border:1px solid currentColor;border-radius:9px;padding:9px 12px;background:Canvas;color:CanvasText;cursor:pointer';
        retry.addEventListener('click', async () => {
          const msg = 'Only retry after reviewing the original record and resolving any finalized-register or attendance conflicts. Keep the device record if unsure.';
          const accept = window.AppDialog?.confirm
            ? await window.AppDialog.confirm(msg, {title:'Retry attendance sync',confirmText:'Retry'})
            : window.confirm(msg);
          if (!accept) return;
          retry.disabled = true;
          await put({ ...record, status:'PENDING', reason:null });
          dialog.close(); dialog.remove(); await emit(); await sync(); await showQueue();
        });
        line.append(retry);
      }
      entries.append(line);
    }
    const close = document.createElement('button');
    close.type='button'; close.textContent='Close';
    close.style.cssText='margin-top:16px;border:1px solid currentColor;border-radius:9px;padding:9px 16px;background:Canvas;color:CanvasText;cursor:pointer';
    close.addEventListener('click', () => dialog.close());
    dialog.append(title, hint, entries, close);
    dialog.addEventListener('close', () => dialog.remove(), {once:true});
    document.body.append(dialog);
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open','');
  }
  function init() {
    if (!document.body || document.getElementById('attendigoOfflineStatus')) return;
    const status = document.createElement('button');
    status.id = 'attendigoOfflineStatus';
    status.type = 'button';
    status.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:9000;border:1px solid currentColor;border-radius:18px;padding:8px 12px;background:Canvas;color:CanvasText;font:600 12px system-ui;box-shadow:0 3px 14px #0002;max-width:70vw';
    status.addEventListener('click', showQueue);
    document.body.append(status);
    emit();
    window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
    setInterval(sync, 30000);
    sync();
  }
  window.AttendigoOffline = { record, enqueueOperation, sync, pending: rows };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
