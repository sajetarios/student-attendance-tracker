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
  const saveSignatories=$('form48SaveSignatories'),schoolSigners=$('form48SchoolSignatories');
  const signatoryStatus=$('form48SchoolSignatoriesStatus');
  const signatoryKeys=['verifiedBy','verifiedPosition','approvedBy','approvedPosition'];
  const signatoryFields={
   verifiedBy:$('form48VerifiedBy'),verifiedPosition:$('form48VerifiedPosition'),
   approvedBy:$('form48ApprovedBy'),approvedPosition:$('form48ApprovedPosition')
  };
  const saySignatories=(message,error=false)=>{
   if(signatoryStatus){
    signatoryStatus.textContent=message;
    signatoryStatus.classList.toggle('is-error',error);
   }
  };
  const selected=new Set();
  let staff=[],defaults=null,busy=false;
  const say=(message,error=false)=>{feedback.textContent=message;feedback.classList.toggle('is-error',error);};
  async function refreshLeaves(){
   const month=$('form48Month').value,records=$('form48LeaveRecords');
   if(!/^\d{4}-\d{2}$/.test(month))return;
   records.textContent='Loading approved leave records…';
   try{
    const {leaves}=await api('/api/staff-attendance/admin/form48/leaves?'+new URLSearchParams({month}));
    records.replaceChildren();
    if(!leaves?.length){records.textContent='No approved leave records found for this month.';return;}
    for(const leave of leaves){
     const row=document.createElement('div'),text=document.createElement('span'),button=document.createElement('button');
     row.className='form48-leave-record';
     text.textContent=leave.displayName+' · '+leave.leaveType.replaceAll('_',' ')+
      ' · '+leave.startDate+' to '+leave.endDate+' · Ref: '+leave.approvalReference;
     button.className='outline-button';button.type='button';button.textContent='Correct / revoke';
     button.addEventListener('click',async()=>{
      if(busy)return;
      const reason=window.prompt('Reason for correcting this approved leave record (required):');
      if(reason===null)return;
      if(reason.trim().length<5){say('Enter a correction reason of at least five characters.',true);return;}
      if(!window.confirm('Revoke this recorded leave range? Verified DTR punches will remain unchanged.'))return;
      busy=true;button.disabled=true;
      try{
       await api('/api/staff-attendance/admin/form48/leaves/'+encodeURIComponent(leave.leaveId)+'/revoke',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:reason.trim()})
       });
       say('Leave record revoked with audit trail. Generate a new DTR preview to see the correction.');
       $('form48Print').disabled=true;$('form48PrintArea').hidden=true;
       await refreshLeaves();
      }catch(err){say(err.message,true);}
      finally{busy=false;button.disabled=false;}
     });
     row.append(text,button);records.append(row);
    }
   }catch(err){records.textContent='Unable to load approved leave records: '+err.message;}
  }
  $('form48RefreshLeaves').addEventListener('click',refreshLeaves);
  $('form48Month').addEventListener('change',()=>{if(!panel.hidden)refreshLeaves();});
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
   if(!panel.hidden){filter.focus();refreshLeaves();}
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
    for(const key of signatoryKeys)signatoryFields[key].value=defaults[key]||'';
    if(saveSignatories)saveSignatories.disabled=false;
    saySignatories(defaults.revision>0?'These settings apply to all staff DTRs.':
     'Enter and save both signatories once for the school.');
   }catch(err){
    if(saveSignatories)saveSignatories.disabled=true;
    saySignatories('Unable to load school signatories: '+err.message,true);
    say('School defaults unavailable: '+err.message,true);
   }
  }
  fetchDefaults();
  schoolSigners?.addEventListener('input',event=>{
   if(Object.values(signatoryFields).includes(event.target))
    saySignatories('Unsaved changes. Save to apply to all staff and months.');
  });
  saveSignatories?.addEventListener('click',async()=>{
   if(busy||!defaults)return;
   const payload={revision:defaults.revision};
   for(const key of signatoryKeys)payload[key]=signatoryFields[key].value.trim();
   if(signatoryKeys.some(key=>!payload[key]||payload[key].length>120)){
    saySignatories('Provide the names and positions of both signatories.',true);return;
   }
   busy=true;saveSignatories.disabled=true;
   try{
    const result=await api('/api/staff-attendance/admin/form48/signatories',{
     method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
    });
    defaults={...defaults,...payload,revision:result.revision};
    saySignatories('Saved for all employees. Generate a new DTR preview to see updated names.');
    document.dispatchEvent(new CustomEvent('attendigo:form48-signatories-saved'));
   }catch(err){
    saySignatories('Nothing saved: '+err.message+'. Reload the page if school settings changed elsewhere.',true);
   }finally{busy=false;saveSignatories.disabled=false;}
  });
  const hoursFor=group=>Object.fromEntries([...document.querySelectorAll('[data-form48-hour="'+group+'"]')]
   .map(input=>[input.dataset.slot,input.value]));
  saveDefaults.addEventListener('click',async()=>{
   if(busy||!defaults)return;
   const settings=$('form48ReportSettings');
   if(!roster.value||settings?.hidden){say('Select an employee and load work hours before setting school defaults.',true);return;}
   const details={
    revision:defaults.revision,workdays:[...settings.querySelectorAll('[data-form48-day]:checked')].map(x=>Number(x.value)),
    regularHours:hoursFor('regular'),saturdayHours:hoursFor('saturday'),
    verifiedBy:defaults.verifiedBy||'',verifiedPosition:defaults.verifiedPosition||'',
    approvedBy:defaults.approvedBy||'',approvedPosition:defaults.approvedPosition||''
   };
   if(!window.confirm('Apply these prescribed work hours as SCHOOL DEFAULTS? Employee work schedules and school-wide signatories remain unchanged.'))return;
   busy=true;saveDefaults.disabled=true;
   try{
    const result=await api('/api/staff-attendance/admin/form48/defaults',{
     method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(details)
    });
    defaults={...details,revision:result.revision};
    say('School working hours saved as defaults. Employee-specific schedules remain unchanged.');
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
    await refreshLeaves();
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
