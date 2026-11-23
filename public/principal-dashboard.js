'use strict';
// Read-only Principal leadership workspace. Every statistic comes from a
// school-scoped server query; no demonstration figures are ever substituted.
(() => {
 const $=id=>document.getElementById(id);
 const metricHelp={
  activeStudents:['Active learner records','These are active learner records from the school roster, not a student attendance rate. A department filter does not change this school-wide figure.'],
  activeTeachers:['Active teacher accounts','This counts active Teacher-role school accounts currently assigned to the selected department, or all departments when no filter is active.'],
  todayVerifiedAmIn:['Verified AM Time-In','Distinct teachers with a verified AM_IN DTR slot today, based on the Philippine school date. This is not proof that everyone else is absent, or that anyone was on time.'],
  windowPendingScans:['Scans awaiting review','Pending teacher DTR events within the selected dates. These are not certified Form 48 entries until properly verified.']
 };
 let current=null,fetchSeq=0;
 function number(v){return Number.isFinite(+v)?Number(v).toLocaleString('en-PH'):'—';}
 function text(id,value){const el=$(id);if(el)el.textContent=value;}
 async function request(url,options={}){
  const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(data.error||'Unable to load this information ('+r.status+').');
  return data;
 }
 const fmtDate=(iso)=>{const d=new Date(iso+'T12:00:00+08:00');return new Intl.DateTimeFormat('en-PH',{month:'short',day:'numeric',timeZone:'Asia/Manila'}).format(d);};
 function buildTrend(items){
  const node=$('plTrend');node.replaceChildren();
  const values=Array.isArray(items)?items:[];
  if(!values.length){node.textContent='No trend data for this date range.';return;}
  const max=Math.max(1,...values.map(x=>Number(x.verifiedAmIn)||0));
  let last=null;
  values.forEach(item=>{
   const button=document.createElement('button');
   button.type='button';button.style.height=Math.max(4,Math.round((Number(item.verifiedAmIn)||0)/max*144))+'px';
   const label=fmtDate(item.date)+': '+number(item.verifiedAmIn)+' verified AM Time-In, '+number(item.pending)+' pending DTR scans';
   button.setAttribute('aria-label',label);button.title=label;
   button.addEventListener('click',()=>{
    if(last)last.classList.remove('pl-selected');
    last=button;button.classList.add('pl-selected');
    text('plTrendDetail',fmtDate(item.date)+' · '+number(item.verifiedAmIn)+
     ' teachers with a verified AM Time-In · '+number(item.pending)+' pending DTR entries. No absence or tardiness is inferred.');
   });
   node.append(button);
  });
  const newest=values.at(-1);
  text('plTrendDetail',fmtDate(newest.date)+' · '+number(newest.verifiedAmIn)+' verified AM Time-In records · '+
   number(newest.pending)+' pending entries. Tap another day for details.');
 }
 function buildPriorities(m){
  const host=$('plPriorityItems');host.replaceChildren();
  const rows=[
   ['Pending leave applications',m.pendingLeave,'School/department review and documented official decisions'],
   ['Official Business requests',m.pendingOb,'Requests awaiting department or school review'],
   ['Unverified DTR scans',m.windowPendingScans,'Teacher scans awaiting independent validation'],
   ['Department location proposals',m.pendingLocationProposals,'Submitted GPS coordinates awaiting School Admin approval'],
   ['Unconfigured department locations',m.unconfiguredDepartments,'No approved scanning coordinate is available']
  ];
  rows.forEach(([label,value,desc])=>{
   const row=document.createElement('div');row.className='pl-priority';
   const info=document.createElement('div');const strong=document.createElement('strong');
   strong.textContent=label;const small=document.createElement('small');small.textContent=desc;
   const numberEl=document.createElement('b');numberEl.textContent=number(value);
   info.append(strong,small);row.append(info,numberEl);host.append(row);
  });
  const total=rows.reduce((sum,row)=>sum+(Number(row[1])||0),0);
  text('plHealthValue',number(total));
  text('plHealthLabel',total===0?'No open items in these categories':'Items to monitor');
 }
 function buildDepartments(data){
  const host=$('plDepartmentRows');host.replaceChildren();
  const items=data.comparison||[];
  if(!items.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.textContent='No active departments match this filter.';tr.append(td);host.append(tr);return;}
  items.forEach(d=>{
   const tr=document.createElement('tr');
   for(const value of [d.name,number(d.teachers),number(d.staffWithVerifiedAmIn),number(d.pendingScans)]){
    const td=document.createElement('td');td.textContent=value;tr.append(td);
   }
   const td=document.createElement('td'),btn=document.createElement('button');
   btn.type='button';btn.className='pl-drill';
   const selected=$('plDepartment').value===d.departmentId;
   btn.textContent=selected?'Selected':'Explore';
   btn.setAttribute('aria-label','Filter dashboard to '+d.name);
   btn.addEventListener('click',()=>{$('plDepartment').value=d.departmentId;void load();window.scrollTo?.({top:0,behavior:'smooth'});});
   td.append(btn);tr.append(td);host.append(tr);
  });
 }
 function definitions(data){
  const host=$('plDefinitionsBody');host.replaceChildren();
  const items={
   'Verified AM Time-In':data.definitions?.todayVerifiedAmIn,
   'Verified DTR entries':data.definitions?.windowVerifiedSlots,
   'Teacher population':data.definitions?.activeTeachers,
   'Student population':data.definitions?.activeStudents,
   'Pending verification':data.definitions?.pendingScans,
   'Chart interpretation':data.definitions?.trend
  };
  Object.entries(items).forEach(([name,explanation])=>{
   const item=document.createElement('div');item.className='pl-definition';
   const title=document.createElement('strong');title.textContent=name;
   const detail=document.createElement('p');detail.textContent=explanation||'Definition unavailable';
   item.append(title,detail);host.append(item);
  });
 }
 function draw(data){
  current=data;const m=data.metrics;
  text('plStudents',number(m.activeStudents));text('plTeachers',number(m.activeTeachers));
  text('plAmIn',number(m.todayVerifiedAmIn));text('plPending',number(m.windowPendingScans));
  const refreshed=new Date(data.generatedAt);
  text('plSnapshotDate','School date: '+data.schoolDate+' · '+data.days+'-day view');
  text('plSnapshotSource','Refreshed '+new Intl.DateTimeFormat('en-PH',
   {timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'}).format(refreshed)+' (PH time) · '+data.source);
  const select=$('plDepartment'),previous=select.value;
  select.replaceChildren(new Option('All departments',''));
  for(const d of data.departments||[])select.add(new Option(d.name,d.departmentId));
  select.value=previous;
  buildTrend(data.trend);buildPriorities(m);buildDepartments(data);definitions(data);
  $('plError').hidden=true;
 }
 async function load(){
  const seq=++fetchSeq,range=$('plRange').value,department=$('plDepartment').value;
  $('plRefresh').disabled=true;text('plSnapshotDate','Updating verified school metrics…');
  try{
   const qs=new URLSearchParams({days:range});
   if(department)qs.set('departmentId',department);
   const data=await request('/api/principal/overview?'+qs);
   if(seq!==fetchSeq)return;
   draw(data);
  }catch(error){
   if(seq!==fetchSeq)return;
   $('plError').textContent=error.message+'. Existing figures have not been replaced with estimates.';
   $('plError').hidden=false;
   text('plSnapshotDate',current?'Latest successful report retained':'Metrics unavailable');
  }finally{if(seq===fetchSeq)$('plRefresh').disabled=false;}
 }
 function goto(section){
  const ids={overview:'plOverview',departments:'plDepartments',
   decisions:'plPriorityPanel',methodology:'plDefinitions'};
  const dest=$(ids[section]||ids.overview);
  dest?.scrollIntoView({behavior:'smooth',block:'start'});
  document.querySelectorAll('.pl-nav').forEach(btn=>{
   const active=btn.dataset.section===section;btn.classList.toggle('active',active);
   if(active)btn.setAttribute('aria-current','page');else btn.removeAttribute('aria-current');
  });
 }
 function csvCell(value){const s=String(value??'');return '"'+(/^[\s]*[=+@-]/.test(s)?"'"+s:s).replace(/"/g,'""')+'"';}
 function exportCsv(){
  if(!current)return;const m=current.metrics,lines=[
   ['Attendigo Principal Overview','Source',current.source,'Generated UTC',current.generatedAt],
   ['School date',current.schoolDate,'Date window',current.days,'Department ID',current.departmentId||'ALL'],
   ['Metric','Value'],
   ...Object.entries(m).map(([k,v])=>[k,v]),
   ['Department','Active Teachers','Staff with verified AM In during window','Pending DTR scans'],
   ...current.comparison.map(d=>[d.name,d.teachers,d.staffWithVerifiedAmIn,d.pendingScans]),
   ['School Date','Distinct teachers with verified AM In','Pending DTR events'],
   ...current.trend.map(t=>[t.date,t.verifiedAmIn,t.pending]),
   ['Caution','Verified punches are not attendance or punctuality rates. Department assignment is current, not historical.']
  ];
  const blob=new Blob(['\uFEFF'+lines.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='Attendigo_Principal_Overview_'+current.schoolDate+'.csv';
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),500);
 }
 async function init(){
  try{
   const result=await request('/api/auth/me');
   const user=result.user;
   if(user?.mustChangePassword){location.replace('/force-password-change.html');return;}
   if(user?.role!=='PRINCIPAL'){location.replace('/portal-login.html');return;}
   text('plGreeting','Welcome, '+(user.displayName||'School Principal')+'. Your school-wide decision briefing is ready.');
  }catch{location.replace('/portal-login.html');return;}
  document.querySelectorAll('.pl-nav').forEach(button=>button.addEventListener('click',()=>goto(button.dataset.section)));
  document.querySelectorAll('[data-metric]').forEach(button=>button.addEventListener('click',()=>{
   const [title,help]=metricHelp[button.dataset.metric]||['Metric information','No definition available.'];
   text('plExplainTitle',title);text('plExplainBody',help);
   $('plExplain').showModal();
  }));
  $('plExplainClose').addEventListener('click',()=>$('plExplain').close());
  $('plExplainDone').addEventListener('click',()=>$('plExplain').close());
  $('plRange').addEventListener('change',()=>{void load();});
  $('plDepartment').addEventListener('change',()=>{void load();});
  $('plRefresh').addEventListener('click',()=>{void load();});
  $('plClearDepartment').addEventListener('click',()=>{$('plDepartment').value='';void load();});
  $('plExport').addEventListener('click',exportCsv);
  $('plLogout').addEventListener('click',async()=>{
   try{await request('/api/auth/logout',{method:'POST'});}
   catch{return text('plSnapshotDate','Sign-out unavailable. Please retry; your session has not been confirmed closed.');}
   sessionStorage.removeItem('schoolAttendance.accessToken');
   sessionStorage.removeItem('schoolAttendance.user');
   location.replace('/portal-login.html');
  });
  await load();
 }
 document.addEventListener('DOMContentLoaded',()=>{void init();},{once:true});
})();
