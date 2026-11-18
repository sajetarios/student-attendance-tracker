(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let selected = null;
  const now = () => Date.now();
  const isActive = session => Boolean(session && !session.closedAt &&
    now() >= Date.parse(session.startsAt) && now() < Date.parse(session.closesAt));
  const isOpen = session => Boolean(session && !session.closedAt && now() < Date.parse(session.closesAt));

  async function api(url, options = {}) {
    const response = await fetch(url, {cache:'no-store', ...options,
      headers: options.body ? {'Content-Type':'application/json'} : {}});
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      location.replace('/portal-login.html');
      throw Error('Your school session has expired.');
    }
    if (!response.ok) throw Error(data.error || 'Could not load attendance monitoring.');
    return data;
  }

  function cell(row, text, strong = false) {
    const td = document.createElement('td');
    if (strong) {
      const node = document.createElement('strong');
      node.textContent = String(text);
      td.append(node);
    } else td.textContent = String(text);
    row.append(td);
    return td;
  }
  function sessionStatus(session) {
    if (!session) return 'No QR session';
    if (session.closedAt) return 'Closed';
    if (isActive(session)) return 'Active';
    if (now() < Date.parse(session.startsAt)) return 'Not started';
    return 'Window ended';
  }
  function displayTime(value) {
    const text = String(value || '');
    if (/^\d{2}:\d{2}/.test(text)) return text.slice(0,5);
    return value ? new Date(value).toLocaleTimeString('en-PH',
      {timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit'}) : '—';
  }
  function addRow(tbody, item, session) {
    const row = document.createElement('tr');
    const title = (item.subjectName || 'Class') + ' · ' +
      String(item.gradeLevel || '') + ' ' + String(item.section || '');
    cell(row, title, true);
    cell(row, displayTime(item.startTime) + ' – ' + displayTime(item.endTime));
    const status = cell(row, sessionStatus(session));
    status.classList.add('status');
    cell(row, session ? session.checkedIn : '—');
    cell(row, session ? (session.present + ' / ' + session.late) : '—');
    const actions = document.createElement('td');
    if (isOpen(session)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = 'Emergency close';
      button.setAttribute('aria-label', 'Emergency close for ' + title);
      button.addEventListener('click', () => {
        selected = {sessionId:session.sessionId, title};
        $('overrideTitle').textContent = 'Emergency close · ' + title;
        $('overrideDetails').textContent = 'This action ends the QR session for ' + title + '.';
        $('overrideReason').value = '';
        $('overridePanel').hidden = false;
        $('overrideReason').focus();
        $('overridePanel').scrollIntoView({block:'nearest',behavior:'smooth'});
      });
      actions.append(button);
    } else actions.textContent = '—';
    row.append(actions);
    tbody.append(row);
  }

  async function refresh() {
    $('refresh').disabled = true;
    $('message').textContent = 'Refreshing class QR activity…';
    try {
      const [schedule,monitor] = await Promise.all([
        api('/api/class-qr/today'),api('/api/class-qr/monitor')
      ]);
      const classes = Array.isArray(schedule.classes) ? schedule.classes : [];
      const sessions = Array.isArray(monitor.sessions) ? monitor.sessions : [];
      const byPeriod = new Map(sessions.map(s => [String(s.periodId),s]));
      const seen = new Set();
      const tbody = $('classRows');
      tbody.replaceChildren();
      for (const item of classes) {
        const key = String(item.periodId);
        seen.add(key);
        addRow(tbody,item,byPeriod.get(key));
      }
      // Keep historical QR check-ins visible if the current timetable changed.
      for (const session of sessions) {
        if (seen.has(String(session.periodId))) continue;
        addRow(tbody,{
          subjectName:session.subjectName,gradeLevel:session.gradeLevel,
          section:session.section,startTime:session.startsAt,endTime:session.closesAt
        },session);
      }
      if (!tbody.children.length) {
        const tr = document.createElement('tr');
        const td = cell(tr,'No scheduled classes or QR sessions for today.');
        td.colSpan = 6;
        td.className = 'empty';
        tbody.append(tr);
      }
      const today = new Date(schedule.date + 'T12:00:00+08:00');
      $('schoolDate').textContent = today.toLocaleDateString('en-PH',
        {timeZone:'Asia/Manila',weekday:'long',month:'long',day:'numeric',year:'numeric'}) + ' · Philippine time';
      $('scheduledCount').textContent = String(classes.length);
      $('sessionCount').textContent = String(sessions.length);
      $('activeCount').textContent = String(sessions.filter(isActive).length);
      $('checkinCount').textContent = String(sessions.reduce((sum,s) => sum + (Number(s.checkedIn)||0),0));
      $('message').textContent = 'Monitoring updated. Check-ins reflect verified QR records, not inferred absences.';
    } catch (error) {
      $('message').textContent = error.message;
    } finally {
      $('refresh').disabled = false;
    }
  }
  $('refresh').addEventListener('click',refresh);
  $('overrideCancel').addEventListener('click', () => {
    selected = null;
    $('overridePanel').hidden = true;
  });
  $('overrideForm').addEventListener('submit',async event => {
    event.preventDefault();
    if (!selected) return;
    const reason = $('overrideReason').value.trim();
    if (reason.length < 12 || reason.length > 500) {
      $('message').textContent = 'An emergency reason of 12–500 characters is required.';
      return;
    }
    $('overrideConfirm').disabled = true;
    try {
      await api('/api/class-qr/admin-override/sessions/' +
        encodeURIComponent(selected.sessionId) + '/close',
        {method:'POST',body:JSON.stringify({reason})});
      selected = null;
      $('overridePanel').hidden = true;
      await refresh();
      $('message').textContent = 'Emergency close saved with an administrator audit record.';
    } catch (error) {
      $('message').textContent = error.message;
    } finally {
      $('overrideConfirm').disabled = false;
    }
  });

  (async () => {
    try {
      const {user} = await api('/api/auth/me');
      if (user?.role !== 'SCHOOL_ADMIN') {
        location.replace('/portal.html');
        return;
      }
      $('monitorPage').hidden = false;
      await refresh();
    } catch (error) {
      $('monitorPage').hidden = false;
      $('message').textContent = error.message;
    }
  })();
})();