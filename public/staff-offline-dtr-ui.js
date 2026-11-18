'use strict';
(() => {
 const roles=['TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN'];
 const slots=['AM_IN','AM_OUT','PM_IN','PM_OUT'];
 const request=async(path,options={})=>{
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,
   headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||('Request failed: '+response.status));
  return data;
 };
 const button=(label,handler)=>{
  const el=document.createElement('button');el.type='button';el.className='outline-button';
  el.textContent=label;el.addEventListener('click',handler);return el;
 };
 const say=(node,message)=>{node.textContent=message;};
 async function init(user){
  if(!roles.includes(user?.role)||!user.userId||!user.schoolId)return;
  const host=document.getElementById('dashboardView');if(!host)return;
  const storageKey='attendigo:staff-offline-dtr:v1:'+user.schoolId+':'+user.userId;
  const read=()=>{try{const data=JSON.parse(localStorage.getItem(storageKey)||'[]');return Array.isArray(data)?data.filter(e=>slots.includes(e.slot)&&e.clientEventKey&&e.capturedAt):[];}catch{return [];}};
  const save=items=>localStorage.setItem(storageKey,JSON.stringify(items));
  const root=document.createElement('section');root.className='staff-lunch-panel staff-offline-dtr-panel';
  root.setAttribute('aria-label','Offline staff DTR verification');
  const title=document.createElement('h3');title.textContent='Staff DTR · Offline verification';
  const explanation=document.createElement('p');
  explanation.textContent='Offline captures are evidence only. They do not count as verified attendance until School Admin reviews them. Use the verified QR or Gatekeeper method when available.';
  const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const select=document.createElement('select');select.setAttribute('aria-label','DTR time slot');
  slots.forEach(slot=>{const opt=document.createElement('option');opt.value=slot;opt.textContent=slot.replace('_',' ');select.append(opt);});
  const list=document.createElement('div');list.className='staff-ob-list';
  const controls=document.createElement('div');controls.className='staff-lunch-controls';
  let busy=false;
  const refreshLocal=()=>say(status,read().length+' capture(s) stored on this device awaiting upload.');
  async function sync(){
   if(busy||!navigator.onLine){refreshLocal();return;}
   busy=true;
   try{
    const pending=read(),remaining=[];
    for(const event of pending){
     try{await request('/api/staff-attendance/my/dtr/offline-sync',{method:'POST',body:JSON.stringify(event)});}
     catch(err){remaining.push(event);say(status,'Some captures still need syncing: '+err.message);}
    }
    save(remaining);
    const remote=await request('/api/staff-attendance/my/dtr/pending');
    say(status,remaining.length+' awaiting upload · '+(remote.pending||[]).length+' awaiting School Admin verification.');
   }catch(err){say(status,'Unable to refresh pending DTR: '+err.message);}
   finally{busy=false;}
  }
  controls.append(select,button('Capture pending DTR',()=>{
   if(busy)return;
   if(!globalThis.crypto?.randomUUID){say(status,'Secure event identifiers are unavailable on this device.');return;}
   const event={clientEventKey:crypto.randomUUID(),slot:select.value,capturedAt:new Date().toISOString()};
   try{const records=read();records.push(event);save(records);refreshLocal();if(navigator.onLine)sync();}
   catch{say(status,'Local storage unavailable. Capture was not saved.');}
  }),button('Sync pending captures',sync));
  root.append(title,explanation,controls,status);
  if(user.role==='SCHOOL_ADMIN'){
   const heading=document.createElement('h4');heading.textContent='Review offline staff captures';
   const reviewStatus=document.createElement('p');reviewStatus.setAttribute('role','status');
   async function refreshReviews(){
    try{
     const result=await request('/api/staff-attendance/offline-review');
     list.replaceChildren();
     if(!result.pending?.length){say(reviewStatus,'No staff captures awaiting review.');return;}
     say(reviewStatus,result.pending.length+' pending capture(s). Check supporting evidence before verifying.');
     result.pending.forEach(item=>{
      const line=document.createElement('div');line.className='staff-ob-item';
      const details=document.createElement('p');
      details.textContent=[item.staffName,item.slot,item.schoolDate,new Date(item.capturedAt).toLocaleString('en-PH',{timeZone:'Asia/Manila'})].join(' · ');
      const note=document.createElement('input');note.placeholder='Evidence/review note (required)';note.maxLength=1000;
      note.setAttribute('aria-label','Review evidence note for '+item.staffName);
      const decide=async decision=>{
       if(note.value.trim().length<3){say(reviewStatus,'Enter a review note of at least 3 characters.');return;}
       try{
        await request('/api/staff-attendance/offline-review/'+encodeURIComponent(item.eventId),
         {method:'POST',body:JSON.stringify({decision,note:note.value.trim()})});
        await refreshReviews();
       }catch(err){say(reviewStatus,err.message);}
      };
      line.append(details,note,button('Verify',()=>decide('VERIFY')),button('Reject',()=>decide('REJECT')));
      list.append(line);
     });
    }catch(err){say(reviewStatus,'Review queue unavailable: '+err.message);}
   }
   root.append(heading,button('Refresh review queue',refreshReviews),reviewStatus,list);
   refreshReviews();
  }
  host.prepend(root);
  window.addEventListener('online',sync);
  refreshLocal();
  if(navigator.onLine)sync();
 }
 window.attendigoStaffIdentity?.then(init).catch(()=>{});
})();
