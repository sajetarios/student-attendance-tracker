'use strict';
(() => {
 const $=id=>document.getElementById(id);
 const themePicker=$('themePreference');
 if(themePicker){
  themePicker.value=document.documentElement.dataset.theme||'light';
  themePicker.addEventListener('change',()=>{
   const selected=themePicker.value;
   if(!['light','dark','system'].includes(selected))return;
   document.documentElement.dataset.theme=selected;
   try{localStorage.setItem('attendigo.principal.theme',selected);}catch(_){}
  });
 }
 const MAX_AGE_DAYS=365;
 const fmt=v=>Number.isFinite(Number(v))?new Intl.NumberFormat('en-PH').format(Number(v)):'—';
 const toDay=when=>{
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(when);
  const p=Object.fromEntries(parts.map(t=>[t.type,t.value]));
  return p.year+'-'+p.month+'-'+p.day;
 };
 const today=toDay(new Date());
 const minDate=new Date(Date.parse(today+'T00:00:00Z')-MAX_AGE_DAYS*86400000).toISOString().slice(0,10);
 let latest=null,abort=null,sequence=0,activeSection='overview';
 const buttons=[...document.querySelectorAll('[data-section]')];
 const sectionMap={overview:'overviewPanel',departments:'departmentsPanel',
  staff:'staffPanel',priorities:'prioritiesPanel',definitions:'definitionsPanel'};
 function status(message,state='info'){
  const el=$('feedback');
  el.textContent=message;el.dataset.state=state;
 }
 function switchSection(name){
  if(!sectionMap[name])return;
  activeSection=name;
  for(const button of buttons){
   const selected=button.dataset.section===name;
   button.classList.toggle('is-active',selected);
   button.setAttribute('aria-pressed',String(selected));
  }
  for(const [key,id] of Object.entries(sectionMap))$(id).hidden=key!==name;
  if(name==='staff'&&latest)$('staffSearch').focus({preventScroll:true});
 }
 function csvSafe(value){
  const raw=String(value??'').replace(/\r|\n/g,' ');
  return '"'+(/^[\s]*[=+\-@]/.test(raw)?"'"+raw:raw).replace(/"/g,'""')+'"';
 }
 function errorText(error){
  return error?.message||'Data could not be loaded.';
 }
 function make(tag,cls,textContent){
  const el=document.createElement(tag);
  if(cls)el.className=cls;
  if(textContent!==undefined)el.textContent=String(textContent);
  return el;
 }
 function numeric(v){return Math.max(0,Number(v)||0);}
 function countLabel(value,label){
  return fmt(value)+' '+label;
 }
 async function getSession(){
  const response=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});
  if(response.status===401){window.location.replace('/portal-login.html');return null;}
  if(!response.ok)throw Error('Could not verify your staff session ('+response.status+').');
  const data=await response.json();
  if(data.user?.mustChangePassword){
   window.location.replace('/force-password-change.html');return null;
  }
  if(!data.user||!['PRINCIPAL','SCHOOL_ADMIN'].includes(data.user.role))
   throw Error('This school leadership dashboard requires a Principal or School Admin account.');
  if(data.user.role==='SCHOOL_ADMIN'){
   $('roleBadge').textContent='School Admin preview · Read-only';
   $('adminBack').hidden=false;
  }else $('roleBadge').textContent='Principal · School oversight';
  return data.user;
 }
 function applyDepartmentOptions(data){
  const select=$('departmentFilter'),previous=select.value;
  const known=new Set((data.departments||[]).map(d=>d.departmentId));
  if(select.options.length===1){
   select.replaceChildren(new Option('All departments',''));
   for(const dep of data.departments||[])select.add(new Option(dep.name,dep.departmentId));
  }
  if(previous&&known.has(previous))select.value=previous;
 }
 function applyMetrics(data){
  const m=data.metrics||{},en=data.enrollment||{};
  $('schoolTitle').textContent=data.school?.schoolName||'School leadership dashboard';
  $('schoolCode').textContent='School '+(data.school?.schoolCode||'');
  const d=new Date(data.generatedAt);
  $('generatedAt').textContent='Updated '+(Number.isFinite(d.getTime())?
   new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(d):'time unavailable');
  $('heroPending').textContent=fmt(data.approvals?.totalPending);
  $('withVerifiedPunch').textContent=fmt(m.withVerifiedPunch);
  $('staffTrackedDescription').textContent='Of '+fmt(m.trackedStaff)+' tracked active staff';
  $('pendingDtrSlots').textContent=fmt(m.pendingDtrSlots);
  $('activeStudentRecords').textContent=fmt(en.activeStudentRecords);
  $('acceptedClassCheckins').textContent=fmt(m.acceptedClassCheckins);
 }
 function renderTrend(data){
  const host=$('trendChart');host.replaceChildren();
  const rows=Array.isArray(data.trends)?data.trends:[];
  const peak=Math.max(1,...rows.flatMap(r=>[numeric(r.verified),numeric(r.pending)]));
  for(const day of rows){
   const btn=make('button','trend-day');
   btn.type='button';
   btn.classList.toggle('is-selected',day.date===$('reportDate').value);
   btn.setAttribute('aria-label',day.date+': '+countLabel(day.verified,'verified DTR slots')+
     ', '+countLabel(day.pending,'pending DTR slots')+'. Select this report date.');
   const count=make('span','trend-count',numeric(day.verified)||numeric(day.pending)?numeric(day.verified)+numeric(day.pending):'0');
   const bars=make('span','trend-bars');
   const verified=make('i','verified'),pending=make('i','pending');
   verified.style.height=(numeric(day.verified)/peak*100)+'%';
   pending.style.height=(numeric(day.pending)/peak*100)+'%';
   bars.append(verified,pending);
   const date=make('span','trend-date',day.date.slice(5));
   btn.append(count,bars,date);
   btn.addEventListener('click',()=>{
    $('reportDate').value=day.date;
    void load();
   });
   host.append(btn);
  }
  if(!rows.length)host.textContent='No trend data is available for this period.';
 }
 function addAttention(host,title,details,count,target,icon){
  const item=make('div','attention-item');
  const mark=make('span','mark',icon);
  const label=make('span');
  label.append(make('strong',null,title),make('small',null,details));
  item.append(mark,label,make('b',null,fmt(count)));
  host.append(item);
  if(target){
   item.tabIndex=0;item.setAttribute('role','button');
   item.setAttribute('aria-label',title+'; open '+target);
   item.addEventListener('click',()=>switchSection(target));
   item.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();switchSection(target);}});
  }
 }
 function renderAttention(data){
  const host=$('attentionList');host.replaceChildren();
  const m=data.metrics||{},a=data.approvals||{},loc=data.locationSetup||{};
  addAttention(host,'DTR events pending verification','Selected school date · not part of certified Form 48',m.pendingDtrSlots,'staff','!');
  addAttention(host,'Leave applications in progress','Documented workflow stages · not final approvals',
   Object.values(a.leave||{}).reduce((n,v)=>n+numeric(v),0),'priorities','L');
  addAttention(host,'Official Business in progress','Department or school review',Object.values(a.ob||{}).reduce((n,v)=>n+numeric(v),0),'priorities','O');
  addAttention(host,'Department locations awaiting approval','Pending QR location configuration',loc.pending,'priorities','⌖');
 }
 function departmentCard(dep){
  const btn=make('button','dept-card');btn.type='button';
  btn.append(make('strong',null,dep.name),make('span','sub',countLabel(dep.trackedStaff,'tracked active staff')));
  const bar=make('div','progress');const progress=make('span');
  // A proportion of staff with any verified punch, not attendance rate.
  progress.style.width=(numeric(dep.trackedStaff)>0?Math.min(100,100*numeric(dep.withVerifiedPunch)/numeric(dep.trackedStaff)):0)+'%';
  bar.append(progress);btn.append(bar);
  const nums=make('div','nums');
  nums.append(make('span',null,fmt(dep.withVerifiedPunch)+' with verified punch'),
   make('span',null,fmt(dep.withPendingPunch)+' with pending punch'));
  btn.append(nums);
  btn.setAttribute('aria-label',dep.name+': '+fmt(dep.withVerifiedPunch)+
   ' staff with a verified punch; filter this department');
  btn.addEventListener('click',()=>{
   $('departmentFilter').value=dep.departmentId;
   switchSection('overview');
   void load();
  });
  return btn;
 }
 function renderDepartments(data){
  const preview=$('departmentPreview'),list=$('departmentsList');
  preview.replaceChildren();list.replaceChildren();
  const rows=data.departmentRows||[];
  for(const dep of rows){list.append(departmentCard(dep));if(preview.children.length<6)preview.append(departmentCard(dep));}
  if(!rows.length){preview.textContent='No active school departments are configured.';list.textContent=preview.textContent;}
 }
 function statusOf(row){
  if(numeric(row.pendingSlots)>0)return {label:'Pending review',cls:'pending'};
  if(numeric(row.verifiedSlots)>0)return {label:'Verified punch',cls:''};
  if(row.approvedLeave)return {label:'Approved leave',cls:'leave'};
  return {label:'No verified punch',cls:'missing'};
 }
 function filteredStaff(){
  if(!latest)return [];
  const text=$('staffSearch').value.trim().toLocaleLowerCase(),filter=$('staffStatus').value;
  return (latest.staffRows||[]).filter(r=>{
   if(text&&![r.name,r.department,r.role].join(' ').toLocaleLowerCase().includes(text))return false;
   if(filter==='pending'&&numeric(r.pendingSlots)===0)return false;
   if(filter==='verified'&&numeric(r.verifiedSlots)===0)return false;
   if(filter==='no-punch'&&numeric(r.verifiedSlots)!==0)return false;
   if(filter==='leave'&&!r.approvedLeave)return false;
   return true;
  });
 }
 function renderStaff(){
  const body=$('staffTable');body.replaceChildren();
  if(!latest)return;
  const rows=filteredStaff();
  $('staffCount').textContent='Showing '+fmt(rows.length)+' matching employees'+
    (latest.staffRowsLimited?' · First 200 staff records returned; use department filtering to narrow.':'')+
    ' · '+latest.schoolDate+' · Not a punctuality or absence determination.';
  for(const r of rows){
   const tr=document.createElement('tr');
   const name=document.createElement('td');
   name.append(make('strong',null,r.name),make('small',null,String(r.role||'').replaceAll('_',' ')));
   tr.append(name,make('td',null,r.department||'Unassigned'),
    make('td',null,fmt(r.verifiedSlots)+'/4'),
    make('td',null,fmt(r.pendingSlots)));
   const last=document.createElement('td');const st=statusOf(r);
   last.append(make('span','status '+st.cls,st.label));tr.append(last);
   body.append(tr);
  }
  if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;
   td.textContent='No staff match the current filters. This is not evidence of absence.';tr.append(td);body.append(tr);}
 }
 function renderPriorities(data){
  const root=$('priorityBreakdown');root.replaceChildren();
  const leave=data.approvals?.leave||{},ob=data.approvals?.ob||{},m=data.metrics||{},loc=data.locationSetup||{};
  const entries=[
   ['Leave: Department recommendation',leave.PENDING_HEAD||0,'Awaiting the Department Head review'],
   ['Leave: School review',leave.PENDING_ADMIN||0,'Waiting for authorized school-level review'],
   ['Leave: Official decision',leave.PENDING_EXTERNAL||0,'Requires documented decision by the authorized official'],
   ['OB: Department review',ob.PENDING_HEAD||0,'Waiting for Department Head recommendation'],
   ['OB: School review',ob.PENDING_ADMIN||0,'Waiting for School Admin decision'],
   ['DTR: Unverified slots',m.pendingDtrSlots||0,'Selected school date · not certified'],
   ['Location proposals',loc.pending||0,'Department points awaiting School Admin approval']
  ];
  for(const [label,value,explain] of entries){
   const card=make('div','priority-card');
   card.append(make('h3',null,label),make('strong',null,fmt(value)),make('p',null,explain));
   root.append(card);
  }
 }
 function renderDefinitions(data){
  const host=$('definitionList');host.replaceChildren();
  const definitions={
   'Staff with verified punch':data.definitions?.withVerifiedPunch,
   'Verified DTR slots':data.definitions?.verifiedDtrSlots,
   'Accepted classroom check-ins':data.definitions?.acceptedClassCheckins,
   'Pending school requests':data.definitions?.pendingApprovals,
   'No activity recorded':data.definitions?.noData,
   'Student enrollment':'Active student records count uses active learner roster; active school year enrollment is separately derived from ENROLLED students only.'
  };
  for(const [name,meaning] of Object.entries(definitions)){
   const card=make('div','definition-item');
   card.append(make('strong',null,name),make('p',null,meaning||'No definition was returned by the server.'));
   host.append(card);
  }
 }
 function renderBriefing(data){
  const host=$('briefingActions'),summary=$('briefingSummary'),scope=$('briefingScope');
  if(!host||!summary||!scope)return;
  host.replaceChildren();
  const m=data.metrics||{},a=data.approvals||{},loc=data.locationSetup||{};
  const pendingDtr=numeric(m.pendingDtrSlots);
  const openRequests=numeric(a.totalPending);
  const totalDepartments=numeric(loc.total),approvedDepartments=numeric(loc.approved);
  const unapprovedDepartments=Math.max(0,totalDepartments-approvedDepartments);
  const dept=data.departmentId?($('departmentFilter').selectedOptions?.[0]?.textContent||'Selected department'):'All departments';
  scope.textContent=dept+' · '+data.schoolDate;
  summary.textContent='For '+data.schoolDate+', '+fmt(m.verifiedDtrSlots)+
   ' verified staff DTR slot entries and '+fmt(m.pendingDtrSlots)+
   ' pending DTR slot entries were recorded in this scope. No employee absence or punctuality is inferred.';
  const items=[
   {
    icon:'◷',name:'Attendance evidence',value:fmt(pendingDtr)+' pending',
    text:pendingDtr? 'Review the original evidence before accepting DTR slots.':
      'No unverified DTR slots are recorded for this date. This does not establish full attendance.',
    action:'Inspect DTR',kind:pendingDtr?'attention':'stable',
    click:()=>{$('staffStatus').value=pendingDtr?'pending':'all';switchSection('staff');renderStaff();}
   },
   {
    icon:'▤',name:'Decisions and requests',value:fmt(openRequests)+' open',
    text:openRequests?'Leave and OB requests still have workflow steps outstanding.':
      'No pending leave or OB workflows were returned for this scope.',
    action:'Inspect stages',kind:openRequests?'attention':'stable',click:()=>switchSection('priorities')
   },
   {
    icon:'⌖',name:'Department QR readiness',value:fmt(approvedDepartments)+' / '+fmt(totalDepartments),
    text:totalDepartments===0?'No active department locations are available for comparison.':
     unapprovedDepartments?
      fmt(unapprovedDepartments)+' department location(s) lack an approved QR check-in point.':
      'All returned department locations have approved QR check-in points.',
    action:'Explore departments',kind:unapprovedDepartments?'attention':'stable',
    click:()=>switchSection('departments')
   },
   {
    icon:'✓',name:'Learner scan activity',value:fmt(m.acceptedClassCheckins)+' learners',
    text:'Unique learners with an accepted classroom QR Time-In on the selected school date. This is not the official SF2 attendance count.',
    action:'Understand measure',kind:'neutral',click:()=>switchSection('definitions')
   }
  ];
  for(const item of items){
   const button=make('button','briefing-item briefing-'+item.kind);
   button.type='button';
   const heading=make('span','briefing-item-head');
   heading.append(make('span','briefing-item-icon',item.icon),
    make('strong',null,item.name));
   const count=make('span','briefing-item-value',item.value);
   const description=make('span','briefing-item-description',item.text);
   const action=make('span','briefing-item-link',item.action+' ↗');
   button.append(heading,count,description,action);
   button.setAttribute('aria-label',item.name+': '+item.value+'. '+item.text+' '+item.action);
   button.addEventListener('click',item.click);
   host.append(button);
  }
 }
 function render(data){
  latest=data;applyDepartmentOptions(data);applyMetrics(data);renderTrend(data);
  renderAttention(data);renderDepartments(data);renderStaff();renderPriorities(data);renderDefinitions(data);renderBriefing(data);
  const scope=data.departmentId?($('departmentFilter').selectedOptions?.[0]?.textContent||'Selected department'):'All departments';
  status('Live report · '+scope+' · '+data.schoolDate+' · verified source records only','success');
 }
 async function load(){
  if(abort)abort.abort();abort=new AbortController();const current=++sequence;
  $('refreshDashboard').disabled=true;
  status('Checking live school records. DTR and approval data are read-only…');
  try{
   const query=new URLSearchParams({date:$('reportDate').value,days:$('periodFilter').value});
   if($('departmentFilter').value)query.set('departmentId',$('departmentFilter').value);
   const response=await fetch('/api/principal/overview?'+query.toString(),
    {credentials:'same-origin',cache:'no-store',signal:abort.signal});
   if(response.status===401){window.location.replace('/portal-login.html');return;}
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||'Report request failed ('+response.status+').');
   if(current!==sequence)return;
   render(data);
  }catch(error){
   if(error.name==='AbortError'||current!==sequence)return;
   latest=null;
   for(const id of ['withVerifiedPunch','pendingDtrSlots','activeStudentRecords','acceptedClassCheckins','heroPending'])$(id).textContent='—';
   status('Unable to verify school records: '+errorText(error)+'. Retry; no estimated figures are displayed.','error');
  }finally{if(current===sequence)$('refreshDashboard').disabled=false;}
 }
 function downloadCsv(){
  if(!latest)return;
  const columns=['Name','Role','Department','Verified slots','Pending slots','Approved leave on date','Status'];
  const data=filteredStaff().map(r=>[r.name,r.role,r.department||'Unassigned',
   r.verifiedSlots,r.pendingSlots,r.approvedLeave?'Yes':'No',statusOf(r).label]);
  const csv=[columns,...data].map(row=>row.map(csvSafe).join(',')).join('\r\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),anchor=document.createElement('a');
  anchor.href=url;anchor.download='attendigo-principal-staff-'+latest.schoolDate+'.csv';
  document.body.append(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),0);
 }
 async function init(){
  $('reportDate').value=today;$('reportDate').max=today;$('reportDate').min=minDate;
  document.querySelectorAll('[data-jump]').forEach(b=>b.addEventListener('click',()=>switchSection(b.dataset.jump)));
  for(const b of buttons)b.addEventListener('click',()=>switchSection(b.dataset.section));
  $('openPriorities').addEventListener('click',()=>switchSection('priorities'));
  const presentation=$('presentationToggle');
  function setPresentation(enabled){
   document.body.classList.toggle('principal-presentation',enabled);
   if(presentation){
    presentation.setAttribute('aria-pressed',String(enabled));
    presentation.textContent=enabled?'✕ Exit presentation':'▣ Present dashboard';
    presentation.title=enabled?'Exit presentation mode':'Enter larger-text presentation mode';
   }
  }
  if(presentation)presentation.addEventListener('click',()=>setPresentation(
   !document.body.classList.contains('principal-presentation')));
  document.addEventListener('keydown',event=>{
   if(event.key==='Escape'&&document.body.classList.contains('principal-presentation'))
    setPresentation(false);
  });
  $('refreshDashboard').addEventListener('click',()=>void load());
  for(const id of ['reportDate','departmentFilter','periodFilter'])$(id).addEventListener('change',()=>void load());
  for(const id of ['staffSearch','staffStatus'])$(id).addEventListener(id==='staffSearch'?'input':'change',renderStaff);
  $('downloadStaff').addEventListener('click',downloadCsv);
  $('signOut').addEventListener('click',async()=>{
   const button=$('signOut');button.disabled=true;
   try{
    const r=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin',cache:'no-store'});
    if(!r.ok)throw Error('Sign-out failed. Please retry.');
    sessionStorage.removeItem('schoolAttendance.accessToken');
    sessionStorage.removeItem('schoolAttendance.user');
    window.location.replace('/portal-login.html');
   }catch(error){status(error.message,'error');button.disabled=false;}
  });
  const me=await getSession();if(!me)return;
  await load();
 }
 void init().catch(error=>{
  status('Unable to open Principal dashboard: '+errorText(error),'error');
 });
})();
