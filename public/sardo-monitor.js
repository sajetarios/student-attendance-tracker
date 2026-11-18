window.attendigoStaffIdentity.then(user => {
  'use strict';
  const card = document.getElementById('sardoCard');
  if (!card) return;

  if (!['SCHOOL_ADMIN', 'DEPARTMENT_HEAD'].includes(user.role)) return;

  const el = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let items = [], loading = false;
  const statusLabel = { OPEN: 'Needs action', CONTACTED: 'Contacted', MONITORING: 'Monitoring', RESOLVED: 'Resolved' };
  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, cache: 'no-store',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not load SARDO records.');
    return data;
  }
  function renderList() {
    const query = (el('sardoSearch')?.value || '').trim().toLowerCase();
    const showResolved = Boolean(el('sardoShowResolved')?.checked);
    const visible = items.filter(item => (showResolved || item.state !== 'RESOLVED')
      && [item.fullName,item.studentId,item.gradeLevel,item.section].some(value =>
        String(value || '').toLowerCase().includes(query)));
    const container = el('sardoRows');
    if (!container) return;
    container.innerHTML = visible.length ? visible.map(item => {
      const label = statusLabel[item.state] || statusLabel.OPEN;
      return `<article class="sardo-learner">
        <div class="sardo-learner-top">
          <div><strong>${escape(item.fullName)}</strong><span>${escape(item.gradeLevel)} · ${escape(item.section)} · ${escape(item.studentId)}</span></div>
          <span class="sardo-case-state" data-state="${escape(item.state)}">${escape(label)}</span>
        </div>
        <div class="sardo-learner-meta">
          <b>${Number(item.consecutiveDays)} consecutive school days</b>
          <span>${escape(item.streakStart)} to ${escape(item.streakEnd)}</span>
        </div>
        ${item.note ? `<p class="sardo-case-note">${escape(item.note)}</p>` : ''}
        <div class="sardo-learner-actions">
          <button type="button" class="outline-button" data-sardo-action="review" data-sardo-id="${escape(item.studentId)}">Review SF2</button>
          ${item.state !== 'RESOLVED'
            ? `<button type="button" class="outline-button" data-sardo-action="contact" data-sardo-id="${escape(item.studentId)}">Record follow-up</button>
               <button type="button" class="outline-button" data-sardo-action="resolve" data-sardo-id="${escape(item.studentId)}">Resolve</button>`
            : `<button type="button" class="outline-button" data-sardo-action="reopen" data-sardo-id="${escape(item.studentId)}">Reopen case</button>`}
        </div>
      </article>`;
    }).join('') : `<div class="sardo-blank">${items.length
      ? 'No matching cases in this filter.' : 'No confirmed SARDO cases in the monitoring window.'}</div>`;
  }
  async function refresh() {
    if (loading || card.hidden) return;
    loading = true;
    const refreshButton = el('sardoRefresh');
    if (refreshButton) refreshButton.disabled = true;
    try {
      const data = await api('/api/sardo');
      items = data.alerts || [];
      const flagged = Number(data.openAlerts || 0);
      el('sardoStatus').textContent = flagged ? flagged + ' needs follow-up' : 'Monitoring active';
      el('sardoStatus').dataset.state = flagged ? 'alert' : 'ok';
      el('sardoOpenCount').textContent = String(flagged);
      el('sardoResolvedCount').textContent = String(data.resolvedAlerts || 0);
      el('sardoConflictCount').textContent = String(data.conflictingDays || 0);
      const note = data.message + (data.throughDate
        ? ' · Last completed school day: ' + data.throughDate : '');
      el('sardoMessage').textContent = note;
      el('sardoMessage').hidden = false;
      renderList();
    } catch (error) {
      el('sardoStatus').textContent = 'Check connection';
      el('sardoStatus').dataset.state = 'error';
      el('sardoMessage').textContent = error.message;
      el('sardoMessage').hidden = false;
      el('sardoRows').textContent = 'Monitoring data is unavailable. Existing SF2 attendance remains unchanged.';
    } finally {
      loading = false;
      if (refreshButton) refreshButton.disabled = false;
    }
  }
  card.addEventListener('click', async event => {
    const button = event.target.closest('[data-sardo-action]');
    if (!button) return;
    const item = items.find(row => row.studentId === button.dataset.sardoId);
    if (!item) return;
    if (button.dataset.sardoAction === 'review') {
      const nav = document.querySelector('.nav-item[data-view="sf2"]');
      if (nav && !nav.hidden) {
        nav.click();
        const feedback = document.getElementById('sf2Feedback');
        if (feedback) feedback.textContent = 'For SARDO review, select ' +
          item.gradeLevel + ' – ' + item.section + ' and ' + item.streakEnd.slice(0,7) +
          '. Absence corrections belong to the assigned Class Adviser.';
      }
      return;
    }
    const action = button.dataset.sardoAction;
    const state = action === 'resolve' ? 'RESOLVED' : action === 'reopen' ? 'OPEN' : 'CONTACTED';
    const title = action === 'resolve' ? 'Resolve SARDO case'
      : action === 'reopen' ? 'Reopen SARDO case' : 'Record SARDO follow-up';
    const promptText = action === 'resolve'
      ? 'Explain the completed intervention. Resolving a case does not change attendance records.'
      : action === 'reopen'
        ? 'Add an optional note explaining why this case needs further follow-up.'
        : 'Record the contact made or action planned. Do not include sensitive medical details.';
    const note = await window.AppDialog?.prompt(promptText, '', {
      title, label: 'Follow-up note', required: state !== 'OPEN',
      placeholder: 'Enter the contact or intervention summary', 
      validate: value => state === 'OPEN' || String(value || '').trim()
        ? (String(value || '').length <= 1000 ? true : 'Limit notes to 1000 characters.')
        : 'A follow-up note is required.'
    });
    if (note == null) return;
    button.disabled = true;
    try {
      await api('/api/sardo/followup', { method: 'POST',
        body: JSON.stringify({ studentId: item.studentId, streakStart: item.streakStart,
          state, note: String(note).trim() }) });
      await refresh();
    } catch (error) {
      el('sardoMessage').textContent = error.message;
      el('sardoMessage').hidden = false;
    } finally { button.disabled = false; }
  });
  el('sardoRefresh')?.addEventListener('click', refresh);
  el('sardoSearch')?.addEventListener('input', renderList);
  el('sardoShowResolved')?.addEventListener('change', renderList);
  window.AttendigoSardo = { refresh };
});
