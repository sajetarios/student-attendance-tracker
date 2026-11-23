'use strict';
// School Admin reviews submitted department locations; Department Head captures
// the location on site. QR verification continues to use only approved points.
(() => {
 const $=id=>document.getElementById(id);
 async function request(path,options={}){
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,
   headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(body.error||'Location request failed ('+response.status+')');
  return body;
 }
 function getPosition(){
  return new Promise((resolve,reject)=>{
   if(!window.isSecureContext)return reject(Error('Use HTTPS to capture a department location.'));
   if(!navigator.geolocation)return reject(Error('Location access is unavailable on this device.'));
   navigator.geolocation.getCurrentPosition(resolve,reject,
    {enableHighAccuracy:true,timeout:15000,maximumAge:0});
  });
 }
 function failure(error){
  if(error?.code===1)return 'Location permission denied. Allow location access in your browser settings.';
  if(error?.code===2)return 'Location unavailable. Enable device location services and retry on site.';
  if(error?.code===3)return 'GPS timed out. Try near a window or outdoors near your department.';
  return error?.message||'Location unavailable.';
 }
 async function initHead(user){
  const card=$('staffLunchHeadLocationCard'),button=$('staffLunchHeadSubmit'),
   status=$('staffLunchHeadStatus'),title=$('staffLunchHeadDepartment');
  if(!card||!status||!button)return;
  card.hidden=false;
  const departmentId=user.departmentId;
  if(!departmentId){
   status.textContent='Your account has no assigned department. Contact the School Admin.';
   button.disabled=true;return;
  }
  title.textContent=user.departmentName||'My assigned department';
  async function refresh(){
   try{
    const info=await request('/api/staff-attendance/lunch/location');
    title.textContent=info.departmentName||title.textContent;
    const current=info.configured?'Approved attendance location is active.':'No approved attendance location yet.';
    const review=info.proposalStatus==='PENDING'?' Your latest submission is pending School Admin approval.':
      info.proposalStatus==='REJECTED'?' Previous proposal was rejected; you may submit a corrected location.':
      info.proposalStatus==='APPROVED'?' Location proposal was approved.':'';
    status.textContent=current+review;
   }catch(error){status.textContent='Unable to load department location: '+error.message;}
  }
  button.addEventListener('click',async()=>{
   button.disabled=true;
   status.textContent='Checking your position. Allow location access while physically inside your department.';
   try{
    const position=await getPosition(),accuracyMeters=position.coords.accuracy;
    if(!Number.isFinite(accuracyMeters)||accuracyMeters>100)
     throw Error('Location accuracy is insufficient. Enable precise location and retry near your department.');
    const result=await request('/api/staff-attendance/lunch/location/propose',{
     method:'POST',
     body:JSON.stringify({departmentId,latitude:position.coords.latitude,
      longitude:position.coords.longitude,accuracyMeters,radiusMeters:120})
    });
    status.textContent=result.message||'Location submitted for School Admin approval. This does not change the approved location yet.';
   }catch(error){status.textContent='Location not submitted: '+failure(error);}
   finally{button.disabled=false;}
  });
  await refresh();
 }
 async function initAdmin(){
  const select=$('staffLunchLocationDepartment'),status=$('staffLunchPointStatus'),
   review=$('staffLunchLocationReview'),approve=$('staffLunchApprovePoint'),
   reject=$('staffLunchRejectPoint'),map=$('staffLunchCandidateMap');
  if(!select||!status||!approve||!reject||!review)return;
  let seq=0;
  function pendingButtons(enabled){approve.disabled=!enabled;reject.disabled=!enabled;}
  async function refresh(){
   const id=select.value,requestSeq=++seq;
   pendingButtons(false);review.hidden=true;
   if(map){map.hidden=true;map.removeAttribute('href');}
   if(!id){status.textContent='Choose a department to review its location status.';return;}
   status.textContent='Loading location proposal…';
   try{
    const result=await request('/api/staff-attendance/lunch/location?'+
     new URLSearchParams({departmentId:id}).toString());
    if(seq!==requestSeq||select.value!==id)return;
    const approved=result.configured?'Approved location active ('+result.radiusMeters+' m radius).':
     'No approved location. Teacher scans will need review until approval.';
    if(result.proposalStatus==='PENDING'&&result.candidate){
     const point=result.candidate;
     status.textContent=approved+' A Department Head has submitted a new location for your approval.';
     review.hidden=false;
     review.textContent='Submitted point: '+Number(point.latitude).toFixed(5)+', '+
      Number(point.longitude).toFixed(5)+' · Accuracy reported: '+Math.round(point.accuracyMeters)+' m.';
     if(map){
      map.href='https://www.google.com/maps?q='+encodeURIComponent(point.latitude+','+point.longitude);
      map.hidden=false;
     }
     pendingButtons(true);
    }else{
     status.textContent=approved+(
      result.proposalStatus==='APPROVED'?' Latest submission approved.':
      result.proposalStatus==='REJECTED'?' Latest proposal rejected.':
      ' Awaiting a Department Head submission.');
    }
   }catch(error){if(seq===requestSeq)status.textContent='Unable to load location: '+error.message;}
  }
  try{
   const data=await request('/api/departments');
   const departments=(data.departments||[]).filter(d=>d.active===true&&d.code!=='UNASSIGNED');
   select.replaceChildren(new Option('Choose a department',''));
   for(const d of departments)select.add(new Option(d.name||'Department',d.departmentId));
   if(departments.length===1)select.value=departments[0].departmentId;
   await refresh();
  }catch(error){status.textContent='Department list unavailable: '+error.message;return;}
  select.addEventListener('change',()=>{void refresh();});
  async function decide(decision){
   const departmentId=select.value;
   if(!departmentId)return;
   const note=window.prompt('Provide an independent review reason (at least 10 characters) for '+decision.toLowerCase()+' of '+select.selectedOptions[0].text+':');
   if(note===null)return;
   if(note.trim().length<10||note.trim().length>500){
    status.textContent='Provide an approval reason between 10 and 500 characters.';return;
   }
   pendingButtons(false);select.disabled=true;
   try{
    const result=await request('/api/staff-attendance/lunch/location/decision',{
     method:'POST',body:JSON.stringify({departmentId,decision,note:note.trim()})
    });
    status.textContent=result.message;
   }catch(error){status.textContent='Review failed: '+error.message;}
   finally{select.disabled=false;await refresh();}
  }
  approve.addEventListener('click',()=>{void decide('APPROVE');});
  reject.addEventListener('click',()=>{void decide('REJECT');});
 }
 window.attendigoStaffIdentity?.then(user=>{
  if(user?.role==='DEPARTMENT_HEAD')return initHead(user);
  if(user?.role==='SCHOOL_ADMIN')return initAdmin();
 }).catch(()=>{});
})();
