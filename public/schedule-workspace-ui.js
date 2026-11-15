'use strict';
/* Modern schedule workspace without changing the scheduling endpoints or permissions. */
(function(){
 const $=id=>document.getElementById(id);
 const choices=[
  {id:'regular',label:'Regular schedules',icon:'calendar'},
  {id:'changes',label:'Date-specific changes',icon:'swap'},
  {id:'weekly',label:'Weekly timetable',icon:'grid'},
  {id:'settings',label:'Timetable settings',icon:'settings'}
 ];
 let active='regular',role='',initialized=false,focusedBeforeDrawer=null,activeDrawer=null;
 function setTab(tab){
  if(!choices.some(c=>c.id===tab)|| (tab==='settings'&&role!=='SCHOOL_ADMIN'))return;
  const view=$('schedulesView');if(!view)return;
  active=tab;view.dataset.scheduleTab=tab;
  document.querySelectorAll('[data-schedule-workspace-tab]').forEach(button=>{
   const selected=button.dataset.scheduleWorkspaceTab===tab;
   button.classList.toggle('is-active',selected);
   button.setAttribute('aria-selected',String(selected));
   button.tabIndex=selected?0:-1;
  });
  if(tab==='regular')document.querySelector('[data-schedule-display="list"]')?.click();
  if(tab==='weekly'){
    document.querySelector('[data-schedule-display="weekly"]')?.click();
  }
  window.TimetableGrid?.close?.(false);
  if(tab==='settings')$('timetableSettings')?.scrollIntoView({block:'nearest',behavior:'smooth'});
 }
 function update(data){
  if(!initialized)initialize();
  const roleChanged=Boolean(data.role && data.role!==role);
  role=data.role||role;
  const periods=Array.isArray(data.periods)?data.periods:[];
  const changes=Array.isArray(data.scheduleAdjustments)?data.scheduleAdjustments:[];
  const total=periods.length;
  const free=periods.filter(item=>!item.assignedTeacherName&&!item.assignedTeacherUserId).length;
  const count=id=>{if($(id))$(id).textContent=String(id==='scheduleTotalMetric'?total:id==='scheduleUnassignedMetric'?free:changes.length);};
  ['scheduleTotalMetric','scheduleUnassignedMetric','scheduleChangesMetric'].forEach(count);
  if($('scheduleSettingsTab'))$('scheduleSettingsTab').hidden=role!=='SCHOOL_ADMIN';
  if($('scheduleSettingsShortcut'))$('scheduleSettingsShortcut').hidden=role!=='SCHOOL_ADMIN';
  if($('scheduleMetricScope'))$('scheduleMetricScope').textContent=role==='TEACHER'?'Your assigned classes':role==='DEPARTMENT_HEAD'?'Department timetable':'School-wide timetable';
  const manager=role==='SCHOOL_ADMIN'||role==='DEPARTMENT_HEAD';
  if($('scheduleAdjustmentShortcut'))$('scheduleAdjustmentShortcut').hidden=!manager;
  const intro=$('scheduleScopeText');
  if(intro){
    intro.dataset.newCopy='1';
    intro.textContent=role==='TEACHER'?'View your assigned classes and date-specific timetable changes.':role==='DEPARTMENT_HEAD'?'Assign teachers and manage temporary changes for classes in your department.':'Create school-wide schedules, including unassigned classes, and manage timetable settings.';
  }
  if(roleChanged||!active||active==='settings'&&role!=='SCHOOL_ADMIN')setTab(role==='TEACHER'?'weekly':'regular');
  if(!initialized)return;
 }
 function initialize(){
  if(initialized)return;
  const view=$('schedulesView'),header=view?.querySelector(':scope > .surface-card > .section-toolbar');
  if(!view||!header)return;
  initialized=true;view.classList.add('modern-schedule-workspace');
  view.dataset.scheduleTab='regular';
  const create=$('showScheduleForm');
  if(create){
    const actionRow=document.createElement('div');actionRow.className='schedule-primary-actions';
    create.parentElement.insertBefore(actionRow,create);actionRow.appendChild(create);
    create.textContent='＋ New class schedule';
    const change=document.createElement('button');change.type='button';change.id='scheduleAdjustmentShortcut';change.className='outline-button';change.textContent='⇄ Temporary adjustment';
    change.addEventListener('click',()=>{
      setTab('changes');
      $('toggleScheduleAdjustmentForm')?.click();
    });
    actionRow.appendChild(change);
    const settings=document.createElement('button');settings.type='button';settings.id='scheduleSettingsShortcut';settings.className='outline-button';settings.textContent='⚙ Timetable settings';
    settings.addEventListener('click',()=>setTab('settings'));actionRow.appendChild(settings);
  }
  const overview=document.createElement('div');
  overview.className='schedule-overview';
  overview.innerHTML=
   '<div class="schedule-overview-card"><span class="schedule-overview-icon" data-ui-icon="calendar"></span><span>Regular schedules</span><strong id="scheduleTotalMetric">—</strong><small id="scheduleMetricScope">Visible class schedules</small></div>'+
   '<div class="schedule-overview-card"><span class="schedule-overview-icon is-amber" data-ui-icon="users"></span><span>Unassigned classes</span><strong id="scheduleUnassignedMetric">—</strong><small>Need a Subject Teacher</small></div>'+
   '<div class="schedule-overview-card"><span class="schedule-overview-icon is-violet" data-ui-icon="swap"></span><span>Changes this week</span><strong id="scheduleChangesMetric">—</strong><small>Temporary date changes</small></div>';
  header.insertAdjacentElement('afterend',overview);
  const tabs=document.createElement('div');tabs.className='schedule-workspace-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Class scheduling sections');
  choices.forEach(choice=>{
   const button=document.createElement('button');button.type='button';
   button.id=choice.id==='settings'?'scheduleSettingsTab':'scheduleTab'+choice.id;
   button.setAttribute('role','tab');button.dataset.scheduleWorkspaceTab=choice.id;button.setAttribute('aria-selected',String(choice.id==='regular'));
   button.innerHTML='<span data-ui-icon="'+choice.icon+'" aria-hidden="true"></span>'+choice.label;
   button.addEventListener('click',()=>{
    // Close previous drawer before switching task.
    if(!$('scheduleForm')?.hidden)$('cancelScheduleForm')?.click();
    if(!$('scheduleAdjustmentForm')?.hidden)$('cancelScheduleAdjustment')?.click();
    setTab(choice.id);
   });
   tabs.appendChild(button);
  });
  overview.insertAdjacentElement('afterend',tabs);
  tabs.addEventListener('keydown',event=>{
   if(!['ArrowRight','ArrowLeft'].includes(event.key))return;
   const visible=[...tabs.querySelectorAll('[role="tab"]')].filter(b=>!b.hidden);
   const index=visible.indexOf(document.activeElement);if(index<0)return;
   event.preventDefault();const direction=event.key==='ArrowRight'?1:-1;
   const next=visible[(index+direction+visible.length)%visible.length];next.focus();next.click();
  });
  const guide=view.querySelector('.schedule-workflow-guide');
  if(guide)guide.hidden=true;
  const form=$('scheduleForm');
  const adjust=$('scheduleAdjustmentForm');
  const backdrop=document.createElement('div');backdrop.id='scheduleFormBackdrop';backdrop.className='schedule-drawer-backdrop';backdrop.hidden=true;document.body.append(backdrop);
  function syncDrawer(){
   const openForm=[form,adjust].find(node=>node&&!node.hidden&&!node.closest('[hidden]'));
   backdrop.hidden=!openForm;
   document.body.classList.toggle('schedule-drawer-open',Boolean(openForm));
   if(openForm){
    if(!focusedBeforeDrawer)focusedBeforeDrawer=document.activeElement;
    openForm.setAttribute('role','dialog');openForm.setAttribute('aria-modal','true');
    const title=openForm===form?'Create or edit class schedule':'Temporary schedule change';
    openForm.setAttribute('aria-label',title);
    if(activeDrawer!==openForm){
      activeDrawer=openForm;
      openForm.querySelector('button, input, select, textarea')?.focus({preventScroll:true});
    }
   }else{
    if(focusedBeforeDrawer&&document.contains(focusedBeforeDrawer)){focusedBeforeDrawer.focus({preventScroll:true});}
    focusedBeforeDrawer=null;activeDrawer=null;
   }
  }
  for(const node of [form,adjust]){
   if(!node)continue;
   node.classList.add('schedule-side-drawer');
   const head=document.createElement('div');head.className='schedule-drawer-heading';
   head.innerHTML='<div><span>CLASS SCHEDULING</span><h3>'+(node===form?'Class schedule':'Temporary class adjustment')+'</h3><p>'+(node===form?'Set the teacher, class group, weekdays and time.':'Override a scheduled class only for the chosen dates.')+'</p></div>';
   const close=document.createElement('button');close.type='button';close.className='schedule-drawer-close';close.textContent='×';close.setAttribute('aria-label','Close form');
   close.addEventListener('click',()=>$(node===form?'cancelScheduleForm':'cancelScheduleAdjustment')?.click());
   head.append(close);node.prepend(head);
   new MutationObserver(syncDrawer).observe(node,{attributes:true,attributeFilter:['hidden']});
  }
  backdrop.addEventListener('click',()=>{
   if(form&&!form.hidden)$('cancelScheduleForm')?.click();
   if(adjust&&!adjust.hidden)$('cancelScheduleAdjustment')?.click();
  });
  document.addEventListener('keydown',event=>{
   if(backdrop.hidden||document.querySelector('.app-dialog-overlay'))return;
   if(event.key==='Tab' && activeDrawer){
    const controls=[...activeDrawer.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')].filter(el=>!el.disabled&&el.tabIndex>=0&&el.getClientRects().length);
    const first=controls[0],last=controls[controls.length-1];
    if(event.shiftKey && (document.activeElement===first || !activeDrawer.contains(document.activeElement))){event.preventDefault();last?.focus();}
    else if(!event.shiftKey && (document.activeElement===last || !activeDrawer.contains(document.activeElement))){event.preventDefault();first?.focus();}
    return;
   }
   if(event.key!=='Escape')return;
   const node=[form,adjust].find(node=>node&&!node.hidden);
   if(node){event.preventDefault();$(node===form?'cancelScheduleForm':'cancelScheduleAdjustment')?.click();}
  });
  setTab('regular');
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});
 else initialize();
 window.ScheduleWorkspaceUI={update,setTab};
})();
