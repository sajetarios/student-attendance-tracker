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
      <div class="dh-monitor-heading">
        <div class="dh-monitor-heading-icon" aria-hidden="true">▥</div>
        <div class="dh-monitor-heading-title"><span class="dh-monitor-eyebrow">DEPARTMENT WORKSPACE</span>
          <h3>Department Monitoring &amp; Reports</h3>
          <p>Gate activity, teacher workload, department notices and learner follow-up.</p>
        </div>
        <div class="dh-monitor-heading-actions">
          <span class="dh-last-updated" id="dhLastUpdated" role="status">Not refreshed yet</span>
          <button class="outline-button" type="button" id="dhInsightsRefresh">↻ Refresh</button>
        </div>
      </div>
      <p class="inline-feedback dh-monitor-feedback" role="status" aria-live="polite" id="dhInsightsStatus"></p>
      <div class="dh-insights-metrics" aria-label="Department monitoring totals">
        <article class="dh-kpi dh-kpi-gate"><span class="dh-kpi-icon" aria-hidden="true">▣</span><div><span>Verified gate arrivals today</span><strong id="dhGateArrivals">—</strong><small>Gate arrivals only</small></div></article>
        <article class="dh-kpi dh-kpi-ob"><span class="dh-kpi-icon" aria-hidden="true">▤</span><div><span>OB requests awaiting recommendation</span><strong id="dhPendingOb">—</strong><small>Awaiting your action</small></div></article>
        <article class="dh-kpi dh-kpi-cover"><span class="dh-kpi-icon" aria-hidden="true">▦</span><div><span>Approved classes needing coverage</span><strong id="dhUncoveredClassesReports">—</strong><small>Review class assignments</small></div></article>
      </div>
      <div class="dh-monitor-columns">
        <section class="dh-monitor-panel dh-monitor-workload">
          <div class="dh-monitor-panel-head">
            <button type="button" class="dh-panel-toggle" id="dhToggleWorkload" aria-expanded="true" aria-controls="dhWorkloadBody">
              <span class="dh-panel-glyph" aria-hidden="true">▤</span><span><strong>Teacher Workload</strong><small>Assigned class periods and active temporary substitutions</small></span><span class="dh-panel-chevron" aria-hidden="true">⌄</span>
            </button>
            <button class="outline-button" type="button" id="dhExportWorkload">↓ Export CSV</button>
          </div>
          <div id="dhWorkloadBody" class="dh-workload-body">
            <div class="dh-workload-tools">
              <input type="search" id="dhWorkloadSearch" placeholder="Search teacher or status…" aria-label="Search teacher workload">
              <button type="button" class="outline-button" id="dhSortTeachers" aria-label="Sort teacher names">Name A–Z</button>
            </div>
            <div class="dh-workload-scroll" role="region" aria-label="Department teacher workload" tabindex="0">
              <table class="dh-workload-table"><thead><tr>
                <th scope="col">Teacher</th><th scope="col">Account status</th>
                <th scope="col">Assigned periods</th><th scope="col">Active substitutions</th>
              </tr></thead><tbody id="dhWorkloadRows"><tr><td colspan="4">Loading teacher workload…</td></tr></tbody></table>
            </div>
          </div>
        </section>
        <div class="dh-monitor-right">
          <section class="dh-monitor-panel dh-monitor-notices">
            <div class="dh-monitor-panel-head">
              <div class="dh-panel-label"><span class="dh-panel-glyph" aria-hidden="true">◉</span><span><strong>Department Announcements</strong><small>Notify active teachers and Department Heads in your department</small></span></div>
              <button type="button" class="outline-button" id="dhNewNotice" aria-expanded="false" aria-controls="dhAnnouncementForm">+ New Notice</button>
            </div>
            <form id="dhAnnouncementForm" class="dh-notice-form" hidden>
              <label>Title<input required name="title" maxlength="120" minlength="3" placeholder="e.g. Department meeting" autocomplete="off"></label>
              <label>Message<textarea required name="body" maxlength="1200" minlength="3" rows="3" placeholder="Enter a brief departmental notice"></textarea></label>
              <div class="dh-notice-actions"><button type="submit" class="primary-button">Send department notice</button>
                <span id="dhNoticeStatus" role="status" aria-live="polite"></span></div>
            </form>
          </section>
          <section class="dh-monitor-panel dh-monitor-recent">
            <div class="dh-monitor-panel-head">
              <div class="dh-panel-label"><span class="dh-panel-glyph" aria-hidden="true">▤</span><span><strong>Recent Department Notices</strong><small>Messages sent within your department</small></span></div>
              <button class="outline-button" type="button" id="dhToggleNotices" aria-expanded="false" aria-controls="dhAnnouncements">View all</button>
            </div>
            <ul class="dh-announcement-list" id="dhAnnouncements"><li>Loading notices…</li></ul>
          </section>
        </div>
      </div>`;
    parent.append(panel);
    // Keep the existing SARDO monitor and its permissions, handlers and IDs intact.
    // Department Heads see it as the next panel in this monitoring workspace.
    const sardoPanel = $('sardoCard');
    if (sardoPanel) panel.append(sardoPanel);
    const toggleWorkload = $('dhToggleWorkload');
    toggleWorkload.addEventListener('click', () => {
      const expanded = toggleWorkload.getAttribute('aria-expanded') !== 'true';
      toggleWorkload.setAttribute('aria-expanded', String(expanded));
      $('dhWorkloadBody').hidden = !expanded;
    });
    const newNotice = $('dhNewNotice');
    newNotice.addEventListener('click', () => {
      const expanded = newNotice.getAttribute('aria-expanded') !== 'true';
      newNotice.setAttribute('aria-expanded', String(expanded));
      $('dhAnnouncementForm').hidden = !expanded;
      newNotice.textContent = expanded ? 'Close' : '+ New Notice';
      if (expanded) $('dhAnnouncementForm').querySelector('input[name="title"]').focus();
    });
    let allNotices = false;
    $('dhToggleNotices').addEventListener('click', () => {
      allNotices = !allNotices;
      $('dhToggleNotices').setAttribute('aria-expanded', String(allNotices));
      $('dhToggleNotices').textContent = allNotices ? 'Show less' : 'View all';
      updateNoticeVisibility();
    });
    function updateNoticeVisibility() {
      [...$('dhAnnouncements').children].forEach((li, i) => { li.hidden = !allNotices && i >= 3; });
    }
    let reverseTeacherSort = false;
    function filterWorkloadTable() {
      const tbody = $('dhWorkloadRows');
      const search = $('dhWorkloadSearch').value.trim().toLocaleLowerCase();
      const rows = [...tbody.rows];
      const hasRealRows = rows.every(row => row.cells.length > 1);
      if (!hasRealRows) return;
      rows.sort((a, b) => {
        const aName = a.cells[0]?.textContent || '';
        const bName = b.cells[0]?.textContent || '';
        return aName.localeCompare(bName, 'en', { sensitivity: 'base' }) * (reverseTeacherSort ? -1 : 1);
      });
      rows.forEach(row => {
        tbody.append(row);
        row.hidden = !row.textContent.toLocaleLowerCase().includes(search);
      });
    }
    $('dhWorkloadSearch').addEventListener('input', filterWorkloadTable);
    $('dhSortTeachers').addEventListener('click', () => {
      reverseTeacherSort = !reverseTeacherSort;
      $('dhSortTeachers').textContent = reverseTeacherSort ? 'Name Z–A' : 'Name A–Z';
      filterWorkloadTable();
    });


    const subjectPanel = document.createElement('section');
    subjectPanel.className = 'dh-insights';
    subjectPanel.setAttribute('aria-label', 'Manage department subjects');
    subjectPanel.innerHTML = `
      <div class="dh-insights-head"><div><h3>Manage Subjects</h3>
        <p>Add or rename subjects in your assigned department. Existing class schedules and attendance remain unchanged.</p></div></div>
      <p id="dhSubjectStatus" role="status" aria-live="polite"></p>
      <form id="dhSubjectEditForm" class="dh-notice-form">
        <label>Existing subject<select name="subjectId" id="dhSubjectSelect" required></select></label>
        <label>New subject name<input name="subjectName" id="dhSubjectName" maxlength="120" required></label>
        <div class="dh-notice-actions"><button type="submit" class="primary-button">Save subject name</button></div>
      </form>
      <form id="dhSubjectAddForm" class="dh-notice-form">
        <label>Add subject<input name="subjectName" maxlength="120" required placeholder="New department subject"></label>
        <div class="dh-notice-actions"><button type="submit" class="outline-button">Add subject</button></div>
      </form>`;
    // Keep subject management out of the Department Head dashboard.
    // Its forms remain mounted in a modal for the schedule subject shortcut.
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Manage department subjects');
    dialog.style.cssText = 'width:min(94vw,560px);max-height:85dvh;overflow:auto;border:1px solid #cbd5e1;border-radius:16px;padding:18px;background:var(--surface,#fff);color:var(--text,#172b4d)';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'outline-button';
    close.textContent = 'Close';
    close.style.cssText = 'width:100%;margin-top:12px';
    dialog.append(subjectPanel,close);
    document.body.append(dialog);
    const scheduleSubject = $('periodSubject');
    if (scheduleSubject) {
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'outline-button';
      trigger.textContent = 'Manage Subjects';
      trigger.style.cssText = 'width:100%;margin-top:8px;min-height:40px';
      scheduleSubject.closest('.field-group')?.append(trigger);
      trigger.addEventListener('click', () => {
        dialog.showModal();
        loadSubjects();
      });
    }
    close.addEventListener('click', () => dialog.close());

    let ownDepartmentId = user.departmentId;
    async function loadSubjects() {
      const status = $('dhSubjectStatus');
      try {
        if (!ownDepartmentId) {
          const departments = await fetch('/api/departments', { credentials: 'same-origin', cache: 'no-store' });
          const data = await departments.json();
          ownDepartmentId = data.ownDepartmentId;
        }
        if (!ownDepartmentId) throw new Error('An assigned department is required.');
        const response = await fetch('/api/subjects', { credentials: 'same-origin', cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Cannot load subjects.');
        const select = $('dhSubjectSelect');
        select.replaceChildren();
        for (const subject of data.subjects || []) {
          const option = document.createElement('option');
          option.value = subject.subjectId;
          option.textContent = subject.subjectName;
          select.append(option);
        }
        const syncName = () => {
          $('dhSubjectName').value = select.selectedOptions[0]?.textContent || '';
        };
        select.onchange = syncName;
        syncName();
        $('dhSubjectEditForm').querySelector('button').disabled = !select.options.length;
        status.textContent = select.options.length ? '' : 'No subjects yet. Add one below.';
      } catch (error) { status.textContent = error.message; }
    }
    async function saveSubject(event, isAdd) {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      const button = form.querySelector('button[type="submit"]');
      const status = $('dhSubjectStatus');
      const name = String(new FormData(form).get('subjectName') || '').trim();
      button.disabled = true;
      try {
        const path = isAdd ? '/api/subjects' : '/api/subjects/' + encodeURIComponent($('dhSubjectSelect').value);
        const response = await fetch(path, {
          method: isAdd ? 'POST' : 'PATCH', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(isAdd ? { departmentId: ownDepartmentId, subjectName: name } : { subjectName: name })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not save subject.');
        await loadSubjects();
        // Refresh the open class schedule selector without losing the selected subject.
        const scheduleSelect = $('periodSubject');
        if (scheduleSelect) {
          const previousId = isAdd ? result.subject?.subjectId : scheduleSelect.value;
          try {
            const response = await fetch('/api/subjects', { credentials: 'same-origin', cache: 'no-store' });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Could not refresh schedule subjects.');
            scheduleSelect.replaceChildren();
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = 'Select subject';
            scheduleSelect.append(placeholder);
            for (const subject of data.subjects || []) {
              const option = document.createElement('option');
              option.value = subject.subjectId;
              option.textContent = subject.subjectName;
              scheduleSelect.append(option);
            }
            scheduleSelect.disabled = !(data.subjects || []).length;
            if ([...scheduleSelect.options].some(option => option.value === previousId)) scheduleSelect.value = previousId;
            if ($('periodSubjectHint')) $('periodSubjectHint').textContent = (data.subjects || []).length + ' subjects available for the selected teacher.';
          } catch (error) { status.textContent = 'Subject saved, but refresh the schedule form: ' + error.message; }
        }
        if (isAdd) form.reset();
        status.textContent = 'Subject saved. Existing class records were not changed.';
      } catch (error) { status.textContent = error.message; }
      finally { button.disabled = false; }
    }
    $('dhSubjectEditForm').addEventListener('submit', event => saveSubject(event, false));
    $('dhSubjectAddForm').addEventListener('submit', event => saveSubject(event, true));
    loadSubjects();


    let workload = [];
    const status = $('dhInsightsStatus');
    async function loadOverview() {
      status.textContent = 'Loading department monitoring…';
      try {
        const data = await request('/overview');
        $('dhGateArrivals').textContent = String(data.summary?.verifiedGateArrivals ?? '—');
        $('dhPendingOb').textContent = String(data.summary?.pendingObRecommendations ?? '—');
        $('dhUncoveredClassesReports').textContent = String(data.summary?.uncoveredClasses ?? '—');
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
        filterWorkloadTable();
        const now = new Date();
        $('dhLastUpdated').textContent = 'Updated ' + now.toLocaleTimeString('en-PH', {timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'});
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
          updateNoticeVisibility();
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
        updateNoticeVisibility();
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
        newNotice.setAttribute('aria-expanded', 'false');
        newNotice.textContent = '+ New Notice';
        form.hidden = true;
        await loadAnnouncements();
      } catch (error) {
        feedback.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
    document.addEventListener('attendigo:dashboard-refresh',event=>{if(!$('dashboardView')?.hidden)event.detail.tasks.push(Promise.all([loadOverview(),loadAnnouncements()]));});
    await Promise.all([loadOverview(), loadAnnouncements()]);
  }

  window.attendigoStaffIdentity?.then(init).catch(() => {});
})();
