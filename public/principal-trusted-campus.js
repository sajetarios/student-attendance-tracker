'use strict';
(()=>{
 const panel=document.getElementById('trustedCampusSettings'),form=document.getElementById('trustedCampusForm'),status=document.getElementById('trustedCampusStatus'),list=document.getElementById('trustedCampusList');
 if(!panel||!form||!status||!list)return;
 const base='/api/staff-attendance/lunch';
 async function request(path='/campuses',body){const r=await fetch(base+path,{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'Request failed.');return data;}
 async function refresh(){const data=await request();list.replaceChildren();for(const campus of data.campuses||[]){const row=document.createElement('p');row.textContent=campus.name+' · '+campus.radiusMeters+' m · '+(campus.active?'Active':'Retired');if(campus.active){const button=document.createElement('button');button.type='button';button.className='quiet-button';button.textContent='Retire campus';button.addEventListener('click',async()=>{if(!window.AppDialog?.prompt){status.textContent='Confirmation dialog unavailable. Refresh first.';return;}const reason=await window.AppDialog.prompt('Retirement stops Lunch QR at linked departments. Gatekeeper remains available.','',{title:'Retire trusted campus',inputType:'textarea',required:true,maxLength:500,confirmText:'Retire campus',variant:'danger',validate:v=>v.trim().length>=10||'Enter at least 10 characters.'});if(!reason||reason.trim().length<10)return;button.disabled=true;try{await request('/campuses/retire',{campusId:campus.campusId,reason});status.textContent='Campus retired. Linked departments must use Gatekeeper until authorized relocation.';await refresh();}catch(e){status.textContent=e.message;button.disabled=false;}});row.append(' ',button);}list.append(row);}}
 const relocation=document.getElementById('trustedCampusRelocation');
 async function refreshRelocation(){
  if(!relocation)return;
  const [c,d]=await Promise.all([request(),request('/relocation-departments')]);
  relocation.elements.departmentId.replaceChildren(new Option('Choose department',''));
  for(const dept of d.departments||[]){const opt=new Option(dept.departmentName+(dept.pendingCampusId?' (relocation pending)':''),dept.departmentId);opt.disabled=!!dept.pendingCampusId;relocation.elements.departmentId.add(opt);}
  relocation.elements.campusId.replaceChildren(new Option('Choose destination',''));
  for(const campus of c.campuses||[])if(campus.active)relocation.elements.campusId.add(new Option(campus.name,campus.campusId));
 }
 panel.addEventListener('toggle',()=>{if(panel.open)Promise.all([refresh(),refreshRelocation()]).catch(e=>status.textContent=e.message);});
 relocation?.addEventListener('submit',async event=>{
  event.preventDefault();const d=new FormData(relocation),button=relocation.querySelector('button[type=submit]');
  if(!window.AppDialog?.confirm){status.textContent='Confirmation dialog unavailable. Refresh first.';return;}
  if(!await window.AppDialog.confirm('The current department geofence and QR codes will stop working until the Head captures fresh GPS in the destination campus.',{title:'Authorize exceptional relocation',confirmText:'Authorize relocation',variant:'danger'}))return;
  button.disabled=true;try{const r=await request('/location/relocate',{departmentId:d.get('departmentId'),campusId:d.get('campusId'),reason:d.get('reason'),attested:d.get('attested')==='on'});if(r.status!=='RELOCATION_PENDING')throw Error('Relocation authorization not confirmed.');relocation.reset();status.textContent='Relocation authorized. Gatekeeper remains available until the Head activates the new location.';await refreshRelocation();}catch(e){status.textContent=e.message;}finally{button.disabled=false;}
 });
 form.addEventListener('submit',async event=>{event.preventDefault();const d=new FormData(form),button=form.querySelector('button[type=submit]');button.disabled=true;try{await request('/campuses',{name:d.get('name'),latitude:Number(d.get('latitude')),longitude:Number(d.get('longitude')),radiusMeters:Number(d.get('radiusMeters')),evidenceReference:d.get('evidenceReference'),attested:d.get('attested')==='on'});form.reset();status.textContent='Trusted campus registered. Heads can configure locations within it.';await Promise.all([refresh(),refreshRelocation()]);}catch(e){status.textContent=e.message;}finally{button.disabled=false;}});
})();

(()=>{
 const panel=document.getElementById('principalLunchReview'),list=document.getElementById('principalLunchList'),status=document.getElementById('principalLunchStatus'),refreshButton=document.getElementById('principalLunchRefresh');
 if(!panel||!list||!status||!refreshButton)return;
 const base='/api/staff-attendance/lunch';
 async function request(path,body){const r=await fetch(base+path,{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'Request failed.');return data;}
 let busy=false;
 async function refresh(){
  if(busy)return;refreshButton.disabled=true;status.textContent='Loading pending Department Head scans…';
  try{const d=await request('/pending');list.replaceChildren();status.textContent=d.items?.length?'Review requires independent evidence.':'No pending Department Head lunch scans in the displayed period.';
   for(const item of d.items||[]){const row=document.createElement('div');row.className='surface';const label=document.createElement('p');label.textContent=item.teacherName+' · '+item.schoolDate+' · '+item.slot;row.append(label);
    for(const decision of ['VERIFY','REJECT']){const b=document.createElement('button');b.type='button';b.className='quiet-button';b.textContent=decision==='VERIFY'?'Verify scan':'Reject scan';b.addEventListener('click',async()=>{
      if(busy||!window.AppDialog?.prompt)return;busy=true;refreshButton.disabled=true;
      try{const note=await window.AppDialog.prompt('Record independent evidence and the reason for your decision. Never verify without evidence.','',{title:'Review Department Head lunch scan',inputType:'textarea',required:true,maxLength:500,confirmText:decision==='VERIFY'?'Verify':'Reject',validate:v=>v.trim().length>=10||'Enter at least 10 characters.'});
       if(note===null)return;const result=await request('/review',{eventId:item.eventId,decision,note:note.trim()});if(result.status!==(decision==='VERIFY'?'VERIFIED':'REJECTED'))throw Error('Review not confirmed.');
       busy=false;await refresh();
      }catch(e){status.textContent=e.message;}finally{busy=false;refreshButton.disabled=false;}
    });row.append(b);}list.append(row);}
  }catch(e){status.textContent=e.message;}finally{refreshButton.disabled=false;}
 }
 panel.addEventListener('toggle',()=>{if(panel.open)void refresh();});refreshButton.addEventListener('click',()=>{void refresh();});
})();
