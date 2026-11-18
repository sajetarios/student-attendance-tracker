'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const base = '/api/department-head';
  async function request(path, options = {}) {
    const response = await fetch(base + path, {
      ...options, credentials: 'same-origin', cache: 'no-store',
      headers: options.body ? { 'Content-Type': 'application/json' } : {}
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Department service unavailable.');
    return data;
  }
  const csvCell = value => {
    let text = String(value ?? '');
    // Prevent formula execution if the exported CSV is opened in Excel.
    if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const date = value => {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toLocaleString('en-PH', {
      timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short'
    }) : '';
  };

  async function init(user) {
    if (user?.role !== 'DEPARTMENT_HEAD') return;
    const parent = $('departmentHeadOverview');
    if (!parent) return;
    const panel = document.createElement('section');
    panel.className = 'dh-insights';
    panel.setAttribute('aria-label', 'Department monitoring and announcements');
    panel.innerHTML = `
      <div class="dh-insights-head"><div>
        <h3>Department monitoring & reports</h3>
        <p>Only records for your assigned department. Gate arrivals do not determine official DTR or absences.</p>
      </div><button class="outline-button" type="button" id="dhInsightsRefresh">Refresh</button></div>
      <p class="inline-feedback" role="status" aria-live="polite" id="dhInsightsStatus"></p>
      <div class="dh-insights-metrics" aria-label="Department monitoring totals">
        <div><span>Verified gate arrivals today</span><strong id="dhGateArrivals">—</strong></div>
        <div><span>OB requests awaiting recommendation</span><strong id="dhPendingOb">—</strong></div>
        <div><span>Approved classes needing coverage</span><strong id="dhUncoveredClasses">—</strong></div>
      </div>
      <div class="dh-insights-head"><div><h4>Teacher workload</h4>
        <p>Assigned class periods and active temporary substitutions; not teaching hours or attendance status.</p>
      </div><button class="outline-button" type="button" id="dhExportWorkload">Export CSV</button></div>
      <div class="dh-workload-scroll" role="region" aria-label="Department teacher workload" tabindex="0">
        <table class="dh-workload-table"><thead><tr>
          <th scope="col">Teacher</th><th scope="col">Account status</th>
          <th scope="col">Assigned periods</th><th scope="col">Active substitutions</th>
        </tr></thead><tbody id="dhWorkloadRows"><tr><td colspan="4">Loading teacher workload…</td></tr></tbody></table>
      </div>
      <div class="dh-insights-head"><div><h4>Department announcements</h4>
        <p>Send a notice to active teachers and Department Heads in your assigned department only.</p>
      </div></div>
      <form id="dhAnnouncementForm" class="dh-notice-form">
        <label>Title<input required name="title" maxlength="120" minlength="3" placeholder="e.g. Department meeting" autocomplete="off"></label>
        <label>Message<textarea required name="body" maxlength="1200" minlength="3" rows="3" placeholder="Enter a brief departmental notice"></textarea></label>
        <div class="dh-notice-actions"><button type="submit" class="primary-button">Send department notice</button>
          <span id="dhNoticeStatus" role="status" aria-live="polite"></span></div>
      </form>
      <h4 class="dh-recent-heading">Recent department notices</h4>
      <ul class="dh-announcement-list" id="dhAnnouncements"><li>Loading notices…</li></ul>`;
    parent.append(panel);

    let workload = [];
    const status = $('dhInsightsStatus');
    async function loadOverview() {
      status.textContent = 'Loading department monitoring…';
      try {
        const data = await request('/overview');
        $('dhGateArrivals').textContent = String(data.summary?.verifiedGateArrivals ?? '—');
        $('dhPendingOb').textContent = String(data.summary?.pendingObRecommendations ?? '—');
        $('dhUncoveredClasses').textContent = String(data.summary?.uncoveredClasses ?? '—');
        workload = Array.isArray(data.teachers) ? data.teachers : [];
        const tbody = $('dhWorkloadRows');
        tbody.replaceChildren();
        if (!workload.length) {
          const tr = tbody.insertRow();
          const td = tr.insertCell(); td.colSpan = 4; td.textContent = 'No teachers assigned to this department.';
        } else {
          for (const teacher of workload) {
            const row = tbody.insertRow();
            const state = !teacher.active ? 'Inactive' : teacher.teacherStatus === 'ON_LEAVE' ? 'On leave' : 'Active';
            for (const value of [teacher.displayName, state, teacher.assignedPeriods, teacher.activeSubstitutions]) {
              row.insertCell().textContent = String(value ?? '—');
            }
          }
        }
        status.textContent = data.attendanceNote || 'Department totals loaded.';
      } catch (error) {
        status.textContent = error.message;
      }
    }
    async function loadAnnouncements() {
      const list = $('dhAnnouncements');
      try {
        const data = await request('/announcements');
        list.replaceChildren();
        if (!data.announcements?.length) {
          const li = document.createElement('li');
          li.textContent = 'No department announcements have been sent.';
          list.append(li);
          return;
        }
        for (const announcement of data.announcements) {
          const li = document.createElement('li');
          const heading = document.createElement('strong');
          const time = document.createElement('time');
          const body = document.createElement('p');
          heading.textContent = announcement.title;
          time.textContent = date(announcement.createdAt);
          if (announcement.createdAt) time.dateTime = announcement.createdAt;
          body.textContent = announcement.body;
          li.append(heading, time, body);
          list.append(li);
        }
      } catch (error) {
        list.replaceChildren();
        const li = document.createElement('li'); li.textContent = error.message; list.append(li);
      }
    }
    $('dhInsightsRefresh').addEventListener('click', async event => {
      event.currentTarget.disabled = true;
      try { await Promise.all([loadOverview(), loadAnnouncements()]); }
      finally { event.currentTarget.disabled = false; }
    });
    $('dhExportWorkload').addEventListener('click', () => {
      const header = ['Teacher', 'Account status', 'Assigned class periods', 'Active substitutions'];
      const rows = workload.map(t => [
        t.displayName, !t.active ? 'Inactive' : t.teacherStatus === 'ON_LEAVE' ? 'On leave' : 'Active',
        t.assignedPeriods, t.activeSubstitutions
      ]);
      const csv = [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
      const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      const day = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Manila'}).format(new Date());
      link.download = 'attendigo-department-workload-' + day + '.csv';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    $('dhAnnouncementForm').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      const button = form.querySelector('button[type="submit"]');
      const feedback = $('dhNoticeStatus');
      const values = new FormData(form);
      button.disabled = true;
      feedback.textContent = 'Sending notice…';
      try {
        const result = await request('/announcements', {
          method: 'POST',
          body: JSON.stringify({
            title: String(values.get('title') || '').trim(),
            body: String(values.get('body') || '').trim()
          })
        });
        feedback.textContent = 'Notice delivered to ' + Number(result.recipients || 0) + ' department account(s).';
        document.dispatchEvent(new Event('attendigo:requests-changed'));
        form.reset();
        await loadAnnouncements();
      } catch (error) {
        feedback.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
    await Promise.all([loadOverview(), loadAnnouncements()]);
  }

  window.attendigoStaffIdentity?.then(init).catch(() => {});
})();
