'use strict';
/* Teacher Dashboard V3: presentation only, no data mutations or independent scheduling claims. */
(() => {
 const $=id=>document.getElementById(id);
 function init(user){
  if(user?.role!=='TEACHER')return;
  const dashboard=$('dashboardView'),scan=$('dashboardScanCta'),summary=$('learnerSummaryCard');
  if(!dashboard||!scan||!summary||dashboard.dataset.teacherV3==='true')return;
  dashboard.dataset.teacherV3='true';
  // One teacher-only presenter retains V2 layout styles and V3 teaching summary.
  // It reuses existing metrics, routes and role-scoped actions; no new attendance source.
  document.documentElement.classList.add('attendigo-teacher-v2','attendigo-teacher-v3');
  const stats=$('statsGrid');
  if(stats){
   stats.classList.add('teacher-v2-redundant-stats');
   stats.setAttribute('aria-hidden','true');
  }
  const shortcuts=$('quickActionsCard'),recent=$('recentActivityCard'),planner=$('plannerDashboardWidget');
  const hero=document.createElement('section');
  hero.className='teacher-v3-hero';hero.setAttribute('aria-label','Teaching day overview');
  hero.innerHTML='<div class="teacher-v3-hero-copy"><span class="teacher-v3-eyebrow">MY TEACHING DAY</span><h2>Ready for today’s classes?</h2><p>Review your assigned timetable, then record class attendance using the existing secure workflow.</p><div class="teacher-v3-hero-pills"><span>▣ Subject classes</span><span>✦ Advisory classes</span></div></div><div class="teacher-v3-hero-actions"><button type="button" class="teacher-v3-schedule">View My Timetable <span aria-hidden="true">↗</span></button><span class="teacher-v3-note">Actual class times are shown in My Timetable.</span></div>';
  dashboard.insertBefore(hero,scan);
  const designations=new Set(Array.isArray(user.teacherDesignations)?user.teacherDesignations:[]);
  const isSubject=designations.has('SUBJECT_TEACHER');
  const isAdviser=designations.has('CLASS_ADVISER');
  const pills=hero.querySelector('.teacher-v3-hero-pills');
  pills.replaceChildren();
  for(const [enabled,label] of [
   [isSubject,'▣ Subject classes'],
   [isAdviser,'✦ Advisory classes']
  ]){
   if(!enabled)continue;
   const pill=document.createElement('span');pill.textContent=label;pills.append(pill);
  }
  if(!pills.childElementCount){
   const pill=document.createElement('span');pill.textContent='Assigned classes';pills.append(pill);
  }
  const scanHeading=scan.querySelector('h2');
  if(scanHeading)scanHeading.textContent='Record Class Attendance';
  const scanHint=scan.querySelector('.dashboard-scan-cta-copy p');
  if(scanHint)scanHint.textContent='Choose an assigned class or advisory section before scanning.';
  $('dashboardAddStudent')?.classList.add('teacher-v2-secondary-action');
  const shortcutTitle=shortcuts?.querySelector('.card-heading h3');
  if(shortcutTitle)shortcutTitle.textContent='My Teaching Shortcuts';
  const shortcutDesc=shortcuts?.querySelector('.card-heading p');
  if(shortcutDesc)shortcutDesc.textContent='Assigned learners, timetable and authorized reports';
  const sf2Shortcut=shortcuts?.querySelector('[data-go="sf2"] strong');
  if(sf2Shortcut)sf2Shortcut.textContent=isAdviser
   ?(isSubject?'Section SF2 & personal copy':'Official section SF2')
   :'Personal SF2 copy';
  const studentsShortcut=shortcuts?.querySelector('[data-go="students"] strong');
  if(studentsShortcut)studentsShortcut.textContent=isAdviser&&!isSubject
   ?'My Advisory Students':'My Assigned Learners';
  const scheduleShortcut=shortcuts?.querySelector('[data-go="schedules"] strong');
  if(scheduleShortcut)scheduleShortcut.textContent='My Timetable';
  const timetableAction=shortcuts?.querySelector('[data-go="schedules"]');
  const timetableButton=hero.querySelector('.teacher-v3-schedule');
  timetableButton.addEventListener('click',()=>{
   if(timetableAction&&!timetableAction.hidden&&!timetableAction.disabled)timetableAction.click();
  });
  if(!timetableAction){timetableButton.disabled=true;timetableButton.title='Timetable shortcut unavailable';}
  const title=summary.querySelector('.card-heading h3');
  if(title)title.textContent='Class Attendance Snapshot';
  const metrics=[...summary.querySelectorAll('.learner-metric')];
  const iconPaths=[
   '<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 6a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5"/>',
   '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
   '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
   '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m5 5 2 2 4-4"/>'
  ];
  metrics.forEach((card,i)=>{
   if(!iconPaths[i]||card.querySelector('.teacher-v3-metric-icon'))return;
   const icon=document.createElement('span');icon.className='teacher-v3-metric-icon';
   icon.innerHTML='<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+iconPaths[i]+'</svg>';
   card.prepend(icon);
  });
  const foot=document.createElement('div');foot.className='teacher-v3-foot';
  foot.innerHTML='<div class="teacher-v3-foot-top"><span>Confirmed learner check-ins today</span><strong class="teacher-v3-confirmed">—</strong></div><div class="teacher-v3-progress" role="progressbar" aria-label="Share of assigned learners confirmed today" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div><small>This is an indicative share of assigned learners, not an official attendance rate. Pending is not absent.</small>';
  summary.append(foot);
  const confirmed=$('learnerPresent'),total=$('learnerTotal');
  const update=()=>{
   const a=Number((confirmed?.textContent||'').replace(/,/g,'')),b=Number((total?.textContent||'').replace(/,/g,''));
   const valid=Number.isFinite(a)&&Number.isFinite(b)&&b>0&&a>=0;
   const pct=valid?Math.min(100,Math.max(0,Math.round(a/b*100))):0;
   foot.querySelector('.teacher-v3-confirmed').textContent=valid?a+' of '+b:'Awaiting summary';
   foot.querySelector('.teacher-v3-progress span').style.width=pct+'%';
   foot.querySelector('.teacher-v3-progress').setAttribute('aria-valuenow',String(pct));
  };
  update();
  if(typeof MutationObserver!=='undefined'){
   const observer=new MutationObserver(update);
   if(confirmed)observer.observe(confirmed,{childList:true,characterData:true,subtree:true});
   if(total)observer.observe(total,{childList:true,characterData:true,subtree:true});
  }
  // Preserve original planner and activity elements and their event handlers.
  // Only their container is collapsible; no data or handler is cloned.
  function addCollapse(section,header,elements,label,defaultOpen){
   if(!section||!header||!elements.length)return;
   const first=elements.find(element=>element?.parentNode===section);
   if(!first)return;
   const body=document.createElement('div');
   body.className='teacher-v2-panel-body';
   body.id='teacher-v2-'+label.toLowerCase().replace(/[^a-z0-9]+/g,'-');
   section.insertBefore(body,first);
   elements.forEach(element=>{if(element)body.append(element);});
   const button=document.createElement('button');
   button.type='button';button.className='teacher-v2-toggle';
   button.setAttribute('aria-controls',body.id);
   button.setAttribute('aria-expanded',String(defaultOpen));
   button.setAttribute('aria-label','Toggle '+label);
   button.textContent=defaultOpen?'⌃':'⌄';
   header.append(button);
   body.hidden=!defaultOpen;
   button.addEventListener('click',()=>{
    const open=button.getAttribute('aria-expanded')!=='true';
    button.setAttribute('aria-expanded',String(open));
    button.textContent=open?'⌃':'⌄';
    body.hidden=!open;
   });
  }
  if(recent){
   const heading=recent.querySelector('.card-heading');
   const title=heading?.querySelector('h3');
   if(title)title.textContent='Recent Class Attendance';
   const desc=heading?.querySelector('p');
   if(desc)desc.textContent='Recent records available to your teacher account';
   addCollapse(recent,heading,[recent.querySelector('.table-scroll')],'Recent Attendance',true);
   const empty=recent.querySelector('#recentRows');
   if(empty)empty.setAttribute('aria-live','polite');
  }
  if(planner){
   const header=planner.querySelector('.planner-dashboard-intro h3');
   if(header)header.textContent='My Planner & Priorities';
   addCollapse(planner,planner.querySelector('.planner-dashboard-intro'),
    [planner.querySelector('.planner-dashboard-metrics'),$('plannerDashboardPreview')],
    'Planner',false);
  }
 }
 if(window.attendigoStaffIdentity?.then)window.attendigoStaffIdentity.then(init).catch(()=>{});
})();