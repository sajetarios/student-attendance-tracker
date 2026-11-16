/* Attendigo Student Portal Accounts — uses the existing school session and students. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const view = $('studentAccountsView');
  if (!view) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const identity = () => {
    try { return JSON.parse(sessionStorage.getItem('schoolAttendance.user') || 'null'); }
    catch { return null; }
  };
  const isAdmin = () => identity()?.role === 'SCHOOL_ADMIN';
  const isTeacher = () => identity()?.role === 'TEACHER';
  let students = [];
  let requests = [];
  let busy = false;
  let activeStudent = null;
  let pendingReview = null;
  let credentials = [];
  const selected = new Set();

  async function api(url, options = {}) {
    const token = sessionStorage.getItem('schoolAttendance.accessToken');
    if (!token) throw new Error('Your school session has expired. Sign in again.');
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', 'Bearer ' + token);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(url, {...options, headers, cache: 'no-store'});
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error || 'Request failed. Please try again.');
    return json;
  }
  async function confirmAction(message) {
    if (window.AppDialog && typeof window.AppDialog.confirm === 'function') {
      return window.AppDialog.confirm(message, {title:'Confirm student account action'});
    }
    return window.confirm(message);
  }
  function announce(message, error = false) {
    const target = $('sapListCount');
    if (!target) return;
    target.textContent = message;
    target.style.color = error ? '#b63e43' : '';
  }
  function statusMarkup(s) {
    if (!s.hasAccount) return '<span class="sap-chip">No account</span>';
    if (!s.accountActive) return '<span class="sap-chip disabled">Disabled</span>';
    return '<span class="sap-chip active">Active login</span>';
  }
  function pendingFor(id) { return requests.find(r => r.studentId === id && r.status === 'PENDING'); }
  function filtered() {
    const text = ($('sapSearch')?.value || '').trim().toLocaleLowerCase();
    const filter = $('sapFilter')?.value || 'ALL';
    return students.filter(s =>
      (!text || (s.fullName + ' ' + s.studentId + ' ' + s.gradeLevel + ' ' + s.section).toLocaleLowerCase().includes(text)) &&
      (filter === 'ALL' || (filter === 'MISSING' && !s.hasAccount) ||
       (filter === 'ACTIVE' && s.accountActive) ||
       (filter === 'DISABLED' && s.hasAccount && !s.accountActive)));
  }
  function actionMarkup(s) {
    if (isAdmin()) {
      if (!s.hasAccount) return '<button type="button" class="sap-action primary" data-sap-action="CREATE" data-student-id="' + esc(s.studentId) + '">Create login</button>';
      if (!s.accountActive) return '<button type="button" class="sap-action primary" data-sap-action="ACTIVATE" data-student-id="' + esc(s.studentId) + '">Reactivate</button>';
      return '<button type="button" class="sap-action" data-sap-action="RESET" data-student-id="' + esc(s.studentId) + '">Reset password</button>' +
        '<button type="button" class="sap-action warn" data-sap-action="SUSPEND" data-student-id="' + esc(s.studentId) + '">Suspend</button>';
    }
    const action = !s.hasAccount ? 'CREATE' : s.accountActive ? 'RESET' : 'ACTIVATE';
    if (pendingFor(s.studentId)) return '<span class="sap-chip pending">Request pending</span>';
    const label = action === 'CREATE' ? 'Request login' : action === 'RESET' ? 'Request reset' : 'Request activation';
    return '<button type="button" class="sap-action primary" data-sap-action="' + action + '" data-student-id="' + esc(s.studentId) + '">' + label + '</button>';
  }
  function renderDirectory() {
    const admin = isAdmin();
    view.classList.toggle('is-teacher', !admin);
    $('sapBulkToolbar').hidden = !admin;
    $('sapDirectoryHelp').textContent = admin
      ? 'Create, reset or disable student logins. Temporary passwords are available once.'
      : 'Only your assigned learners are shown. Account changes require School Admin approval.';
    const total = students.length;
    $('sapActive').textContent = String(students.filter(s=>s.accountActive).length);
    $('sapMissing').textContent = String(students.filter(s=>!s.hasAccount).length);
    $('sapDisabled').textContent = String(students.filter(s=>s.hasAccount&&!s.accountActive).length);
    $('sapPending').textContent = String(requests.filter(r=>r.status==='PENDING').length);
    const rows = filtered();
    $('sapRows').innerHTML = rows.length ? rows.map(s => {
      const checkbox = admin && !s.hasAccount
        ? '<input type="checkbox" aria-label="Select ' + esc(s.fullName) + '" data-sap-select="' + esc(s.studentId) + '" ' + (selected.has(s.studentId) ? 'checked' : '') + '>'
        : '';
      return '<tr><td>' + checkbox + '</td><td><span class="sap-student-name">' + esc(s.fullName) +
       '</span><span class="sap-student-id">' + esc(s.studentId) + '</span></td><td>' +
       esc(s.gradeLevel || '—') + '<span class="sap-student-id">' + esc(s.section || '—') +
       '</span></td><td>' + statusMarkup(s) + '</td><td><div class="sap-cell-actions">' + actionMarkup(s) + '</div></td></tr>';
    }).join('') : '<tr><td colspan="5" class="sap-empty">No learners match this search or filter.</td></tr>';
    const missing = new Set(students.filter(s=>!s.hasAccount).map(s=>s.studentId));
    [...selected].filter(id=>!missing.has(id)).forEach(id=>selected.delete(id));
    const eligible = rows.filter(s=>!s.hasAccount);
    $('sapSelectAll').checked = Boolean(eligible.length) && eligible.every(s=>selected.has(s.studentId));
    $('sapSelectAll').indeterminate = eligible.some(s=>selected.has(s.studentId)) && !eligible.every(s=>selected.has(s.studentId));
    $('sapSelectedCount').textContent = selected.size + ' selected · maximum 20 per batch';
    $('sapBulkCreate').disabled = !admin || selected.size===0 || selected.size>20 || busy;
    $('sapListCount').textContent = rows.length + ' of ' + total + ' authorized learners displayed.';
  }
  const dateLabel = value => {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-PH', {timeZone:'Asia/Manila',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  };
  function renderRequests() {
    $('sapRequestsTitle').textContent = isAdmin() ? 'Teacher account requests' : 'My account requests';
    $('sapRequestsHelp').textContent = isAdmin() ? 'Review requests from teachers and approve or reject them.' : 'Track the approval status of your submitted requests.';
    const host = $('sapRequestRows');
    host.innerHTML = requests.length ? requests.map(r=>{
      const chip = r.status==='APPROVED' ? 'active' : r.status==='PENDING' ? 'pending' : 'disabled';
      const name = r.requestType==='CREATE' ? 'Create login' : r.requestType==='RESET' ? 'Password reset' : 'Reactivate login';
      const buttons = isAdmin() && r.status==='PENDING'
        ? '<div class="sap-request-buttons"><button class="sap-action primary" type="button" data-sap-review="APPROVE" data-request-id="'+esc(r.requestId)+'">Approve</button><button class="sap-action" type="button" data-sap-review="REJECT" data-request-id="'+esc(r.requestId)+'">Reject</button></div>'
        : '';
      return '<div class="sap-request-row"><div class="sap-request-info"><strong>'+esc(r.fullName)+'</strong><p>'+
        esc(r.studentId)+' · '+esc(name)+' · '+esc(r.requestedBy || 'Teacher')+' · '+esc(dateLabel(r.createdAt))+
        '</p><p>'+esc(r.reason)+'</p>'+(r.reviewNote?'<p>Review note: '+esc(r.reviewNote)+'</p>':'')+
        '</div><span class="sap-chip '+chip+'">'+esc(r.status)+'</span>'+buttons+'</div>';
    }).join('') : '<p class="sap-empty">No student account requests yet.</p>';
  }
  async function refresh() {
    if (busy || (!isAdmin() && !isTeacher())) return;
    busy = true;
    const button = $('sapRefresh');
    if(button) button.disabled = true;
    try {
      const [directory, requestData] = await Promise.all([
        api('/api/student-portal/accounts'),api('/api/student-portal/requests')
      ]);
      students = directory.students || [];
      requests = requestData.requests || [];
      renderDirectory();
      renderRequests();
    } catch (error) {
      $('sapRows').innerHTML = '<tr><td colspan="5" class="sap-empty">Unable to load student accounts.</td></tr>';
      announce(error.message,true);
    } finally { busy = false; if(button) button.disabled = false; }
  }
  function closeModal(id) {
    $(id).hidden=true;
    if(id==='sapSecretModal') {
      credentials=[];
      $('sapSecrets').value='';
    }
    if(id==='sapRequestModal') {
      activeStudent=null;
      $('sapRequestForm').reset();
      $('sapRequestFeedback').textContent='';
    }
    if(id==='sapReviewModal') {
      pendingReview=null;
      $('sapReviewForm').reset();
      $('sapReviewFeedback').textContent='';
    }
  }
  function openCredentials(items) {
    if (!isAdmin() || !Array.isArray(items) || !items.length) return;
    credentials=items.map(i=>({...i}));
    $('sapSecrets').value = credentials.map(c =>
      'Student: '+c.fullName+'\nStudent ID: '+c.studentId+'\nUsername: '+c.username+'\nTemporary password: '+c.temporaryPassword+'\n').join('\n');
    $('sapSecretModal').hidden=false;
    $('sapCopySecrets').focus();
  }
  async function issue(studentId,action) {
    if (!isAdmin() || busy) return;
    const student=students.find(s=>s.studentId===studentId);
    if(!student)return;
    const label=action==='CREATE'?'Create a new login':action==='RESET'?'Reset the password': 'Reactivate login with a new temporary password';
    if (!await confirmAction(label+' for '+student.fullName+'? This will change their access.')) return;
    busy=true;
    try {
      const result=await api('/api/student-portal/accounts/'+encodeURIComponent(studentId)+'/provision',
        {method:'POST',body:JSON.stringify({action})});
      openCredentials([result.credentials]);
      document.dispatchEvent(new CustomEvent('attendigo:requests-changed'));
      await refreshAfterMutation().catch(error => announce('Credentials issued. Account list refresh failed: ' + error.message, true));
    } catch(error) {announce(error.message,true);}
    finally {busy=false;}
  }
  async function suspend(studentId) {
    if (!isAdmin() || busy) return;
    const student=students.find(s=>s.studentId===studentId);
    if(!student || !await confirmAction('Suspend '+student.fullName+'\'s login and revoke current sessions? Attendance records will be preserved.'))return;
    busy=true;
    try {
      await api('/api/student-portal/accounts/'+encodeURIComponent(studentId)+'/status',
        {method:'PATCH',body:JSON.stringify({active:false})});
      announce('Student portal login suspended. Attendance history is unchanged.');
      await refreshAfterMutation();
      document.dispatchEvent(new CustomEvent('attendigo:requests-changed'));
    } catch(error){announce(error.message,true);}
    finally{busy=false;}
  }
  async function refreshAfterMutation(){
    const [directory,requestData]=await Promise.all([
      api('/api/student-portal/accounts'),api('/api/student-portal/requests')
    ]);
    students=directory.students||[];
    requests=requestData.requests||[];
    renderDirectory();renderRequests();
  }
  async function bulkCreate() {
    if (!isAdmin()||busy || selected.size===0)return;
    const ids=[...selected];
    if(ids.length>20){announce('Select at most 20 learners in one batch.',true);return;}
    if(!await confirmAction('Create '+ids.length+' student portal accounts? Passwords will be shown once.'))return;
    busy=true;
    try{
      const result=await api('/api/student-portal/accounts/bulk-provision',
        {method:'POST',body:JSON.stringify({studentIds:ids})});
      selected.clear();
      openCredentials(result.credentials||[]);
      document.dispatchEvent(new CustomEvent('attendigo:requests-changed'));
      await refreshAfterMutation().catch(error => announce('Credentials issued. Account list refresh failed: ' + error.message, true));
    }catch(error){announce(error.message,true);}
    finally{busy=false;}
  }
  function showTeacherRequest(studentId,action) {
    if(!isTeacher())return;
    const student=students.find(s=>s.studentId===studentId);
    if(!student || pendingFor(studentId))return;
    activeStudent=student;
    $('sapRequestStudentId').value=studentId;
    $('sapRequestType').value=action;
    $('sapRequestStudent').textContent=student.fullName+' · '+studentId+' · '+(action==='CREATE'?'Create portal login':action==='RESET'?'Reset password':'Reactivate portal login');
    $('sapRequestFeedback').textContent='';
    $('sapRequestModal').hidden=false;
    $('sapReason').focus();
  }
  function showReview(requestId,decision){
    if(!isAdmin())return;
    const request=requests.find(r=>r.requestId===requestId&&r.status==='PENDING');
    if(!request)return;
    pendingReview=request;
    $('sapReviewRequestId').value=requestId;
    $('sapReviewDecision').value=decision;
    $('sapReviewTitle').textContent=decision==='APPROVE'?'Approve student account request':'Reject student account request';
    $('sapReviewDetails').textContent=request.fullName+' · '+request.requestType+' · Requested by '+request.requestedBy;
    $('sapReviewSubmit').textContent=decision==='APPROVE'?'Approve and issue credentials':'Reject request';
    $('sapReviewFeedback').textContent='';
    $('sapReviewModal').hidden=false;
    $('sapReviewNote').focus();
  }
  view.addEventListener('click',async event=>{
    const selection=event.target.closest('[data-sap-select]');
    if(selection) {
      if(selection.checked)selected.add(selection.dataset.sapSelect);
      else selected.delete(selection.dataset.sapSelect);
      renderDirectory();return;
    }
    const action=event.target.closest('[data-sap-action]');
    if(action){
      const kind=action.dataset.sapAction,id=action.dataset.studentId;
      if(isAdmin()) {
        if(kind==='SUSPEND') await suspend(id);else await issue(id,kind);
      }else showTeacherRequest(id,kind);
      return;
    }
    const review=event.target.closest('[data-sap-review]');
    if(review)showReview(review.dataset.requestId,review.dataset.sapReview);
  });
  $('sapRefresh').addEventListener('click',refresh);
  $('sapSearch').addEventListener('input',renderDirectory);
  $('sapFilter').addEventListener('change',renderDirectory);
  $('sapSelectAll').addEventListener('change',event=>{
    filtered().filter(s=>!s.hasAccount).forEach(s=>event.target.checked?selected.add(s.studentId):selected.delete(s.studentId));
    renderDirectory();
  });
  $('sapBulkCreate').addEventListener('click',bulkCreate);
  $('sapRequestClose').addEventListener('click',()=>closeModal('sapRequestModal'));
  $('sapReviewClose').addEventListener('click',()=>closeModal('sapReviewModal'));
  $('sapSecretClose').addEventListener('click',()=>closeModal('sapSecretModal'));
  ['sapRequestModal','sapReviewModal','sapSecretModal'].forEach(id=>{
    $(id).addEventListener('click',event=>{if(event.target===$(id))closeModal(id);});
  });
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    ['sapRequestModal','sapReviewModal','sapSecretModal'].forEach(id=>{
      if(!$(id).hidden)closeModal(id);
    });
  });
  $('sapRequestForm').addEventListener('submit',async event=>{
    event.preventDefault();
    if(!isTeacher()||busy||!activeStudent)return;
    const button=$('sapRequestSubmit');
    button.disabled=true;
    try{
      await api('/api/student-portal/requests',{method:'POST',body:JSON.stringify({
        studentId:$('sapRequestStudentId').value,requestType:$('sapRequestType').value,
        reason:$('sapReason').value.trim()
      })});
      closeModal('sapRequestModal');
      document.dispatchEvent(new CustomEvent('attendigo:requests-changed'));
      await refreshAfterMutation();
      announce('Your request is pending School Admin approval.');
    }catch(error){$('sapRequestFeedback').textContent=error.message;}
    finally{button.disabled=false;}
  });
  $('sapReviewForm').addEventListener('submit',async event=>{
    event.preventDefault();
    if(!isAdmin()||busy||!pendingReview)return;
    const button=$('sapReviewSubmit');
    button.disabled=true;
    try{
      const result=await api('/api/student-portal/requests/'+encodeURIComponent($('sapReviewRequestId').value)+'/review',
        {method:'POST',body:JSON.stringify({decision:$('sapReviewDecision').value,note:$('sapReviewNote').value.trim()})});
      closeModal('sapReviewModal');
      document.dispatchEvent(new CustomEvent('attendigo:requests-changed'));
      if(result.credentials)openCredentials([result.credentials]);
      else announce('Request rejected. No student login was changed.');
      await refreshAfterMutation().catch(error => announce('Decision saved; list refresh failed: ' + error.message, true));
    }catch(error){$('sapReviewFeedback').textContent=error.message;}
    finally{button.disabled=false;}
  });
  $('sapCopySecrets').addEventListener('click',async()=>{
    if(!isAdmin()||!credentials.length)return;
    try{
      await navigator.clipboard.writeText($('sapSecrets').value);
      announce('Temporary credentials copied. Share privately and clear your clipboard afterward.');
    }catch(error){$('sapSecrets').focus();$('sapSecrets').select();announce('Copy blocked by the browser. The credentials are selected; copy them manually.',true);}
  });
  $('sapPrintSecrets')?.addEventListener('click',()=>{
    if(!isAdmin() || !credentials.length)return;
    const existing=document.getElementById('sapPrintSlips');
    if(existing)existing.remove();
    const wrapper=document.createElement('section');
    wrapper.id='sapPrintSlips';
    wrapper.setAttribute('aria-label','Private student portal login slips');
    const schoolCode=identity()?.schoolCode || '';
    const portalUrl=window.location.origin+'/portal-login.html';
    for (const record of credentials) {
      const slip=document.createElement('section');
      slip.className='sap-print-slip';
      const heading=document.createElement('h2');
      heading.textContent='Attendigo · Student portal access';
      slip.append(heading);
      for(const [label,value] of [
        ['Learner',record.fullName],['Student ID',record.studentId],
        ['School code',schoolCode],['Username',record.username],
        ['Temporary password',record.temporaryPassword],['Login page',portalUrl]
      ]){
        const p=document.createElement('p');
        const strong=document.createElement('strong');
        strong.textContent=label+': ';
        const span=document.createElement('span');
        span.textContent=String(value||'—');
        p.append(strong,span);
        slip.append(p);
      }
      const note=document.createElement('p');
      note.className='sap-print-warning';
      note.textContent='CONFIDENTIAL — Hand directly to the learner or a verified guardian in a sealed slip. Change this temporary password immediately at first sign-in.';
      slip.append(note);
      wrapper.append(slip);
    }
    document.body.append(wrapper);
    document.body.classList.add('sap-print-mode');
    const clean=()=>{
      document.body.classList.remove('sap-print-mode');
      wrapper.remove();
      window.removeEventListener('afterprint',clean);
    };
    window.addEventListener('afterprint',clean,{once:true});
    window.requestAnimationFrame(()=>window.print());
  });
  $('sapDownloadSecrets').addEventListener('click',()=>{
    if(!isAdmin()||!credentials.length)return;
    const csvValue = value=>'"'+String(value??'').replace(/"/g,'""').replace(/^[=+@-]/,"'$&")+'"';
    const rows=[['Student ID','Name','Username','Temporary password'],...credentials.map(c=>[c.studentId,c.fullName,c.username,c.temporaryPassword])];
    const content='\uFEFF'+rows.map(row=>row.map(csvValue).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');
    a.href=url;a.download='attendigo-student-portal-credentials.csv';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    announce('Credentials file downloaded. Protect it and delete it after distributing.');
  });
  const observer=new MutationObserver(()=>{
    if(!view.hidden && (isAdmin()||isTeacher()))refresh();
    else if(view.hidden && !$('sapSecretModal').hidden)closeModal('sapSecretModal');
  });
  observer.observe(view,{attributes:true,attributeFilter:['hidden']});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!view.hidden)refresh();});
  window.setInterval(()=>{if(!document.hidden&&!view.hidden)refresh();},45000);
  if(!view.hidden)refresh();
})();