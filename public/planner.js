window.attendigoStaffIdentity.then(user => {
 'use strict';
 const root=document.getElementById('plannerView');
 if(!root)return;

 if(!['TEACHER','DEPARTMENT_HEAD'].includes(user.role))return;
 const $=id=>document.getElementById(id);
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const phTime=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(d));
 const phDate=d=>{const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(d));const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));return v.year+'-'+v.month+'-'+v.day;};
 const today=()=>phDate(new Date());
 const dateParts=s=>s.split('-').map(Number);
 const state={month:today().slice(0,7),date:today(),items:[],editing:null,scope:'ALL',view:(typeof window.matchMedia==='function' && window.matchMedia('(max-width:650px)').matches ? 'AGENDA' : 'MONTH'),loaded:false};
 async function api(path,options={}) {
   const r=await fetch(path,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{})},cache:'no-store'});
   const data=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(data.error||'Request failed ('+r.status+')');
   return data;
 }
 function msg(m,bad=false){$('plannerFeedback').textContent=m;$('plannerFeedback').style.color=bad?'#e35b61':''}
 function asInput(date){const dt=new Date(date);return phDate(dt)+'T'+new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(dt)}
 function formData(){
   const start=$('plannerStart').value,end=$('plannerEnd').value;
   return {title:$('plannerTitle').value.trim(),details:$('plannerDetails').value.trim(),itemType:$('plannerType').value,
     visibility:$('plannerVisibility').value,priority:$('plannerPriority').value,status:$('plannerStatus').value,
     allDay:$('plannerAllDay').checked,startAt:start?new Date(start+':00+08:00').toISOString():null,
     endAt:end?new Date(end+':00+08:00').toISOString():null};
 }
 function matchScope(item){return state.scope==='ALL'||(state.scope==='PERSONAL'?item.visibility==='PERSONAL':item.visibility==='DEPARTMENT')}
 function monthItems(){return state.items.filter(matchScope)}
 function renderStats(){
   const items=monthItems();
   $('plannerStats').innerHTML=[['Upcoming',items.filter(x=>x.status==='PLANNED').length],
   ['Completed',items.filter(x=>x.status==='DONE').length],
   ['High priority',items.filter(x=>x.priority==='HIGH'&&x.status==='PLANNED').length]]
     .map(([name,value],i)=>'<div class="planner-stat planner-stat-'+i+'"><span class="planner-stat-icon" aria-hidden="true">'+['◷','✓','!'][i]+'</span><strong>'+value+'</strong><span>'+name+'</span></div>').join('');
 }
 function renderCalendar(){
   const [year,month]=dateParts(state.month);
   const start=new Date(Date.UTC(year,month-1,1));
   const first=(start.getUTCDay()+6)%7;
   const days=new Date(Date.UTC(year,month,0)).getUTCDate();
   const cells=Math.ceil((first+days)/7)*7;
   $('plannerMonthTitle').textContent=start.toLocaleDateString('en-PH',{month:'long',year:'numeric',timeZone:'UTC'});
   const filtered=monthItems();
   const weekStart=(()=>{const d=new Date(state.date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d;})();
   let html='';
   const total=state.view==='WEEK'?7:cells;
   for(let i=0;i<total;i++){
     const d=state.view==='WEEK'?new Date(weekStart.getTime()+i*86400000):new Date(Date.UTC(year,month-1,i-first+1));
     const key=d.toISOString().slice(0,10),outside=d.getUTCMonth()!==month-1;
     const events=filtered.filter(x=>phDate(x.startAt)===key);
     html+='<button type="button" class="planner-day'+(outside?' outside':'')+(key===today()?' today':'')+(key===state.date?' chosen':'')+'" data-planner-day="'+key+'" aria-label="'+key+', '+events.length+' events"><span class="planner-date">'+d.getUTCDate()+'</span>'+
       events.slice(0,state.view==='WEEK'?5:3).map(x=>'<span class="planner-event-dot planner-type-'+escape(x.itemType.toLowerCase())+(x.visibility==='DEPARTMENT'?' shared':'')+'">'+escape(x.title)+'</span>').join('')+
       (events.length>(state.view==='WEEK'?5:3)?'<span class="planner-more">+'+(events.length-(state.view==='WEEK'?5:3))+' more</span>':'')+'</button>';
   }
   $('plannerDays').innerHTML=html;
   const calendar=root.querySelector('.planner-calendar');
   calendar.hidden=state.view==='AGENDA';
   calendar.classList.toggle('planner-week-mode',state.view==='WEEK');
   root.classList.toggle('planner-agenda-mode',state.view==='AGENDA');
   root.classList.toggle('planner-week-mode',state.view==='WEEK');
   root.querySelectorAll('[data-planner-view]').forEach(button=>{
     const active=button.dataset.plannerView===state.view;
     button.classList.toggle('is-active',active);
     button.setAttribute('aria-pressed',String(active));
   });
 }
 function renderList(){
   $('plannerDateHeading').textContent=new Date(state.date+'T00:00:00+08:00').toLocaleDateString('en-PH',{timeZone:'Asia/Manila',weekday:'long',month:'long',day:'numeric',year:'numeric'});
   const events=monthItems().filter(x=>state.view==='AGENDA'?true:phDate(x.startAt)===state.date).sort((a,b)=>a.startAt.localeCompare(b.startAt));
   if(state.view==='AGENDA')$('plannerDateHeading').textContent='Upcoming activities · '+$('plannerMonthTitle').textContent;
   $('plannerItems').innerHTML=events.length?events.map(x=>{
     const own=x.ownerUserId===user.userId,cls=x.status==='DONE'?' done':'';
     const date=new Date(x.startAt);
     const time=x.allDay?'All day':new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'}).format(date);
     return '<article class="planner-item planner-type-'+escape(x.itemType.toLowerCase())+cls+'"><div class="planner-item-main"><strong>'+escape(x.title)+'</strong><p>'+(state.view==='AGENDA'?escape(phDate(x.startAt))+' · ':'')+escape(time)+' · '+escape(x.itemType.toLowerCase())+(x.visibility==='DEPARTMENT'?' · Shared by '+escape(x.ownerName):'')+'</p>'+
     (x.details?'<p>'+escape(x.details)+'</p>':'')+
     '<div class="planner-item-badges"><span class="planner-chip '+(x.priority==='HIGH'?'high':'')+'">'+escape(x.priority)+'</span><span class="planner-chip '+(x.visibility==='DEPARTMENT'?'shared':'')+'">'+escape(x.visibility)+'</span><span class="planner-chip">'+escape(x.status)+'</span></div></div>'+
     (own?'<div class="planner-actions"><button class="planner-btn" type="button" data-planner-edit="'+escape(x.itemId)+'">Edit</button><button class="planner-btn" type="button" data-planner-delete="'+escape(x.itemId)+'">Delete</button></div>':'')+'</article>';
   }).join(''):'<div class="planner-empty"><span class="planner-empty-icon" aria-hidden="true">✧</span><strong>A little breathing room</strong><p>No activities '+(state.view==='AGENDA'?'this month':'for this date')+'. Create a task, meeting or lesson preparation when you are ready.</p><button type="button" class="planner-btn" data-planner-empty-new>＋ Add an item</button></div>';
 }
 function render(){renderStats();renderCalendar();renderList()}
 async function load(){
   const [y,m]=dateParts(state.month);
   const from=new Date(Date.UTC(y,m-1,-6)).toISOString();
   const to=new Date(Date.UTC(y,m-1,43)).toISOString();
   msg('Loading Planner…');
   try{
     const result=await api('/api/planner/items?'+new URLSearchParams({from,to}));
     state.items=result.items||[];state.loaded=true;
     const shareOption=$('plannerVisibility').querySelector('option[value="DEPARTMENT"]');
     if(shareOption){
       shareOption.disabled=!result.canShare;
       shareOption.textContent=result.canShare?'My department'+(result.departmentName?' ('+result.departmentName+')':''):'My department (assignment required)';
       if(!result.canShare&&$('plannerVisibility').value==='DEPARTMENT')$('plannerVisibility').value='PERSONAL';
     }
     $('plannerShareHint').textContent=result.canShare
       ?'Your department colleagues can view shared items. Your personal items stay private.'
       :'Sharing is unavailable until your School Admin assigns an active department.';
     render();msg('Your planner is up to date.');
   }catch(e){render();msg('Unable to load Planner: '+e.message,true)}
 }
 function openForm(item=null){
   state.editing=item?.itemId||null;
   $('plannerForm').hidden=false;
   $('plannerFormTitle').textContent=item?'Edit planner item':'New planner item';
   $('plannerTitle').value=item?.title||'';
   $('plannerDetails').value=item?.details||'';
   $('plannerType').value=item?.itemType||'TASK';
   $('plannerPriority').value=item?.priority||'NORMAL';
   $('plannerStatus').value=item?.status||'PLANNED';
   $('plannerVisibility').value=item?.visibility||'PERSONAL';
   $('plannerAllDay').checked=item?.allDay||false;
   $('plannerStart').value=item?asInput(item.startAt):state.date+'T08:00';
   $('plannerEnd').value=item?asInput(item.endAt):state.date+'T09:00';
   $('plannerTitle').focus();
 }
 $('plannerToday').addEventListener('click',()=>{state.month=today().slice(0,7);state.date=today();load()});
 $('plannerPrevious').addEventListener('click',()=>changeMonth(-1));
 $('plannerNext').addEventListener('click',()=>changeMonth(1));
 function changeMonth(step){
   const [y,m]=dateParts(state.month);
   const d=new Date(Date.UTC(y,m-1+step,1));state.month=d.toISOString().slice(0,7);state.date=state.month+'-01';load();
 }
 $('plannerNew').addEventListener('click',()=>openForm());
 $('plannerCancel').addEventListener('click',()=>{$('plannerForm').hidden=true;state.editing=null});
 $('plannerScope').addEventListener('change',e=>{state.scope=e.target.value;render()});
 root.querySelectorAll('[data-planner-view]').forEach(button=>button.addEventListener('click',()=>{
   state.view=button.dataset.plannerView;
   render();
 }));
 $('plannerItems').addEventListener('click',e=>{if(e.target.closest('[data-planner-empty-new]'))openForm()});

 $('plannerDays').addEventListener('click',e=>{
   const button=e.target.closest('[data-planner-day]');if(!button)return;
   state.date=button.dataset.plannerDay;
   if(state.month!==state.date.slice(0,7)){state.month=state.date.slice(0,7);load()}else render();
 });
 $('plannerItems').addEventListener('click',async e=>{
   const edit=e.target.closest('[data-planner-edit]'),del=e.target.closest('[data-planner-delete]');
   if(edit){const item=state.items.find(x=>x.itemId===edit.dataset.plannerEdit);if(item)openForm(item);return;}
   if(!del)return;
   if(!confirm('Delete this planner item? This does not alter the official timetable.'))return;
   del.disabled=true;
   try{await api('/api/planner/items/'+encodeURIComponent(del.dataset.plannerDelete),{method:'DELETE'});await load();updateDashboardWidget();msg('Planner item deleted.')}
   catch(error){msg(error.message,true);del.disabled=false}
 });
 $('plannerForm').addEventListener('submit',async e=>{
   e.preventDefault();const button=$('plannerSave');button.disabled=true;
   try{
     const data=formData(),editing=state.editing;
     await api('/api/planner/items'+(editing?'/'+encodeURIComponent(editing):''),{method:editing?'PATCH':'POST',body:JSON.stringify(data)});
     $('plannerForm').hidden=true;state.editing=null;await load();updateDashboardWidget();msg('Planner item saved.');
   }catch(error){msg(error.message,true)}
   finally{button.disabled=false}
 });
 // Sharing capabilities are supplied by the server for both roles.
 // Never remove the Department option solely because the user is a Teacher.

 let summaryBusy=false;
 async function updateDashboardWidget(){
   const card=$('plannerDashboardWidget');
   if(!card||card.hidden||summaryBusy)return;
   summaryBusy=true;
   const todayDate=today();
   const start=new Date(todayDate+'T00:00:00+08:00');
   const end=new Date(start.getTime()+8*86400000);
   try{
     const response=await api('/api/planner/items?'+new URLSearchParams({from:start.toISOString(),to:end.toISOString()}));
     const items=response.items||[];
     const active=items.filter(x=>x.status==='PLANNED');
     const dayItems=active.filter(x=>phDate(x.startAt)===todayDate);
     $('plannerDashboardToday').textContent=String(dayItems.length);
     $('plannerDashboardUpcoming').textContent=String(active.length);
     $('plannerDashboardShared').textContent=String(active.filter(x=>x.visibility==='DEPARTMENT').length);
     const next=active.slice().sort((a,b)=>a.startAt.localeCompare(b.startAt)).slice(0,3);
     $('plannerDashboardPreview').innerHTML=next.length
       ?next.map(x=>'<span class="planner-dashboard-event"><b>'+escape(x.title)+'</b><small>'+escape(phDate(x.startAt))+(x.visibility==='DEPARTMENT'?' · Shared':'')+'</small></span>').join('')
       :'<span class="planner-dashboard-empty">No upcoming activities. Add a task, meeting or lesson preparation.</span>';
   }catch(error){
     $('plannerDashboardPreview').textContent='Planner summary unavailable. Open Planner to try again.';
   }finally{summaryBusy=false}
 }
 $('plannerDashboardOpen')?.addEventListener('click',()=>$('plannerNav')?.click());
 $('plannerDashboardNew')?.addEventListener('click',()=>{
   $('plannerNav')?.click();
   openForm();
 });
 root.addEventListener('planner:dashboard',updateDashboardWidget);
 root.addEventListener('planner:open',()=>{if(!state.loaded)load()});
});
