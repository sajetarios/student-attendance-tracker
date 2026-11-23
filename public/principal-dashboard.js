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
 let latest=null,classImpact=null,abort=null,sequence=0,activeSection='overview',currentRole=null,selectedSdoRequest=null;
 const buttons=[...document.querySelectorAll('[data-section]')];
 const sectionMap={overview:'overviewPanel',departments:'departmentsPanel',
  staff:'staffPanel',priorities:'prioritiesPanel',definitions:'definitionsPanel',badge:'badgePanel',personal:'personalPanel',students:'studentsPanel',calendar:'calendarPanel',security:'securityPanel',reports:'reportsPanel',notifications:'notificationsPanel',assistant:'assistantPanel'};
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
  for(const id of ['principalMyWorkspace','principalMore']){
   const select=$(id);
   if(select)select.value=Array.from(select.options).some(o=>o.value===name)?name:'';
  }
  if(name==='personal')$('principalPersonalRequests').open=false;
  if(name==='staff'&&latest)$('staffSearch').focus({preventScroll:true});
  if(name==='personal'){void loadPersonal();void loadSdoRequests();}
  if(name==='priorities'&&currentRole==='SCHOOL_ADMIN')void loadSdoRequests();
  if(name==='notifications')void loadNotifications();
  if(name==='calendar'&&currentRole==='PRINCIPAL')void loadMemoAdmin();
  if(['personal','calendar','security'].includes(name))void loadWorkspace();
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
   $('roleBadge').textContent='School Admin · SDO coordinator';
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
  $('heroPending').textContent='—';
  $('principalReportVerified').textContent=fmt(m.verifiedDtrSlots);
  $('principalReportPending').textContent=fmt(m.pendingDtrSlots);
  $('principalReportClassQr').textContent=fmt(m.acceptedClassCheckins);
  $('principalReportWorkflows').textContent=fmt(data.approvals?.totalPending);
  $('principalReportingScope').textContent='School date '+data.schoolDate+' · Last '+data.trendDays+' days in the DTR trend chart';
  $('principalSchoolAlerts').textContent=fmt(m.pendingDtrSlots)+' DTR slots pending verification; instructional coverage exceptions are checked separately. Routine leave and OB stages are informational, not Principal escalation alerts.';
  $('studentSummaryActive').textContent=fmt(data.enrollment?.activeStudentRecords);
  $('studentSummaryCheckins').textContent=fmt(m.acceptedClassCheckins);
  $('actionInboxSummary').textContent=fmt(data.approvals?.totalPending)+' pending leave/OB requests across review stages · '+fmt(m.pendingDtrSlots)+' pending DTR slots · '+fmt(data.locationSetup?.pending)+' QR locations pending review.';
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
  const m=data.metrics||{},loc=data.locationSetup||{};
  addAttention(host,'DTR events pending verification','Selected school date · not part of certified Form 48',m.pendingDtrSlots,'staff','!');
  // Never escalate routine leave or OB workflow stages as Principal alerts.
  if(classImpact&&(classImpact.limited||numeric(classImpact.unresolvedCount)>0))
   addAttention(host,'Classes without recorded coverage',
    'Approved leave/OB · substitute or schedule adjustment not yet documented',
    classImpact.limited?(classImpact.atLeast||classImpact.cases?.length||0):classImpact.unresolvedCount,
    'priorities','!');
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
  const departmentRows=Array.isArray(data.approvalDepartments)?data.approvalDepartments:[];
  const knownDepartments=new Set((data.departments||[]).map(d=>d.departmentId));
  const entries=[
   ['Leave: Department recommendation',leave.PENDING_HEAD||0,'Awaiting the Department Head review','LEAVE','PENDING_HEAD'],
   ['Leave: School review',leave.PENDING_ADMIN||0,'Waiting for authorized school-level review','LEAVE','PENDING_ADMIN'],
   ['Leave: Official decision',leave.PENDING_EXTERNAL||0,'Requires documented decision by the authorized official','LEAVE','PENDING_EXTERNAL'],
   ['OB: Department review',ob.PENDING_HEAD||0,'Waiting for Department Head recommendation','OB','PENDING_HEAD'],
   ['OB: School review',ob.PENDING_ADMIN||0,'Waiting for School Admin decision','OB','PENDING_ADMIN'],
   ['DTR: Unverified slots',m.pendingDtrSlots||0,'Selected school date · not certified',null,null],
   ['Location proposals',loc.pending||0,'Department points awaiting School Admin approval',null,null]
  ];
  function addDepartmentButton(parent,row){
   const department=row.departmentName||'Unassigned / unavailable department';
   const navigable=Boolean(row.departmentId&&knownDepartments.has(row.departmentId));
   const item=make(navigable?'button':'div','priority-department-row');
   if(navigable){
    item.type='button';
    item.title='Filter this read-only dashboard to '+department;
    item.setAttribute('aria-label','Show '+department+' pending school actions ('+fmt(row.total)+')');
    item.addEventListener('click',()=>{
     $('departmentFilter').value=row.departmentId;
     void load();
    });
   }
   item.append(make('span','priority-department-name',department),
    make('span','priority-department-count',fmt(row.total)));
   parent.append(item);
  }
  for(const [label,value,explain,kind,stage] of entries){
   const card=make('div','priority-card');
   card.append(make('h3',null,label),make('strong',null,fmt(value)),make('p',null,explain));
   if(kind&&numeric(value)>0){
    const departmentEntries=departmentRows.filter(r=>r.kind===kind&&r.status===stage&&numeric(r.total)>0);
    if(departmentEntries.length){
     const group=make('div','priority-department-group');
     group.append(make('span','priority-department-heading','Originating department'));
     for(const item of departmentEntries)addDepartmentButton(group,item);
     card.append(group);
    }else card.append(make('p','priority-department-unavailable','Department breakdown unavailable; verify the source record with School Admin.'));
   }
   root.append(card);
  }
  const host=$('actionInboxDepartmentSummary');
  if(!host)return;
  host.replaceChildren();
  const total=numeric(data.approvals?.totalPending);
  const departments=new Map();
  for(const item of departmentRows){
   if(!['LEAVE','OB'].includes(item.kind)||numeric(item.total)===0)continue;
   const key=item.departmentId||'unassigned';
   const existing=departments.get(key);
   if(existing)existing.total+=numeric(item.total);
   else departments.set(key,{departmentId:item.departmentId,
    departmentName:item.departmentName,total:numeric(item.total)});
  }
  if(total===0)host.append(make('span',null,'No pending leave or OB requests by department.'));
  else if(departments.size){
   host.append(make('span','priority-summary-label','Pending requests from:'));
   const names=[...departments.values()].sort((a,b)=>a.departmentName.localeCompare(b.departmentName));
   for(const row of names)addDepartmentButton(host,row);
  }else host.append(make('span',null,'Department source details are currently unavailable.'));
  if(data.departmentId){
   const reset=make('button','priority-reset','Show all departments');
   reset.type='button';
   reset.addEventListener('click',()=>{$('departmentFilter').value='';void load();});
   host.append(reset);
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

 // Only missing documented classroom coverage is raised to the Principal.
 // Routine leave/OB review states are kept under the collapsed reference list.
 function renderClassImpact(data,errorMessage=''){
  const detail=$('principalClassImpactList'),scope=$('principalClassImpactStatus'),
   total=$('principalClassImpactTotal'),overview=$('principalClassOverviewStatus');
  if(!detail||!scope||!total||!overview)return;
  detail.replaceChildren();
  if(!data){
   const message=errorMessage||'Checking recorded class coverage for the next seven days…';
   scope.textContent=message;
   overview.textContent=message;
   total.textContent='Not verified';
   $('heroPending').textContent='—';
   if(errorMessage)detail.append(make('p','source-note',
    'Coverage cannot currently be verified. Do not interpret this as zero uncovered classes.'));
   return;
  }
  const cases=Array.isArray(data.cases)?data.cases:[];
  const number=data.limited?fmt(data.atLeast||cases.length)+'+':fmt(data.unresolvedCount);
  const hasAlerts=data.limited||numeric(data.unresolvedCount)>0;
  $('heroPending').textContent=number;
  total.textContent=number+' period'+(!data.limited&&numeric(data.unresolvedCount)===1?'':'s');
  if(!hasAlerts){
   const message='No approved leave/OB class periods without recorded coverage from '+
    data.fromDate+' through '+data.throughDate+'.';
   scope.textContent=message;
   overview.textContent='No uncovered class periods found in the recorded timetable for the next seven days.';
   detail.append(make('div','principal-class-covered','No unresolved class coverage was found. Department-managed requests do not generate a Principal alert.'));
  }else{
   scope.textContent='Only approved leave/OB periods without recorded substitutes or valid timetable adjustments are shown. '+
    (data.limited?'Additional records exist; filter by department to review more.':'');
   overview.textContent=number+' class period'+(!data.limited&&numeric(data.unresolvedCount)===1?'':'s')+
    ' still need'+(!data.limited&&numeric(data.unresolvedCount)===1?'s':'')+
    ' coverage documented by the department. Select Review class coverage.';
   for(const row of cases.slice(0,60)){
    const card=make('article','principal-class-impact-row');
    const head=make('div','principal-class-impact-row-head');
    const title=make('strong',null,[
     row.gradeLevel?'Grade '+row.gradeLevel:'',
     row.section||'Section not recorded'
    ].filter(Boolean).join(' · '));
    const when=make('span',null,row.date+' · '+(row.startTime||'—')+'–'+(row.endTime||'—'));
    head.append(title,when);
    const line=make('p',null,
      (row.periodName||'Scheduled class')+' · '+(row.kind==='OB'?'Approved OB':'Approved leave')+
      ' · No recorded substitute');
    const footer=make('div','principal-class-impact-row-footer');
    footer.append(make('span','principal-class-impact-department',row.departmentName||'Department unavailable'));
    const valid=Boolean(row.departmentId&&(latest?.departments||[]).some(d=>d.departmentId===row.departmentId));
    if(valid){
     const button=make('button','quiet-button','Filter department');
     button.type='button';
     button.addEventListener('click',()=>{$('departmentFilter').value=row.departmentId;void load();});
     footer.append(button);
    }
    card.append(head,line,footer);detail.append(card);
   }
   if(cases.length>60)detail.append(make('p','source-note',
     'Showing the first 60 of '+number+' returned period(s). Use the department filter for a focused view.'));
  }
  if(latest){
   const m=latest.metrics||{};
   $('principalSchoolAlerts').textContent=fmt(m.pendingDtrSlots)+' DTR slots pending verification; '+
    (hasAlerts?number+' approved leave/OB class period(s) without recorded coverage.':
      'No approved leave/OB class coverage exceptions found in the next seven days.')+
    ' Other leave/OB workflow stages are informational only.';
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
  const impactCount=classImpact
   ?(classImpact.limited?fmt(classImpact.atLeast||classImpact.cases?.length||0)+'+':fmt(classImpact.unresolvedCount))
   :'—';
  const impacted=Boolean(classImpact&&(classImpact.limited||numeric(classImpact.unresolvedCount)>0));
  const items=[
   {
    icon:'▤',name:'Class coverage exceptions',value:impactCount+' periods',
    text:!classImpact?'Checking seven-day approved leave and OB coverage.':
     impacted?'Department has not yet recorded substitute coverage for the flagged classes.':
      'No unresolved class coverage is recorded. Resolved departmental actions stay off the Principal alert list.',
    action:'Inspect class coverage',kind:!classImpact?'neutral':impacted?'attention':'stable',
    click:()=>switchSection('priorities')
   },
   {
    icon:'◷',name:'Attendance evidence',value:fmt(pendingDtr)+' pending',
    text:pendingDtr? 'Review the original evidence before accepting DTR slots.':
      'No unverified DTR slots are recorded for this date. This does not establish full attendance.',
    action:'Inspect DTR',kind:pendingDtr?'attention':'stable',
    click:()=>{$('staffStatus').value=pendingDtr?'pending':'all';switchSection('staff');renderStaff();}
   },
   {
    icon:'▤',name:'Administrative workflow reference',value:fmt(openRequests)+' in review',
    text:'Department-managed leave and OB review counts are not instructional coverage alerts.',
    action:'View stage counts',kind:'neutral',click:()=>{$('principalWorkflowDetails').open=true;switchSection('priorities');}
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
 function recognitionEmpty(icon,title,description){
  const element=make('div','recognition-empty');
  const symbol=make('span','recognition-empty-icon',icon);
  symbol.setAttribute('aria-hidden','true');
  const body=make('div');
  body.append(make('strong',null,title),make('p',null,description));
  element.append(symbol,body);
  return element;
 }
 function renderEarlyArrivals(data){
  const host=$('earlyArrivalsList'),count=$('earlyArrivalsCount');
  host.replaceChildren();
  const entries=data.earlyArrivals?.entries;
  const date=data.schoolDate||'selected date';
  $('earlyArrivalsSubtitle').textContent='Photo-verified gate entry before 7:00 AM · '+date+' · Asia/Manila';
  if(!Array.isArray(entries)){
   count.textContent='Data unavailable';
   count.dataset.state='empty';
   host.append(recognitionEmpty('–','Arrival data unavailable',
    'Verified gate entry records could not be checked. No attendance conclusion can be made.'));
   return;
  }
  count.textContent=entries.length+' verified '+(entries.length===1?'arrival':'arrivals');
  count.dataset.state=entries.length?'active':'empty';
  if(!entries.length){
   host.append(recognitionEmpty('☀','No verified early arrivals on this date',
    'No photo-verified entries before 7:00 AM for this date. This does not mean teachers were absent or late.'));
   return;
  }
  for(const person of entries){
   const item=make('div','principal-early-person');
   const avatar=make('span','principal-early-avatar','★');
   avatar.setAttribute('aria-hidden','true');
   const detail=make('div','principal-early-person-detail');
   detail.append(make('strong',null,person.name||'Teacher'),make('span',null,person.department||'Department not assigned'));
   const time=make('span','principal-early-time',String(person.arrivalTime||'—').slice(0,5));
   time.setAttribute('aria-label','Verified entry at '+time.textContent+' Philippine time');
   item.append(avatar,detail,time);host.append(item);
  }
 }
 function renderWatchNominees(data){
  const host=$('principalWatchNomineeList'),count=$('principalWatchCount'),
    period=$('principalWatchPeriod'),award=data.watchNominees;
  host.replaceChildren();
  if(!award||!Array.isArray(award.entries)){
   count.textContent='Data unavailable';
   count.dataset.state='empty';
   period.textContent='Recognition evidence could not be verified.';
   host.append(recognitionEmpty('–','Nomination data unavailable',
    'The evidence source could not be verified. No award decisions can be made from this display.'));
   return;
  }
  period.textContent='Rolling 30-day window · '+award.periodStart+' to '+award.periodEnd+
   ' · Asia/Manila · '+(data.departmentId?'selected department':'all departments');
  count.textContent=award.entries.length+' '+(award.entries.length===1?'candidate':'candidates');
  count.dataset.state=award.entries.length?'active':'empty';
  if(!award.entries.length){
   host.append(recognitionEmpty('✦','No candidates in this period',
    'No teacher meets all Watch Recognition thresholds yet. This is not an absence or performance finding.'));
   return;
  }
  for(const [i,person] of award.entries.entries()){
   const card=make('div','principal-watch-person');
   const numeral=make('span','principal-watch-rank',String(i+1));numeral.setAttribute('aria-label','Shortlist position '+(i+1));
   const identity=make('div','principal-watch-person-detail');
   identity.append(make('strong',null,person.name||'Teacher'),
    make('span',null,person.department||'Department not assigned'));
   const metrics=make('div','principal-watch-metrics');
   metrics.append(make('strong',null,String(person.earlyDays||0)+' early-entry days'),
    make('span',null,String(person.activeWeeks||0)+' different weeks'));
   card.append(numeral,identity,metrics);
   host.append(card);
  }
 }
 function render(data){
  latest=data;applyDepartmentOptions(data);applyMetrics(data);renderTrend(data);
  renderAttention(data);renderDepartments(data);renderStaff();renderPriorities(data);renderDefinitions(data);renderBriefing(data);renderEarlyArrivals(data);renderWatchNominees(data);
  const scope=data.departmentId?($('departmentFilter').selectedOptions?.[0]?.textContent||'Selected department'):'All departments';
  status('Live report · '+scope+' · '+data.schoolDate+' · verified source records only','success');
 }
 async function load(){
  if(abort)abort.abort();abort=new AbortController();const current=++sequence;
  classImpact=null;
  renderClassImpact(null);
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
   if(['personal','calendar','security'].includes(activeSection))void loadWorkspace();
   // Isolated optional read: an unavailable coverage source does not hide DTR
   // metrics or turn unknown instructional coverage into a false zero.
   try{
    const coverageQuery=new URLSearchParams();
    if($('departmentFilter').value)coverageQuery.set('departmentId',$('departmentFilter').value);
    const coverageResponse=await fetch('/api/principal/class-impact?'+coverageQuery,
     {credentials:'same-origin',cache:'no-store',signal:abort.signal});
    if(coverageResponse.status===401){window.location.replace('/portal-login.html');return;}
    const info=await coverageResponse.json().catch(()=>({}));
    if(!coverageResponse.ok)throw Error(info.error||'Class coverage request failed ('+coverageResponse.status+').');
    if(current!==sequence)return;
    classImpact=info;
    renderClassImpact(classImpact);
    if(latest){renderBriefing(latest);renderAttention(latest);}
   }catch(error){
    if(error.name==='AbortError'||current!==sequence)return;
    classImpact=null;
    renderClassImpact(null,'Could not verify class coverage. '+errorText(error));
    if(latest){renderBriefing(latest);renderAttention(latest);}
   }
  }catch(error){
   if(error.name==='AbortError'||current!==sequence)return;
   latest=null;
   $('earlyArrivalsList').replaceChildren(make('p','source-note','Early-arrival records are currently unavailable; no recognition can be verified.'));
   $('earlyArrivalsCount').textContent='Unavailable';
   $('principalWatchNomineeList').replaceChildren(make('p','source-note','Watch nomination records are unavailable; no candidate can be verified.'));
   $('principalWatchCount').textContent='Unavailable';
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

 const ownSlotLabels={AM_IN:'AM time-in',AM_OUT:'AM time-out',PM_IN:'PM time-in',PM_OUT:'PM time-out'};
 const manilaTime=value=>value?new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(value)):'Not recorded';
 let personalRevision=0;
 async function loadPersonal(){
  if(activeSection!=='personal')return;
  const request=++personalRevision,date=$('personalDate').value;
  const message=$('personalFeedback');
  message.textContent='Reading your verified attendance…';
  try{
   const opts={credentials:'same-origin',cache:'no-store'};
   const [d,g]=await Promise.all([
    fetch('/api/staff-attendance/my/dtr?date='+encodeURIComponent(date),opts),
    fetch('/api/teacher/my-gate-attendance?from='+encodeURIComponent(date)+'&to='+encodeURIComponent(date),opts)
   ]);
   if(d.status===401||g.status===401){window.location.replace('/portal-login.html');return;}
   const dtr=await d.json().catch(()=>({})),gate=await g.json().catch(()=>({}));
   if(!d.ok||!g.ok)throw Error(dtr.error||gate.error||'Could not verify your attendance.');
   if(request!==personalRevision)return;
   const slots=$('personalSlots');slots.replaceChildren();
   for(const item of dtr.slots||[]){
    const card=make('div','personal-slot');
    card.append(make('span',null,ownSlotLabels[item.slot]||item.slot),
      make('strong',null,item.status==='VERIFIED'&&item.occurredAt?manilaTime(item.occurredAt):'No verified punch'));
    card.title=item.status==='VERIFIED'?'Verified official DTR slot':'No verified official DTR slot in this source for the selected date; this does not establish absence.';
    slots.append(card);
   }
   const host=$('personalGate');host.replaceChildren();
   for(const event of gate.events||[]){
    const item=make('div','attention-item');
    item.append(make('strong',null,event.eventType==='TIME_IN'?'Gate entry':'Gate exit'),
     make('span',null,manilaTime(event.occurredAt)));
    host.append(item);
   }
   if(!gate.events?.length)host.append(make('p','source-note','No verified gate movements for this date.'));
   message.textContent='Loaded verified source records for '+date+'. Unverified entries, leave and OB are not included in these DTR slots.';
  }catch(error){
   if(request!==personalRevision)return;
   message.textContent='Attendance source unavailable — times cannot be determined. '+errorText(error);
   $('personalSlots').replaceChildren();$('personalGate').replaceChildren();
  }
 }
 async function showBadge(){
  const button=$('showPrincipalBadge');button.disabled=true;
  $('badgeNotice').textContent='Checking your staff identity…';
  try{
   const response=await fetch('/api/staff-attendance/my/badge',{method:'POST',credentials:'same-origin',cache:'no-store'});
   if(response.status===401){window.location.replace('/portal-login.html');return;}
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||'Your badge is unavailable.');
   $('principalBadgeImage').src=data.qrCode;
   $('badgeEmployeeName').textContent=data.displayName||'School Principal';
   $('badgeImageWrap').hidden=false;$('hidePrincipalBadge').hidden=false;
   $('badgeNotice').textContent='Show your private QR only to an authorized Gatekeeper.';
  }catch(error){$('badgeNotice').textContent=errorText(error);}
  finally{button.disabled=false;}
 }
 function hideBadge(){
  $('principalBadgeImage').removeAttribute('src');
  $('badgeImageWrap').hidden=true;$('hidePrincipalBadge').hidden=true;
  $('badgeNotice').textContent='Your badge is hidden. Viewing a badge never records attendance.';
 }


 const showList=(id,rows,render,empty)=>{
  const host=$(id);host.replaceChildren();
  if(!Array.isArray(rows)){host.append(make('p','source-note','Source unavailable.'));return;}
  if(!rows.length){host.append(make('p','source-note',empty||'No records found.'));return;}
  for(const row of rows.slice(0,30)){
   const item=make('div','principal-record-item');
   const lines=render(row);
   item.append(make('strong',null,lines[0]),make('small',null,lines[1]||''));
   host.append(item);
  }
 };
 const sectionRows=(data,key)=>data?.sections?.[key]?.available?data.sections[key].rows:null;
 let workspaceLoading=null;
 async function loadWorkspace(){
  if(workspaceLoading)return workspaceLoading;
  workspaceLoading=(async()=>{
   try{
    const response=await fetch('/api/principal/workspace?date='+encodeURIComponent($('reportDate').value),{credentials:'same-origin',cache:'no-store'});
    if(response.status===401){window.location.replace('/portal-login.html');return;}
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(data.error||'Leadership details unavailable.');
    showList('principalCreditsList',sectionRows(data,'leaveCredits'),x=>[
     x.account||'Credit account',String(x.balance||0)+' verified days'],'No certified credit entries available.');
    const weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    showList('principalOperatingDays',sectionRows(data,'operatingDays'),x=>[
     weekdays[Number(x.dayOfWeek)]||'Day '+x.dayOfWeek,x.operating?'Scheduled operating day':'Not scheduled'],'Operating days have not been configured.');
    showList('principalCalendarEvents',sectionRows(data,'calendar'),x=>[
     x.date||'School date',String(x.type||'Recorded exception').replaceAll('_',' ')],'No calendar exceptions recorded in the next 45 days.');
    $('principalCalendarStatus').textContent='School-scoped calendar sources · '+data.date;
    const keeper=sectionRows(data,'gatekeeperAccounts')?.[0];
    const movements=sectionRows(data,'gateActivity')?.[0];
    const pending=sectionRows(data,'gatePending')?.[0];
    $('principalKeeperTotal').textContent=keeper?fmt(keeper.total):'—';
    $('principalKeeperActive').textContent=keeper?fmt(keeper.active)+' active accounts':'Source unavailable';
    $('principalGateVerified').textContent=movements?fmt(movements.verifiedMovements):'—';
    $('principalGateScanned').textContent=movements?fmt(movements.staffScanned):'—';
    $('principalGatePending').textContent=pending?fmt(pending.pendingEvents):'—';
    $('principalSecurityStatus').textContent='Selected school date '+data.date+' · verified source data only';
   }catch(err){
    for(const id of ['principalCreditsList','principalOperatingDays','principalCalendarEvents']){
     $(id).textContent='Source currently unavailable. '+errorText(err);
    }
    $('principalCalendarStatus').textContent='School calendar unavailable.';
    $('principalSecurityStatus').textContent='Gate overview unavailable.';
   }
  })();
  try{await workspaceLoading;}finally{workspaceLoading=null;}
 }
 async function loadNotifications(){
  const host=$('principalNotificationList'),label=$('principalNotificationStatus');
  label.textContent='Reading your notifications…';host.replaceChildren();
  try{
   const response=await fetch('/api/notifications?limit=30',{credentials:'same-origin',cache:'no-store'});
   if(response.status===401){window.location.replace('/portal-login.html');return;}
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||'Notification service unavailable.');
   showList('principalNotificationList',data.notifications,x=>[
    (x.readAt?'':'Unread · ')+(x.title||x.category||'Notification'),
    x.body||'No message content'],'No personal notifications at this time.');
   const memoAlerts=Array.isArray(data.notifications)?data.notifications.filter(x=>
    x.requestType==='MEMORANDUM'&&/^[0-9a-f-]{36}$/i.test(String(x.requestId||''))):[];
   if(memoAlerts.length){
    const shortcut=make('button','quiet-button','Read school memoranda ('+memoAlerts.length+')');
    shortcut.type='button';
    shortcut.addEventListener('click',()=>window.AttendigoSchoolMemos?.open?.(memoAlerts[0].requestId));
    host.append(shortcut);
   }
   label.textContent=fmt(data.unreadCount)+' unread notifications. School memoranda open inside this workspace.';
  }catch(err){host.textContent=errorText(err);label.textContent='Notifications unavailable.';}
 }
 function exportLeadershipSummary(){
  if(!latest){status('Load a verified dashboard first.','error');return;}
  const source=latest;
  const rows=[
   ['School',source.school?.schoolName||''],['School date',source.schoolDate],
   ['Verified staff',source.metrics?.withVerifiedPunch],['Verified DTR slots',source.metrics?.verifiedDtrSlots],
   ['Pending DTR slots',source.metrics?.pendingDtrSlots],
   ['Active students',source.enrollment?.activeStudentRecords],
   ['Accepted class check-ins',source.metrics?.acceptedClassCheckins],
   ['Pending leave/OB requests',source.approvals?.totalPending],
   ['Pending location proposals',source.locationSetup?.pending]
  ];
  const csv=[['Metric','Source value'],...rows].map(line=>line.map(csvSafe).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download='attendigo-principal-summary-'+source.schoolDate+'.csv';
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),0);
 }
 async function askPrincipalGuide(){
  const answer=$('principalHelpAnswer'),question=$('principalHelpQuestion').value.trim();
  if(!question){answer.textContent='Enter a brief Attendigo usage question.';return;}
  if(/[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b\d{12}\b/.test(question)){
   answer.textContent='Please remove personal identifiers before asking.';return;
  }
  $('principalAskHelp').disabled=true;answer.textContent='Checking the verified Attendigo guide…';
  try{
   const r=await fetch('/api/help/ask',{method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({question})});
   const data=await r.json().catch(()=>({}));
   answer.textContent=r.ok?(data.answer||'No verified answer returned.'):(data.error||'AI guidance unavailable. Consult verified metric definitions.');
  }catch(err){answer.textContent='AI service unavailable. Use the metric definitions and School Admin guidance.';}
  finally{$('principalAskHelp').disabled=false;}
 }


 function sdoPhase(x){
  if(x.status==='APPROVED')return 'Approved · external decision verified';
  if(x.status==='REJECTED')return 'Disapproved · decision recorded';
  if(x.status==='CANCELLED')return 'Cancelled';
  if(x.sdoSubmittedAt)return 'Submitted to SDO · awaiting official decision';
  return 'Filed · awaiting school handoff to SDO';
 }
 async function loadSdoRequests(){
  if(!currentRole)return;
  try{
   const response=await fetch('/api/principal/sdo-requests',{credentials:'same-origin',cache:'no-store'});
   if(response.status===401){window.location.replace('/portal-login.html');return;}
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||'Unable to load SDO applications.');
   const list=$('principalSdoRequestList'),admin=$('principalSdoAdminList');
   list.replaceChildren();admin.replaceChildren();
   const requests=Array.isArray(data.requests)?data.requests:[];
   const mine=requests.filter(r=>currentRole==='PRINCIPAL');
   for(const r of mine){
    const item=make('div','principal-record-item');
    item.append(make('strong',null,(r.kind==='LEAVE'?'Leave: ':'Official business: ')+(r.title||'Request')),
      make('small',null,sdoPhase(r)+' · '+String(r.startDate||'').slice(0,10)),
      make('small',null,r.handoffReference?'SDO reference: '+r.handoffReference:'School Admin will record the SDO submission'));
    if(r.kind==='LEAVE'){
     const form=make('button','quiet-button','View CSC Form 6 data');
     form.type='button';form.addEventListener('click',()=>void showForm6(r.requestId));item.append(form);
    }
    if(r.kind==='OB'&&r.signedFilename){
     const link=make('a','text-link','Download signed OB decision');
     link.href='/api/principal/sdo-requests/ob/'+encodeURIComponent(r.requestId)+'/document';
     item.append(link);
    }
    list.append(item);
   }
   if(currentRole==='PRINCIPAL'&&!mine.length)
    list.append(make('p','source-note','No requests filed yet.'));
   if(currentRole==='SCHOOL_ADMIN'){
    $('principalSdoAdminPanel').hidden=false;
    for(const r of requests){
     const card=make('div','principal-record-item');
     card.append(make('strong',null,(r.principalName||'Principal')+' · '+r.kind+' · '+(r.title||'')),
      make('small',null,sdoPhase(r)));
     if(!['APPROVED','REJECTED','CANCELLED'].includes(r.status)){
      const choose=make('button','quiet-button',r.sdoSubmittedAt?'Record signed decision':'Record SDO handoff');
      choose.type='button';
      choose.addEventListener('click',()=>{
       selectedSdoRequest=r;
       $('principalSdoAdminForms').hidden=false;
       $('principalSdoSelected').textContent=(r.principalName||'Principal')+' · '+r.kind+
          ' · '+(r.title||'')+' · '+sdoPhase(r);
       $('principalSdoHandoffForm').hidden=Boolean(r.sdoSubmittedAt);
       $('principalSdoDecisionForm').hidden=!r.sdoSubmittedAt;
       $('principalCertifiedDaysLabel').hidden=r.kind!=='LEAVE';
       $('principalSdoAdminForms').scrollIntoView({behavior:'smooth',block:'nearest'});
      });
      card.append(choose);
     }
     admin.append(card);
    }
    if(!requests.length)admin.append(make('p','source-note','No principal applications need coordination.'));
   }
  }catch(error){
   $('principalSdoRequestList').textContent='Requests unavailable: '+errorText(error);
   $('principalSdoAdminList').textContent='SDO coordination unavailable: '+errorText(error);
  }
 }
 async function showForm6(id){
  const url='/api/staff-leave/requests/'+encodeURIComponent(id)+'/form6';
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){$('principalLeaveFormStatus').textContent=data.error||'Form 6 prefill unavailable.';return;}
  const req=data.request||{};
  const summary='CSC Form No. 6 prefill data\\n'+
    'Employee: '+(req.staffName||'')+'\\n'+
    'School: '+(req.schoolName||'')+'\\n'+
    'Leave: '+(req.leaveType||'')+'\\n'+
    'Start: '+String(req.startDate||'').slice(0,10)+'\\n'+
    'End: '+String(req.endDate||'').slice(0,10)+'\\n'+
    'Estimated school working days: '+(data.estimatedSchoolWorkingDays??'Unverified')+'\\n'+
    'Status: '+(req.status||'')+'\\n\\n'+
    'This is prefill data, not the signed official CSC Form 6.';
  const blob=new Blob([summary],{type:'text/plain;charset=utf-8'});
  const href=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=href;link.download='principal-leave-form6-prefill-'+id+'.txt';
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(href),0);
 }
 async function submitPrincipalLeave(){
  const form=$('principalLeaveForm'),status=$('principalLeaveFormStatus');
  if(!form.reportValidity())return;
  const data=new FormData(form),button=form.querySelector('[type="submit"]');
  button.disabled=true;status.textContent='Submitting leave application…';
  try{
   const payload={leaveType:data.get('leaveType'),creditAccount:data.get('creditAccount'),
    startDate:data.get('startDate'),endDate:data.get('endDate'),
    reason:data.get('reason'),details:'',commutation:'NOT_REQUESTED'};
   const response=await fetch('/api/staff-leave/requests',{method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   const result=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(result.error||'Leave filing failed.');
   status.textContent='Filed. Awaiting School Admin handoff to SDO. This is NOT approved leave.';
   form.reset();void loadSdoRequests();void loadWorkspace();
  }catch(error){status.textContent=errorText(error);}
  finally{button.disabled=false;}
 }
 async function submitPrincipalOb(){
  const form=$('principalObForm'),status=$('principalObFormStatus');
  if(!form.reportValidity())return;
  const data=new FormData(form),button=form.querySelector('[type="submit"]');
  button.disabled=true;status.textContent='Submitting official business…';
  try{
   const start=new Date(String(data.get('startsAt'))),end=new Date(String(data.get('endsAt')));
   if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime()))throw Error('Select valid dates and times.');
   const response=await fetch('/api/principal/ob',{method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({
     purpose:data.get('purpose'),destination:data.get('destination'),
     startsAt:start.toISOString(),endsAt:end.toISOString()})});
   const result=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(result.error||'OB filing failed.');
   status.textContent='OB filed. School Admin must coordinate SDO authorization; DTR remains unchanged.';
   form.reset();void loadSdoRequests();void loadWorkspace();
  }catch(error){status.textContent=errorText(error);}
  finally{button.disabled=false;}
 }
 async function saveSdoHandoff(){
  if(!selectedSdoRequest||currentRole!=='SCHOOL_ADMIN')return;
  const form=$('principalSdoHandoffForm'),data=new FormData(form),status=$('principalSdoAdminStatus');
  if(!form.reportValidity())return;
  const button=form.querySelector('[type="submit"]');button.disabled=true;status.textContent='Recording SDO receiving details…';
  try{
   const {kind,requestId}=selectedSdoRequest;
   const r=await fetch('/api/principal/sdo-requests/'+kind.toLowerCase()+'/'+encodeURIComponent(requestId)+'/handoff',{
    method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({channel:data.get('channel'),receivingOffice:data.get('receivingOffice'),
      reference:data.get('reference')})});
   const result=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(result.error||'Handoff could not be saved.');
   status.textContent='SDO handoff recorded. Signed decision is still required.';
   form.reset();$('principalSdoAdminForms').hidden=true;selectedSdoRequest=null;void loadSdoRequests();
  }catch(error){status.textContent=errorText(error);}
  finally{button.disabled=false;}
 }
 async function saveSdoDecision(){
  if(!selectedSdoRequest||currentRole!=='SCHOOL_ADMIN')return;
  const form=$('principalSdoDecisionForm'),data=new FormData(form),status=$('principalSdoAdminStatus');
  if(!form.reportValidity())return;
  const file=data.get('signedDocument'),button=form.querySelector('[type="submit"]');
  if(!(file instanceof File)||!file.size||file.size>4194304||
    !['application/pdf','image/png','image/jpeg'].includes(file.type)){
   status.textContent='Choose a signed PDF/JPG/PNG document up to 4 MB.';return;
  }
  const req=selectedSdoRequest,decision=String(data.get('decision'));
  if(req.kind==='LEAVE'&&decision==='APPROVED'&&!(Number(data.get('certifiedWorkingDays'))>0)){
   status.textContent='Enter verified working days for an approved leave.';return;
  }
  button.disabled=true;status.textContent='Uploading signed external decision…';
  try{
   let response,result;
   if(req.kind==='LEAVE'){
    response=await fetch('/api/staff-leave/requests/'+encodeURIComponent(req.requestId)+'/documents',{
     method:'POST',credentials:'same-origin',
     headers:{'Content-Type':file.type,'x-document-kind':'APPROVAL','x-filename':file.name},body:file});
    result=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(result.error||'Signed leave document could not be stored.');
    response=await fetch('/api/staff-leave/requests/'+encodeURIComponent(req.requestId)+'/external-decision',{
     method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({decision:decision==='APPROVED'?'APPROVE':'REJECT',
      approvalReference:data.get('approvalReference'),approverName:data.get('approverName'),
      approverPosition:data.get('approverPosition'),approvedOn:data.get('approvedOn'),
      certifiedWorkingDays:data.get('certifiedWorkingDays'),note:data.get('note')})});
   }else{
    response=await fetch('/api/principal/sdo-requests/ob/'+encodeURIComponent(req.requestId)+'/decision',{
     method:'POST',credentials:'same-origin',headers:{'Content-Type':file.type,'x-filename':encodeURIComponent(file.name),
      'x-sdo-decision':decision,'x-sdo-reference':String(data.get('approvalReference')),
      'x-sdo-approver':String(data.get('approverName')),'x-sdo-position':String(data.get('approverPosition')),
      'x-sdo-date':String(data.get('approvedOn'))},body:file});
   }
   result=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(result.error||'External decision verification failed.');
   status.textContent='Signed SDO decision recorded. School Admin acted only as recorder.';
   form.reset();$('principalSdoAdminForms').hidden=true;selectedSdoRequest=null;
   void loadSdoRequests();void load();
  }catch(error){status.textContent='Decision not recorded: '+errorText(error);}
  finally{button.disabled=false;}
 }

 async function loadMemoAdmin(){
  if(currentRole!=='PRINCIPAL')return;
  const host=$('principalMemoPublishedList');host.replaceChildren();
  host.append(make('p','source-note','Loading published memoranda…'));
  try{
   const response=await fetch('/api/school-memos?limit=30',{credentials:'same-origin',cache:'no-store'});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||'Unable to load school memoranda.');
   host.replaceChildren();
   const list=Array.isArray(data.memoranda)?data.memoranda:[];
   if(!list.length){host.append(make('p','source-note','No school memoranda have been published yet.'));return;}
   for(const memo of list){
    const item=make('div','principal-record-item');
    item.append(make('strong',null,memo.title),
      make('span',null,String(memo.category||'GENERAL').replaceAll('_',' ')+' · '+
       (memo.audience==='ALL_USERS'?'All school users':'School personnel only')));
    const actions=make('div','principal-memo-links');
    const link=make('button','text-link','View memorandum in dashboard');
    link.type='button';
    link.addEventListener('click',()=>window.AttendigoSchoolMemos?.open?.(memo.memoId));
    actions.append(link);
    const count=make('button','quiet-button','Check acknowledgments');
    count.type='button';count.addEventListener('click',async()=>{
     count.disabled=true;
     try{
      const response=await fetch('/api/school-memos/'+encodeURIComponent(memo.memoId)+'/receipts',
       {credentials:'same-origin',cache:'no-store'});
      const detail=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(detail.error||'Receipts unavailable');
      count.textContent=fmt(detail.acknowledgedAccounts)+' acknowledged · '+
       fmt(detail.notifiedAccounts)+' inboxes notified';
     }catch(e){count.textContent=errorText(e);}
     finally{count.disabled=false;}
    });
    actions.append(count);item.append(actions);host.append(item);
   }
  }catch(e){host.replaceChildren(make('p','source-note','Memoranda unavailable: '+errorText(e)));}
 }
 async function publishPrincipalMemo(){
  if(currentRole!=='PRINCIPAL')return;
  const form=$('principalMemoForm'),feedback=$('principalMemoPublishStatus'),
    button=$('principalMemoPublish');
  if(!form.reportValidity())return;
  const data=new FormData(form),file=data.get('document'),
    category=String(data.get('category')),audience=String(data.get('audience')),
    effectiveDate=String(data.get('effectiveDate')||'');
  if(!(file instanceof File)||!file.size||file.size>4194304||
    !['application/pdf','image/jpeg','image/png'].includes(file.type)){
    feedback.textContent='Attach a PDF, JPG or PNG document up to 4 MB.';return;
  }
  if(['CLASS_SUSPENSION','SCHEDULE_NOTICE'].includes(category)&&!effectiveDate){
   feedback.textContent='Choose an effective date for a schedule or class suspension notice.';return;
  }
  const notice=audience==='ALL_USERS'
   ?'all active school accounts including registered students and parents'
   :'school personnel accounts only';
  if(!window.confirm('Publish this memorandum to '+notice+
    '? In-app notifications will be created. Uploading a memo does NOT automatically change timetable or attendance rules.'))return;
  button.disabled=true;feedback.textContent='Publishing memorandum and creating school notifications…';
  try{
   const response=await fetch('/api/school-memos',{method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':file.type,'x-filename':file.name,
      'x-memo-title':encodeURIComponent(String(data.get('title'))),'x-memo-summary':encodeURIComponent(String(data.get('summary')||'')),
      'x-memo-category':category,'x-memo-audience':audience,'x-memo-effective-date':effectiveDate},body:file});
   const result=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(result.error||'Could not publish memorandum.');
   feedback.textContent='Published successfully. '+fmt(result.notifiedAccounts)+
    ' in-app inbox records created. Recipients must open and explicitly acknowledge the memo.';
   form.reset();void loadMemoAdmin();void window.AttendigoSchoolMemos?.refresh?.();
  }catch(e){feedback.textContent='Not published: '+errorText(e);}
  finally{button.disabled=false;}
 }

 async function init(){
  $('principalRefreshNotifications').addEventListener('click',()=>void loadNotifications());
  $('principalMemoForm').addEventListener('submit',e=>{e.preventDefault();void publishPrincipalMemo();});
  $('principalMemoRefresh').addEventListener('click',()=>void loadMemoAdmin());
  $('principalExportSummary').addEventListener('click',exportLeadershipSummary);
  $('principalExportStaff').addEventListener('click',downloadCsv);
  $('principalPrint').addEventListener('click',()=>window.print());
  $('principalAskHelp').addEventListener('click',()=>void askPrincipalGuide());
  $('principalLeaveForm').addEventListener('submit',e=>{e.preventDefault();void submitPrincipalLeave();});
  $('principalObForm').addEventListener('submit',e=>{e.preventDefault();void submitPrincipalOb();});
  $('principalRefreshSdo').addEventListener('click',()=>void loadSdoRequests());
  $('principalSdoHandoffForm').addEventListener('submit',e=>{e.preventDefault();void saveSdoHandoff();});
  $('principalSdoDecisionForm').addEventListener('submit',e=>{e.preventDefault();void saveSdoDecision();});
  $('personalDate').value=today;$('personalDate').max=today;$('personalDate').min=minDate;
  $('showPrincipalBadge').addEventListener('click',()=>void showBadge());
  $('hidePrincipalBadge').addEventListener('click',hideBadge);
  $('refreshPersonal').addEventListener('click',()=>void loadPersonal());
  $('personalDate').addEventListener('change',()=>void loadPersonal());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)hideBadge();});
  $('reportDate').value=today;$('reportDate').max=today;$('reportDate').min=minDate;
  document.querySelectorAll('[data-jump]').forEach(b=>b.addEventListener('click',()=>switchSection(b.dataset.jump)));
  for(const b of buttons)b.addEventListener('click',()=>switchSection(b.dataset.section));
  for(const id of ['principalMyWorkspace','principalMore']){
   $(id).addEventListener('change',()=>{if(sectionMap[$(id).value])switchSection($(id).value);});
  }
  $('principalRequestsShortcut').addEventListener('click',()=>{
   const details=$('principalPersonalRequests');details.open=true;
   details.scrollIntoView({behavior:'smooth',block:'nearest'});
  });
  $('openPriorities').addEventListener('click',()=>switchSection('priorities'));
  const presentation=$('presentationToggle');
  function setPresentation(enabled){
   document.body.classList.toggle('principal-presentation',enabled);
   if(presentation){
    presentation.setAttribute('aria-pressed',String(enabled));
    presentation.textContent=enabled?'Normal view':'Presentation mode';
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
  currentRole=me.role;
  $('principalMemoPublishPanel').hidden=currentRole!=='PRINCIPAL';
  if(currentRole==='PRINCIPAL')void loadMemoAdmin();
  $('principalLeaveForm').hidden=currentRole!=='PRINCIPAL';
  $('principalObForm').hidden=currentRole!=='PRINCIPAL';
  $('principalSdoAdminPanel').hidden=currentRole!=='SCHOOL_ADMIN';
  if(currentRole==='SCHOOL_ADMIN')void loadSdoRequests();
  await load();
 }
 void init().catch(error=>{
  status('Unable to open Principal dashboard: '+errorText(error),'error');
 });
})();
