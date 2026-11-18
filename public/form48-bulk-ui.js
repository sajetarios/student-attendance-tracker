'use strict';
// School Admin-only bulk controls for Form 48. No test employee records are created here.
(() => {
 const $=id=>document.getElementById(id);
 const api=async(url,options={})=>{
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});
  const json=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(json.error||'Unable to complete this action.');
  return json;
 };
 const init=user=>{
  if(user?.role!=='SCHOOL_ADMIN'||!$('form48BatchPanel'))return;
  const roster=$('form48Employee'),search=$('form48EmployeeSearch');
  const panel=$('form48BatchPanel'),host=$('form48BatchStaff');
  const filter=$('form48BatchSearch'),badge=$('form48BatchCount');
  const feedback=$('form48BatchStatus'),toggle=$('form48BatchToggle');
  const saveDefaults=$('form48SaveSchoolDefaults');
  const selected=new Set();
  let staff=[],defaults=null,busy=false;
  const say=(message,error=false)=>{feedback.textContent=message;feedback.classList.toggle('is-error',error);};
  const visible=()=>staff.filter(s=>String(s.displayName+' '+s.role).toLowerCase().includes(filter.value.trim().toLowerCase()));
  const draw=()=>{
   const rows=visible();
   host.replaceChildren();
   const chunk=document.createDocumentFragment();
   for(const employee of rows){
    const label=document.createElement('label'),check=document.createElement('input'),name=document.createElement('span');
    check.type='checkbox';check.value=employee.userId;check.checked=selected.has(employee.userId);
    check.addEventListener('change',()=>{
     if(check.checked)selected.add(employee.userId);else selected.delete(employee.userId);
     badge.textContent=selected.size+' selected';
    });
    name.textContent=employee.displayName+' · '+employee.role.replaceAll('_',' ');
    label.append(check,name);chunk.append(label);
   }
   host.append(chunk);badge.textContent=selected.size+' selected';
  };
  function filterEmployeeOptions(){
   const q=search.value.trim().toLowerCase(),old=roster.value;
   roster.replaceChildren(new Option('Select a staff member',''));
   const matches=staff.filter(s=>String(s.displayName+' '+s.role).toLowerCase().includes(q));
   const chosen=staff.find(s=>s.userId===old);
   if(chosen&&!matches.some(s=>s.userId===chosen.userId))matches.unshift(chosen);
   for(const s of matches)roster.add(new Option(s.displayName+' · '+s.role.replaceAll('_',' '),s.userId));
   roster.value=old||'';
  }
  function onStaff(rows){
   staff=rows.filter(s=>s.userId&&s.displayName);
   filterEmployeeOptions();draw();
  }
  document.addEventListener('attendigo:form48-staff-loaded',e=>onStaff(e.detail.staff||[]));
  if(Array.isArray(window.attendigoForm48Staff))onStaff(window.attendigoForm48Staff);
  search.addEventListener('input',filterEmployeeOptions);
  filter.addEventListener('input',draw);
  toggle.addEventListener('click',()=>{
   panel.hidden=!panel.hidden;
   toggle.setAttribute('aria-expanded',String(!panel.hidden));
   if(!panel.hidden)filter.focus();
  });
  $('form48BatchSelectVisible').addEventListener('click',()=>{
   const rows=visible();
   if(rows.length+selected.size>50){say('Filter the directory to select up to 50 employees per leave batch.',true);return;}
   for(const s of rows)selected.add(s.userId);
   draw();
  });
  $('form48BatchClear').addEventListener('click',()=>{selected.clear();draw();});
  async function fetchDefaults(){
   try{
    const result=await api('/api/staff-attendance/admin/form48/defaults');
    defaults=result.defaults;saveDefaults.disabled=false;
   }catch(err){say('School defaults unavailable: '+err.message,true);}
  }
  fetchDefaults();
  const hoursFor=group=>Object.fromEntries([...document.querySelectorAll('[data-form48-hour="'+group+'"]')]
   .map(input=>[input.dataset.slot,input.value]));
  saveDefaults.addEventListener('click',async()=>{
   if(busy||!defaults)return;
   const settings=$('form48ReportSettings');
   if(!roster.value||settings?.hidden){say('Select an employee and load work hours before setting school defaults.',true);return;}
   const details={
    revision:defaults.revision,workdays:[...settings.querySelectorAll('[data-form48-day]:checked')].map(x=>Number(x.value)),
    regularHours:hoursFor('regular'),saturdayHours:hoursFor('saturday'),
    verifiedBy:$('form48VerifiedBy').value.trim(),verifiedPosition:$('form48VerifiedPosition').value.trim(),
    approvedBy:$('form48ApprovedBy').value.trim(),approvedPosition:$('form48ApprovedPosition').value.trim()
   };
   if(!window.confirm('Apply these printed signatories and prescribed work hours as SCHOOL DEFAULTS for future staff DTR previews? Employee-specific overrides remain unchanged.'))return;
   busy=true;saveDefaults.disabled=true;
   try{
    const result=await api('/api/staff-attendance/admin/form48/defaults',{
     method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(details)
    });
    defaults={...details,revision:result.revision};
    say('School defaults saved. They will prefill other employees who have no individual settings.');
   }catch(err){say(err.message,true);await fetchDefaults();}
   finally{busy=false;saveDefaults.disabled=false;}
  });
  $('form48BatchRecordLeave').addEventListener('click',async()=>{
   if(busy)return;
   const ids=[...selected];
   const type=$('form48LeaveType').value,start=$('form48LeaveStart').value,
    end=$('form48LeaveEnd').value,ref=$('form48LeaveReference').value.trim();
   if(ids.length<1||ids.length>50){say('Choose between 1 and 50 employees.',true);return;}
   if(!start||!end||start>end||ref.length<3){say('Enter valid approved start/end dates and a documented approval reference.',true);return;}
   if(!$('form48LeaveCertified').checked){say('Confirm these dates are already approved and documented.',true);return;}
   const entries=ids.map(staffUserId=>({staffUserId,leaveType:type,startDate:start,endDate:end,approvalReference:ref}));
   if(!window.confirm('Record '+ids.length+' already-approved '+type.toLowerCase()+' leave period(s)? This is an audited record update, not a new approval.'))return;
   busy=true;$('form48BatchRecordLeave').disabled=true;
   try{
    const result=await api('/api/staff-attendance/admin/form48/leaves/batch',{
     method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entries})
    });
    say(result.recorded+' approved leave period(s) recorded. The date ranges automatically cover overlapping report months.');
    $('form48LeaveCertified').checked=false;
    $('form48Print').disabled=true;
    $('form48PrintArea').hidden=true;
   }catch(err){say(err.message,true);}
   finally{busy=false;$('form48BatchRecordLeave').disabled=false;}
  });
  $('form48BatchPrint').addEventListener('click',async()=>{
   if(busy)return;
   const ids=[...selected],month=$('form48Month').value;
   if(!month||ids.length<1||ids.length>25){say('Select a report month and 1 to 25 employees for each batch preview.',true);return;}
   const renderer=window.attendigoForm48RenderCopy;
   if(typeof renderer!=='function'){say('Report renderer not available; reload this page.',true);return;}
   busy=true;$('form48BatchPrint').disabled=true;
   const pages=[],problems=[];
   try{
    for(const [index,id] of ids.entries()){
     say('Generating '+(index+1)+' of '+ids.length+' reports…');
     const query=new URLSearchParams({staffUserId:id,month});
     const [data,analysis]=await Promise.all([
      api('/api/staff-attendance/admin/form48?'+query),
      api('/api/staff-attendance/admin/form48/analysis?'+query)
     ]);
     if(analysis.summary?.hasUnreviewed||!analysis.summary?.configured||
        analysis.summary?.tardyMinutes===null)problems.push(data.displayName);
     pages.push('<div class="form48-batch-sheet"><div class="form48-sheets">'+
      renderer(data,analysis,"Office's")+renderer(data,analysis,"Employee's")+'</div></div>');
    }
    const area=$('form48PrintArea');
    area.innerHTML=pages.join('')+'<p class="form48-preview-note">Batch prepared from verified DTR punches. Draft reports require verification and authorized signatures.</p>';
    area.hidden=false;$('form48Print').disabled=false;
    say('Prepared '+pages.length+' employee DTRs (office + employee copies). '+
     problems.length+' need schedule or attendance review. Use Print / Save PDF after checking the preview.');
   }catch(err){say('Batch preview not completed: '+err.message,true);}
   finally{busy=false;$('form48BatchPrint').disabled=false;}
  });
 };
 window.attendigoStaffIdentity?.then(init).catch(()=>{});
})();
