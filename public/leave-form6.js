'use strict';
(async()=>{
 const $=id=>document.getElementById(id);
 const put=(id,value)=>{const el=$(id);if(el)el.textContent=String(value??'');};
 const params=new URLSearchParams(location.search),id=params.get('requestId')||'';
 const token=sessionStorage.getItem('schoolAttendance.accessToken')||
  (()=>{try{return window.opener?.sessionStorage?.getItem('schoolAttendance.accessToken')||'';}catch{return '';}})();
 const showError=s=>{put('status',s);};
 // The blank worksheet contains no personal data. It is available before
 // filing so employees can inspect the actual Form 6 layout safely.
 if(params.get('template')==='1'){
  const kinds=['Vacation leave','Mandatory/Forced leave','Sick leave','Maternity leave',
   'Paternity leave','Special privilege leave','Solo parent leave','Study leave',
   '10-Day VAWC leave','Rehabilitation privilege','Special leave benefits for women',
   'Special Emergency (Calamity) leave','Adoption leave','Others (specify)'];
  const list=$('types');
  if(list)kinds.forEach(kind=>{
   const line=document.createElement('span');line.className='checkline';
   line.textContent='☐ '+kind;list.append(line);
  });
  put('salary','_________________');
  put('workingDays','To be certified by HR');
  put('dates','_________________');
  put('commutation','☐ Requested / ☐ Not Requested');
  put('officialName','Authorized approving official and signature required');
  put('status','Blank CSC Form No. 6 worksheet — no application submitted. Complete and verify through your school HR office.');
  $('print')?.addEventListener('click',()=>window.print());
  return;
 }
 if(!/^[a-f0-9-]{36}$/i.test(id)){showError('Open a saved application from Leave Management.');return;}
 try{
  const response=await fetch('/api/staff-leave/requests/'+encodeURIComponent(id)+'/form6',{
   credentials:'same-origin',headers:token?{Authorization:'Bearer '+token}:{},cache:'no-store'});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'The authorized application could not be loaded.');
  const r=data.request||{},date=s=>String(s||'').slice(0,10);
  put('school',r.schoolName||'');
  put('office',[r.schoolName,r.departmentName].filter(Boolean).join(' — '));
  put('name',r.staffName||'');
  put('position',r.staffPosition||'');
  const filed=new Date(r.submittedAt);
  put('filed',r.submittedAt&&Number.isFinite(filed.getTime())
   ?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(filed):'');
  put('filingNote',r.leaveType==='SICK'
   ?r.filingBasis==='POST_RETURN'
     ?'Filed after listed sick-leave dates. Under CSC Sec. 53, HR must verify immediate filing upon actual return and notice to the supervisor.'
     :r.filingBasis==='ADVANCE'
       ?'Sick leave filed in advance; medical evidence and approval required.'
       :'Sick leave filed during the listed absence.'
   :'');
  put('salary','_________________');
  put('workingDays',r.certifiedWorkingDays!=null?r.certifiedWorkingDays+' day(s) — HR verified':data.estimatedSchoolWorkingDays+' day(s) — calendar estimate; HR verification required');
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
  if(r.status==='DECLINED_HEAD'){
   put('recommendApprove','☐ For approval');
   put('recommendDisapprove','☑ For disapproval due to:');
   put('recommendationNote',r.headNote||'See Department Head recommendation.');
  }
  if(r.status==='APPROVED')put('officialName',(r.externalApprover||'')+' · '+(r.externalApproverPosition||'')+' (printed reference only; signature required)');
  else if(r.status==='DECLINED_HEAD')put('officialName','Not endorsed by Department Head; no official approval/disapproval recorded.');
  else if(r.status==='REJECTED')put('disapproval','Disapproved'+(r.externalReference?' · '+r.externalReference:'')+'.');
  else if(r.status==='CANCELLED')put('officialName','Application cancelled.');
  else put('officialName','Authorization pending. Not approved.');
  put('status','Prefill loaded. Check all unverified fields before filing.');
  $('print').addEventListener('click',()=>window.print());
 }catch(e){showError(e.message);}
})();