/* Attendigo Attendance Sync Center: a shared, read-only view of the
 * authenticated device queue and (School Admin only) school cloud outbox.
 * Revisions, sign-offs, and QR conflicts are ALWAYS resolved by the server. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const tokenKey = 'schoolAttendance.accessToken';
  const userKey = 'schoolAttendance.user';
  const typeNames = { QR_SCAN: 'QR scan', MANUAL_MARKS: 'Manual correction', REGISTER_SIGNOFF: 'Register sign-off' };
  const statusNames = { PENDING: 'Waiting to sync', REVIEW: 'Needs review' };
  const role = () => {
    try { return JSON.parse(sessionStorage.getItem(userKey) || '{}'); }
    catch { return {}; }
  };
  const time = value => {
    if (!value || !Number.isFinite(new Date(value).getTime())) return 'Not yet confirmed';
    return new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short'
    }).format(new Date(value));
  };
  const api = async (path, options = {}) => {
    const bearer = sessionStorage.getItem(tokenKey);
    if (!bearer) throw Error('Sign in to check the school server.');
    const response = await fetch(path, {
      ...options, cache: 'no-store', headers: {
        'Authorization': 'Bearer ' + bearer,
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || 'School server returned ' + response.status);
    return data;
  };
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const button = (name, className, action) => {
    const node = element('button', className, name);
    node.type = 'button';
    if (action) node.addEventListener('click', action);
    return node;
  };

  let dialog, lastCloud = null, lastSummary = null, refreshing = false;
  let statusMessage = '';
  const getQueue = () => window.AttendigoOffline;
  const connected = () => Boolean(navigator.onLine);
  const isAdmin = () => role().role === 'SCHOOL_ADMIN';

  function setup() {
    if (dialog || !document.body || !getQueue()) return;
    const trigger = button('☁  Attendance sync', 'asc-dock', open);
    trigger.id = 'ascDock';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-controls', 'attendanceSyncDialog');
    const dot = element('span', 'asc-dock-dot');
    dot.setAttribute('aria-hidden', 'true');
    trigger.prepend(dot);
    document.body.append(trigger);

    dialog = document.createElement('dialog');
    dialog.id = 'attendanceSyncDialog';
    dialog.className = 'asc-dialog';
    dialog.setAttribute('aria-labelledby', 'ascTitle');
    dialog.innerHTML =
      '<div class="asc-shell">' +
        '<header class="asc-header">' +
          '<div><p class="asc-eyebrow">ATTENDIGO · ATTENDANCE</p>' +
            '<h2 id="ascTitle">Attendance Sync Center</h2>' +
            '<p class="asc-lead">Track this device separately from the school cloud.</p></div>' +
          '<button class="asc-icon-button" type="button" id="ascClose" aria-label="Close Sync Center">×</button>' +
        '</header>' +
        '<div class="asc-banner" id="ascNetwork" role="status"></div>' +
        '<div class="asc-metrics" id="ascMetrics" aria-live="polite"></div>' +
        '<div class="asc-actions">' +
          '<button class="asc-primary" type="button" id="ascSyncNow">↻  Sync this device</button>' +
          '<button class="asc-secondary" type="button" id="ascRefresh">Refresh status</button>' +
        '</div>' +
        '<p class="asc-timestamp" id="ascLastConfirmed"></p>' +
        '<div class="asc-section-head"><div><h3>This device</h3>' +
          '<p>Unsent work belongs to the currently signed-in account only.</p></div>' +
          '<span class="asc-count" id="ascQueueCount">0 items</span></div>' +
        '<div id="ascQueueList" class="asc-queue" aria-live="polite"></div>' +
        '<section id="ascCloudSection" class="asc-cloud" hidden>' +
          '<div class="asc-section-head"><div><h3>School cloud replication</h3>' +
             '<p>School-wide view · School Administrator only</p></div>' +
             '<span class="asc-cloud-state" id="ascCloudState">Checking</span></div>' +
          '<div class="asc-cloud-metrics" id="ascCloudMetrics"></div>' +
          '<div id="ascCloudReview" class="asc-cloud-review"></div>' +
        '</section>' +
        '<p id="ascFeedback" class="asc-feedback" role="status" aria-live="polite"></p>' +
        '<footer class="asc-footer">Device sync confirms the school server accepted a record. ' +
        'It does not guarantee school-to-cloud delivery. Conflicts never overwrite automatically.</footer>' +
      '</div>';
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => { statusMessage = ''; });
    dialog.querySelector('#ascClose').addEventListener('click', () => dialog.close());
    dialog.querySelector('#ascSyncNow').addEventListener('click', async event => {
      event.currentTarget.disabled = true;
      statusMessage = 'Checking records with the school server…';
      await refresh(false);
      try {
        if (!connected()) throw Error('This device is offline. Its queued attendance has been preserved.');
        await getQueue().sync();
        statusMessage = 'Synchronization attempt completed. Pending or conflicting records remain on this device.';
      } catch (error) { statusMessage = error.message; }
      finally { event.currentTarget.disabled = false; await refresh(true); }
    });
    dialog.querySelector('#ascRefresh').addEventListener('click', () => refresh(true));
    document.body.append(dialog);

    const dashboard = $('dashboardView');
    if (dashboard && !dashboard.querySelector('#ascDashboardCard')) {
      const card = element('section', 'asc-dashboard-card');
      card.id = 'ascDashboardCard';
      card.innerHTML = '<div class="asc-dashboard-orb" aria-hidden="true">☁</div>' +
        '<div class="asc-dashboard-copy"><strong>Attendance Sync Center</strong>' +
        '<p id="ascDashboardDescription">Checking this device…</p></div>';
      card.append(button('View sync status', 'asc-dashboard-open', open));
      dashboard.prepend(card);
    }
    const folioButton = $('mfOpenSyncCenter');
    if (folioButton) folioButton.addEventListener('click', open);
    window.addEventListener('attendigo-offline-status', event => updateSummary(event.detail));
    window.addEventListener('online', refreshIfOpen);
    window.addEventListener('offline', refreshIfOpen);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshIfOpen(); });
    refresh(false);
  }

  const pendingLabel = summary => summary.pending ? summary.pending + ' on device' : 'No queued operations';
  function updateSummary(summary) {
    lastSummary = summary;
    const trigger = $('ascDock');
    if (!trigger) return;
    const review = Number(summary.needsReview || 0);
    const waiting = Number(summary.waiting || 0);
    trigger.dataset.state = review ? 'review' : waiting ? 'waiting' : connected() ? 'ready' : 'offline';
    trigger.textContent = '☁  ' + (review ? review + ' need review' :
      waiting ? waiting + ' waiting to sync' : connected() ? 'Attendance sync' : 'Offline · Sync Center');
    const dot = element('span', 'asc-dock-dot');
    dot.setAttribute('aria-hidden', 'true');
    trigger.prepend(dot);
    trigger.title = 'Open Attendance Sync Center. ' + (review ? 'Resolve device conflicts.' : pendingLabel(summary));
    const dashboardDescription = $('ascDashboardDescription');
    if (dashboardDescription) dashboardDescription.textContent =
      (review ? review + ' records need review · ' : '') +
      (waiting ? waiting + ' waiting to sync' : 'No operations waiting on this device') +
      (isAdmin() ? ' · School cloud status available' : '');
    if (dialog && dialog.open) void renderSummary(summary);
  }

  async function renderSummary(summary) {
    if (!dialog) return;
    const network = $('ascNetwork');
    network.dataset.state = connected() ? 'online' : 'offline';
    network.textContent = connected()
      ? '● Network available · Checking school records still requires server confirmation'
      : '● Offline · Records stay encrypted on this device until connectivity returns';
    const metrics = $('ascMetrics');
    metrics.replaceChildren();
    const items = [
      ['Saved on device', summary.pending, 'local'],
      ['Waiting to sync', summary.waiting, 'waiting'],
      ['Needs review', summary.needsReview, 'review'],
      ['Last school acceptance', summary.lastConfirmedAt ? time(summary.lastConfirmedAt) : '—', 'confirmed']
    ];
    for (const [label, value, style] of items) {
      const tile = element('div', 'asc-metric asc-metric-' + style);
      tile.append(element('span', 'asc-metric-label', label));
      tile.append(element('strong', 'asc-metric-value', value));
      metrics.append(tile);
    }
    $('ascQueueCount').textContent = summary.pending + (summary.pending === 1 ? ' item' : ' items');
    $('ascLastConfirmed').textContent = summary.lastConfirmedAt
      ? 'Most recent school-server acceptance on this device: ' + time(summary.lastConfirmedAt)
      : 'No school-server acceptance confirmed during this page visit.';
    $('ascSyncNow').disabled = !connected() || !sessionStorage.getItem(tokenKey) || Boolean(summary.syncing);
    $('ascFeedback').textContent = statusMessage;
    const list = $('ascQueueList');
    list.replaceChildren();
    let records = [];
    try { records = await getQueue().pending(); }
    catch (error) { list.append(element('p', 'asc-empty', 'Device queue unavailable: ' + error.message)); return; }
    records.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    if (!records.length) {
      list.append(element('p', 'asc-empty',
        'No queued operations for this account. Any unsent attendance draft remains in its original sheet until submitted.'));
    }
    for (const entry of records.slice(0, 60)) {
      const line = element('article', 'asc-operation');
      line.dataset.state = entry.status === 'REVIEW' ? 'review' : 'waiting';
      const copy = element('div', 'asc-operation-copy');
      copy.append(element('strong', null, typeNames[entry.type || 'QR_SCAN'] || 'Attendance operation'));
      copy.append(element('small', null, (statusNames[entry.status] || 'On device') +
        ' · ' + time(entry.createdAt)));
      if (entry.reason) copy.append(element('p', 'asc-operation-reason', entry.reason));
      line.append(copy);
      line.append(button(entry.status === 'REVIEW' ? 'Review conflict' : 'Details',
        'asc-secondary asc-review-button', () => inspectOperation(entry.id)));
      list.append(line);
    }
    if (records.length > 60) list.append(element('p', 'asc-empty',
      (records.length - 60) + ' more device operations are safely retained.'));
  }

  async function refresh(includeCloud = true) {
    if (refreshing || !dialog) return;
    refreshing = true;
    try {
      const summary = await getQueue().snapshot();
      updateSummary(summary);
      if (dialog.open) {
        await renderSummary(summary);
        $('ascCloudSection').hidden = !isAdmin();
        if (isAdmin() && includeCloud) await loadCloud();
      }
    } catch (error) {
      if (dialog && dialog.open) $('ascFeedback').textContent = 'Unable to read device queue: ' + error.message;
    } finally { refreshing = false; }
  }
  function refreshIfOpen() { if (dialog && dialog.open) void refresh(true); else void refresh(false); }
  async function open() {
    if (!dialog) setup();
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    await refresh(true);
  }

  async function loadCloud() {
    if (!isAdmin() || !dialog.open) return;
    const cloud = $('ascCloudSection');
    cloud.hidden = false;
    const metrics = $('ascCloudMetrics'), review = $('ascCloudReview'), state = $('ascCloudState');
    metrics.replaceChildren(); review.replaceChildren();
    try {
      lastCloud = await api('/api/cloud-sync/status');
      state.textContent = lastCloud.enabled
        ? (lastCloud.connectionStatus === 'CONNECTED' ? 'Configured · last contact available' : 'Configured · not verified')
        : 'Forwarding disabled';
      state.dataset.state = lastCloud.enabled ? 'enabled' : 'disabled';
      for (const [label, value] of [
        ['Waiting for cloud', lastCloud.pendingCount || 0],
        ['Needs administrator review', lastCloud.needsReviewCount || 0],
        ['Last cloud success', lastCloud.lastSuccessAt ? time(lastCloud.lastSuccessAt) : 'Not confirmed']
      ]) {
        const stat = element('div', 'asc-cloud-stat');
        stat.append(element('small', null, label), element('strong', null, value));
        metrics.append(stat);
      }
      if (!lastCloud.enabled) {
        review.append(element('p', 'asc-empty', 'Cloud forwarding is disabled. Configure the separate school server and credentials before enabling it.'));
        return;
      }
      const data = await api('/api/cloud-sync/review');
      const records = (data.records || []).slice(0, 30);
      if (!records.length) {
        review.append(element('p', 'asc-empty', 'No cloud operations currently need review. Pending cloud delivery is not the same as a confirmed transfer.'));
      }
      for (const record of records) {
        const item = element('article', 'asc-operation asc-cloud-operation');
        const copy = element('div', 'asc-operation-copy');
        copy.append(element('strong', null, (typeNames[record.type] || 'Cloud record') + ' · Needs review'));
        copy.append(element('small', null, time(record.createdAt)));
        copy.append(element('p', 'asc-operation-reason', record.reason || 'Cloud record requires administrator review.'));
        item.append(copy, button('Review', 'asc-secondary asc-review-button',
          () => showCloudReview(record)));
        review.append(item);
      }
    } catch (error) {
      state.textContent = 'Unable to verify';
      review.append(element('p', 'asc-empty', 'Cloud status could not be confirmed: ' + error.message));
    }
  }

  async function inspectOperation(operationId) {
    let record;
    try { record = await getQueue().inspect(operationId); }
    catch (error) { statusMessage = error.message; await refresh(false); return; }
    const detail = document.createElement('dialog');
    detail.className = 'asc-detail-dialog';
    detail.setAttribute('aria-label', 'Attendance conflict review');
    const head = element('header', 'asc-detail-header');
    head.append(element('div', null));
    head.firstChild.append(
      element('p', 'asc-eyebrow', 'DEVICE RECORD · ' + (statusNames[record.status] || 'Waiting')),
      element('h2', null, typeNames[record.type] || 'Attendance record')
    );
    head.append(button('×', 'asc-icon-button', () => detail.close()));
    const body = element('div', 'asc-detail-body');
    body.append(element('p', 'asc-advisory', record.reason ||
      'This record is preserved on the device. No school record is changed by opening this review.'));
    if (record.type === 'MANUAL_MARKS') await compareManual(record, body);
    else if (record.type === 'REGISTER_SIGNOFF') await compareSignoff(record, body);
    else {
      body.append(element('p', 'asc-support-note',
        'QR scan details are retained on this device. Confirm the learner, school date, and scanned class with an authorized teacher or School Administrator.'));
      body.append(element('p', 'asc-support-note', 'Event: ' + String(record.id).slice(0, 36)));
    }
    const actions = element('div', 'asc-detail-actions');
    actions.append(button('Keep on device', 'asc-secondary', () => detail.close()));
    if (record.status === 'REVIEW') {
      const retry = button('Retry after resolving', 'asc-primary', async () => {
        const prompt = 'Retry this unchanged attendance operation? You must first resolve the school record conflict. The server will still enforce its current revisions, permissions, and register lock.';
        const approved = window.AppDialog?.confirm
          ? await window.AppDialog.confirm(prompt, { title: 'Retry without overwriting', confirmText: 'Retry' })
          : window.confirm(prompt);
        if (!approved) return;
        retry.disabled = true;
        try {
          await getQueue().retryReviewed(record.id);
          statusMessage = 'Retried safely; check whether the school server accepted it or still needs review.';
        } catch (error) { statusMessage = error.message; }
        detail.close();
        await refresh(true);
      });
      retry.disabled = !connected();
      actions.append(retry);
    }
    body.append(actions);
    detail.append(head, body);
    document.body.append(detail);
    detail.addEventListener('close', () => detail.remove(), { once: true });
    detail.showModal();
  }

  async function compareManual(record, body) {
    const payload = record.payload;
    body.append(element('p', 'asc-support-note',
      'Class date ' + (payload.date || 'Unknown') + ' · ' +
      (payload.marks?.length || 0) + ' proposed corrections. Changes are NOT applied by viewing this comparison.'));
    let server = null, failure = '';
    if (!connected()) failure = 'Offline: the school server cannot be compared yet.';
    else {
      try {
        server = await api('/api/manual-attendance?' +
          new URLSearchParams({ periodId: payload.periodId, date: payload.date }));
      } catch (error) { failure = 'School record unavailable: ' + error.message; }
    }
    if (failure) body.append(element('p', 'asc-advisory', failure));
    const remote = new Map((server?.marks || []).map(mark => [mark.studentId, mark]));
    const table = element('div', 'asc-compare');
    table.append(element('div', 'asc-compare-heading',
      'Saved on device                                  School record'));
    const marks = (payload.marks || []).slice(0, 30);
    for (const mark of marks) {
      const current = remote.get(mark.studentId);
      const line = element('div', 'asc-compare-row');
      line.dataset.diff = Boolean(current &&
        (mark.status !== current.status || (mark.note || '') !== (current.note || '')));
      const left = element('div', null);
      left.append(element('small', null, 'Learner ID: ' + mark.studentId),
        element('strong', null, mark.status || '—'),
        element('small', null, mark.note || 'No note'));
      const right = element('div', null);
      right.append(element('small', null, server ? 'School-confirmed' : 'Not available'),
        element('strong', null, server ? (current?.status || 'No manual mark') : 'Not checked'),
        element('small', null, server ? (current?.note || 'No note') : 'Reconnect to compare'));
      line.append(left, right);
      table.append(line);
    }
    body.append(table);
    if (payload.marks?.length > 30)
      body.append(element('p', 'asc-support-note', 'Showing 30 of ' + payload.marks.length + ' saved corrections.'));
    body.append(element('p', 'asc-support-note',
      'If these disagree, verify the original paper register and the school audit trail. Make authorized corrections in the attendance sheet before retrying; this dialog cannot force an overwrite.'));
  }

  async function compareSignoff(record, body) {
    const payload = record.payload;
    body.append(element('p', 'asc-support-note',
      'Requested action: ' + (payload.action || 'Unknown') + ' · Date: ' + (payload.date || 'Unknown')));
    if (!connected()) return body.append(element('p', 'asc-advisory', 'Offline: the register lock cannot be confirmed.'));
    try {
      const remote = await api('/api/manual-attendance?' +
        new URLSearchParams({ periodId: payload.periodId, date: payload.date }));
      body.append(element('p', 'asc-advisory',
        'School register currently: ' + (remote.finalization?.finalized ? 'Finalized' : 'Not finalized') +
        '. Review conflicting marks and pending scans before retrying.'));
    } catch (error) {
      body.append(element('p', 'asc-advisory', 'Register comparison unavailable: ' + error.message));
    }
  }

  async function showCloudReview(record) {
    const msg = (typeNames[record.type] || 'Cloud record') + ' needs review.\n\n' +
      (record.reason || 'Cloud server rejected this operation.') +
      '\n\nResolve the teacher, learner, class schedule, or attendance discrepancy first. ' +
      'Retrying only requeues the original record; it never forces a cloud overwrite.';
    const approved = window.AppDialog?.confirm
      ? await window.AppDialog.confirm(msg, {
        title: 'School cloud conflict', confirmText: 'Retry after resolution'
      }) : window.confirm(msg + '\n\nHave you resolved the conflict?');
    if (!approved) return;
    try {
      await api('/api/cloud-sync/retry', { method: 'POST', body: JSON.stringify({
        type: record.type, operationId: record.operationId
      }) });
      statusMessage = 'Cloud operation requeued; delivery is not yet confirmed.';
    } catch (error) { statusMessage = 'Cloud retry failed: ' + error.message; }
    await refresh(true);
  }

  window.AttendigoSyncCenter = { open, refresh };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
  document.addEventListener('attendigo:portal-ready', setup);
})();
