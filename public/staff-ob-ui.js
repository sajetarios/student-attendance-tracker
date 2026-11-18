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
  const dash=$('dashboardView');if(!dash)return;
  const root=document.createElement('section');
  root.className='staff-lunch-panel staff-ob-panel';
  root.setAttribute('aria-label','Official Business requests');
  root.innerHTML=`<div class="section-toolbar"><div><h3>Official Business requests</h3>
    <p>Department Heads recommend; School Admin makes the final decision. Approved requests flag affected classes for coverage.</p></div>
    <button type="button" class="outline-button" id="obRefresh">Refresh</button></div>
    <details id="obNew"><summary>Submit Official Business request</summary>
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
  dash.prepend(root);
  const status=$('obStatus'),list=$('obList');
  const say=(s,error=false)=>{status.textContent=s;status.classList.toggle('is-error',error);};
  let busy=false;
  async function refresh(){
   if(busy)return;
   say('Loading Official Business requests…');
   try{
    const result=await call(api);
    list.replaceChildren();
    const requests=result.requests||[];
    if(!requests.length){say('No Official Business requests to display.');return;}
    say(requests.length+' request(s) in your authorized view.');
    requests.forEach(ob=>{
     const item=document.createElement('article');item.className='staff-ob-item';
     const statusLabel=String(ob.status||'').replaceAll('_',' ');
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
      const note=window.prompt('Decision note (optional; maximum 1000 characters):','');
      if(note===null)return;
      busy=true;say('Saving decision…');
      try{
       await call(api+'/'+encodeURIComponent(ob.requestId)+'/'+kind,'POST',{decision,note});
       say('Decision recorded.');busy=false;await refresh();
      }catch(e){busy=false;say(e.message,true);}
     }
     if(user.role==='DEPARTMENT_HEAD'&&ob.status==='PENDING_HEAD'&&ob.staffUserId!==user.userId){
      action('Recommend',()=>decide('recommend','RECOMMEND'));
      action('Reject',()=>decide('recommend','REJECT'));
     }
     if(user.role==='SCHOOL_ADMIN'&&ob.status==='PENDING_ADMIN'&&ob.staffUserId!==user.userId){
      action('Approve',()=>decide('decide','APPROVE'));
      action('Reject',()=>decide('decide','REJECT'));
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
           const substituteUserId=window.prompt('Enter the active teacher user ID from your department:');
           if(!substituteUserId)return;
           button.disabled=true;
           try{
            await call(api+'/'+encodeURIComponent(ob.requestId)+'/coverage/'+
             encodeURIComponent(coverage.coverageId)+'/substitute','POST',{substituteUserId:substituteUserId.trim()});
            say('Substitute assigned and audited.');target.hidden=true;item.querySelector('.staff-ob-coverage').replaceChildren();
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
   }catch(e){say(e.message,true);}
  }
  $('obRefresh').addEventListener('click',refresh);
  $('obForm').addEventListener('submit',async(event)=>{
   event.preventDefault();
   const form=event.currentTarget;
   if(!form.reportValidity())return;
   const values=new FormData(form);
   const toManilaIso=s=>new Date(s+':00+08:00').toISOString();
   let body;
   try{body={purpose:String(values.get('purpose')).trim(),destination:String(values.get('destination')).trim(),
    startsAt:toManilaIso(String(values.get('startsAt'))),endsAt:toManilaIso(String(values.get('endsAt')))};}
   catch{say('Enter valid Philippine dates and times.',true);return;}
   busy=true;say('Submitting OB request…');
   try{await call(api,'POST',body);form.reset();$('obNew').open=false;busy=false;await refresh();}
   catch(e){busy=false;say(e.message,true);}
  });
  await refresh();
 }
 window.attendigoStaffIdentity?.then(init).catch(()=>{});
})();
