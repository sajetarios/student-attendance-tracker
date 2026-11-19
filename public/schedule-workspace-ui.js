'use strict';
/* Modern schedule workspace without changing the scheduling endpoints or permissions. */
(function(){
 const $=id=>document.getElementById(id);
 const choices=[
  {id:'weekly',label:'Class timetable',icon:'grid'},
  {id:'changes',label:'Date-specific changes',icon:'swap'},
  {id:'settings',label:'Timetable settings',icon:'settings'}
 ];
 let active='weekly',role='',initialized=false,focusedBeforeDrawer=null,activeDrawer=null;

 // Department-scoped permanent teacher assignment dialog.
 let assignmentContext={periods:[],teachers:[],departmentId:null,onAssign:null};
 const assignmentSelected=new Set();
 let assignmentSaving=false,assignmentReturnFocus=null;
 function assignmentAvailable(){
  return assignmentContext.periods.filter(p=>
   String(p.scheduleDepartmentId||p.departmentId||'')===String(assignmentContext.departmentId||'') &&
   Boolean(assignmentContext.departmentId) && !p.assignedTeacherUserId && !p.assignedTeacherName);
 }
 function assignmentTeachers(){
  return assignmentContext.teachers.filter(t=>t.active &&
   (t.teacherDesignations||[]).includes('SUBJECT_TEACHER') &&
   String(t.departmentId||'')===String(assignmentContext.departmentId||''));
 }
 function assignmentLabel(p){
  return [p.periodName||'Class',p.subjectName||'',p.gradeLevel?'Grade '+p.gradeLevel:'',p.section||'']
   .filter(Boolean).join(' · ');
 }
 function assignmentFeedback(message,error){
  const target=$('teacherAssignmentFeedback');
  if(!target)return;
  target.textContent=message||'';
  target.classList.toggle('is-error',Boolean(error));
 }
 function assignmentSaveState(){
  const available=assignmentAvailable();
  const ids=new Set(available.map(p=>String(p.periodId)));
  [...assignmentSelected].forEach(id=>{if(!ids.has(id))assignmentSelected.delete(id);});
  const count=assignmentSelected.size;
  const label=$('teacherAssignmentCount'),all=$('teacherAssignmentSelectAll');
  if(label)label.textContent=count+' of '+available.length+' selected (maximum 100)';
  if(all){
   all.disabled=assignmentSaving||!available.length||available.length>100;
   all.checked=available.length>0&&count===available.length;
   all.indeterminate=count>0&&count<available.length;
  }
  const teacher=$('teacherAssignmentTeacher');
  if(teacher)teacher.disabled=assignmentSaving||!assignmentTeachers().length;
  const save=$('teacherAssignmentSave');
  if(save){save.disabled=assignmentSaving||!count||!teacher?.value||count>100;
   save.textContent=assignmentSaving?'Assigning…':count?'Assign '+count+' class'+(count===1?'':'es'):'Assign teacher';}
  $('teacherAssignmentClose').disabled=assignmentSaving;
  $('teacherAssignmentCancel').disabled=assignmentSaving;
 }
 function renderAssignmentDialog(){
  if(!$('teacherAssignmentOverlay')||$('teacherAssignmentOverlay').hidden||assignmentSaving)return;
  const available=assignmentAvailable();
  const teacher=$('teacherAssignmentTeacher'),prior=teacher.value;
  teacher.replaceChildren(new Option('Choose Subject Teacher',''));
  assignmentTeachers().forEach(t=>teacher.add(new Option(t.displayName||t.username||'Teacher',String(t.userId))));
  if([...teacher.options].some(o=>o.value===prior))teacher.value=prior;
  const host=$('teacherAssignmentClasses');
  host.replaceChildren();
  if(!available.length){
   const empty=document.createElement('p');empty.className='teacher-assignment-empty';
   empty.textContent='No unassigned classes are available in your department.';host.append(empty);
  }else{
   available.forEach(p=>{
    const row=document.createElement('label');row.className='teacher-assignment-class';
    const input=document.createElement('input');input.type='checkbox';input.value=String(p.periodId);
    input.checked=assignmentSelected.has(String(p.periodId));
    const details=document.createElement('span');details.className='teacher-assignment-class-details';
    const title=document.createElement('strong');title.textContent=assignmentLabel(p);
    const secondary=document.createElement('small');
    const days=Array.isArray(p.weekdays)&&p.weekdays.length?p.weekdays.join(', '):'';
    secondary.textContent=[days,p.startTime&&p.endTime?p.startTime+'–'+p.endTime:'',p.classroom||''].filter(Boolean).join(' · ');
    details.append(title,secondary);row.append(input,details);
    input.addEventListener('change',()=>{
     if(input.checked&&assignmentSelected.size>=100){
      input.checked=false;assignmentFeedback('You can assign up to 100 classes at a time.',true);
     }else{
      if(input.checked)assignmentSelected.add(input.value);else assignmentSelected.delete(input.value);
      assignmentFeedback('',false);
     }
     assignmentSaveState();
    });
    host.append(row);
   });
  }
  $('teacherAssignmentNoTeachers').hidden=assignmentTeachers().length>0;
  $('teacherAssignmentLimitNote').hidden=available.length<=100;
  assignmentSaveState();
 }
 function closeAssignmentDialog(){
  if(assignmentSaving)return;
  const overlay=$('teacherAssignmentOverlay');if(!overlay||overlay.hidden)return;
  overlay.hidden=true;document.body.classList.remove('teacher-assignment-open');
  assignmentSelected.clear();assignmentFeedback('',false);
  if(assignmentReturnFocus&&document.contains(assignmentReturnFocus))assignmentReturnFocus.focus({preventScroll:true});
  assignmentReturnFocus=null;
 }
 function openAssignmentDialog(options={}){
  if(role!=='DEPARTMENT_HEAD'||!assignmentContext.departmentId||assignmentSaving)return;
  const overlay=$('teacherAssignmentOverlay');if(!overlay)return;
  const available=assignmentAvailable();
  const requestedId=options.periodId?String(options.periodId):'';
  assignmentSelected.clear();
  // A specific class takes priority; otherwise preselect the only available class.
  const preferred=available.find(period=>String(period.periodId)===requestedId)||
    (available.length===1?available[0]:null);
  if(preferred)assignmentSelected.add(String(preferred.periodId));
  assignmentReturnFocus=document.activeElement;
  overlay.hidden=false;document.body.classList.add('teacher-assignment-open');
  assignmentFeedback('',false);renderAssignmentDialog();
  $('teacherAssignmentTeacher').focus({preventScroll:true});
 }
 function initializeAssignmentDialog(){
  if($('teacherAssignmentOverlay'))return;
  const overlay=document.createElement('div');overlay.id='teacherAssignmentOverlay';
  overlay.className='teacher-assignment-overlay';overlay.hidden=true;
  overlay.innerHTML=
   '<section class="teacher-assignment-dialog" role="dialog" aria-modal="true" aria-labelledby="teacherAssignmentTitle" aria-describedby="teacherAssignmentIntro">'+
   '<header class="teacher-assignment-header"><div><span class="teacher-assignment-kicker">DEPARTMENT SCHEDULES</span>'+
   '<h2 id="teacherAssignmentTitle">Assign Subject Teachers</h2>'+
   '<p id="teacherAssignmentIntro">Select unassigned classes from your department and choose an eligible teacher.</p></div>'+
   '<button type="button" id="teacherAssignmentClose" class="teacher-assignment-close" aria-label="Close assignment dialog">×</button></header>'+
   '<div class="teacher-assignment-body"><label class="teacher-assignment-label" for="teacherAssignmentTeacher">Subject Teacher</label>'+
   '<select id="teacherAssignmentTeacher" aria-describedby="teacherAssignmentNoTeachers"></select>'+
   '<p id="teacherAssignmentNoTeachers" class="teacher-assignment-hint" hidden>No active Subject Teachers are available in this department.</p>'+
   '<div class="teacher-assignment-list-top"><strong>Unassigned class schedules</strong><span id="teacherAssignmentCount"></span></div>'+
   '<label class="teacher-assignment-select-all"><input type="checkbox" id="teacherAssignmentSelectAll"> Select all available classes</label>'+
   '<p id="teacherAssignmentLimitNote" class="teacher-assignment-hint" hidden>Select up to 100 classes per assignment.</p>'+
   '<div id="teacherAssignmentClasses" class="teacher-assignment-classes"></div>'+
   '<p class="teacher-assignment-hint">Only permanent assignments are made here. Department eligibility, existing owners and overlapping schedules are checked when you save.</p>'+
   '<p id="teacherAssignmentFeedback" class="teacher-assignment-feedback" role="status" aria-live="polite"></p></div>'+
   '<footer class="teacher-assignment-actions"><button type="button" id="teacherAssignmentCancel" class="outline-button">Cancel</button>'+
   '<button type="button" id="teacherAssignmentSave" class="primary-button" disabled>Assign teacher</button></footer></section>';
  document.body.append(overlay);
  $('teacherAssignmentClose').addEventListener('click',closeAssignmentDialog);
  $('teacherAssignmentCancel').addEventListener('click',closeAssignmentDialog);
  overlay.addEventListener('click',e=>{if(e.target===overlay)closeAssignmentDialog();});
  $('teacherAssignmentTeacher').addEventListener('change',()=>{assignmentFeedback('',false);assignmentSaveState();});
  $('teacherAssignmentSelectAll').addEventListener('change',e=>{
   assignmentSelected.clear();
   if(e.target.checked)assignmentAvailable().forEach(p=>assignmentSelected.add(String(p.periodId)));
   $('teacherAssignmentClasses').querySelectorAll('input[type="checkbox"]').forEach(input=>{input.checked=assignmentSelected.has(input.value);});
   assignmentFeedback('',false);assignmentSaveState();
  });
  $('teacherAssignmentSave').addEventListener('click',async()=>{
   if(assignmentSaving||role!=='DEPARTMENT_HEAD'||typeof assignmentContext.onAssign!=='function')return;
   const valid=new Set(assignmentAvailable().map(p=>String(p.periodId)));
   const periodIds=[...assignmentSelected].filter(id=>valid.has(id));
   const teacherUserId=$('teacherAssignmentTeacher').value;
   if(!periodIds.length||periodIds.length>100||!assignmentTeachers().some(t=>String(t.userId)===teacherUserId)){
    assignmentFeedback('Choose at least one unassigned class and an eligible Subject Teacher.',true);return;
   }
   assignmentSaving=true;assignmentSaveState();
   assignmentFeedback('Checking permissions and timetable conflicts…',false);
   try{
    const result=await assignmentContext.onAssign({periodIds,teacherUserId});
    assignmentSaving=false;closeAssignmentDialog();
   }catch(error){
    assignmentSaving=false;
    assignmentFeedback(error?.message||'Could not save teacher assignments. Please try again.',true);
    assignmentSaveState();
   }
  });
  document.addEventListener('keydown',e=>{
   if(overlay.hidden)return;
   if(e.key==='Escape'){if(!assignmentSaving){e.preventDefault();closeAssignmentDialog();}return;}
   if(e.key!=='Tab')return;
   const controls=[...overlay.querySelectorAll('button,select,input')].filter(x=>!x.disabled&&x.getClientRects().length);
   const first=controls[0],last=controls[controls.length-1];
   if(e.shiftKey&&(document.activeElement===first||!overlay.contains(document.activeElement))){e.preventDefault();last?.focus();}
   else if(!e.shiftKey&&(document.activeElement===last||!overlay.contains(document.activeElement))){e.preventDefault();first?.focus();}
  });
 }

 function setTab(tab){
  if(!choices.some(c=>c.id===tab)|| (tab==='settings'&&role!=='SCHOOL_ADMIN'))return;
  const view=$('schedulesView');if(!view||!role)return;
  active=tab;view.dataset.scheduleTab=tab;
  document.querySelectorAll('[data-schedule-workspace-tab]').forEach(button=>{
   const selected=button.dataset.scheduleWorkspaceTab===tab;
   button.classList.toggle('is-active',selected);
   button.setAttribute('aria-selected',String(selected));
   button.tabIndex=selected?0:-1;
  });
  if(tab==='weekly' && role) {
    // Wait until authenticated role data is loaded before rendering the timetable.
    document.querySelector('[data-schedule-display="weekly"]')?.click();
  }
  window.TimetableGrid?.close?.(false);
  if(tab==='settings')$('timetableSettings')?.scrollIntoView({block:'nearest',behavior:'smooth'});
 }
 function update(data){
  if(!initialized)initialize();
  const roleChanged=Boolean(data.role && data.role!==role);
  const authorizedRole=['SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER'].includes(data.role) ? data.role : '';
  if (!authorizedRole) return; // Remain default-deny until authenticated role data exists.
  role=authorizedRole;
  const view=$('schedulesView');
  if(view) view.dataset.scheduleRole=role;
  const periods=Array.isArray(data.periods)?data.periods:[];
  assignmentContext={periods,teachers:Array.isArray(data.teachers)?data.teachers:[],departmentId:data.departmentId||null,onAssign:data.onAssign};
  if($('teacherAssignmentOverlay')&&!$('teacherAssignmentOverlay').hidden&&!assignmentSaving)renderAssignmentDialog();
  if(role!=='DEPARTMENT_HEAD'&&!assignmentSaving)closeAssignmentDialog();
  const changes=Array.isArray(data.scheduleAdjustments)?data.scheduleAdjustments:[];
  const total=periods.length;
  const free=role==='DEPARTMENT_HEAD' ? assignmentAvailable().length :
    periods.filter(item=>!item.assignedTeacherName&&!item.assignedTeacherUserId).length;
  const count=id=>{if($(id))$(id).textContent=String(id==='scheduleTotalMetric'?total:id==='scheduleUnassignedMetric'?free:changes.length);};
  ['scheduleTotalMetric','scheduleUnassignedMetric','scheduleChangesMetric'].forEach(count);
  const unassignedCard=$('scheduleUnassignedCard');
  if(unassignedCard){
    const canAssign=role==='DEPARTMENT_HEAD'&&Boolean(assignmentContext.departmentId);
    unassignedCard.hidden=false;
    unassignedCard.tabIndex=canAssign?0:-1;
    unassignedCard.setAttribute('role',canAssign?'button':'group');
    unassignedCard.setAttribute('aria-label',canAssign?
      'Assign Subject Teachers to '+assignmentAvailable().length+' unassigned department class schedules':
      'Unassigned class schedules');
    unassignedCard.classList.toggle('is-actionable',canAssign);
    unassignedCard.dataset.assignmentEnabled=String(canAssign);
  }
  if($('scheduleSettingsTab'))$('scheduleSettingsTab').hidden=role!=='SCHOOL_ADMIN';
  if($('scheduleSettingsShortcut'))$('scheduleSettingsShortcut').hidden=role!=='SCHOOL_ADMIN';
  if($('scheduleMetricScope'))$('scheduleMetricScope').textContent=role==='TEACHER'?'Your assigned classes':role==='DEPARTMENT_HEAD'?'Department timetable':'School-wide timetable';
  const manager=role==='SCHOOL_ADMIN'||role==='DEPARTMENT_HEAD';
  if($('scheduleAdjustmentShortcut'))$('scheduleAdjustmentShortcut').hidden=!manager;
  if($('scheduleAssignmentShortcut'))$('scheduleAssignmentShortcut').hidden=role!=='DEPARTMENT_HEAD';
  if($('scheduleAdvancedTools'))$('scheduleAdvancedTools').hidden=!manager;
  if($('showScheduleForm')) {
    $('showScheduleForm').hidden=role!=='SCHOOL_ADMIN'&&role!=='DEPARTMENT_HEAD';
    $('showScheduleForm').textContent=role==='DEPARTMENT_HEAD'?'＋ New department class':'＋ New class schedule';
  }
  if($('schedulePrimaryActions'))$('schedulePrimaryActions').hidden=!manager;
  const intro=$('scheduleScopeText');
  if(intro){
    intro.dataset.newCopy='1';
    intro.textContent=role==='TEACHER'?'View your assigned classes and date-specific timetable changes.':role==='DEPARTMENT_HEAD'?'Create, edit and assign department classes within published school timetable rules.':'Create school-wide schedules, including unassigned classes, and manage timetable settings.';
  }
  if(view) view.dataset.scheduleRoleReady='true';
  if(roleChanged||!active||active==='settings'&&role!=='SCHOOL_ADMIN')setTab('weekly');
  if(!initialized)return;
 }
 function initialize(){
  if(initialized)return;
  const view=$('schedulesView'),header=view?.querySelector(':scope > .surface-card > .section-toolbar');
  if(!view||!header)return;
  initialized=true;view.classList.add('modern-schedule-workspace');
  // Controls never become visible until update() receives a verified role.
  delete view.dataset.scheduleRoleReady;
  delete view.dataset.scheduleRole;
  initializeAssignmentDialog();
  view.dataset.scheduleTab='weekly';
  const create=$('showScheduleForm');
  if(create){
    const actionRow=document.createElement('div');actionRow.className='schedule-primary-actions';actionRow.id='schedulePrimaryActions';actionRow.hidden=true;
    create.parentElement.insertBefore(actionRow,create);actionRow.appendChild(create);
    create.textContent='＋ New class schedule';create.hidden=true;
    const assignment=document.createElement('button');
    assignment.type='button';assignment.id='scheduleAssignmentShortcut';
    assignment.className='primary-button';assignment.textContent='Assign teachers';assignment.hidden=true;
    actionRow.append(assignment);
    assignment.addEventListener('click',openAssignmentDialog);
    const change=document.createElement('button');change.type='button';change.id='scheduleAdjustmentShortcut';change.className='outline-button';change.textContent='⇄ Temporary adjustment';
    change.hidden=true;
    change.addEventListener('click',()=>{
      setTab('changes');
      $('toggleScheduleAdjustmentForm')?.click();
    });
    actionRow.appendChild(change);
    const settings=document.createElement('button');settings.type='button';settings.id='scheduleSettingsShortcut';settings.className='outline-button';settings.textContent='⚙ Timetable settings';
    settings.hidden=true;
    settings.addEventListener('click',()=>setTab('settings'));actionRow.appendChild(settings);
  }
  const overview=document.createElement('div');
  overview.className='schedule-overview';
  overview.innerHTML=
   '<div class="schedule-overview-card"><span class="schedule-overview-icon" data-ui-icon="calendar"></span><span>Regular schedules</span><strong id="scheduleTotalMetric">—</strong><small id="scheduleMetricScope">Visible class schedules</small></div>'+
   '<div class="schedule-overview-card"><span class="schedule-overview-icon is-amber" data-ui-icon="users"></span><span>Unassigned classes</span><strong id="scheduleUnassignedMetric">—</strong><small>Need a Subject Teacher</small></div>'+
   '<div class="schedule-overview-card"><span class="schedule-overview-icon is-violet" data-ui-icon="swap"></span><span>Changes this week</span><strong id="scheduleChangesMetric">—</strong><small>Temporary date changes</small></div>';
  overview.setAttribute('aria-live','polite');
  header.insertAdjacentElement('afterend',overview);
  const unassignedCard=overview.querySelector('.schedule-overview-card:nth-child(2)');
  if(unassignedCard){
    unassignedCard.id='scheduleUnassignedCard';
    unassignedCard.tabIndex=-1;
    unassignedCard.setAttribute('role','group');
    unassignedCard.addEventListener('click',()=>{
      if(unassignedCard.dataset.assignmentEnabled==='true')openAssignmentDialog();
    });
    unassignedCard.addEventListener('keydown',event=>{
      if(unassignedCard.dataset.assignmentEnabled==='true'&&(event.key==='Enter'||event.key===' ')){
        event.preventDefault();openAssignmentDialog();
      }
    });
  }
  const tabs=document.createElement('div');tabs.className='schedule-workspace-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Class scheduling sections');
  choices.forEach(choice=>{
   const button=document.createElement('button');button.type='button';
   button.id=choice.id==='settings'?'scheduleSettingsTab':'scheduleTab'+choice.id;
   button.setAttribute('role','tab');button.dataset.scheduleWorkspaceTab=choice.id;button.setAttribute('aria-selected',String(choice.id==='weekly'));
   if(choice.id==='settings')button.hidden=true;
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
    const title=openForm===form?'School Admin class schedule':'Temporary schedule change';
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
  // Preserve the older management controls for bulk tasks without a duplicate primary view.
  const week=$('weeklyTimetableWorkspace');
  const bulk=$('periodBulkToolbar'),intro=view.querySelector('.schedule-list-intro'),manager=$('managerScheduleTableWrap');
  if(week&&manager){
    const advanced=document.createElement('details');advanced.id='scheduleAdvancedTools';
    advanced.className='schedule-advanced-tools';
    const summary=document.createElement('summary');
    summary.textContent='Advanced schedule management · Bulk actions';
    advanced.append(summary);
    [bulk,intro,manager].forEach(node=>{if(node)advanced.append(node);});
    week.insertAdjacentElement('afterend',advanced);
  }
  // update() will activate the tab only after the authenticated role is known.
  if(role)setTab('weekly');
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});
 else initialize();
 window.ScheduleWorkspaceUI={update,setTab};
})();
