'use strict';
(() => {
 const $=id=>document.getElementById(id);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const date=s=>s?new Date(s).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}):'—';
 const call=async(path,method='GET',body)=>{
  const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',
   headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  const json=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(json.error||('Request failed ('+response.status+')'));
  return json;
 };
 const api='/api/staff-attendance/official-business';
 async function init(user){
  if(!['TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN'].includes(user?.role))return;
  const personalAdmin=user.role==='SCHOOL_ADMIN';
  const dash=$(personalAdmin?'myGateAttendanceView':'officialBusinessView');if(!dash)return;
  const root=document.createElement('section');
  root.className='staff-lunch-panel staff-ob-panel';
  root.setAttribute('aria-label','Official Business requests');
  root.innerHTML=`<div class="section-toolbar"><div><h3>${personalAdmin?'My Official Business requests':'Official Business requests'}</h3>
    <p>Department Heads recommend teacher requests; the Principal authorizes official business after signing the physical Locator Slip. Approved requests retain existing DTR and class coverage rules.</p></div>
    <button type="button" class="outline-button" id="obRefresh">Refresh</button></div>
    <div id="obScopeTabs" class="coverage-tabs" role="tablist" aria-label="Official Business request scope" hidden>
      <button type="button" class="coverage-tab" id="obMineTab" role="tab" aria-selected="false" aria-controls="obList">My OB Requests</button>
      <button type="button" class="coverage-tab is-active" id="obDepartmentTab" role="tab" aria-selected="true" aria-controls="obList">Department OB Requests</button>
    </div>
    <details id="obNew"><summary>Submit My Official Business request</summary>
      <form id="obForm" class="staff-ob-form">
       <label>Purpose<textarea name="purpose" maxlength="1000" required minlength="3" rows="2"></textarea></label>
       <label>Destination<input name="destination" maxlength="300" required minlength="2"></label>
       <label>Start (Philippine time)<input name="startsAt" type="datetime-local" required></label>
       <label>End (Philippine time)<input name="endsAt" type="datetime-local" required></label>
       <button class="primary-button" type="submit">Submit OB request</button>
      </form>
    </details>
    <p id="obStatus" role="status" aria-live="polite" class="staff-lunch-status">Loading requests…</p>
    <div class="staff-ob-list" id="obList"></div>`;
  dash.append(root);
  const status=$('obStatus'),list=$('obList');
  const say=(s,error=false)=>{status.textContent=s;status.classList.toggle('is-error',error);};
  let busy=false;
  let refreshSequence=0;
  let selectedScope=user.role==='DEPARTMENT_HEAD'?'department':personalAdmin?'mine':null;
  const scopeTabs=$('obScopeTabs');
  if(scopeTabs)scopeTabs.hidden=user.role!=='DEPARTMENT_HEAD';
  const setScope=scope=>{
   if(busy)return;
   selectedScope=scope;
   for(const [id,active] of [['obMineTab',scope==='mine'],['obDepartmentTab',scope==='department']]){
    const tab=$(id);if(!tab)continue;
    tab.classList.toggle('is-active',active);tab.setAttribute('aria-selected',String(active));
   }
   refresh().catch(()=>{});
  };
  $('obMineTab')?.addEventListener('click',()=>setScope('mine'));
  $('obDepartmentTab')?.addEventListener('click',()=>setScope('department'));
  // Department Heads keep personal OB under My Attendance while the review
  // shortcut opens the EXISTING department-scoped view (no new authority).
  if(user.role==='DEPARTMENT_HEAD'){
   const approvals=document.querySelector('[data-submenu="operations"]');
   if(approvals&&!$('obDepartmentReviewNav')){
    const review=document.createElement('button');
    review.id='obDepartmentReviewNav';
    review.type='button';
    review.className='nav-item';
    review.title='Open department Official Business reviews';
    review.innerHTML='<span class="nav-icon" aria-hidden="true">✓</span><span class="nav-label">OB Reviews</span>';
    review.addEventListener('click',()=>{
     $('officialBusinessNav')?.click();
     setScope('department');
    });
    approvals.append(review);
    approvals.closest('.nav-group')?.removeAttribute('hidden');
   }
  }
  async function refresh(){
   if(busy)return;
   const sequence=++refreshSequence;
   say('Loading Official Business requests…');
   try{
    const scopeQuery=selectedScope?'?scope='+encodeURIComponent(selectedScope):'';
    const result=await call(api+scopeQuery);
    if(sequence!==refreshSequence)return;
    list.replaceChildren();
    const requests=result.requests||[];
    if(!requests.length){say('No Official Business requests to display.');return;}
    say(requests.length+' request(s) in '+(selectedScope==='mine'?'your personal OB history':selectedScope==='department'?'your department queue':'your authorized view')+'.');
    requests.forEach(ob=>{
     const item=document.createElement('article');item.className='staff-ob-item';
     const statusLabel=ob.status==='PENDING_ADMIN'||(ob.status==='PENDING_HEAD'&&ob.staffRole==='DEPARTMENT_HEAD')?'Awaiting Principal authorization':ob.status==='PENDING_HEAD'?'Awaiting Department Head recommendation':String(ob.status||'').replaceAll('_',' ');
     item.innerHTML=`<div class="section-toolbar"><div>
       <strong>${esc(ob.staffName||'Staff')} · ${esc(statusLabel)}</strong>
       <p>${esc(ob.purpose)} · ${esc(ob.destination)}</p>
       <p>${esc(date(ob.startsAt))} – ${esc(date(ob.endsAt))}</p>
       ${ob.decisionNote?`<p>Decision note: ${esc(ob.decisionNote)}</p>`:''}
      </div><div class="staff-lunch-controls" data-actions></div></div>
      <div class="staff-ob-coverage" hidden></div>`;
     const actions=item.querySelector('[data-actions]');
     function action(label,handler){
      const b=document.createElement('button');b.type='button';b.className='outline-button';
      b.textContent=label;b.addEventListener('click',handler);actions.append(b);
     }
     async function decide(kind,decision){
      if(busy)return;
      if(!window.AppDialog){say('The review dialog could not load. Refresh Attendigo before recording a decision.',true);return;}
      busy=true;
      const controls=[...actions.querySelectorAll('button')];
      controls.forEach(button=>button.disabled=true);
      const label=decision==='RECOMMEND'?'Recommend':decision==='APPROVE'?'Approve':'Reject';
      let saved=false;
      try{
       const note=await window.AppDialog.prompt(label+' this Official Business request for '+(ob.staffName||'this staff member')+'? Add an optional decision note (maximum 1000 characters).','',{
        title:label+' Official Business request',label:'Decision note (optional)',inputType:'textarea',maxLength:1000,
        validate:value=>value.length<=1000||'Use no more than 1000 characters.',confirmText:label,variant:decision==='REJECT'?'danger':undefined
       });
       if(note===null)return;
       say('Saving decision…');
       await call(api+'/'+encodeURIComponent(ob.requestId)+'/'+kind,'POST',{decision,note});
       saved=true;say('Decision recorded.');document.dispatchEvent(new Event('attendigo:requests-changed'));
      }catch(e){say(e.message,true);}
      finally{busy=false;controls.forEach(button=>button.disabled=false);}
      if(saved)await refresh();
     }
     if(user.role==='DEPARTMENT_HEAD'&&ob.status==='PENDING_HEAD'&&ob.staffUserId!==user.userId&&['TEACHER','SCHOOL_ADMIN'].includes(ob.staffRole)){
      action('Recommend',()=>decide('recommend','RECOMMEND'));
      action('Reject',()=>decide('recommend','REJECT'));
     }
     if(personalAdmin&&(ob.status==='PENDING_ADMIN'||(ob.status==='PENDING_HEAD'&&ob.staffRole==='DEPARTMENT_HEAD'))){
      actions.append(document.createTextNode('Awaiting Principal authorization'));
     }
     if(ob.staffUserId===user.userId&&(ob.status==='PENDING_ADMIN'||ob.status==='APPROVED'||(ob.status==='PENDING_HEAD'&&ob.staffRole==='DEPARTMENT_HEAD'))){
      const link=document.createElement('a');link.className='outline-button';link.textContent='Print / download Locator Slip';
      link.href=api+'/'+encodeURIComponent(ob.requestId)+'/locator-slip';link.target='_blank';link.rel='noopener noreferrer';actions.append(link);
      actions.append(document.createTextNode('Attach supporting documents and secure handwritten signatures.'));
     }
     if(ob.status==='APPROVED'){
      action('Affected classes',async()=>{
       const target=item.querySelector('.staff-ob-coverage');
       if(!target.hidden){target.hidden=true;return;}
       target.hidden=false;target.textContent='Loading affected classes…';
       try{
        const data=await call(api+'/'+encodeURIComponent(ob.requestId)+'/coverage');
        target.replaceChildren();
        if(!data.coverage?.length){target.textContent='No scheduled classes affected.';return;}
        data.coverage.forEach(coverage=>{
         const line=document.createElement('div');line.className='staff-ob-coverage-row';
         line.innerHTML=`<span>${esc(coverage.classDate)} · ${esc(coverage.gradeLevel)} ${esc(coverage.section)} ·
           ${esc(coverage.periodName||'Class')} (${esc(coverage.startTime)}–${esc(coverage.endTime)}) ·
           ${esc(coverage.status)} ${esc(coverage.substituteName||'')}</span>`;
         if(user.role==='DEPARTMENT_HEAD'&&coverage.status==='NEEDS_COVERAGE'){
          const button=document.createElement('button');button.type='button';button.className='outline-button';
          button.textContent='Assign substitute';
          button.addEventListener('click',async()=>{
           const basePath=api+'/'+encodeURIComponent(ob.requestId)+'/coverage/'+encodeURIComponent(coverage.coverageId);
           button.disabled=true;
           try{
            const data=await call(basePath+'/substitutes');
            const candidates=Array.isArray(data.substitutes)?data.substitutes:[];
            if(!candidates.length){say('No active department teachers available for selection.',true);return;}
            line.querySelector('.staff-ob-picker')?.remove();
            const picker=document.createElement('div');picker.className='staff-ob-picker';
            const select=document.createElement('select');select.setAttribute('aria-label','Select substitute teacher');
            const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Select a department teacher';select.append(placeholder);
            candidates.forEach(person=>{
             const option=document.createElement('option');option.value=person.userId;option.textContent=person.displayName||'Teacher';
             select.append(option);
            });
            const confirm=document.createElement('button');confirm.type='button';confirm.className='primary-button';
            confirm.textContent='Confirm substitute';confirm.disabled=true;
            select.addEventListener('change',()=>{confirm.disabled=!select.value;});
            confirm.addEventListener('click',async()=>{
             if(!select.value)return;
             confirm.disabled=true;select.disabled=true;
             try{
              await call(basePath+'/substitute','POST',{substituteUserId:select.value});
              say('Substitute assigned and audited.');document.dispatchEvent(new Event('attendigo:requests-changed'));target.hidden=true;target.replaceChildren();
             }catch(e){say(e.message,true);confirm.disabled=false;select.disabled=false;}
            });
            picker.append(select,confirm);line.append(picker);
           }catch(e){say(e.message,true);}finally{button.disabled=false;}
          });
          line.append(button);
         }
         target.append(line);
        });
       }catch(e){target.textContent=e.message;}
      });
     }
     list.append(item);
    });
   }catch(e){if(sequence===refreshSequence)say(e.message,true);}
  }
  // Refresh the OB list when users navigate to this standalone view.
  dash.addEventListener('official-business:open',()=>refresh().catch(()=>{}));
  $('obRefresh').addEventListener('click',refresh);
  $('obForm').addEventListener('submit',async(event)=>{
   event.preventDefault();
   const form=event.currentTarget;
   if(!form.reportValidity())return;
   const values=new FormData(form);
   const toManilaIso=s=>{const value=new Date(s+':00+08:00');if(!Number.isFinite(value.getTime()))throw Error('Invalid date');return value.toISOString();};
   let body;
   try{body={purpose:String(values.get('purpose')).trim(),destination:String(values.get('destination')).trim(),
    startsAt:toManilaIso(String(values.get('startsAt'))),endsAt:toManilaIso(String(values.get('endsAt')))};}
   catch{say('Enter valid Philippine dates and times.',true);return;}
   busy=true;say('Submitting OB request…');
   try{await call(api,'POST',body);document.dispatchEvent(new Event('attendigo:requests-changed'));form.reset();$('obNew').open=false;busy=false;if(user.role==='DEPARTMENT_HEAD'){selectedScope='mine';for(const [id,active] of [['obMineTab',true],['obDepartmentTab',false]]){$(id)?.classList.toggle('is-active',active);$(id)?.setAttribute('aria-selected',String(active));}}await refresh();}
   catch(e){busy=false;say(e.message,true);}
  });
  await refresh();
 }
 window.attendigoStaffIdentity?.then(init).catch(()=>{});
})();
