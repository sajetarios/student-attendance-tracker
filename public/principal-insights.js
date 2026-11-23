'use strict';
// Interactive, read-only executive overview. School Admin preview only.
// Each value comes from a school-scoped API; no demo numbers or inferred absences.
(() => {
 const $=id=>document.getElementById(id);
 const root=$('principalInsightsView');
 if(!root)return;
 const asNumber=v=>Number.isFinite(Number(v))?Number(v):0;
 const fmt=v=>new Intl.NumberFormat('en-PH').format(asNumber(v));
 const shortDay=iso=>new Intl.DateTimeFormat('en-PH',{month:'short',day:'numeric',
  timeZone:'UTC'}).format(new Date(iso+'T00:00:00Z'));
 const sourceLinks={pending:'lunchQrAdmin',approvals:'officialBusiness',students:'classQrMonitor',
   verified:'form48Reports'};
 let current=null,active=false,seq=0;
 function status(message,error=false){
  const el=$('piStatus'); if(!el)return;
  el.textContent=message;el.classList.toggle('pi-error',error);
 }
 function blank(text){
  const el=document.createElement('p');
  el.className='pi-blank';el.textContent=text;return el;
 }
 function focus(key,day){
  if(!current)return;
  const staff=current.staff,leave=current.approvals.leave,ob=current.approvals.ob;
  const details={
   verified:['What does verified mean?',
    fmt(staff.verifiedSlots)+' verified DTR slot entries across '+fmt(staff.staffWithVerifiedSlot)+
    ' staff in this reporting period. This counts events, not days present. Staff without a verified scan are not automatically absent.'],
   pending:['Which records need verification?',
    fmt(staff.pendingSlots)+' DTR slot events are awaiting authorized review. Until reviewed they do not count as verified Form 48 entries. Use the QR review workflow to inspect the original evidence.'],
   students:['How should learner activity be interpreted?',
    fmt(current.students.uniqueLearnersScanned)+' unique learners have accepted school-level Time-In scans in the selected dates. Class-period attendance may exist separately; missing scans must not be interpreted as absences. This count is school-wide even when a department is selected.'],
   approvals:['What decisions are outstanding?',
    fmt(leave.head)+' leave requests await department recommendation, '+fmt(leave.school)+
    ' await school review, '+fmt(leave.official)+' await documented official decisions, and '+
    fmt(ob.head+ob.school)+' OB requests await a workflow step. These counts are not approvals granted.']
  };
  const chosen=day?
   ['Verified activity · '+shortDay(day.date),fmt(day.verifiedSlots)+
    ' verified DTR slot event(s) were recorded for this day. This is an event count, not an employee attendance rate.']:
   details[key]||['School intelligence','Select any card, bar or department to explore its source and limitations.'];
  $('piFocusTitle').textContent=chosen[0];$('piFocusBody').textContent=chosen[1];
  root.querySelectorAll('.pi-kpi').forEach(el=>el.classList.toggle('pi-selected',!day&&el.dataset.piFocus===key));
  if(key && sourceLinks[key] && !day){
   const link=root.querySelector('.pi-focus-link');if(link)link.href='/portal.html?view='+sourceLinks[key];
  }
 }
 function trend(data){
  const el=$('piTrend');el.replaceChildren();
  const rows=data.trend||[];
  if(!rows.length){el.append(blank('No verified DTR trend data for this selection.'));return;}
  const max=Math.max(1,...rows.map(r=>asNumber(r.verifiedSlots)));
  const chart=document.createElement('div');chart.className='pi-bars';
  const showLabels=rows.length<=7;
  for(const item of rows){
   const bar=document.createElement('button');bar.type='button';bar.className='pi-bar-button';
   const count=asNumber(item.verifiedSlots);
   const fill=document.createElement('span');fill.className='pi-bar-fill';
   fill.style.height=Math.max(3,(count/max)*100)+'%';
   fill.setAttribute('aria-hidden','true');
   const day=document.createElement('span');day.className='pi-bar-date';
   day.textContent=showLabels?shortDay(item.date):item.date.slice(8);
   const number=document.createElement('span');number.className='pi-bar-number';
   number.textContent=showLabels?fmt(count):'';
   bar.setAttribute('aria-label',item.date+': '+fmt(count)+' verified DTR entries. Inspect day.');
   bar.title=item.date+' · '+fmt(count)+' verified DTR entries';
   bar.append(number,fill,day);
   bar.addEventListener('click',()=>{
    chart.querySelectorAll('.pi-bar-button').forEach(b=>b.classList.remove('pi-active'));
    bar.classList.add('pi-active');
    $('piTrendDetail').textContent=item.date+': '+fmt(count)+
      ' verified DTR slot event(s). Missing entries are not confirmed absences.';
    focus(null,item);
   });
   chart.append(bar);
  }
  el.append(chart);
 }
 function attention(data){
  const holder=$('piAttention');holder.replaceChildren();
  const l=data.approvals.leave,o=data.approvals.ob,items=[
   {number:data.staff.pendingSlots,name:'DTR scans for review',
    note:'Security evidence or exception must be checked',view:'lunchQrAdmin'},
   {number:l.school,name:'Leave requests for school review',
    note:'Next school-level workflow step',view:'dashboard',panel:'requests'},
   {number:l.official,name:'Leave awaiting official decision',
    note:'Not approved until documentary decision is verified',view:'dashboard',panel:'requests'},
   {number:o.school,name:'OB pending school decision',
    note:'Follow existing approval permissions',view:'officialBusiness'},
   {number:l.head+o.head,name:'Requests awaiting department review',
    note:'Department Heads must complete their stage',view:'officialBusiness'}
  ];
  const present=items.filter(x=>x.number>0);
  if(!present.length){holder.append(blank('No pending DTR scans or open leave/OB workflows in the selected scope.'));return;}
  for(const item of present){
   const a=document.createElement('a');a.className='pi-action';
   a.href='/portal.html?view='+item.view+(item.panel?'&panel='+item.panel:'');
   const count=document.createElement('strong');count.className='pi-action-count';
   count.textContent=fmt(item.number);
   const copy=document.createElement('span');
   const title=document.createElement('b');title.textContent=item.name;
   const note=document.createElement('small');note.textContent=item.note;
   copy.append(title,note);
   const arrow=document.createElement('span');arrow.setAttribute('aria-hidden','true');arrow.textContent='↗';
   a.append(count,copy,arrow);holder.append(a);
  }
 }
 function departmentRows(data){
  const holder=$('piDepartments');holder.replaceChildren();
  const rows=data.departments||[];
  if(!rows.length){holder.append(blank('No active departments configured.'));return;}
  const values=rows.map(x=>asNumber(x.verifiedSlots));
  const max=Math.max(1,...values);
  const selected=$('piDepartment').value;
  for(const item of rows){
   const button=document.createElement('button');button.type='button';
   button.className='pi-dept'+(selected===item.departmentId?' pi-dept-active':'');
   button.setAttribute('aria-label',item.name+': '+fmt(item.verifiedSlots)+' verified DTR entries, '+
    fmt(item.pendingSlots)+' pending. Filter dashboard to this department.');
   const line=document.createElement('span');line.className='pi-dept-line';
   const name=document.createElement('strong');name.textContent=item.name;
   const facts=document.createElement('small');
   facts.textContent=fmt(item.staff)+' staff · '+fmt(item.verifiedSlots)+' verified · '+fmt(item.pendingSlots)+' pending';
   line.append(name,facts);
   const track=document.createElement('span');track.className='pi-dept-track';
   const fill=document.createElement('span');fill.style.width=(100*asNumber(item.verifiedSlots)/max)+'%';
   track.append(fill);button.append(line,track);
   button.addEventListener('click',()=>{const sel=$('piDepartment');sel.value=item.departmentId;void load();});
   holder.append(button);
  }
 }
 function cases(data){
  const holder=$('piCases');holder.replaceChildren();
  const cases=data.reviewCases||[];
  if(!cases.length){holder.append(blank('No pending DTR exceptions for these dates and department.'));return;}
  for(const item of cases){
   const row=document.createElement('div');row.className='pi-case';
   const left=document.createElement('span');
   const name=document.createElement('strong');name.textContent=item.staffName;
   const info=document.createElement('small');
   info.textContent=(item.department||'Unassigned department')+' · '+item.date+' · '+
    String(item.slot||'').replace('_',' ');
   left.append(name,info);
   const label=document.createElement('span');label.className='pi-review-tag';label.textContent='Review';
   row.append(left,label);holder.append(row);
  }
 }
 function render(data){
  current=data;
  $('piVerified').textContent=fmt(data.staff.verifiedSlots);
  $('piPending').textContent=fmt(data.staff.pendingSlots);
  $('piLearners').textContent=fmt(data.students.uniqueLearnersScanned);
  const l=data.approvals.leave,o=data.approvals.ob;
  $('piApprovals').textContent=fmt(l.head+l.school+l.official+o.head+o.school);
  $('piStaffEvidence').textContent=fmt(data.staff.staffWithVerifiedSlot)+
    ' of '+fmt(data.staff.active)+' active staff have a verified slot';
  $('piAsOf').textContent='School dates '+data.from+' to '+data.to+
    ' · refreshed '+new Date(data.generatedAt).toLocaleTimeString('en-PH',{hour:'numeric',
      minute:'2-digit',timeZone:'Asia/Manila'})+' PHT';
  $('piTrendPeriod').textContent=data.days===1?'Today':data.days+' days';
  attention(data);trend(data);departmentRows(data);cases(data);focus(null);
  status(data.departmentId?
    'Showing selected department staff evidence. Learner scans remain school-wide.':
    'Showing real, school-wide activity. Not a simulated dataset.');
 }
 async function load(){
  if(!active||root.hidden)return;
  const requestId=++seq;
  const params=new URLSearchParams({days:$('piDays').value});
  if($('piDepartment').value)params.set('departmentId',$('piDepartment').value);
  $('piRefresh').disabled=true;status('Loading verified school records…');
  try{
   const response=await fetch('/api/principal/insights?'+params.toString(),
    {credentials:'same-origin',cache:'no-store'});
   const result=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(result.error||'Unable to retrieve school insights.');
   if(requestId!==seq)return;
   render(result);
  }catch(error){
   if(requestId===seq){
    current=null;status(error.message+' No figures are shown until data is available.',true);
    for(const id of ['piVerified','piPending','piLearners','piApprovals'])$(id).textContent='—';
    for(const id of ['piAttention','piTrend','piDepartments','piCases']){
     const el=$(id);el.replaceChildren(blank('This section is unavailable until the school data loads.'));
    }
   }
  }finally{if(requestId===seq)$('piRefresh').disabled=false;}
 }
 async function init(user){
  if(user?.role!=='SCHOOL_ADMIN')return;
  active=true;
  const nav=$('principalInsightsNav');
  if(nav)nav.hidden=false;
  root.querySelectorAll('.pi-kpi').forEach(el=>el.addEventListener('click',()=>focus(el.dataset.piFocus)));
  $('piDays').addEventListener('change',()=>{void load();});
  $('piDepartment').addEventListener('change',()=>{void load();});
  $('piRefresh').addEventListener('click',()=>{void load();});
  $('piClearDept').addEventListener('click',()=>{$('piDepartment').value='';void load();});
  try{
   const response=await fetch('/api/departments',{credentials:'same-origin',cache:'no-store'});
   if(!response.ok)throw Error('Departments unavailable');
   const data=await response.json();
   for(const d of data.departments||[]){
    if(d.active!==true||d.code==='UNASSIGNED')continue;
    $('piDepartment').add(new Option(d.name,d.departmentId));
   }
  }catch(error){status('Department filter unavailable; school-wide view is still usable.');}
  const observer=new MutationObserver(()=>{
   if(!root.hidden&&active){void load();observer.disconnect();}
  });
  observer.observe(root,{attributes:true,attributeFilter:['hidden']});
  if(!root.hidden)void load();
 }
 window.attendigoStaffIdentity?.then(init).catch(()=>{});
})();
