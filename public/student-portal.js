(() => {
  const tokenKey = 'schoolAttendance.accessToken';
  const userKey = 'schoolAttendance.user';
  const token = null;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  let currentUser = null;
  let profile = null;


  function clearSession() {
    window.AttendigoOfflineAccount?.clear();
    window.StudentQrOffline?.disable();
    sessionStorage.removeItem(tokenKey);
    sessionStorage.removeItem(userKey);
    sessionStorage.removeItem('schoolAttendance.expiresAt');
  }
  async function api(url, options = {}) {
    const headers = new Headers(options.headers || {});
    // Student identity is exclusively determined by the HttpOnly cookie.
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(url, {...options, headers, cache: 'no-store'});
    if (response.status === 401) { clearSession(); location.replace('/portal-login.html'); throw new Error('Your session expired. Please sign in again.'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }
  function formatDate(value) {
    const clean = String(value || '').slice(0, 10);
    const [y,m,d] = clean.split('-').map(Number);
    if (!y || !m || !d) return clean || '—';
    return new Date(y, m - 1, d).toLocaleDateString('en-PH', {year:'numeric',month:'short',day:'numeric'});
  }
  function formatTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('en-PH', {timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'});
  }
  let attendanceRecords = [];
  let historyPage = 0;
  const HISTORY_DAYS_PER_PAGE = 5;
  const dayKey = record => String(record.schoolDate || '').slice(0,10);
  const subjectKey = record => String(record.subjectName || record.periodName || 'Class period').trim() || 'Class period';
  function eventLabel(record) {
    const type=String(record.eventType || '').toUpperCase();
    return type==='TIME_IN'?'Time in':type==='TIME_OUT'?'Time out':type.replaceAll('_',' ').toLowerCase()||'Attendance event';
  }
  function groupAttendance(records) {
    const days = new Map();
    for (const record of records) {
      const date=dayKey(record);
      if(!days.has(date))days.set(date,new Map());
      const groups=days.get(date);
      const gate=record.scope==='SCHOOL';
      const name=gate?'School gate':subjectKey(record);
      const key=(gate?'SCHOOL:':'CLASS:')+name;
      if(!groups.has(key))groups.set(key,{name,gate,records:[]});
      groups.get(key).records.push(record);
    }
    return [...days].sort(([a],[b])=>b.localeCompare(a)).map(([date,groups])=>({
      date,groups:[...groups.values()].sort((a,b)=>Number(a.gate)-Number(b.gate)||a.name.localeCompare(b.name)).map(group=>({
        ...group,records:[...group.records].sort((a,b)=>String(b.occurredAt||'').localeCompare(String(a.occurredAt||'')))
      }))
    }));
  }
  function filterAttendance(records, {search='',scope='ALL',subject='ALL',date='LATEST'}={}) {
    const latest=records.map(dayKey).filter(Boolean).sort().at(-1);
    return records.filter(record=>{
      if(date!=='ALL' && dayKey(record)!==(date==='LATEST'?latest:date))return false;
      if(scope!=='ALL' && record.scope!==scope)return false;
      if(subject!=='ALL' && (record.scope!=='CLASS'||subjectKey(record)!==subject))return false;
      const terms=[record.schoolDate,formatDate(record.schoolDate),formatTime(record.occurredAt),record.scope==='SCHOOL'?'school gate':'subject class',record.subjectName,record.periodName,record.eventType,eventLabel(record),record.late?'late':'accepted'].join(' ').toLocaleLowerCase();
      return terms.includes(search.trim().toLocaleLowerCase());
    });
  }
  function updateHistoryFilters(){
    const date=$('studentAttendanceDate'),subject=$('studentAttendanceSubject');
    const previousDate=date.value||'LATEST',previousSubject=subject.value||'ALL';
    const dates=[...new Set(attendanceRecords.map(dayKey).filter(Boolean))].sort().reverse();
    const subjects=[...new Set(attendanceRecords.filter(r=>r.scope==='CLASS').map(subjectKey))].sort((a,b)=>a.localeCompare(b));
    date.replaceChildren(new Option('Latest recorded day','LATEST'),new Option('All recent dates','ALL'),...dates.map(d=>new Option(formatDate(d),d)));
    date.value=['LATEST','ALL',...dates].includes(previousDate)?previousDate:'LATEST';
    subject.replaceChildren(new Option('All subjects','ALL'),...subjects.map(name=>new Option(name,name)));
    subject.value=['ALL',...subjects].includes(previousSubject)?previousSubject:'ALL';
  }
  function renderAttendance() {
    const scope=$('studentAttendanceScopeFilter').value||'ALL';
    const subject=$('studentAttendanceSubject');
    subject.disabled=scope==='SCHOOL';
    if(subject.disabled)subject.value='ALL';
    const records=filterAttendance(attendanceRecords,{search:$('studentAttendanceSearch').value,scope,subject:subject.value||'ALL',date:$('studentAttendanceDate').value||'LATEST'});
    const days=groupAttendance(records);
    const totalPages=Math.max(1,Math.ceil(days.length/HISTORY_DAYS_PER_PAGE));
    historyPage=Math.min(historyPage,totalPages-1);
    const visible=days.slice(historyPage*HISTORY_DAYS_PER_PAGE,(historyPage+1)*HISTORY_DAYS_PER_PAGE);
    const host=$('studentAttendanceRows');
    const opened=new Set([...host.querySelectorAll('details[open]')].map(node=>node.dataset.historyKey));
    host.innerHTML=visible.length?visible.map(day=>{
      const count=day.groups.reduce((sum,g)=>sum+g.records.length,0);
      return `<section class="student-history-day"><h3>${esc(formatDate(day.date))}<span>${count} accepted event${count===1?'':'s'}</span></h3><div class="student-history-groups">${day.groups.map(group=>{
        const late=group.records.filter(r=>r.late).length;
        const key=JSON.stringify([day.date,group.gate,group.name]);
        return `<details class="student-history-group" data-history-key="${esc(key)}"${opened.has(key)?' open':''}><summary><div class="student-history-name"><strong>${esc(group.name)}</strong><small>${group.records.length} record${group.records.length===1?'':'s'} · Latest ${esc(formatTime(group.records[0].occurredAt))}</small></div><span class="student-history-status${late?' is-late':''}">${late?late+' late':'Accepted'}</span><span class="student-history-chevron" aria-hidden="true">⌄</span></summary><ul class="student-history-events">${group.records.map(r=>`<li><div><strong>${esc(eventLabel(r))}</strong>${r.periodName&&r.periodName!==group.name?`<small>${esc(r.periodName)}</small>`:''}</div><span>${esc(formatTime(r.occurredAt))}</span><small class="student-history-event-status">${r.late?'Late':'Accepted'}</small></li>`).join('')}</ul></details>`;
      }).join('')}</div></section>`;
    }).join(''):`<div class="student-history-empty"><strong>${attendanceRecords.length?'No matching records':'No attendance records yet'}</strong><p>${attendanceRecords.length?'Choose another date, subject, or attendance area.':'Verified school gate and class events will appear here when recorded.'}</p></div>`;
    $('studentAttendanceDayStats').hidden=!records.length;
    $('studentHistoryClassCount').textContent=String(days.reduce((sum,day)=>sum+day.groups.filter(g=>!g.gate).length,0));
    $('studentHistoryLateCount').textContent=String(records.filter(r=>r.late).length);
    $('studentHistoryGateCount').textContent=String(records.filter(r=>r.scope==='SCHOOL').length);
    $('studentAttendancePages').hidden=totalPages<=1;
    $('studentHistoryPrevious').disabled=historyPage===0;
    $('studentHistoryNext').disabled=historyPage>=totalPages-1;
    $('studentHistoryPageLabel').textContent='Page '+(historyPage+1)+' of '+totalPages;
    const count=$('studentAttendanceVisibleCount');
    count.textContent=records.length?'Showing '+visible.reduce((sum,day)=>sum+day.groups.reduce((n,g)=>n+g.records.length,0),0)+' of '+records.length+' matching accepted events':'';
  }
  async function loadAttendance() {
    const result = await api('/api/student/attendance');
    attendanceRecords = Array.isArray(result.attendance) ? result.attendance : [];
    $('studentRecordCount').textContent = String(attendanceRecords.length);
    $('studentSubjectCount').textContent = String(attendanceRecords.filter(record => record.scope === 'CLASS').length);
    $('studentGateCount').textContent = String(attendanceRecords.filter(record => record.scope === 'SCHOOL').length);
    updateHistoryFilters();
    renderAttendance();
  }
  function mountStudentPhoto() {
    try {
      window.ProfilePhotos?.mountSelf({token,role:'STUDENT',studentId:currentUser.studentId,container:'#studentProfilePhoto',displayName:currentUser.displayName});
      const widget=$('studentProfilePhoto')?.querySelector('.my-photo-widget');
      const note=widget?.querySelector('.my-photo-copy p');
      if(note)note.textContent='New photos require School Admin approval.';
      const button=widget?.querySelector('.my-photo-copy button');
      if(button)button.textContent='Request photo change';
    } catch {}
  }
  async function loadProfile() {
    const data = await api('/api/student/profile');
    profile = data.student;
    $('studentSchoolLabel').textContent = data.school?.schoolName || currentUser?.schoolName || 'STUDENT PORTAL';
    $('studentWelcome').textContent = `Welcome, ${profile.fullName || currentUser?.displayName || 'Student'}`;
    $('studentIdValue').textContent = profile.studentId || '—';
    $('studentGradeValue').textContent = profile.gradeLevel || '—';
    $('studentSectionValue').textContent = profile.section || '—';
    const membership = await api('/api/special-programs/mine');
    const current = (membership.students || []).find(item => item.studentId === profile.studentId);
    $('studentSpecialProgramValue').textContent = current?.programCode
      ? current.programCode + ' — ' + current.programName : 'Not assigned for the active school year';
  }
  async function refresh() {
    if($('studentRefresh').disabled)return;
    $('studentRefresh').disabled = true;
    document.dispatchEvent(new Event('attendigo:requests-changed'));
    try { await Promise.all([loadProfile(),!currentUser?.mustChangePassword?loadAttendance():Promise.resolve()]); $('studentPortalFeedback').textContent = 'Information refreshed.'; }
    catch (error) { $('studentPortalFeedback').textContent = error.message; }
    finally { $('studentRefresh').disabled = false; }
  }
  $('studentPasswordForm').addEventListener('submit', async event => {
    event.preventDefault();
    const feedback = $('studentPasswordFeedback');
    const currentPassword = $('studentCurrentPassword').value;
    const newPassword = $('studentNewPassword').value;
    if (newPassword !== $('studentConfirmPassword').value) { feedback.textContent = 'The new passwords do not match.'; return; }
    if (newPassword.length < 12) { feedback.textContent = 'Use at least 12 characters for your new password.'; return; }
    $('studentSavePassword').disabled = true;
    try {
      await api('/api/student/change-password', {method:'POST',body:JSON.stringify({currentPassword,newPassword})});
      currentUser.mustChangePassword = false;
      try { sessionStorage.setItem(userKey, JSON.stringify(currentUser)); } catch {}
      $('studentPasswordRequired').hidden = true;
      $('studentAttendanceSummary').hidden = false;
      $('studentAttendanceCard').hidden = false;
      window.StudentClassQrScanner?.enable(currentUser);
      $('studentPasswordForm').reset();
      feedback.textContent = 'Password changed successfully.';
      await loadAttendance();
    } catch (error) { feedback.textContent = error.message; }
    finally { $('studentSavePassword').disabled = false; }
  });
  window.addEventListener('student-class-attendance-recorded',()=>{void loadAttendance().catch(error=>{$('studentPortalFeedback').textContent=error.message;});});
  const resetHistory=()=>{historyPage=0;renderAttendance();};
  $('studentAttendanceSearch')?.addEventListener('input',resetHistory);
  for(const id of ['studentAttendanceScopeFilter','studentAttendanceDate','studentAttendanceSubject'])$(id)?.addEventListener('change',resetHistory);
  $('studentHistoryPrevious')?.addEventListener('click',()=>{historyPage=Math.max(0,historyPage-1);renderAttendance();});
  $('studentHistoryNext')?.addEventListener('click',()=>{historyPage++;renderAttendance();});
  $('studentRefresh').addEventListener('click', refresh);
  $('studentLogout').addEventListener('click', async () => {
    try { await api('/api/auth/logout', {method:'POST'}); } catch {}
    clearSession(); location.replace('/portal-login.html');
  });
  async function init() {
    const me = await api('/api/auth/me');
    window.AttendigoOfflineAccount?.record(me.user,me.expiresAt);
    if (me.user.role !== 'STUDENT') { location.replace(me.user.role === 'PARENT' ? '/parent-portal.html' : '/portal.html'); return; }
    currentUser = me.user;
    mountStudentPhoto();
    // The class scanner depends on the verified session only, not on unrelated dashboard data.
    $('studentAttendanceSummary').hidden = Boolean(currentUser.mustChangePassword);
    $('studentAttendanceCard').hidden = Boolean(currentUser.mustChangePassword);
    $('studentPasswordRequired').hidden = !currentUser.mustChangePassword;
    if (!currentUser.mustChangePassword) {
      if (window.StudentClassQrScanner) window.StudentClassQrScanner.enable(currentUser);
      else $('studentQrReady').textContent = 'Scanner could not load. Reload this page to try again.';
    } else $('studentQrReady').textContent = 'Change your initial password below to use classroom QR attendance.';
    try {
      sessionStorage.setItem(userKey, JSON.stringify(currentUser));
      sessionStorage.removeItem('schoolAttendance.pendingClassQr');
    } catch {}
    // Load the rest of the dashboard independently so an unavailable profile does not hide the scanner.
    const tasks = [loadProfile()];
    if (!currentUser.mustChangePassword) tasks.push(loadAttendance());
    const results = await Promise.allSettled(tasks);
    const failed = results.find(result => result.status === 'rejected');
    if (failed) $('studentPortalFeedback').textContent = failed.reason?.message || 'Some dashboard information could not be loaded.';

  }
  init().catch(error => { $('studentPortalFeedback').textContent = error.message || 'Could not load the Student Portal.'; });
})();
