(() => {
  const token=null;const $=id=>document.getElementById(id);const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,options={}){const h=new Headers(options.headers||{});const r=await fetch(url,{...options,headers:h,cache:'no-store'});if(r.status===401){sessionStorage.removeItem('schoolAttendance.accessToken');sessionStorage.removeItem('schoolAttendance.user');sessionStorage.removeItem('schoolAttendance.expiresAt');location.replace('/portal-login.html');throw new Error('Session expired.');}const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Request failed.');return d;}

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
    const date=$('parentAttendanceDate'),subject=$('parentAttendanceSubject');
    const previousDate=date.value||'LATEST',previousSubject=subject.value||'ALL';
    const dates=[...new Set(attendanceRecords.map(dayKey).filter(Boolean))].sort().reverse();
    const subjects=[...new Set(attendanceRecords.filter(r=>r.scope==='CLASS').map(subjectKey))].sort((a,b)=>a.localeCompare(b));
    date.replaceChildren(new Option('Latest recorded day','LATEST'),new Option('All recent dates','ALL'),...dates.map(d=>new Option(formatDate(d),d)));
    date.value=['LATEST','ALL',...dates].includes(previousDate)?previousDate:'LATEST';
    subject.replaceChildren(new Option('All subjects','ALL'),...subjects.map(name=>new Option(name,name)));
    subject.value=['ALL',...subjects].includes(previousSubject)?previousSubject:'ALL';
  }
  function renderAttendance() {
    const scope=$('parentAttendanceScopeFilter').value||'ALL';
    const subject=$('parentAttendanceSubject');
    subject.disabled=scope==='SCHOOL';
    if(subject.disabled)subject.value='ALL';
    const records=filterAttendance(attendanceRecords,{search:$('parentAttendanceSearch').value,scope,subject:subject.value||'ALL',date:$('parentAttendanceDate').value||'LATEST'});
    const days=groupAttendance(records);
    const totalPages=Math.max(1,Math.ceil(days.length/HISTORY_DAYS_PER_PAGE));
    historyPage=Math.min(historyPage,totalPages-1);
    const visible=days.slice(historyPage*HISTORY_DAYS_PER_PAGE,(historyPage+1)*HISTORY_DAYS_PER_PAGE);
    const host=$('attendanceRows');
    const opened=new Set([...host.querySelectorAll('details[open]')].map(node=>node.dataset.historyKey));
    host.innerHTML=visible.length?visible.map(day=>{
      const count=day.groups.reduce((sum,g)=>sum+g.records.length,0);
      return `<section class="parent-history-day"><h3>${esc(formatDate(day.date))}<span>${count} accepted event${count===1?'':'s'}</span></h3><div class="parent-history-groups">${day.groups.map(group=>{
        const late=group.records.filter(r=>r.late).length;
        const key=JSON.stringify([day.date,group.gate,group.name]);
        return `<details class="parent-history-group" data-history-key="${esc(key)}"${opened.has(key)?' open':''}><summary><div class="parent-history-name"><strong>${esc(group.name)}</strong><small>${group.records.length} record${group.records.length===1?'':'s'} · Latest ${esc(formatTime(group.records[0].occurredAt))}</small></div><span class="parent-history-status${late?' is-late':''}">${late?late+' late':'Accepted'}</span><span class="parent-history-chevron" aria-hidden="true">⌄</span></summary><ul class="parent-history-events">${group.records.map(r=>`<li><div><strong>${esc(eventLabel(r))}</strong>${r.periodName&&r.periodName!==group.name?`<small>${esc(r.periodName)}</small>`:''}</div><span>${esc(formatTime(r.occurredAt))}</span><small class="parent-history-event-status">${r.late?'Late':'Accepted'}</small></li>`).join('')}</ul></details>`;
      }).join('')}</div></section>`;
    }).join(''):`<div class="parent-history-empty"><strong>${attendanceRecords.length?'No matching records':'No attendance records yet'}</strong><p>${attendanceRecords.length?'Choose another date, subject, or attendance area.':'Verified school gate and class events will appear here when recorded.'}</p></div>`;
    $('parentAttendanceDayStats').hidden=!records.length;
    $('parentHistoryClassCount').textContent=String(days.reduce((sum,day)=>sum+day.groups.filter(g=>!g.gate).length,0));
    $('parentHistoryLateCount').textContent=String(records.filter(r=>r.late).length);
    $('parentHistoryGateCount').textContent=String(records.filter(r=>r.scope==='SCHOOL').length);
    $('parentAttendancePages').hidden=totalPages<=1;
    $('parentHistoryPrevious').disabled=historyPage===0;
    $('parentHistoryNext').disabled=historyPage>=totalPages-1;
    $('parentHistoryPageLabel').textContent='Page '+(historyPage+1)+' of '+totalPages;
    const count=$('parentAttendanceVisibleCount');
    count.textContent=records.length?'Showing '+visible.reduce((sum,day)=>sum+day.groups.reduce((n,g)=>n+g.records.length,0),0)+' of '+records.length+' matching accepted events':'';
  }

  let linkedChildren=[],programs=new Map(),selectedId='',historyRequest=0,childrenRequest=0,historyLoading=false;
  function selectedChild(){return linkedChildren.find(c=>String(c.studentId)===selectedId);}
  function renderChild(){
    const child=selectedChild();
    $('children').innerHTML=child?`<div class="parent-child-identity"><div class="parent-child-initial" aria-hidden="true">${esc(String(child.fullName||'?').charAt(0).toUpperCase())}</div><div><h3>${esc(child.fullName)}</h3><p>${esc(child.studentId)} · ${esc(child.gradeLevel)} · ${esc(child.section)}</p><p>${esc(child.relationship)} · ${Number(child.todayTimeIns)||0} accepted time-ins today</p></div></div><details class="parent-child-settings"><summary>Child information &amp; photo</summary><p>Primary special program: <strong>${esc(programs.get(child.studentId)||'Not assigned for active school year')}</strong></p><button type="button" class="outline-button" data-photo-child="${esc(child.studentId)}">Request official photo replacement</button><p class="parent-help">The existing official photo stays until the school approves a change.</p></details>`:'<p class="parent-help">No approved child relationships are linked. Contact the school office if this is incorrect.</p>';
  }
  function resetHistory(){
    historyPage=0;attendanceRecords=[];
    $('parentAttendanceDate').value='LATEST';$('parentAttendanceScopeFilter').value='ALL';$('parentAttendanceSubject').value='ALL';$('parentAttendanceSearch').value='';
    updateHistoryFilters();
  }
  function setHistoryControls(disabled){
    for(const id of ['parentAttendanceDate','parentAttendanceScopeFilter','parentAttendanceSubject','parentAttendanceSearch'])$(id).disabled=disabled;
  }
  function clearHistoryView(message){
    $('attendanceRows').innerHTML='<p class="parent-history-empty">'+esc(message)+'</p>';
    $('parentAttendanceDayStats').hidden=true;$('parentAttendancePages').hidden=true;$('parentAttendanceVisibleCount').textContent='';
  }
  async function loadHistory(studentId,{reset=false}={}){
    const request=++historyRequest;
    const child=linkedChildren.find(c=>String(c.studentId)===studentId);
    if(!child||studentId!==selectedId){attendanceRecords=[];historyLoading=false;$('parentAttendanceCard').hidden=true;clearHistoryView('Select an approved linked child.');return;}
    if(reset)resetHistory();
    $('parentAttendanceCard').hidden=false;
    $('historyTitle').textContent='Attendance · '+child.fullName;
    historyLoading=true;setHistoryControls(true);clearHistoryView('Loading attendance…');
    try{
      const d=await api(`/api/parent/children/${encodeURIComponent(studentId)}/attendance`);
      if(request!==historyRequest||studentId!==selectedId)return;
      attendanceRecords=Array.isArray(d.attendance)?d.attendance:[];
      updateHistoryFilters();setHistoryControls(false);renderAttendance();
    }catch(error){
      if(request!==historyRequest||studentId!==selectedId)return;
      attendanceRecords=[];clearHistoryView('Attendance could not be loaded. Use Refresh to try again.');
      $('feedback').textContent=error.message;
      throw error;
    }finally{if(request===historyRequest){historyLoading=false;}}
  }
  async function load(){
    const request=++childrenRequest;
    const data=await api('/api/parent/children');
    if(request!==childrenRequest)return;
    linkedChildren=Array.isArray(data.children)?data.children:[];
    const before=selectedId;
    selectedId=linkedChildren.some(c=>String(c.studentId)===before)?before:String(linkedChildren[0]?.studentId??'');
    const select=$('parentChildSelect');
    select.replaceChildren(...(linkedChildren.length?linkedChildren.map(c=>new Option(c.fullName+' · '+c.gradeLevel+' '+c.section,String(c.studentId))):[new Option('No approved linked children','')]));
    select.value=selectedId;select.disabled=!linkedChildren.length;
    $('parentChildCount').textContent=String(linkedChildren.length);
    $('parentTodayTimeIns').textContent=String(linkedChildren.reduce((sum,c)=>sum+(Number(c.todayTimeIns)||0),0));
    $('parentChildrenArrived').textContent=String(linkedChildren.filter(c=>Number(c.todayTimeIns)>0).length);
    renderChild();
    const tasks=[loadHistory(selectedId,{reset:before!==selectedId})];
    tasks.push(api('/api/special-programs/mine').then(membership=>{
      if(request!==childrenRequest)return;
      programs=new Map((membership.students||[]).map(p=>[p.studentId,p.programCode?p.programCode+' — '+p.programName:'Not assigned for active school year']));
      renderChild();
    }).catch(()=>{}));
    await Promise.all(tasks);
  }
  $('parentChildSelect').addEventListener('change',()=>{selectedId=$('parentChildSelect').value;renderChild();void loadHistory(selectedId,{reset:true}).catch(()=>{});});
  const resetPage=()=>{if(!historyLoading){historyPage=0;renderAttendance();}};
  $('parentAttendanceSearch').addEventListener('input',resetPage);
  for(const id of ['parentAttendanceDate','parentAttendanceScopeFilter','parentAttendanceSubject'])$(id).addEventListener('change',resetPage);
  $('parentHistoryPrevious').addEventListener('click',()=>{if(!historyLoading){historyPage=Math.max(0,historyPage-1);renderAttendance();}});
  $('parentHistoryNext').addEventListener('click',()=>{if(!historyLoading){historyPage++;renderAttendance();}});
  async function init(){const me=await api('/api/auth/me');if(me.user.role!=='PARENT'){location.replace('/portal.html');return;}$('welcome').textContent='Welcome, '+(me.user.displayName||me.user.username);$('schoolLabel').textContent=me.user.schoolName||'PARENT PORTAL';window.ProfilePhotos?.mountSelf({token,role:'PARENT',container:'#parentProfilePhoto',displayName:me.user.displayName||me.user.username});const note=$('parentProfilePhoto').querySelector('.my-photo-copy p');if(note)note.textContent='Manage your parent account photo.';window.ProfilePhotos?.mountParentStudentRequests(token);await load();}
  $('refreshButton').addEventListener('click',async()=>{const button=$('refreshButton');if(button.disabled)return;button.disabled=true;document.dispatchEvent(new Event('attendigo:requests-changed'));try{await load();$('feedback').textContent='Information refreshed.';}catch(e){$('feedback').textContent=e.message;}finally{button.disabled=false;}});
  $('logoutButton').addEventListener('click',async()=>{++historyRequest;try{await api('/api/auth/logout',{method:'POST'});}catch{}sessionStorage.removeItem('schoolAttendance.accessToken');sessionStorage.removeItem('schoolAttendance.user');sessionStorage.removeItem('schoolAttendance.expiresAt');location.replace('/portal-login.html');});
  init().catch(e=>$('feedback').textContent=e.message);
})();
