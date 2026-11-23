'use strict';
(() => {
 const $=id=>document.getElementById(id);
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
 const fmt=d=>d?new Intl.DateTimeFormat('en-PH',{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'}).format(new Date(d+'T12:00:00Z')):'—';
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const labels={PENDING_HEAD:'Pending Department Head',NEEDS_EVIDENCE:'Needs more evidence',
  HEAD_VERIFIED:'Department verified · Admin review',HEAD_REJECTED:'Rejected by Department Head',
  DOCUMENTED:'Approved · documented exception',DTR_CORRECTED:'Approved · official DTR correction',
  ADMIN_REJECTED:'Rejected by School Admin'};
 async function api(path,{method='GET',data,file}={}){
  const options={method,credentials:'same-origin',cache:'no-store',headers:{}};
  if(data){options.headers['Content-Type']='application/json';options.body=JSON.stringify(data);}
  if(file){options.headers['Content-Type']=file.type;options.body=file;}
  const response=await fetch('/api/missing-scans'+path,options);
  if(response.status===401){location.href='/portal-login.html';throw Error('Session expired.');}
  if(!response.ok){const out=await response.json().catch(()=>({}));throw Error(out.error||'Request failed ('+response.status+').');}
  return response.json();
 }
 function init(user){
  if(!['TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN'].includes(user?.role))return;
  const isHead=user.role==='DEPARTMENT_HEAD',isAdmin=user.role==='SCHOOL_ADMIN';
  const dialog=document.createElement('dialog');
  dialog.id='missingScanDialog';dialog.className='missing-scan-dialog';
  dialog.setAttribute('aria-label','Missing scan correction requests');
  dialog.innerHTML='<div class="ms-shell"><header class="ms-header"><div><small>ATTENDANCE MANAGEMENT</small>'+
   '<h2>Missing Scan Requests</h2><p>Document forgotten AM/PM scans without changing the original QR or gate history.</p></div>'+
   '<button type="button" class="ms-close" aria-label="Close">✕</button></header>'+
   (isHead||isAdmin?'<nav class="ms-tabs" aria-label="Missing scan request views">'+
   '<button type="button" data-ms-tab="mine">My requests</button>'+
   (isHead||isAdmin?'<button type="button" data-ms-tab="inbox">'+(isHead?'Department review':'School Admin review')+'</button>':'')+
   '</nav>':'')+'<div class="ms-message" role="status" aria-live="polite"></div>'+
   '<div class="ms-policy" hidden></div><div class="ms-content"></div></div>';
  document.body.append(dialog);
  const message=dialog.querySelector('.ms-message');
  const content=dialog.querySelector('.ms-content');
  const policyArea=dialog.querySelector('.ms-policy');
  let tab='mine',busy=false,mode='DOCUMENT_EXCEPTION';
  const messageSet=(txt,err=false)=>{message.textContent=txt;message.classList.toggle('is-error',err);};
  function nav(id,label,target,view){
   const host=document.querySelector('[data-submenu="'+target+'"]');
   if(!host)return;
   const button=document.createElement('button');button.type='button';button.className='nav-item';button.id=id;
   button.innerHTML='<span class="nav-icon" aria-hidden="true">◷</span><span class="nav-label">'+esc(label)+'</span>';
   button.addEventListener('click',()=>open(view));
   host.append(button);host.closest('.nav-group')?.removeAttribute('hidden');
  }
  nav('missingScanMyNav','Missing Scan Requests',isAdmin?'attendanceManagement':'personalAttendance','mine');
  if(isHead)nav('missingScanHeadNav','Department Scan Reviews','operations','inbox');
  if(isAdmin)nav('missingScanAdminNav','Missing Scan Reviews','attendanceManagement','inbox');
  // Discoverable from the existing personal DTR; no new dashboard page.
  const myDtr=$('myGateAttendanceView');
  if(myDtr){
   const action=document.createElement('button');action.type='button';
   action.className='outline-button ms-dtr-action';action.textContent='Report a missing AM/PM scan';
   action.addEventListener('click',()=>open('mine'));
   const head=myDtr.querySelector('.section-toolbar');
   (head||myDtr).append(action);
  }
  dialog.querySelector('.ms-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  dialog.querySelectorAll('[data-ms-tab]').forEach(button=>button.addEventListener('click',()=>{
   tab=button.dataset.msTab;load().catch(e=>messageSet(e.message,true));
  }));
  function open(view){
   tab=view==='inbox'&&(isAdmin||isHead)?'inbox':'mine';
   messageSet('');
   dialog.showModal();
   load().catch(e=>messageSet(e.message,true));
  }
  function renderForm(){
   return '<section class="ms-card ms-new"><h3>Report a forgotten scan</h3>'+
    '<p>Select a date to check your verified Form 48 entries. Attendigo will identify unrecorded slots, but only you can confirm which scan was missed and the time you actually arrived or departed. No QR or gate record will be changed.</p>'+
    '<form id="msCreateForm"><div class="ms-grid ms-create-grid">'+
    '<label>Attendance date<input type="date" name="date" max="'+esc(today())+'" required></label>'+
    '<label>Unrecorded DTR entry<select name="slot" required disabled><option value="">Checking DTR entries…</option></select></label>'+
    '<div class="ms-slot-status" role="status" aria-live="polite">Checking your verified DTR record…</div>'+
    '<label class="ms-full">Actual time claimed<input name="claimedTime" type="time" required></label></div>'+
    '<label>Explanation<textarea name="explanation" minlength="10" maxlength="1000" rows="3" required placeholder="Explain when and why the scan was missed."></textarea></label>'+
    '<div class="ms-actions"><button class="primary-button" type="submit" disabled>Send to Department Head</button></div></form></section>';
  }
  function inputText(name,label,value='',type='text'){
   return '<label>'+esc(label)+'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'" required></label>';
  }
  function renderRow(r){
   const own=tab==='mine';
   const canHead=isHead&&!own&&['PENDING_HEAD','NEEDS_EVIDENCE'].includes(r.status);
   const canAdmin=isAdmin&&!own&&r.status==='HEAD_VERIFIED';
   let html='<article class="ms-card ms-row" data-ms-id="'+esc(r.requestId)+'">'+
    '<div class="ms-row-heading"><div><strong>'+esc(r.staffName)+'</strong>'+
    '<p>'+esc(r.departmentName)+' · '+esc(fmt(r.date))+' · '+esc(r.slot.replace('_',' '))+'</p></div>'+
    '<span class="ms-status">'+esc(labels[r.status]||r.status)+'</span></div>'+
    '<dl class="ms-fields"><div><dt>Teacher claimed</dt><dd>'+esc(r.claimedTime||'—')+'</dd></div>'+
    '<div><dt>Head verified</dt><dd>'+esc(r.verifiedTime||'Not yet verified')+'</dd></div>'+
    '<div><dt>Logbook</dt><dd>'+esc(r.evidenceReference||'No reference yet')+'</dd></div></dl>'+
    '<p><strong>Teacher explanation:</strong> '+esc(r.explanation)+'</p>'+
    (r.headNote?'<p><strong>Department Head:</strong> '+esc(r.headNote)+'</p>':'')+
    (r.adminNote?'<p><strong>School Admin:</strong> '+esc(r.adminNote)+'</p>':'')+
    (r.hasEvidence?'<button type="button" class="outline-button" data-ms-action="evidence">View logbook evidence</button>':'<p class="ms-muted">No supporting file uploaded yet.</p>');
   if(own&&r.status==='NEEDS_EVIDENCE'){
    html+='<form data-ms-form="resubmit" class="ms-form">'+
     inputText('claimedTime','Corrected claimed time',r.claimedTime||'','time')+
     '<label>Clarification<textarea name="explanation" minlength="10" maxlength="1000" rows="2" required>'+esc(r.explanation)+'</textarea></label>'+
     '<button type="submit" class="primary-button">Resubmit to Department Head</button></form>';
   }
   if(canHead){
    html+='<div class="ms-review"><h4>Department Head verification</h4>'+
     '<p>Compare the teacher claim with the department logbook. Upload a clear excerpt showing this teacher and the logged time; crop or redact other staff entries.</p>'+
     '<label>Logbook evidence (JPG, PNG, PDF · 3 MB maximum)<input type="file" data-ms-file accept="image/jpeg,image/png,application/pdf"></label>'+
     '<button type="button" class="outline-button" data-ms-action="upload">Upload evidence</button>'+
     '<div class="ms-grid">'+
     inputText('verifiedTime','Time shown in logbook',r.claimedTime||'','time')+
     inputText('reference','Logbook page / entry reference',r.evidenceReference||'')+'</div>'+
     '<label>Reviewer comment<textarea name="comment" minlength="10" maxlength="1000" rows="2" placeholder="Describe what the logbook confirms or why more evidence is needed."></textarea></label>'+
     '<div class="ms-actions"><button type="button" data-ms-action="verify" class="primary-button">Verify entry</button>'+
     '<button type="button" data-ms-action="more" class="outline-button">Request evidence</button>'+
     '<button type="button" data-ms-action="reject" class="outline-button">Reject</button></div></div>';
   }
   if(canAdmin){
    html+='<div class="ms-review"><h4>School Admin reconciliation</h4>'+
     '<p>'+esc(mode==='DOCUMENT_EXCEPTION'?
      'Current policy: supporting evidence is certified, but the missing DTR time stays blank.':
      'Current policy permits an authorized, audited time correction. Check the logbook and conflicting records first.')+'</p>'+
     '<label>Final decision comment<textarea name="comment" minlength="10" maxlength="1000" rows="2" placeholder="State the basis for this final decision."></textarea></label>'+
     '<div class="ms-actions"><button type="button" data-ms-action="approve" class="primary-button">Approve under school policy</button>'+
     '<button type="button" data-ms-action="admin-reject" class="outline-button">Reject</button></div></div>';
   }
   return html+'</article>';
  }
  async function load(){
   dialog.querySelectorAll('[data-ms-tab]').forEach(b=>b.classList.toggle('active',b.dataset.msTab===tab));
   content.textContent='Loading missing-scan records…';policyArea.hidden=true;
   const [result,settings]=await Promise.all([api('/requests?view='+tab),api('/policy')]);
   mode=settings.mode||'DOCUMENT_EXCEPTION';
   if(isAdmin&&tab==='inbox'){
    policyArea.hidden=false;
    policyArea.innerHTML='<label><strong>School DTR policy</strong> (confirm applicable SDO procedure)'+
     '<select id="msPolicySelect"><option value="DOCUMENT_EXCEPTION">Documented exception · keep missing slot blank</option>'+
     '<option value="DTR_CORRECTION">Authorized DTR correction · verified logbook time</option></select></label>'+
     '<button type="button" class="outline-button" id="msSavePolicy">Save policy</button>'+
     '<p>Policy changes affect future decisions only. Original QR scans remain unchanged.</p>';
    $('msPolicySelect').value=mode;
    $('msSavePolicy').addEventListener('click',async()=>{
     const next=$('msPolicySelect').value;
     if(next==='DTR_CORRECTION'&&!confirm('Confirm that your SDO permits approved logbook-based Form 48 time corrections. This will never manufacture a QR scan.'))return;
     try{const saved=await api('/policy',{method:'POST',data:{mode:next}});mode=saved.mode;messageSet('School correction policy saved.');await load();}
     catch(e){messageSet(e.message,true);}
    });
   }
   const rows=result.requests||[];
   content.innerHTML=(tab==='mine'?renderForm():'')+
    '<section class="ms-records"><h3>'+esc(tab==='mine'?'My requests':'Review queue & history')+'</h3>'+
    (!rows.length?'<p class="ms-muted">No missing-scan requests in this view.</p>':rows.map(renderRow).join(''))+'</section>';
   const form=$('msCreateForm');
   if(form){
    form.elements.date.value=today();
    const slotSelect=form.elements.slot;
    const slotStatus=form.querySelector('.ms-slot-status');
    const submit=form.querySelector('[type=submit]');
    let checkRevision=0;
    async function refreshVerifiedSlots(){
     const revision=++checkRevision,date=form.elements.date.value;
     slotSelect.disabled=true;
     submit.disabled=true;
     slotSelect.innerHTML='<option value="">Checking verified DTR…</option>';
     slotStatus.textContent='Checking verified Form 48 entries for '+(fmt(date)||'the selected date')+'…';
     if(!date||date>today()){
      slotStatus.textContent='Choose a current or earlier attendance date.';
      return;
     }
     try{
      // Reuse the read-only, identity-scoped DTR endpoint. Never infer punches from gate movement.
      const response=await fetch('/api/staff-attendance/my/dtr?date='+encodeURIComponent(date),
       {credentials:'same-origin',cache:'no-store'});
      if(!response.ok)throw Error('Verified DTR unavailable. Change the date to retry.');
      const daily=await response.json();
      if(revision!==checkRevision||!form.isConnected)return;
      if(daily.schoolDate!==date||!Array.isArray(daily.slots))
       throw Error('Verified DTR response was incomplete. Please retry.');
      const names={AM_IN:'AM Time-In',AM_OUT:'AM Time-Out',PM_IN:'PM Time-In',PM_OUT:'PM Time-Out'};
      const order=['AM_IN','AM_OUT','PM_IN','PM_OUT'];
      const slotData=new Map(daily.slots.filter(item=>order.includes(item.slot)).map(item=>[item.slot,item]));
      const verified=new Set(order.filter(slot=>slotData.get(slot)?.status==='VERIFIED'));
      // Pending and completed requests must not be offered for a second filing.
      const blocked=new Set(rows.filter(r=>r.date===date &&
       !['HEAD_REJECTED','ADMIN_REJECTED'].includes(r.status)).map(r=>r.slot));
      const available=order.filter(slot=>!verified.has(slot)&&!blocked.has(slot));
      slotSelect.innerHTML='<option value="">Choose missing DTR entry</option>'+
       order.map(slot=>{
        const state=verified.has(slot)?' · Recorded':blocked.has(slot)?' · Request already filed':' · Not recorded';
        return '<option value="'+slot+'"'+(available.includes(slot)?'':' disabled')+'>'+
         names[slot]+state+'</option>';
       }).join('');
      const recorded=order.filter(slot=>verified.has(slot)).map(slot=>names[slot]);
      const pending=order.filter(slot=>blocked.has(slot)).map(slot=>names[slot]);
      slotStatus.textContent=(recorded.length?'Verified: '+recorded.join(', ')+'. ':'No verified DTR entries on this date. ')+
       (pending.length?'Already requested: '+pending.join(', ')+'. ':'')+
       (available.length?'Not recorded does not automatically mean a missed scan. ':'No unrecorded slots available for a new request. ');
      if(date===today())slotStatus.textContent+='Today’s later time-out may not be due yet. ';
      let suggestion='';
      if(available.includes('AM_OUT')&&verified.has('AM_IN')&&verified.has('PM_IN'))suggestion='AM_OUT';
      else if(available.includes('PM_OUT')&&verified.has('PM_IN'))suggestion='PM_OUT';
      else if(available.includes('PM_IN')&&verified.has('AM_OUT'))suggestion='PM_IN';
      else if(available.length===1&&verified.size)suggestion=available[0];
      slotSelect.value=suggestion;
      slotSelect.disabled=!available.length;
      submit.disabled=!available.length;
      if(suggestion)slotStatus.textContent+='Suggested: '+names[suggestion]+'. Confirm the correct slot before submitting.';
      else if(available.length)slotStatus.textContent+='Select the specific slot supported by your records.';
     }catch(error){
      if(revision!==checkRevision||!form.isConnected)return;
      slotStatus.textContent=error.message||'Unable to check verified DTR. Please retry.';
     }
    }
    form.elements.date.addEventListener('change',refreshVerifiedSlots);
    refreshVerifiedSlots();
    form.addEventListener('submit',async e=>{
     e.preventDefault();if(busy)return;
     const v=new FormData(form),data=Object.fromEntries(v.entries());
     busy=true;form.querySelector('[type=submit]').disabled=true;
     try{await api('/requests',{method:'POST',data});messageSet('Request sent to Department Head. Your DTR has not been edited.');await load();}
     catch(err){messageSet(err.message,true);}
     finally{busy=false;}
    });
   }
  }
  content.addEventListener('submit',async e=>{
   const form=e.target.closest('[data-ms-form="resubmit"]');
   if(!form)return;
   e.preventDefault();if(busy)return;busy=true;
   const row=form.closest('.ms-row');
   try{
    await api('/requests/'+encodeURIComponent(row.dataset.msId)+'/resubmit',{method:'POST',data:Object.fromEntries(new FormData(form).entries())});
    messageSet('Clarification resubmitted to the Department Head.');await load();
   }catch(error){messageSet(error.message,true);}finally{busy=false;}
  });
  content.addEventListener('click',async event=>{
   const button=event.target.closest('button[data-ms-action]');
   if(!button||busy)return;
   const row=button.closest('.ms-row'),id=row?.dataset.msId,action=button.dataset.msAction;
   if(!id)return;
   busy=true;button.disabled=true;
   try{
    if(action==='evidence'){
     const r=await fetch('/api/missing-scans/requests/'+encodeURIComponent(id)+'/evidence',{credentials:'same-origin',cache:'no-store'});
     if(!r.ok){const j=await r.json().catch(()=>({}));throw Error(j.error||'Cannot open evidence.');}
     const blob=await r.blob(),url=URL.createObjectURL(blob),anchor=document.createElement('a');
     anchor.href=url;anchor.download='department-logbook.'+(blob.type==='application/pdf'?'pdf':blob.type==='image/png'?'png':'jpg');
     document.body.append(anchor);anchor.click();anchor.remove();
     setTimeout(()=>URL.revokeObjectURL(url),60000);return;
    }
    if(action==='upload'){
     const file=row.querySelector('[data-ms-file]')?.files?.[0];
     if(!file)throw Error('Choose a cropped JPG, PNG or PDF logbook excerpt.');
     if(!['image/jpeg','image/png','application/pdf'].includes(file.type)||file.size>3*1024*1024)
      throw Error('Choose a JPG, PNG or PDF no larger than 3 MB.');
     await api('/requests/'+encodeURIComponent(id)+'/evidence',{method:'POST',file});
     messageSet('Evidence uploaded and saved privately. Complete Department Head verification.');await load();return;
    }
    const comment=row.querySelector('textarea[name=comment]')?.value?.trim()||'';
    if(comment.length<10)throw Error('Please provide a meaningful reviewer comment (at least 10 characters).');
    if(['verify','more','reject'].includes(action)){
     const request={
      decision:action==='verify'?'VERIFY':action==='more'?'MORE_EVIDENCE':'REJECT',
      comment,
      verifiedTime:row.querySelector('[name=verifiedTime]')?.value||'',
      reference:row.querySelector('[name=reference]')?.value?.trim()||''
     };
     if(action==='verify'&&!confirm('Verify this exact logbook time and forward the documented request for School Admin review?'))return;
     await api('/requests/'+encodeURIComponent(id)+'/head-decision',{method:'POST',data:request});
     messageSet('Department Head decision recorded with audit history.');
    }else if(['approve','admin-reject'].includes(action)){
     if(action==='approve'&&!confirm(mode==='DTR_CORRECTION'?
      'Approve the verified logbook time as an official DTR correction? Original scan history will remain unchanged.':
      'Approve the documentation while preserving a blank official DTR time?'))return;
     await api('/requests/'+encodeURIComponent(id)+'/admin-decision',{
      method:'POST',data:{decision:action==='approve'?'APPROVE':'REJECT',comment}});
     messageSet('School Admin decision saved. See the official DTR for any authorized correction.');
    }
    await load();
   }catch(error){messageSet(error.message,true);}finally{busy=false;button.disabled=false;}
  });
 }
 window.attendigoStaffIdentity?.then(init).catch(()=>{});
})();
