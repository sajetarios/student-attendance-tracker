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
  button.innerHTML='<span class="nav-icon" aria-hidden="true">▣</span><span class="nav-label">Leave Management</span>';
  const target=document.querySelector('[data-submenu="attendanceManagement"]')||
    document.querySelector('[data-submenu="personalAttendance"]')||
    document.querySelector('[data-submenu="academics"]');
  if(target)target.append(button);
  else document.querySelector('.side-nav')?.append(button);
  const dialog=document.createElement('dialog');dialog.id='staffLeaveDialog';
  dialog.setAttribute('aria-label','Leave Management');
  dialog.innerHTML='<div class="leave-shell"><div class="leave-header"><div><h2>Leave Management</h2>'+
   '<p>DepEd applications, CSC Form No. 6 (Revised 2020), and certified leave balances</p></div>'+
   '<button class="leave-close" id="leaveClose" type="button" aria-label="Close Leave Management">✕</button></div>'+
   '<div class="leave-tabs" role="tablist" aria-label="Leave Management sections">'+
   '<button type="button" class="is-active" data-leave-tab="requests">Leave requests</button>'+
   '<button type="button" data-leave-tab="credits">Service credits</button></div>'+
   '<div class="leave-body" id="leaveBody"></div><div class="leave-message" id="leaveMessage" role="status" aria-live="polite"></div></div>';
  document.body.append(dialog);
  const body=$('leaveBody'),message=$('leaveMessage');
  let tab='requests',busy=false;
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
   else await renderCredits();
  }
  const selectTab=next=>{
   tab=next;
   dialog.querySelectorAll('[data-leave-tab]').forEach(b=>b.classList.toggle('is-active',b.dataset.leaveTab===next));
   say('');
   load().catch(e=>say(e.message,true));
  };
  dialog.querySelectorAll('[data-leave-tab]').forEach(b=>b.addEventListener('click',()=>selectTab(b.dataset.leaveTab)));
  $('leaveClose').addEventListener('click',()=>dialog.close());
  button.addEventListener('click',()=>{
   if(!dialog.open)dialog.showModal();
   selectTab('requests');
  });
  function newRequest(){
   const details=document.createElement('details');details.className='leave-card';details.innerHTML=
    '<summary>New leave application</summary><form id="leaveNewForm" class="leave-form">'+
    select('leaveType','Type of leave',docTypes)+select('creditAccount','Proposed credit account',accounts)+
    textInput('startDate','Start date',true,'date')+textInput('endDate','End date',true,'date')+
    '<label>Reason (required)<textarea name="reason" rows="2" minlength="3" maxlength="1000" required></textarea></label>'+
    '<label>Details / location (optional)<textarea name="details" rows="2" maxlength="1500"></textarea></label>'+
    select('commutation','Commutation',[['NOT_REQUESTED','Not requested'],['REQUESTED','Requested']])+
    fileInput('supportingDocument','Supporting document (optional at filing)')+
    '<button type="submit" class="leave-primary">Submit for review</button></form>';
   details.querySelector('[name=leaveType]').addEventListener('change',e=>{
    if(e.target.value==='VSC')details.querySelector('[name=creditAccount]').value='VSC';
    if(['MATERNITY','PATERNITY'].includes(e.target.value))details.querySelector('[name=creditAccount]').value='NONE';
   });
   details.querySelector('form').addEventListener('submit',e=>{
    e.preventDefault();const f=e.target;if(!f.reportValidity())return;
    const d=new FormData(f);
    const payload=Object.fromEntries(['leaveType','creditAccount','startDate','endDate','reason','details','commutation'].map(k=>[k,String(d.get(k)||'')]));
    action('Submitting leave',async()=>{
     const response=await call('/requests','POST',payload);
     const file=d.get('supportingDocument');
     if(file instanceof File&&file.size){
      try{await upload('/requests/'+response.requestId+'/documents',file,'APPLICATION');}
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
   body.replaceChildren(newRequest());
   const header=document.createElement('div');header.className='leave-section-title';header.innerHTML=
    '<h3>Applications and approvals</h3><button class="leave-btn" type="button">Refresh</button>';
   header.querySelector('button').addEventListener('click',()=>load().catch(e=>say(e.message,true)));
   body.append(header);
   const list=document.createElement('div');list.className='leave-list';body.append(list);
   const response=await call('/requests');
   if(!response.requests?.length){list.innerHTML='<p class="leave-empty">No leave requests yet. You can submit one above.</p>';return;}
   response.requests.forEach(r=>{
    const card=document.createElement('article');card.className='leave-card';
    card.innerHTML='<div class="leave-card-top"><strong>'+esc(r.staffName)+'</strong>'+
     '<span class="leave-status">'+esc(classify(r.status))+'</span></div>'+
     '<p>'+esc(classify(r.leaveType))+' · '+esc(safeDate(r.startDate))+' to '+esc(safeDate(r.endDate))+'</p>'+
     '<p>Account: '+esc(r.creditAccount)+' · '+esc(r.reason)+'</p>'+
     (r.externalReference?'<p>Approval reference: '+esc(r.externalReference)+'</p>':'')+
     '<div class="leave-actions"></div>';
    const buttons=card.querySelector('.leave-actions');
    buttons.append(buttonFor('CSC Form No. 6',()=>{
     window.open('/leave-form6.html?requestId='+encodeURIComponent(r.requestId),'_blank');
    }));
    if(r.staffUserId===user.userId&&!['APPROVED','REJECTED','CANCELLED'].includes(r.status))
     attachDocument(card,r,'APPLICATION');
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
    '<summary>Record service credit earned</summary>'+
    '<p class="leave-help">Seminars and Brigada Eskwela generate proposed credits only. An official Special Order or authorized certification must be verified before they become available.</p>'+
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
   body.replaceChildren(creditForm());
   const own=await call('/credits');
   const balance=document.createElement('div');balance.className='leave-balances';
   const credits=new Map((own.balances||[]).map(x=>[x.creditAccount,Number(x.available)]));
   [['VSC','Vacation Service Credits'],['VL','Vacation Leave'],['SL','Sick Leave'],['CTO','Compensatory Time Off']]
    .forEach(([key,label])=>{
     const el=document.createElement('div');el.className='leave-balance';
     el.innerHTML='<small>'+esc(label)+'</small><strong>'+esc((credits.get(key)||0).toFixed(3))+'</strong><span>certified days</span>';balance.append(el);
    });
   body.prepend(balance);
   const h=document.createElement('h3');h.textContent='My credit history';body.append(h);
   const list=document.createElement('div');list.className='leave-list';body.append(list);
   (own.entries||[]).forEach(row=>list.append(creditRow(row)));
   if(!own.entries?.length){list.innerHTML='<p class="leave-empty">No certified or proposed credit transactions yet.</p>';}
   if(user.role==='SCHOOL_ADMIN'){
    const importPanel=document.createElement('details');importPanel.className='leave-card';
    importPanel.innerHTML='<summary>Import certified opening leave balance</summary>'+
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
    });body.append(importPanel);
   }
   if(user.role==='SCHOOL_ADMIN'){
    const title=document.createElement('h3');title.textContent='Pending staff credit verification';body.append(title);
    const queue=document.createElement('div');queue.className='leave-list';body.append(queue);
    const data=await call('/credits/pending');
    (data.entries||[]).forEach(row=>queue.append(creditRow(row,true)));
    if(!data.entries?.length)queue.textContent='No pending credit claims.';
   }
  }
 }
 window.attendigoStaffIdentity?.then(init).catch(()=>{});
})();
