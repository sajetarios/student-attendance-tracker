'use strict';
(() => {
 const $=id=>document.getElementById(id);
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
 const token=()=>sessionStorage.getItem('schoolAttendance.accessToken')||'';
 const api='/api/staff-leave';
 async function call(path,method='GET',body){
  const r=await fetch(api+path,{method,cache:'no-store',
   headers:{'Authorization':'Bearer '+token(),...(body?{'Content-Type':'application/json'}:{})},
   body:body?JSON.stringify(body):undefined});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(j.error||'The request could not be completed ('+r.status+').');
  return j;
 }
 async function upload(path,file,kind){
  if(!file)return;
  if(!['application/pdf','image/png','image/jpeg'].includes(file.type)||file.size>4194304)
   throw Error('Only PDF, JPG or PNG files up to 4 MB are allowed.');
  const r=await fetch(api+path,{method:'POST',cache:'no-store',
   headers:{Authorization:'Bearer '+token(),'Content-Type':file.type,'X-Document-Kind':kind,
    'X-Filename':file.name.replace(/[^\x20-\x7E]/g,'_').slice(0,120)},body:file});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(j.error||'Document upload failed.');
  return j;
 }
 const textInput=(name,label,required=true,type='text')=>
  '<label>'+esc(label)+'<input name="'+esc(name)+'" type="'+esc(type)+'" '+(type==='number'?'step="0.001" min="0.001" ':'')+(required?'required':'')+'></label>';
 const fileInput=(name,label)=>'<label>'+esc(label)+'<input name="'+esc(name)+'" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"></label>';
 const select=(name,label,values)=>
  '<label>'+esc(label)+'<select name="'+name+'">'+values.map(([val,txt])=>'<option value="'+esc(val)+'">'+esc(txt)+'</option>').join('')+'</select></label>';
 const docTypes=[['VACATION','Vacation leave'],['SICK','Sick leave'],['VSC','Vacation service credit availment'],['MATERNITY','Maternity leave'],
  ['PATERNITY','Paternity leave'],['SPECIAL_PRIVILEGE','Special privilege leave'],['WELLNESS','Wellness leave'],['OTHER','Other leave']];
 const accounts=[['NONE','No credit deduction / HR determines'],['VSC','Vacation Service Credits (teacher)'],['VL','Vacation Leave'],['SL','Sick Leave']];
 function init(user){
  if(!['TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN'].includes(user?.role))return;
  const button=document.createElement('button');button.id='staffLeaveNav';button.type='button';
  button.className='nav-item';button.title='Leave requests, CSC Form 6 and service credits';
  button.innerHTML='<span class="nav-icon" aria-hidden="true">▣</span><span class="nav-label">Leave Requests</span>';
  // A personal leave request is distinct from an authorized review queue.
  // This only moves the existing UI; staff-leave routes still enforce every
  // approval decision and school/department boundary on the server.
  const targetKey=user.role==='SCHOOL_ADMIN'?'operations':'personalAttendance';
  const target=document.querySelector('[data-submenu="'+targetKey+'"]');
  if(target){
   target.append(button);
   target.closest('.nav-group')?.removeAttribute('hidden');
  }
  const reviewerNav=user.role!=='TEACHER'?document.createElement('button'):null;
  if(reviewerNav){
   reviewerNav.type='button';
   reviewerNav.id='staffLeaveReviewNav';
   reviewerNav.className='nav-item';
   reviewerNav.title='Review leave requests within your authorized scope';
   reviewerNav.innerHTML='<span class="nav-icon" aria-hidden="true">✓</span><span class="nav-label">Leave Approvals</span>';
   const approvals=document.querySelector('[data-submenu="operations"]');
   if(approvals){
    approvals.append(reviewerNav);
    approvals.closest('.nav-group')?.removeAttribute('hidden');
   }
  }
  const isHrAdmin=user.role==='SCHOOL_ADMIN';
  const mayReviewCredits=isHrAdmin||user.role==='DEPARTMENT_HEAD';
  const leaveHeading=isHrAdmin?'Leave & Credits Administration':'My Leave & Credits';
  const leaveIntro=isHrAdmin
   ? 'Submit your own leave separately from HR-certified balances and authorized review queues.'
   : user.role==='DEPARTMENT_HEAD'
     ? 'Apply for leave, view your own certified balances, and handle separate authorized recommendations.'
     : 'Apply for leave and view HR-certified credit balances. Credit claims require independent verification.';
  const dialog=document.createElement('dialog');dialog.id='staffLeaveDialog';
  dialog.setAttribute('aria-label','Leave Management');
  dialog.innerHTML='<div class="leave-shell"><div class="leave-header"><div><h2>'+esc(leaveHeading)+'</h2>'+
   '<p>'+esc(leaveIntro)+'</p></div>'+
   '<button class="leave-close" id="leaveClose" type="button" aria-label="Close Leave Management">✕</button></div>'+
   '<div class="leave-tabs" role="tablist" aria-label="Leave Management sections">'+
   '<button type="button" class="is-active" data-leave-tab="requests">'+(isHrAdmin?'Leave applications':'My applications')+'</button>'+
   '<button type="button" data-leave-tab="inbox" '+(!mayReviewCredits?'hidden':'')+'>Leave approvals</button>'+
   '<button type="button" data-leave-tab="credits">'+(isHrAdmin?'HR credits':'My credits')+'</button></div>'+
   '<div class="leave-body" id="leaveBody"></div><div class="leave-message" id="leaveMessage" role="status" aria-live="polite"></div></div>';
  document.body.append(dialog);
  const body=$('leaveBody'),message=$('leaveMessage');
  // Own employee profile: read-only live leave window; no account deactivation.
  const profileLeave=$('accountProfileLeaveStatus');
  function friendlyDate(s){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(String(s||'')))return 'date unavailable';
   return new Intl.DateTimeFormat('en-PH',{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'})
    .format(new Date(s+'T12:00:00Z'));
  }
  function profileLeaveMessage(leave){
   if(!profileLeave)return;
   profileLeave.hidden=true;
   profileLeave.replaceChildren();
   profileLeave.classList.remove('leave-upcoming','leave-review','leave-unavailable');
   const status=leave?.status||'NONE';
   if(status==='NONE')return;
   const title=document.createElement('strong'),dateLine=document.createElement('span');
   dateLine.className='leave-window';
   const guidance=document.createElement('span');
   guidance.className='leave-guidance';
   if(status==='ACTIVE'){
    title.textContent='On Approved Leave';
    guidance.textContent='Your approved leave is recognized by Form 48 through the end date. '+
      'Physical gate scans remain recorded separately and require review if they overlap leave.';
   }else if(status==='UPCOMING'){
    title.textContent='Approved Leave Scheduled';
    guidance.textContent='This leave is not active today. Normal attendance processing continues until it begins.';
    profileLeave.classList.add('leave-upcoming');
   }else if(status==='ON_LEAVE_REVIEW'){
    title.textContent='Leave status on record — HR review';
    guidance.textContent='Confirm the supporting official approval with your school HR office.';
    profileLeave.classList.add('leave-review');
   }else return;
   dateLine.textContent=friendlyDate(leave.startDate)+' – '+friendlyDate(leave.endDate)+' (inclusive)';
   profileLeave.append(title,dateLine);
   if(leave.approvalReference&&status!=='ON_LEAVE_REVIEW'){
    const ref=document.createElement('span');
    ref.textContent='Approval reference: '+leave.approvalReference;
    profileLeave.append(ref);
   }
   profileLeave.append(guidance);
   profileLeave.hidden=false;
  }
  async function refreshProfileLeave(){
   if(!profileLeave)return;
   try{const data=await call('/my/status');profileLeaveMessage(data.leave);}
   catch(error){
    profileLeave.replaceChildren();
    profileLeave.classList.add('leave-unavailable');
    profileLeave.textContent='Leave status unavailable. Please review Leave Management or retry.';
    profileLeave.hidden=false;
   }
  }
  $('profileMenuButton')?.addEventListener('click',()=>{void refreshProfileLeave();});
  document.addEventListener('attendigo:requests-changed',()=>{
   if($('accountProfileDialog')?.open)void refreshProfileLeave();
  });

  const reviewer=user.role==='SCHOOL_ADMIN'||user.role==='DEPARTMENT_HEAD';
  dialog.querySelector('[data-leave-tab="inbox"]').hidden=!reviewer;
  window.AttendigoLeaveInbox?.attachNav(reviewerNav,user,call);
  let tab='requests',busy=false,reviewOnly=false;
  const say=(value,error=false)=>{message.textContent=value;message.classList.toggle('is-error',error);};
  const buttonFor=(label,cb)=>{
   const b=document.createElement('button');b.type='button';b.className='leave-btn';
   b.textContent=label;b.addEventListener('click',cb);return b;
  };
  const safeDate=s=>String(s||'').slice(0,10)||'—';
  const classify=s=>String(s||'').replaceAll('_',' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
  const action=async(label,fn)=>{
   if(busy)return;
   busy=true; say(label+'…');
   try{const result=await fn();say(result?.notice||'Saved successfully.');document.dispatchEvent(new Event('attendigo:requests-changed'));await load();}
   catch(e){say(e.message,true);}finally{busy=false;}
  };
  async function load(){
   if(tab==='requests')await renderRequests();
   else if(tab==='inbox'){
    if(!window.AttendigoLeaveInbox)throw Error('Leave Approval Inbox is unavailable. Refresh Attendigo.');
    await window.AttendigoLeaveInbox.render({body,user,call,upload,action,message,
     openRequests:()=>{reviewOnly=false;selectTab('requests');}});
   }else await renderCredits();
  }
  const selectTab=next=>{
   if(next==='inbox'&&!mayReviewCredits)return;
   if(next==='requests'&&tab==='inbox')reviewOnly=false;
   tab=next;
   dialog.querySelectorAll('[data-leave-tab]').forEach(b=>b.classList.toggle('is-active',b.dataset.leaveTab===next));
   say('');
   load().catch(e=>say(e.message,true));
  };
  dialog.querySelectorAll('[data-leave-tab]').forEach(b=>b.addEventListener('click',()=>selectTab(b.dataset.leaveTab)));
  $('leaveClose').addEventListener('click',()=>dialog.close());
  function openLeave(reviewQueue=false){
   reviewOnly=reviewQueue;
   if(!dialog.open)dialog.showModal();
   selectTab(reviewQueue?'inbox':'requests');
  }
  button.addEventListener('click',()=>openLeave(false));
  reviewerNav?.addEventListener('click',()=>openLeave(true));
  document.addEventListener('attendigo:open-leave-inbox',()=>openLeave(true));
  const handleLeaveLink=()=>{if(location.hash==='#leaveManagement')openLeave(true);};
  window.addEventListener('hashchange',handleLeaveLink);
  if(location.hash==='#leaveManagement')handleLeaveLink();
  function reviewable(r){
   if(r.staffUserId===user.userId)return false;
   if(user.role==='SCHOOL_ADMIN')
    return r.status==='PENDING_ADMIN'||r.status==='PENDING_EXTERNAL';
   return user.role==='DEPARTMENT_HEAD'&&
    (r.status==='PENDING_HEAD'||(r.status==='PENDING_EXTERNAL'&&r.staffRole==='SCHOOL_ADMIN'));
  }
  function newRequest(){
   const details=document.createElement('details');details.className='leave-card';details.innerHTML=
    '<summary>New leave application</summary>'+
    '<div class="leave-form-intro"><span>Complete this application first. After saving, use the <strong>Print prefilled CSC Form No. 6</strong> action on your request.</span>'+
    '<a class="leave-btn" href="/leave-form6.html?template=1" target="_blank" rel="noopener">View blank CSC Form No. 6</a></div>'+
    '<form id="leaveNewForm" class="leave-form">'+
    select('leaveType','Type of leave',docTypes)+select('creditAccount','Proposed credit account',accounts)+
    '<p class="leave-sick-guidance" role="status" aria-live="polite"></p>'+
    textInput('startDate','Start date',true,'date')+textInput('endDate','End date',true,'date')+
    '<label>Reason (required)<textarea name="reason" rows="2" minlength="3" maxlength="1000" required></textarea></label>'+
    '<label>Details / location (optional)<textarea name="details" rows="2" maxlength="1500"></textarea></label>'+
    select('commutation','Commutation',[['NOT_REQUESTED','Not requested'],['REQUESTED','Requested']])+
    fileInput('supportingDocument','Supporting document (optional at filing)')+
    select('supportingKind','Supporting-document type',[
     ['APPLICATION','Application / general evidence'],['MEDICAL','Medical certificate / clearance'],
     ['AFFIDAVIT','Notarized affidavit if no medical consultation']])+
    '<button type="submit" class="leave-primary">Submit for review</button></form>';
   const leaveTypeControl=details.querySelector('[name=leaveType]');
   const accountControl=details.querySelector('[name=creditAccount]');
   const sickInfo=details.querySelector('.leave-sick-guidance');
   const start=details.querySelector('[name=startDate]');
   const end=details.querySelector('[name=endDate]');
   let certifiedScheme='UNVERIFIED';
   const manilaDate=()=>{
    const parts=new Intl.DateTimeFormat('en-US',{
     timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'
    }).formatToParts(new Date());
    const value=k=>parts.find(p=>p.type===k)?.value;
    return value('year')+'-'+value('month')+'-'+value('day');
   };
   const explainSick=()=>{
    const sick=leaveTypeControl.value==='SICK';
    if(!sick){sickInfo.hidden=true;accountControl.disabled=false;return;}
    sickInfo.hidden=false;
    const account=certifiedScheme==='TEACHING_VSC'?'VSC':
     certifiedScheme==='REGULAR_VL_SL'?'SL':'NONE';
    accountControl.value=account;
    accountControl.disabled=true;
    const today=manilaDate();
    const basis=start.value>today?'Advance-filed':end.value&&end.value<today?
     'Filed upon return':'During ongoing absence';
    sickInfo.textContent=basis+' sick leave: CSC Form No. 6 may be filed immediately after returning to duty. Notify your supervisor of an unexpected absence. '+
     (account==='VSC'?'HR-certified teaching personnel: illness uses Vacation Service Credits (VSC).':
      account==='SL'?'HR-certified regular leave: illness uses Sick Leave (SL).':
      'HR leave scheme not yet verified; you may submit now, but no balance will be charged until HR confirms the correct entitlement.')+
     ' Leave remains pending until the authorized official approves. Advance-filed illness or more than five consecutive days needs a medical certificate/clearance, or an appropriate notarized affidavit if no consultation was obtained.';
   };
   leaveTypeControl.addEventListener('change',e=>{
    if(e.target.value==='VSC')accountControl.value='VSC';
    if(['MATERNITY','PATERNITY'].includes(e.target.value))accountControl.value='NONE';
    explainSick();
   });
   start.addEventListener('change',explainSick);
   end.addEventListener('change',explainSick);
   void call('/my/credit-scheme').then(x=>{
    certifiedScheme=x.leaveScheme||'UNVERIFIED';explainSick();
   }).catch(()=>{certifiedScheme='UNVERIFIED';explainSick();});
   explainSick();
   details.querySelector('form').addEventListener('submit',e=>{
    e.preventDefault();const f=e.target;if(!f.reportValidity())return;
    const d=new FormData(f);
    const payload=Object.fromEntries(['leaveType','creditAccount','startDate','endDate','reason','details','commutation'].map(k=>[k,String(d.get(k)||'')]));
    if(payload.leaveType==='SICK')
     payload.creditAccount=certifiedScheme==='TEACHING_VSC'?'VSC':
      certifiedScheme==='REGULAR_VL_SL'?'SL':'NONE';
    action('Submitting leave',async()=>{
     const response=await call('/requests','POST',payload);
     const file=d.get('supportingDocument');
     if(file instanceof File&&file.size){
      try{await upload('/requests/'+response.requestId+'/documents',file,
       String(d.get('supportingKind')||'APPLICATION'));}
      catch(e){return {notice:'Application saved, but the attachment failed: '+e.message+' Please attach it from the request card.'};}
     }
     details.open=false;f.reset();return response;
    });
   });
   return details;
  }
  function attachDocument(item,row,kind='APPLICATION'){
   const wrap=document.createElement('form');wrap.className='leave-inline-form';
   wrap.innerHTML=fileInput('file','Attach '+(kind==='APPROVAL'?'signed external approval':'supporting evidence'))+
    '<button class="leave-btn" type="submit">Upload document</button>';
   wrap.addEventListener('submit',e=>{
    e.preventDefault();const file=new FormData(wrap).get('file');
    if(!(file instanceof File)||!file.size){say('Select a document first.',true);return;}
    action('Uploading document',()=>upload('/requests/'+row.requestId+'/documents',file,kind));
   });item.append(wrap);
  }
  async function renderRequests(){
   if(reviewOnly)body.replaceChildren();
   else body.replaceChildren(newRequest());
   if(user.role==='SCHOOL_ADMIN'&&!reviewOnly){
    const panel=document.createElement('section');
    panel.className='leave-card';
    panel.innerHTML='<div class="leave-section-title"><div><strong>Gate visits during approved leave</strong>'+
      '<p class="leave-help">Review physical movements that overlap approved leave. A scan does not cancel leave or automatically fill the DTR.</p></div>'+
      '<label>School date <input type="date" class="leave-overlap-date" required></label>'+
      '<button class="leave-btn leave-check-overlaps" type="button">Check date</button></div>'+
      '<div class="leave-overlap-list" role="status" aria-live="polite">Loading…</div>';
    const fields=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'})
     .formatToParts(new Date());
    const val=key=>fields.find(p=>p.type===key)?.value||'';
    const dateInput=panel.querySelector('.leave-overlap-date');
    dateInput.value=val('year')+'-'+val('month')+'-'+val('day');
    const list=panel.querySelector('.leave-overlap-list');
    async function checkOverlaps(){
     list.textContent='Checking documented leave and verified gate movements…';
     try{
      const data=await call('/overlaps?date='+encodeURIComponent(dateInput.value));
      list.replaceChildren();
      if(!data.overlaps?.length){
       list.textContent='No verified gate movements overlapping approved leave on this date.';
       return;
      }
      data.overlaps.forEach(item=>{
       const line=document.createElement('div');line.className='leave-overlap-row';
       const title=document.createElement('strong');title.textContent=item.staffName||'Staff';
       const detail=document.createElement('span');
       detail.textContent=item.movementCount+' gate movement(s) · first '+item.firstMovement+
        ', last '+item.lastMovement+' · HR/DTR review required';
       line.append(title,detail);list.append(line);
      });
     }catch(e){list.textContent='Could not check leave overlaps: '+e.message;}
    }
    panel.querySelector('.leave-check-overlaps').addEventListener('click',()=>{void checkOverlaps();});
    body.append(panel);
    void checkOverlaps();
   }
   const header=document.createElement('div');header.className='leave-section-title';header.innerHTML=
    '<h3>'+(reviewOnly?'Pending leave approvals':'Applications and approvals')+'</h3><button class="leave-btn" type="button">Refresh</button>';
   header.querySelector('button').addEventListener('click',()=>load().catch(e=>say(e.message,true)));
   body.append(header);
   const list=document.createElement('div');list.className='leave-list';body.append(list);
   const response=await call('/requests');
   const visibleRequests=reviewOnly?(response.requests||[]).filter(reviewable):(response.requests||[]);
   if(!visibleRequests.length){
    list.textContent=reviewOnly?'No leave requests are awaiting your authorized review.':'No leave requests yet. You can submit one above.';
    return;
   }
   visibleRequests.forEach(r=>{
    const card=document.createElement('article');card.className='leave-card';
    card.innerHTML='<div class="leave-card-top"><strong>'+esc(r.staffName)+'</strong>'+
     '<span class="leave-status">'+esc(classify(r.status))+'</span></div>'+
     '<p>'+esc(classify(r.leaveType))+' · '+esc(safeDate(r.startDate))+' to '+esc(safeDate(r.endDate))+'</p>'+
     '<p>Account: '+esc(r.creditAccount)+' · '+esc(r.reason)+'</p>'+
     (r.leaveType==='SICK'?'<p class="leave-help">Filing: '+
       esc(r.filingBasis==='POST_RETURN'?'Submitted upon return':
        r.filingBasis==='ADVANCE'?'Submitted in advance':r.filingBasis==='DURING_ABSENCE'?
        'Submitted during absence':'Submission date not classified')+
       ' · Credit account is finalized only after HR certification.</p>':'')+
     (r.externalReference?'<p>Approval reference: '+esc(r.externalReference)+'</p>':'')+
     '<div class="leave-actions"></div>';
    const buttons=card.querySelector('.leave-actions');
    buttons.append(buttonFor('Print prefilled CSC Form No. 6',()=>{
     window.open('/leave-form6.html?requestId='+encodeURIComponent(r.requestId),'_blank');
    }));
    if(r.staffUserId===user.userId&&!['APPROVED','REJECTED','CANCELLED'].includes(r.status)){
     attachDocument(card,r,'APPLICATION');
     if(r.leaveType==='SICK'){
      const sickDoc=document.createElement('details');sickDoc.className='leave-card';
      sickDoc.innerHTML='<summary>Attach medical evidence or notarized affidavit</summary>'+
       '<p class="leave-help">For advance-filed sick leave or illness exceeding five consecutive days, submit a medical certificate/clearance, or an appropriate notarized affidavit where medical consultation was not obtained. Only authorized HR staff can inspect these sensitive documents.</p>'+
       '<form class="leave-inline-form">'+
       select('documentKind','Evidence type',[
         ['MEDICAL','Medical certificate / clearance'],['AFFIDAVIT','Notarized affidavit']])+
       fileInput('file','Official evidence (PDF, JPG or PNG)')+
       '<button class="leave-btn" type="submit">Upload protected evidence</button></form>';
      sickDoc.querySelector('form').addEventListener('submit',e=>{
       e.preventDefault();const d=new FormData(e.target),file=d.get('file');
       if(!(file instanceof File)||!file.size){say('Select the official document first.',true);return;}
       action('Saving protected medical evidence',()=>upload('/requests/'+r.requestId+'/documents',
         file,String(d.get('documentKind'))));
      });card.append(sickDoc);
     }
    }
    async function review(endpoint,decision,request){
     const note=window.prompt('Review note (required for disapproval):','');
     if(note===null)return;
     action('Saving review',()=>call('/requests/'+r.requestId+'/'+endpoint,'POST',{decision,note,...request}));
    }
    if(user.role==='DEPARTMENT_HEAD'&&r.status==='PENDING_HEAD'&&r.staffUserId!==user.userId){
     buttons.append(buttonFor('Recommend',()=>review('recommend','FORWARD')));
     buttons.append(buttonFor('Recommend disapproval',()=>review('recommend','REJECT')));
    }
    if(user.role==='SCHOOL_ADMIN'&&r.status==='PENDING_ADMIN'&&r.staffUserId!==user.userId){
     buttons.append(buttonFor('Forward for official approval',()=>review('admin-review','FORWARD')));
     buttons.append(buttonFor('Recommend disapproval',()=>review('admin-review','REJECT')));
    }
    if(r.status==='PENDING_EXTERNAL'&&r.staffUserId!==user.userId&&
       (user.role==='SCHOOL_ADMIN'||(user.role==='DEPARTMENT_HEAD'&&r.staffRole==='SCHOOL_ADMIN'))){
     const details=document.createElement('details');details.className='leave-approval';
     details.innerHTML='<summary>Record official division decision</summary>'+
      '<p class="leave-help">This records a decision already signed by the authorized official. It does not grant system users new signing authority.</p>'+
      '<form class="leave-form">'+
      select('decision','Documented decision',[['APPROVE','Approved'],['REJECT','Disapproved']])+
      textInput('approvalReference','Official document / order reference')+
      textInput('approverName','Name of authorized approving official')+
      textInput('approverPosition','Official approving position')+
      textInput('approvedOn','Decision date',true,'date')+
      textInput('certifiedWorkingDays','HR-certified working days (approval only)',false,'number')+
      '<label>Notes<textarea name="note" maxlength="1000"></textarea></label>'+
      fileInput('file','Attach signed approval (PDF/JPG/PNG)')+
      '<button class="leave-primary" type="submit">Verify and record decision</button></form>';
     details.querySelector('form').addEventListener('submit',e=>{
      e.preventDefault();const d=new FormData(e.target);
      action('Verifying division decision',async()=>{
       const f=d.get('file');if(f instanceof File&&f.size)await upload('/requests/'+r.requestId+'/documents',f,'APPROVAL');
       return call('/requests/'+r.requestId+'/external-decision','POST',{
        decision:String(d.get('decision')),approvalReference:String(d.get('approvalReference')),
        approverName:String(d.get('approverName')),approverPosition:String(d.get('approverPosition')),
        approvedOn:String(d.get('approvedOn')),certifiedWorkingDays:Number(d.get('certifiedWorkingDays')),
        note:String(d.get('note')||'')});
      });
     });card.append(details);
    }
    list.append(card);
   });
  }
  function creditForm(){
   const details=document.createElement('details');details.className='leave-card';details.innerHTML=
    '<summary>Submit earned-credit claim (not a balance adjustment)</summary>'+
    '<p class="leave-help">Teachers may propose an eligible service-credit claim with supporting evidence, not assign or change their certified balance. HR verifies all approved days against an official Special Order or certification.</p>'+
    '<form class="leave-form">'+select('creditAccount','Credit account',[['VSC','Vacation Service Credits'],['VL','Vacation Leave'],['SL','Sick Leave'],['CTO','Compensatory Time Off']])+
    select('activityKind','Activity',[['SEMINAR','Training / seminar'],['BRIGADA_ESKWELA','Brigada Eskwela'],['TEACHING_OVERLOAD','Eligible overload'],['OTHER','Other authorized service']])+
    textInput('activityDate','Date of service',true,'date')+textInput('hours','Qualifying hours',false,'number')+
    textInput('proposedDays','Proposed credit days',true,'number')+
    textInput('policyReference','DepEd memo/order reference',false)+
    '<label>Notes<textarea name="notes" maxlength="1500"></textarea></label>'+
    '<button class="leave-primary" type="submit">Submit claim for verification</button></form>';
   details.querySelector('form').addEventListener('submit',e=>{
    e.preventDefault();const d=new FormData(e.target);
    action('Submitting service credit claim',()=>call('/credits','POST',{
     creditAccount:String(d.get('creditAccount')),activityKind:String(d.get('activityKind')),
     activityDate:String(d.get('activityDate')),hours:d.get('hours')?Number(d.get('hours')):null,
     proposedDays:Number(d.get('proposedDays')),policyReference:String(d.get('policyReference')),notes:String(d.get('notes'))}));
   });return details;
  }
  function creditRow(e,pending=false){
   const card=document.createElement('article');card.className='leave-card';
   card.innerHTML='<div class="leave-card-top"><strong>'+esc(e.staffName||'My credit record')+'</strong>'+
    '<span class="leave-status">'+esc(classify(e.status))+'</span></div>'+
    '<p>'+esc(e.creditAccount)+' · '+esc(e.entryKind)+' · '+esc(e.days)+' day(s)</p>'+
    '<p>'+esc(classify(e.activityKind))+' · '+esc(safeDate(e.activityDate))+'</p>';
   if(pending&&e.staffUserId!==user.userId){
    const form=document.createElement('form');form.className='leave-inline-form';
    form.innerHTML=textInput('approvalReference','Special Order / signed certification number')+
     textInput('approvedDays','Officially approved credit days',true,'number')+
     fileInput('file',e.entryKind==='OPENING'?'Official HR credit certification':'Official signed Special Order / certification')+
     '<button class="leave-primary" type="submit">Verify credit</button>';
    form.querySelector('[name=approvedDays]').value=e.days;
    form.addEventListener('submit',event=>{
     event.preventDefault();const d=new FormData(form);
     action('Certifying credits',async()=>{
      const f=d.get('file');if(f instanceof File&&f.size)await upload('/credits/'+e.entryId+'/documents',f,e.entryKind==='OPENING'?'CERTIFICATION':'SPECIAL_ORDER');
      return call('/credits/'+e.entryId+'/verify','POST',{
       approvalReference:String(d.get('approvalReference')),approvedDays:Number(d.get('approvedDays'))});
     });
    });card.append(form);
   }
   return card;
  }
  async function renderCredits(){
   body.replaceChildren();
   const guidance=document.createElement('div');guidance.className='leave-role-guidance';
   guidance.innerHTML=isHrAdmin
    ? '<strong>HR credit administration</strong><p>Encode an employee\'s existing credits only from official HR records. Entries stay pending until another authorized officer verifies the supporting certification. Your own balances are displayed separately below.</p>'
    : '<strong>My certified credit balances · read-only</strong><p>These balances come from verified HR records. You cannot edit them. An earned-credit claim is only a proposal until official certification.</p>';
   body.append(guidance);
   const own=await call('/credits');
   const balance=document.createElement('div');balance.className='leave-balances';
   const credits=new Map((own.balances||[]).map(x=>[x.creditAccount,Number(x.available)]));
   const certified=new Set((own.balances||[]).filter(x=>x.isCertified===true).map(x=>x.creditAccount));
   [['VSC','Vacation Service Credits'],['VL','Vacation Leave'],['SL','Sick Leave'],['CTO','Compensatory Time Off']]
    .forEach(([key,label])=>{
     const el=document.createElement('div');el.className='leave-balance';
     const verified=certified.has(key);
     el.innerHTML='<small>'+esc(label)+'</small><strong class="'+(verified?'':'leave-balance-unrecorded')+'">'+
      esc(verified?(credits.get(key)||0).toFixed(3):'Not recorded')+'</strong><span>'+
      (verified?'HR-certified available days':'No HR-certified balance on file')+'</span>';balance.append(el);
    });
   body.append(balance);
   if(!isHrAdmin)body.append(creditForm());
   const h=document.createElement('h3');h.textContent='My credit history';body.append(h);
   const list=document.createElement('div');list.className='leave-list';body.append(list);
   (own.entries||[]).forEach(row=>list.append(creditRow(row)));
   if(!own.entries?.length){list.innerHTML='<p class="leave-empty">No certified or proposed credit transactions yet.</p>';}
   if(user.role==='SCHOOL_ADMIN'){
    const importPanel=document.createElement('details');importPanel.className='leave-card';
    importPanel.innerHTML='<summary>Record staff HR opening balance (requires verification)</summary>'+
     '<p class="leave-help">Record existing credits from an official HR certificate. This creates a pending entry; attach the certificate and verify separately before any balance is available.</p>'+
     '<form class="leave-form"><label>Employee<select name="staffUserId" required><option value="">Select employee</option></select></label>'+
     select('creditAccount','Credit account',[['VSC','Vacation Service Credits'],['VL','Vacation Leave'],['SL','Sick Leave'],['CTO','Compensatory Time Off']])+
     textInput('openingDays','Existing certified balance (days)',true,'number')+
     '<label>Notes<textarea name="notes" maxlength="500"></textarea></label>'+
     '<button class="leave-primary" type="submit">Record pending opening balance</button></form>';
    const selectStaff=importPanel.querySelector('select[name=staffUserId]');
    const roster=await call('/staff-roster');
    (roster.staff||[]).forEach(s=>{
     const opt=document.createElement('option');opt.value=s.userId;opt.textContent=s.displayName+' ('+s.role.replaceAll('_',' ')+')';selectStaff.append(opt);
    });
    importPanel.querySelector('form').addEventListener('submit',event=>{
     event.preventDefault();const d=new FormData(event.target);
     action('Importing opening balance',()=>call('/credits/opening','POST',{
      staffUserId:String(d.get('staffUserId')),creditAccount:String(d.get('creditAccount')),
      openingDays:Number(d.get('openingDays')),notes:String(d.get('notes')||'')}));
    });
    // School HR can inspect school-scoped, certified balances before creating
    // an opening entry. This directory is read-only; adjustments remain audited.
    const directory=document.createElement('section');
    directory.className='leave-card leave-hr-directory';
    directory.innerHTML='<h3>Staff certified credit directory</h3>'+
     '<p class="leave-help">Select an employee to inspect verified balances. An unrecorded balance is not proof of zero entitlement. Only authorized HR records may establish credits.</p>'+
     '<div class="leave-form"><label>Employee<select name="creditDirectoryStaff"><option value="">Select employee</option></select></label>'+
     '<button type="button" class="leave-btn" data-credit-directory-check>View certified record</button></div>'+
     '<div class="leave-hr-directory-result" role="status" aria-live="polite">Select an employee to view their HR-certified credits.</div>';
    const directorySelect=directory.querySelector('select[name=creditDirectoryStaff]');
    (roster.staff||[]).forEach(s=>{
     const opt=document.createElement('option');opt.value=s.userId;
     opt.textContent=s.displayName+' ('+s.role.replaceAll('_',' ')+')';
     directorySelect.append(opt);
    });
    directory.querySelector('[data-credit-directory-check]').addEventListener('click',async e=>{
     const staffId=directorySelect.value,output=directory.querySelector('.leave-hr-directory-result');
     if(!staffId){output.textContent='Select an employee first.';return;}
     const control=e.currentTarget;control.disabled=true;output.textContent='Checking HR-certified records…';
     try{
      const record=await call('/credits?staffUserId='+encodeURIComponent(staffId));
      const confirmed=new Map((record.balances||[]).filter(x=>x.isCertified===true)
       .map(x=>[x.creditAccount,Number(x.available)]));
      const labels=[['VSC','Vacation Service Credits'],['VL','Vacation Leave'],['SL','Sick Leave'],['CTO','Compensatory Time Off']];
      const person=roster.staff.find(s=>s.userId===staffId);
      output.innerHTML='<strong>'+esc(person?.displayName||'Selected staff')+'</strong><ul>'+
       labels.map(([key,label])=>'<li>'+esc(label)+': <strong>'+
        (confirmed.has(key)?esc((confirmed.get(key)||0).toFixed(3))+' certified days':'Not recorded')+
        '</strong></li>').join('')+'</ul>';
     }catch(error){output.textContent='Cannot load certified balances: '+error.message;}
     finally{control.disabled=false;}
    });
    body.insertBefore(directory,h);
    body.insertBefore(importPanel,h);
   }
   if(mayReviewCredits){
    const title=document.createElement('h3');
    title.textContent=isHrAdmin?'Pending staff credit verification':'Administrator credits awaiting independent verification';
    body.insertBefore(title,h);
    const queue=document.createElement('div');queue.className='leave-list';
    body.insertBefore(queue,h);
    const data=await call('/credits/pending');
    (data.entries||[]).forEach(row=>queue.append(creditRow(row,true)));
    if(!data.entries?.length)queue.textContent='No credit claims awaiting your authorized review.';
   }
   if(isHrAdmin){
    const ownClaim=document.createElement('h3');ownClaim.textContent='My own earned-credit claims (verification by another officer)';
    body.append(ownClaim,creditForm());
   }
  }
 }
 window.attendigoStaffIdentity?.then(init).catch(()=>{});
})();
