'use strict';
(() => {
 const $=id=>document.getElementById(id);
 let currentRole=null,selectedSdoRequest=null;
  function errorText(error){
  return error?.message||'Data could not be loaded.';
 }
 function make(tag,cls,textContent){
  const el=document.createElement(tag);
  if(cls)el.className=cls;
  if(textContent!==undefined)el.textContent=String(textContent);
  return el;
 }

  function sdoPhase(x){
  if(x.status==='APPROVED')return 'Approved · external decision verified';
  if(x.status==='REJECTED')return 'Disapproved · decision recorded';
  if(x.status==='CANCELLED')return 'Cancelled';
  if(x.sdoSubmittedAt)return 'Submitted to SDO · awaiting official decision';
  return 'Filed · awaiting school handoff to SDO';
 }

 async function loadSdoRequests(){
  if(currentRole!=='SCHOOL_ADMIN')return;
  const admin=$('principalSdoAdminList');
  try{
   const response=await fetch('/api/principal/sdo-requests',{credentials:'same-origin',cache:'no-store'});
   if(response.status===401){window.location.replace('/portal-login.html');return;}
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||'Unable to load SDO applications.');
   admin.replaceChildren();
   const requests=Array.isArray(data.requests)?data.requests:[];
   if(currentRole==='SCHOOL_ADMIN'){
    $('principalSdoAdminPanel').hidden=false;
    for(const r of requests){
     const card=make('div','principal-record-item');
     card.append(make('strong',null,(r.principalName||'Principal')+' · '+r.kind+' · '+(r.title||'')),
      make('small',null,sdoPhase(r)));
     if(!['APPROVED','REJECTED','CANCELLED'].includes(r.status)){
      const choose=make('button','quiet-button',r.sdoSubmittedAt?'Record signed decision':'Record SDO handoff');
      choose.type='button';
      choose.addEventListener('click',()=>{
       selectedSdoRequest=r;
       $('principalSdoAdminForms').hidden=false;
       $('principalSdoSelected').textContent=(r.principalName||'Principal')+' · '+r.kind+
          ' · '+(r.title||'')+' · '+sdoPhase(r);
       $('principalSdoHandoffForm').hidden=Boolean(r.sdoSubmittedAt);
       $('principalSdoDecisionForm').hidden=!r.sdoSubmittedAt;
       $('principalCertifiedDaysLabel').hidden=r.kind!=='LEAVE';
       $('principalSdoAdminForms').scrollIntoView({behavior:'smooth',block:'nearest'});
      });
      card.append(choose);
     }
     admin.append(card);
    }
    if(!requests.length)admin.append(make('p','source-note','No principal applications need coordination.'));
   }

  }catch(error){admin.textContent='SDO coordination unavailable: '+errorText(error);}
 }
  async function saveSdoHandoff(){
  if(!selectedSdoRequest||currentRole!=='SCHOOL_ADMIN')return;
  const form=$('principalSdoHandoffForm'),data=new FormData(form),status=$('principalSdoAdminStatus');
  if(!form.reportValidity())return;
  const button=form.querySelector('[type="submit"]');button.disabled=true;status.textContent='Recording SDO receiving details…';
  try{
   const {kind,requestId}=selectedSdoRequest;
   const r=await fetch('/api/principal/sdo-requests/'+kind.toLowerCase()+'/'+encodeURIComponent(requestId)+'/handoff',{
    method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({channel:data.get('channel'),receivingOffice:data.get('receivingOffice'),
      reference:data.get('reference')})});
   const result=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(result.error||'Handoff could not be saved.');
   status.textContent='SDO handoff recorded. Signed decision is still required.';
   form.reset();$('principalSdoAdminForms').hidden=true;selectedSdoRequest=null;void loadSdoRequests();
  }catch(error){status.textContent=errorText(error);}
  finally{button.disabled=false;}
 }
 async function saveSdoDecision(){
  if(!selectedSdoRequest||currentRole!=='SCHOOL_ADMIN')return;
  const form=$('principalSdoDecisionForm'),data=new FormData(form),status=$('principalSdoAdminStatus');
  if(!form.reportValidity())return;
  const file=data.get('signedDocument'),button=form.querySelector('[type="submit"]');
  if(!(file instanceof File)||!file.size||file.size>4194304||
    !['application/pdf','image/png','image/jpeg'].includes(file.type)){
   status.textContent='Choose a signed PDF/JPG/PNG document up to 4 MB.';return;
  }
  const req=selectedSdoRequest,decision=String(data.get('decision'));
  if(req.kind==='LEAVE'&&decision==='APPROVED'&&!(Number(data.get('certifiedWorkingDays'))>0)){
   status.textContent='Enter verified working days for an approved leave.';return;
  }
  button.disabled=true;status.textContent='Uploading signed external decision…';
  try{
   let response,result;
   if(req.kind==='LEAVE'){
    response=await fetch('/api/staff-leave/requests/'+encodeURIComponent(req.requestId)+'/documents',{
     method:'POST',credentials:'same-origin',
     headers:{'Content-Type':file.type,'x-document-kind':'APPROVAL','x-filename':file.name},body:file});
    result=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(result.error||'Signed leave document could not be stored.');
    response=await fetch('/api/staff-leave/requests/'+encodeURIComponent(req.requestId)+'/external-decision',{
     method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({decision:decision==='APPROVED'?'APPROVE':'REJECT',
      approvalReference:data.get('approvalReference'),approverName:data.get('approverName'),
      approverPosition:data.get('approverPosition'),approvedOn:data.get('approvedOn'),
      certifiedWorkingDays:data.get('certifiedWorkingDays'),note:data.get('note')})});
   }else{
    response=await fetch('/api/principal/sdo-requests/ob/'+encodeURIComponent(req.requestId)+'/decision',{
     method:'POST',credentials:'same-origin',headers:{'Content-Type':file.type,'x-filename':encodeURIComponent(file.name),
      'x-sdo-decision':decision,'x-sdo-reference':String(data.get('approvalReference')),
      'x-sdo-approver':String(data.get('approverName')),'x-sdo-position':String(data.get('approverPosition')),
      'x-sdo-date':String(data.get('approvedOn'))},body:file});
   }
   result=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(result.error||'External decision verification failed.');
   status.textContent='Signed SDO decision recorded. School Admin acted only as recorder.';
   form.reset();$('principalSdoAdminForms').hidden=true;selectedSdoRequest=null;
   void loadSdoRequests();
  }catch(error){status.textContent='Decision not recorded: '+errorText(error);}
  finally{button.disabled=false;}
 }


 async function init(){
  const r=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});
  if(r.status===401){window.location.replace('/portal-login.html');return;}
  if(!r.ok)throw Error('Unable to verify the current session.');
  const {user}=await r.json();
  if(user?.mustChangePassword){window.location.replace('/force-password-change.html');return;}
  if(user?.role!=='SCHOOL_ADMIN'){ $('sessionStatus').textContent='School Admin access required.';return; }
  currentRole=user.role;
  $('sessionStatus').textContent='Authorized School Admin · SDO coordination only';
  $('principalSdoHandoffForm').addEventListener('submit',e=>{e.preventDefault();void saveSdoHandoff();});
  $('principalSdoDecisionForm').addEventListener('submit',e=>{e.preventDefault();void saveSdoDecision();});
  await loadSdoRequests();
 }
 void init().catch(error=>{$('sessionStatus').textContent=errorText(error);});
})();
