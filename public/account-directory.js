/* School-scoped account directory; read-only search over existing authorized APIs. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const hub = $('accountDirectoryHub');
  if (!hub) return;
  const search = $('allAccountsSearch');
  const typeFilter = $('allAccountsType');
  const statusFilter = $('allAccountsStatus');
  const status = $('allAccountsStatusText');
  const results = $('allAccountsResults');
  const refreshButton = $('allAccountsRefresh');
  const LIMIT = 100;
  let accounts = [];
  let loaded = false;
  let busy = false;
  let requestNumber = 0;
  const isAdmin = () => {
    try { return JSON.parse(sessionStorage.getItem('schoolAttendance.user') || 'null')?.role === 'SCHOOL_ADMIN'; }
    catch { return false; }
  };
  const data = async url => {
    const token = sessionStorage.getItem('schoolAttendance.accessToken');
    if (!token) throw Error('School session expired. Sign in again.');
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { Authorization: 'Bearer ' + token }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(body.error || 'Cannot read account directory (' + response.status + ')');
    return body;
  };
  function statusFor(item) {
    if (item.type === 'student' && !item.hasAccount) return 'missing';
    return item.active ? 'active' : 'inactive';
  }
  const labelFor = item => item.type === 'student' ? 'Student' : item.type === 'parent' ? 'Parent / Guardian' : 'Teacher / Staff';
  const friendlyStatus = value => value === 'missing' ? 'No login issued' : value === 'active' ? 'Active' : 'Inactive';
  const lower = value => String(value ?? '').toLocaleLowerCase();
  function render() {
    if (!isAdmin()) { results.replaceChildren(); status.textContent = 'Only School Administrators can search school-wide accounts.'; return; }
    if (!loaded) return;
    const q = lower(search.value).trim();
    const kind = typeFilter.value;
    const flag = statusFilter.value;
    const rows = accounts.filter(item =>
      (kind === 'all' || item.type === kind) &&
      (flag === 'all' || statusFor(item) === flag) &&
      (!q || lower([item.name, item.username, item.id, item.detail].join(' ')).includes(q))
    );
    const shown = rows.slice(0, LIMIT);
    const fragment = document.createDocumentFragment();
    for (const item of shown) {
      const row = document.createElement('article');
      row.className = 'user-directory-row';
      const summary = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = item.name || item.username || 'Unnamed account';
      const meta = document.createElement('small');
      meta.textContent = [labelFor(item), item.username || item.id, item.detail].filter(Boolean).join(' · ');
      const chip = document.createElement('span');
      chip.className = 'user-directory-chip ' + statusFor(item);
      chip.textContent = friendlyStatus(statusFor(item));
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'outline-button compact-button';
      open.textContent = 'Open ' + (item.type === 'student' ? 'student account' : item.type === 'parent' ? 'parent management' : 'staff accounts');
      open.addEventListener('click', () => openAccount(item));
      summary.append(name, meta);
      row.append(summary, chip, open);
      fragment.append(row);
    }
    if (!shown.length) {
      const p = document.createElement('p');
      p.className = 'field-hint';
      p.textContent = 'No matching accounts found. Try another name or filter.';
      fragment.append(p);
    }
    results.replaceChildren(fragment);
    status.textContent = rows.length + ' matching school accounts' +
      (rows.length > LIMIT ? ' · showing first ' + LIMIT + '; refine your search' : '') +
      ' · account actions remain in their respective modules.';
  }
  function openAccount(item) {
    if (!isAdmin()) return;
    const target = item.type === 'student' ? $('adminStudentAccountsNav') :
      item.type === 'parent' ? $('parentsNav') :
      hub.closest('#teachersView')?.ownerDocument?.querySelector('#staffNavChildren [data-staff-section="accounts"]');
    if (!target || target.hidden) return;
    target.click();
    if (item.type === 'student') {
      const field = $('sapSearch');
      if (field) {
        field.value = item.id || item.name;
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }
  async function load(force = false) {
    if (!isAdmin() || busy || (loaded && !force)) { if (loaded) render(); return; }
    busy = true;
    const current = ++requestNumber;
    refreshButton.disabled = true;
    status.textContent = 'Loading staff, learner, and parent accounts…';
    const responses = await Promise.allSettled([
      data('/api/admin/security/accounts'),
      data('/api/student-portal/accounts'),
      data('/api/parents')
    ]);
    if (current !== requestNumber) return;
    const errors = [];
    const next = [];
    if (responses[0].status === 'fulfilled') {
      for (const a of responses[0].value.accounts || []) {
        next.push({ type:'staff', id:String(a.userId || ''), name:a.displayName,
          username:a.username, detail:String(a.role || '').replaceAll('_',' '), active:Boolean(a.active) });
      }
    } else errors.push('Staff accounts');
    if (responses[1].status === 'fulfilled') {
      for (const a of responses[1].value.students || []) {
        next.push({ type:'student', id:String(a.studentId || ''), name:a.fullName,
          username:'', detail:[a.gradeLevel,a.section].filter(Boolean).join(' · '),
          active:Boolean(a.accountActive), hasAccount:Boolean(a.hasAccount) });
      }
    } else errors.push('Student accounts');
    if (responses[2].status === 'fulfilled') {
      for (const a of responses[2].value.parents || []) {
        next.push({ type:'parent', id:String(a.userId || ''), name:a.displayName,
          username:a.username, detail:'', active:Boolean(a.active) });
      }
    } else errors.push('Parent accounts');
    accounts = next;
    loaded = true;
    busy = false;
    refreshButton.disabled = false;
    render();
    if (errors.length) status.textContent += ' · Could not load: ' + errors.join(', ') + '. Refresh to retry.';
  }
  for (const control of [search,typeFilter,statusFilter]) {
    control.addEventListener(control === search ? 'input' : 'change', render);
  }
  refreshButton.addEventListener('click', () => load(true));
  document.addEventListener('attendigo:user-directory-open', () => load(true));
})();
