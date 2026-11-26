'use strict';
// Presentation only: the role and all authorized modules remain owned by portal.js.
(() => {
 const roles={
  SCHOOL_ADMIN:{name:'School administration',label:'SCHOOL MANAGEMENT',title:'School operations',description:'Manage enrollment, accounts, schedules and pending school requests.',first:'adminDashboardCard'},
  DEPARTMENT_HEAD:{name:'Department leadership',label:'DEPARTMENT WORKSPACE',title:'Department priorities',description:'Review teacher coverage, department schedules and work that needs attention.',first:'departmentHeadOverview'},
  TEACHER:{name:'Teaching workspace',label:'TEACHING TOOLS',title:'My teaching day',description:'Review your timetable, assigned learners and confirmed class attendance.'},
  GATE_KEEPER:{name:'Gatekeeper workspace',label:'GATE OPERATIONS',title:'Gate verification',description:'Scan authorized learner and staff QR badges, then verify the registered photo.'}
 };
 const $=id=>document.getElementById(id);
 const shortcuts={
  SCHOOL_ADMIN:[['dashboardNav','Home','home'],['studentsNav','Learners','users'],['academicAdminNav','Enrollment','book']],
  DEPARTMENT_HEAD:[['dashboardNav','Home','home'],['teachersNav','Teachers','users'],['schedulesNav','Schedules','calendar']],
  TEACHER:[['dashboardNav','Home','home'],['schedulesNav','Timetable','calendar'],['classAttendanceNav','Attendance','check']],
  GATE_KEEPER:[['studentsNav','Scanner','scan']]
 };
 const icons={home:'M3 10l9-7 9 7v11H3z M9 21v-8h6v8',users:'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M2 21v-2a7 7 0 0 1 14 0v2 M17 4a4 4 0 0 1 0 7 M18 15a5 5 0 0 1 4 5',calendar:'M3 5h18v16H3z M7 3v4 M17 3v4 M3 10h18',book:'M4 3h16v18H4z M8 7h8 M8 11h8 M8 15h5',check:'M5 4h14v17H5z M9 2h6v5H9z M8 14l3 3 5-6',scan:'M3 8V3h5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M8 8h8v8H8z',more:'M4 6h16 M4 12h16 M4 18h16'};
 function makeDock(layout,role){
  if(!layout.querySelector('.main-area'))return;
  let dock=$('axSignatureDock');
  if(!dock){dock=document.createElement('nav');dock.id='axSignatureDock';dock.className='ax-signature-dock';dock.setAttribute('aria-label','Quick workspace navigation');layout.querySelector('.main-area').append(dock);}
  const allowed=id=>{const n=$(id);return n&&!n.hidden&&!n.closest('.nav-group[hidden]')&&!n.disabled;};
  function refresh(){
   const entries=shortcuts[role].filter(([id])=>allowed(id));
   const signature=entries.map(([id])=>id+':'+($(id).classList.contains('active')?'1':'0')).join(',');
   if(dock.dataset.signature!==signature){
    dock.dataset.signature=signature;dock.replaceChildren();
    for(const [id,label,icon] of [...entries,['sidebarToggle','More','more']]){
     const button=document.createElement('button');button.type='button';button.dataset.target=id;
     button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+icons[icon]+'"/></svg><span>'+label+'</span>';
     if($(id)?.classList.contains('active'))button.setAttribute('aria-current','page');
     button.addEventListener('click',()=>{if(id==='sidebarToggle'||allowed(id))$(id)?.click();});
     dock.append(button);
    }
   }
   const dashboard=$('dashboardView'),scanner=$('studentScannerPanel'),students=$('studentsView');
   dock.hidden=role==='GATE_KEEPER'?(!students||students.hidden||!scanner||!scanner.hidden):(!dashboard||dashboard.hidden);
  }
  refresh();
  if(!dock.dataset.observed){
   dock.dataset.observed='true';
   const observer=new MutationObserver(refresh);
   const nav=layout.querySelector('.side-nav');
   if(nav)observer.observe(nav,{attributes:true,attributeFilter:['hidden','class'],childList:true,subtree:true});
   for(const id of ['dashboardView','studentsView','studentScannerPanel'])if($(id))observer.observe($(id),{attributes:true,attributeFilter:['hidden']});
  }
 }
 function addAdvisory(role){
  if(!['SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER'].includes(role))return;
  const dashboard=$('dashboardView');if(!dashboard||$('axWeatherAdvisory'))return;
  const card=document.createElement('section');card.id='axWeatherAdvisory';card.className='ax-weather-advisory';card.setAttribute('data-school-weather','');card.setAttribute('aria-label','School weather and heat index');
  dashboard.append(card);window.AttendigoSchoolWeather?.mount(card);
 }
 function addTeachingProgress(){
  const summary=$('learnerSummaryCard'),total=$('learnerTotal'),present=$('learnerPresent');
  if(!summary||!total||!present||$('axTeachingProgress'))return;
  const widget=document.createElement('div');widget.id='axTeachingProgress';widget.className='ax-teaching-progress';
  widget.innerHTML='<div class="ax-progress-ring" aria-hidden="true"><strong>—</strong></div><div><h3>Confirmed check-ins today</h3><p class="ax-progress-copy" role="status">Awaiting attendance summary.</p><small>Share of assigned learners with confirmed attendance. Not an official daily attendance rate.</small></div>';
  summary.append(widget);
  function update(){
   const parse=node=>{const value=node.textContent.trim().replace(/,/g,'');return /^\d+$/.test(value)?Number(value):NaN;};
   const a=parse(present),b=parse(total),valid=Number.isFinite(a)&&Number.isFinite(b)&&b>0&&a<=b;
   const percent=valid?Math.round(a/b*100):0;
   const ring=widget.querySelector('.ax-progress-ring');ring.style.setProperty('--ax-progress',percent+'%');
   ring.querySelector('strong').textContent=valid?percent+'%':'—';
   widget.querySelector('.ax-progress-copy').textContent=valid?a.toLocaleString()+' of '+b.toLocaleString()+' assigned learners confirmed.':'Awaiting attendance summary.';
  }
  update();const observer=new MutationObserver(update);for(const node of [total,present])observer.observe(node,{childList:true,characterData:true,subtree:true});
 }
 function arrangeTeachingDay(){
  const dashboard=$('dashboardView'),summary=$('learnerSummaryCard'),intro=$('axStaffDashboardIntro');
  if(!dashboard||!summary||!intro||dashboard.dataset.axTeachingDay)return;
  dashboard.dataset.axTeachingDay='true';
  const date=document.createElement('span');date.className='ax-teaching-date';
  date.textContent=new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',weekday:'long',month:'long',day:'numeric'}).format(new Date());
  intro.append(date);
  // Reuse the original live metric nodes, original scanner controls and existing
  // timetable action. No cloned attendance records or fabricated trend values.
  const labels=['Assigned learners','Confirmed today','Pending confirmation','Learner-days this month'];
  const paths=['M3 21v-2a6 6 0 0 1 12 0v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M18 4a4 4 0 0 1 0 7 M18 15a5 5 0 0 1 4 5','M3 12l5 5L21 4','M12 7v5l3 2 M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18','M3 5h18v16H3z M7 3v4 M17 3v4 M3 10h18'];
  summary.querySelectorAll('.learner-metric').forEach((card,i)=>{
   if(!labels[i])return;
   const label=card.querySelector('span:not(.teacher-v3-metric-icon)');if(label)label.textContent=labels[i];
   if(!card.querySelector('.teacher-v3-metric-icon')){
    const icon=document.createElement('span');icon.className='teacher-v3-metric-icon';icon.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+paths[i]+'"/></svg>';card.prepend(icon);
   }
  });
  // Keep one actionable welcome section: the old hero retains its timetable
  // button; the new header is a compact date/title line, not a second banner.
  const heading=$('axStaffDashboardDescription');if(heading)heading.textContent='Your classes, attendance and school updates.';
 }
 function init(user){
  const role=user?.role,config=roles[role],layout=document.querySelector('.portal-layout');
  if(!config||!layout||layout.getAttribute('data-attendigo-role')!==role)return;
  $('axStaffWorkspaceName').textContent=config.name;
  $('axStaffNavigationLabel').textContent=config.label;
  $('axStaffDashboardKicker').textContent=config.label;
  $('axStaffDashboardTitle').textContent=config.title;
  $('axStaffDashboardDescription').textContent=config.description;
  // Prioritize the already-authorized role card above auxiliary modules. Move the
  // original node, keeping its identity, hidden state, event handlers and data.
  const card=$(config.first),intro=$('axStaffDashboardIntro');
  if(card&&intro&&card.parentElement===intro.parentElement&&intro.nextElementSibling!==card)intro.after(card);
  makeDock(layout,role);
  addAdvisory(role);
  if(role==='TEACHER'){addTeachingProgress();arrangeTeachingDay();}
  if(role==='GATE_KEEPER'){
   const scanner=$('studentScannerCard');
   if(scanner)scanner.setAttribute('data-ax-gate-workspace','true');
  }
 }
 // Identity resolves before entitlement loading. Wait for the actual role navigation.
 if(window.attendigoStaffIdentity?.then)window.attendigoStaffIdentity.then(user=>{
  if(document.querySelector('.portal-layout')?.getAttribute('data-attendigo-role')===user?.role)init(user);
  else document.addEventListener('attendigo:portal-ready',()=>init(user),{once:true});
 }).catch(()=>{});
})();
