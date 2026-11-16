(() => {
 'use strict';
 const root=document.getElementById('plannerView');
 if(!root)return;
 const token=sessionStorage.getItem('schoolAttendance.accessToken');
 let user={};
 try{user=JSON.parse(sessionStorage.getItem('schoolAttendance.user')||'{}')}catch{}
 if(!token||!['TEACHER','DEPARTMENT_HEAD'].includes(user.role))return;
 const $=id=>document.getElementById(id);
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const phTime=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(d));
 const phDate=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(d));
 const today=()=>phDate(new Date());
 const dateParts=s=>s.split('-').map(Number);
 const state={month:today().slice(0,7),date:today(),items:[],editing:null,scope:'ALL',loaded:false};
 async function api(path,options={}) {
   const r=await fetch(path,{...options,headers:{Authorization:'Bearer '+token,...(options.body?{'Content-Type':'application/json'}:{})},cache:'no-store'});
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
   $('plannerStats').innerHTML=[['Scheduled',items.filter(x=>x.status==='PLANNED').length],
   ['Completed',items.filter(x=>x.status==='DONE').length],
   ['High priority',items.filter(x=>x.priority==='HIGH'&&x.status==='PLANNED').length]]
     .map(([name,value])=>'<div><strong>'+value+'</strong><span>'+name+'</span></div>').join('');
 }
 function renderCalendar(){
   const [year,month]=dateParts(state.month);
   const start=new Date(Date.UTC(year,month-1,1));
   const first=(start.getUTCDay()+6)%7;
   const days=new Date(Date.UTC(year,month,0)).getUTCDate();
   const cells=Math.ceil((first+days)/7)*7;
   $('plannerMonthTitle').textContent=start.toLocaleDateString('en-PH',{month:'long',year:'numeric',timeZone:'UTC'});
   let html='';
   const filtered=monthItems();
   for(let i=0;i<cells;i++){
     const d=new Date(Date.UTC(year,month-1,i-first+1));
     const key=d.toISOString().slice(0,10),outside=d.getUTCMonth()!==month-1;
     const events=filtered.filter(x=>phDate(x.startAt)===key);
     html+='<button type="button" class="planner-day'+(outside?' outside':'')+(key===today()?' today':'')+(key===state.date?' chosen':'')+'" data-planner-day="'+key+'" aria-label="'+key+', '+events.length+' events"><span class="planner-date">'+d.getUTCDate()+'</span>'+
       events.slice(0,2).map(x=>'<span class="planner-event-dot '+(x.visibility==='DEPARTMENT'?'shared':'')+'">'+escape(x.title)+'</span>').join('')+
       (events.length>2?'<span class="planner-more">+'+(events.length-2)+' more</span>':'')+'</button>';
   }
   $('plannerDays').innerHTML=html;
 }
 function renderList(){
   $('plannerDateHeading').textContent=new Date(state.date+'T00:00:00+08:00').toLocaleDateString('en-PH',{timeZone:'Asia/Manila',weekday:'long',month:'long',day:'numeric',year:'numeric'});
   const events=monthItems().filter(x=>phDate(x.startAt)===state.date).sort((a,b)=>a.startAt.localeCompare(b.startAt));
   $('plannerItems').innerHTML=events.length?events.map(x=>{
     const own=x.ownerUserId===user.userId,cls=x.status==='DONE'?' done':'';
     const date=new Date(x.startAt);
     const time=x.allDay?'All day':new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'}).format(date);
     return '<article class="planner-item'+cls+'"><div class="planner-item-main"><strong>'+escape(x.title)+'</strong><p>'+escape(time)+' · '+escape(x.itemType.toLowerCase())+(x.visibility==='DEPARTMENT'?' · Shared by '+escape(x.ownerName):'')+'</p>'+
     (x.details?'<p>'+escape(x.details)+'</p>':'')+
     '<div class="planner-item-badges"><span class="planner-chip '+(x.priority==='HIGH'?'high':'')+'">'+escape(x.priority)+'</span><span class="planner-chip '+(x.visibility==='DEPARTMENT'?'shared':'')+'">'+escape(x.visibility)+'</span><span class="planner-chip">'+escape(x.status)+'</span></div></div>'+
     (own?'<div class="planner-actions"><button class="planner-btn" type="button" data-planner-edit="'+escape(x.itemId)+'">Edit</button><button class="planner-btn" type="button" data-planner-delete="'+escape(x.itemId)+'">Delete</button></div>':'')+'</article>';
   }).join(''):'<div class="planner-empty">No scheduled items for this date. Add a lesson plan, reminder, meeting, or deadline.</div>';
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
   try{await api('/api/planner/items/'+encodeURIComponent(del.dataset.plannerDelete),{method:'DELETE'});await load();msg('Planner item deleted.')}
   catch(error){msg(error.message,true);del.disabled=false}
 });
 $('plannerForm').addEventListener('submit',async e=>{
   e.preventDefault();const button=$('plannerSave');button.disabled=true;
   try{
     const data=formData(),editing=state.editing;
     await api('/api/planner/items'+(editing?'/'+encodeURIComponent(editing):''),{method:editing?'PATCH':'POST',body:JSON.stringify(data)});
     $('plannerForm').hidden=true;state.editing=null;await load();msg('Planner item saved.');
   }catch(error){msg(error.message,true)}
   finally{button.disabled=false}
 });
 if(user.role!=='DEPARTMENT_HEAD'){$('plannerVisibility').querySelector('option[value=DEPARTMENT]').remove();}
 if(user.role==='DEPARTMENT_HEAD'){$('plannerShareHint').textContent='Department-shared events are visible to teachers in your department.'}
 root.addEventListener('planner:open',()=>{if(!state.loaded)load()});
})();
