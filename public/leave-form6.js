'use strict';
(async()=>{
 const $=id=>document.getElementById(id);
 const put=(id,value)=>{const el=$(id);if(el)el.textContent=String(value??'');};
 const params=new URLSearchParams(location.search),id=params.get('requestId')||'';
 const token=sessionStorage.getItem('schoolAttendance.accessToken')||
  (()=>{try{return window.opener?.sessionStorage?.getItem('schoolAttendance.accessToken')||'';}catch{return '';}})();
 const showError=s=>{put('status',s);};
 if(!/^[a-f0-9-]{36}$/i.test(id)||!token){showError('An authenticated school session is required. Open this preview from Leave Management.');return;}
 try{
  const response=await fetch('/api/staff-leave/requests/'+encodeURIComponent(id)+'/form6',{
   headers:{Authorization:'Bearer '+token},cache:'no-store'});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'The authorized application could not be loaded.');
  const r=data.request||{},date=s=>String(s||'').slice(0,10);
  put('school',r.schoolName||'');
  put('office',[r.schoolName,r.departmentName].filter(Boolean).join(' — '));
  put('name',r.staffName||'');
  put('position',r.staffPosition||'');
  put('filed',date(r.submittedAt));
  put('salary','_________________');
  put('workingDays',r.certifiedWorkingDays!=null?r.certifiedWorkingDays+' day(s) — verified':'Pending HR computation');
  put('dates',date(r.startDate)+' to '+date(r.endDate));
  const types=[
   ['VACATION','Vacation leave'],['MANDATORY','Mandatory/Forced leave'],['SICK','Sick leave'],
   ['MATERNITY','Maternity leave'],['PATERNITY','Paternity leave'],
   ['SPECIAL_PRIVILEGE','Special privilege leave'],['SOLO_PARENT','Solo parent leave'],
   ['STUDY','Study leave'],['VAWC','10-Day VAWC leave'],['REHABILITATION','Rehabilitation privilege'],
   ['SPECIAL_WOMEN','Special leave benefits for women'],['EMERGENCY','Special Emergency (Calamity) leave'],
   ['ADOPTION','Adoption leave'],['OTHER','Others (specify)']
  ];
  const selected=['VSC','WELLNESS'].includes(r.leaveType)?'OTHER':r.leaveType;
  $('types').replaceChildren();
  types.forEach(([key,name])=>{
   const line=document.createElement('span');line.className='checkline';
   line.textContent=(selected===key?'☑':'☐')+' '+name;
   $('types').append(line);
  });
  if(['VSC','WELLNESS'].includes(r.leaveType)){const more=document.createElement('p');more.textContent='Others: '+(r.leaveType==='VSC'?'Vacation Service Credit availment':'Wellness Leave');$('types').append(more);}
  put('details',(r.reason||'')+(r.details?' — '+r.details:''));
  put('commutation',(r.commutation==='REQUESTED'?'☑ Requested / ☐ Not Requested':'☐ Requested / ☑ Not Requested'));
  if(r.status==='APPROVED')put('officialName',(r.externalApprover||'')+' · '+(r.externalApproverPosition||'')+' (printed reference only; signature required)');
  else put('officialName','Authorization pending. Not approved.');
  put('status','Prefill loaded. Check all unverified fields before filing.');
  $('print').addEventListener('click',()=>window.print());
 }catch(e){showError(e.message);}
})();