/* Student-only encrypted device outbox. A queued QR is not proof of presence.
 * No password, PIN, cookie, bearer token or private dashboard data is stored. */
(()=>{'use strict';
 const DB='attendigo-student-class-outbox-v1',MARKER='attendigo.studentQrCapture',MAX=50,encoder=new TextEncoder(),decoder=new TextDecoder();
 let owner=null,syncing=false,prepared=false;
 const scope=u=>u?.role==='STUDENT'&&!u.mustChangePassword&&u.schoolId&&u.studentAccountId?{schoolId:String(u.schoolId),accountId:String(u.studentAccountId)}:null;
 const same=(a,b)=>!!a&&!!b&&a.schoolId===b.schoolId&&a.accountId===b.accountId;
 const ownerId=o=>o.schoolId+':'+o.accountId;
 function open(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>{const db=req.result;const scans=db.createObjectStore('scans',{keyPath:'id'});scans.createIndex('owner','owner');db.createObjectStore('keys',{keyPath:'id'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
 async function tx(name,mode,fn){const db=await open();try{return await new Promise((resolve,reject)=>{const t=db.transaction(name,mode),st=t.objectStore(name);let value;t.oncomplete=()=>resolve(value);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||Error('Storage aborted'));try{const req=fn(st);if(req)req.onsuccess=()=>{value=req.result;};}catch(e){t.abort();reject(e);}});}finally{db.close();}}
 async function key(id){let row=await tx('keys','readonly',st=>st.get(id));if(row)return row.key;
  const candidate=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  try{await tx('keys','readwrite',st=>st.add({id,key:candidate}));return candidate;}
  catch(e){row=await tx('keys','readonly',st=>st.get(id));if(row)return row.key;throw e;}
 }
 const list=o=>tx('scans','readonly',st=>st.index('owner').getAll(ownerId(o)));
 const save=row=>tx('scans','readwrite',st=>st.put(row));
 const remove=id=>tx('scans','readwrite',st=>st.delete(id));
 async function verify(){const res=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});if(res.status===401||res.status===403)return null;if(!res.ok)throw Error('Session verification unavailable');return scope((await res.json()).user);}
 async function enable(user){
  const next=scope(user);if(!next)return false;
  owner=next;prepared=true;try{sessionStorage.setItem(MARKER,JSON.stringify({...next,until:Date.now()+12*60*60*1000}));}catch{}
  void render().catch(()=>{});void sync().catch(()=>{});return true;
 }
 function disable(){owner=null;prepared=false;try{sessionStorage.removeItem(MARKER);}catch{}}
 function restoreCapture(){try{const marker=JSON.parse(sessionStorage.getItem(MARKER)||'null');if(!marker?.schoolId||!marker.accountId||marker.until<Date.now())return false;owner={schoolId:marker.schoolId,accountId:marker.accountId};prepared=true;return true;}catch{return false;}}
 async function enqueue(qr){
  if(!prepared||!owner)throw Error('Open the Student Portal online first.');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(qr.sessionId||'')||!/^[a-f0-9]{64}$/i.test(qr.token||''))throw Error('Invalid QR.');
  const o=owner,id=ownerId(o)+':'+qr.sessionId,rows=await list(o);
  if(rows.length>=MAX&&!rows.some(row=>row.id===id))throw Error('Offline queue is full. Reconnect or ask your teacher.');
  const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(id)},await key(ownerId(o)),encoder.encode(JSON.stringify({sessionId:qr.sessionId,token:qr.token})));
  if(!same(o,owner))throw Error('Student account changed. Scan again.');
  await save({id,owner:ownerId(o),sessionId:qr.sessionId,iv:Array.from(iv),cipher:Array.from(new Uint8Array(cipher)),createdAt:Date.now(),state:'PENDING'});
  await render();return id;
 }
 async function decrypt(row){const saved=await tx('keys','readonly',st=>st.get(row.owner));if(!saved)throw Error('Device key unavailable');const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(row.iv),additionalData:encoder.encode(row.id)},saved.key,new Uint8Array(row.cipher));return JSON.parse(decoder.decode(data));}
 async function render(){
  const status=document.getElementById('studentQrQueueStatus'),items=document.getElementById('studentQrQueueItems');if(!status||!items||!owner)return;
  const o=owner,rows=await list(o);if(!same(o,owner))return;
  const pending=rows.filter(x=>x.state==='PENDING').length,review=rows.length-pending;
  status.textContent=pending+' waiting to sync · '+review+' need teacher review. Pending scans are not official attendance.';
  items.replaceChildren();
  for(const row of rows.filter(x=>x.state==='REVIEW')){
   const item=document.createElement('li');item.textContent=new Date(row.createdAt).toLocaleString()+' (device time) — '+row.reason+' Show your teacher; use the existing manual class register.';
   const dismiss=document.createElement('button');dismiss.type='button';dismiss.textContent='Dismiss after teacher review';dismiss.addEventListener('click',async()=>{if(!same(o,owner))return;await remove(row.id);await render();});item.append(' ',dismiss);items.append(item);
  }
 }
 async function sync(){
  if(syncing||!owner||navigator.onLine===false)return;syncing=true;const o=owner;
  try{
   const verified=await verify();if(!same(o,verified)||!same(o,owner))return;
   for(const row of (await list(o)).sort((a,b)=>a.createdAt-b.createdAt)){
    if(!same(o,owner))break;
    const expectedStudentAccountId=o.accountId,expectedSchoolId=o.schoolId;
    const query=new URLSearchParams({sessionId:row.sessionId,expectedStudentAccountId,expectedSchoolId});
    try{
     // Check server first: an earlier attempt or teacher check-in may have succeeded.
     const status=await fetch('/api/class-qr/check-in/status?'+query,{credentials:'same-origin',cache:'no-store'});
     if(status.status===401||status.status===409||status.status===429||status.status>=500)break;
     const info=await status.json().catch(()=>({}));
     if(status.ok&&info.recorded){await remove(row.id);window.dispatchEvent(new Event('student-class-attendance-recorded'));continue;}
     if(row.state==='REVIEW')continue;
     if(!status.ok){await save({...row,state:'REVIEW',reason:'Class could not be verified by the server.'});continue;}
     let qr;try{qr=await decrypt(row);}catch{await save({...row,state:'REVIEW',reason:'Saved QR could not be read.'});continue;}
     const response=await fetch('/api/class-qr/check-in',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({...qr,expectedStudentAccountId,expectedSchoolId})});
     const data=await response.json().catch(()=>({}));
     if((response.ok&&data.ok===true)||data.alreadyRecorded){await remove(row.id);window.dispatchEvent(new Event('student-class-attendance-recorded'));continue;}
     if(response.status===401||response.status===429||response.status>=500||response.status===409)break;
     if(response.status>=400&&response.status<500)await save({...row,state:'REVIEW',reason:response.status===410?'QR expired or class closed before synchronization.':'Server could not accept this scan.'});
     else break;
    }catch{break;}
   }
  }catch{}finally{syncing=false;await render().catch(()=>{});}
 }
 window.addEventListener('online',()=>{void sync();});
 window.addEventListener('pageshow',()=>{void sync();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void sync();});
 document.getElementById('studentQrSync')?.addEventListener('click',()=>{void sync();});
 window.StudentQrOffline={enable,disable,restoreCapture,enqueue,sync,render,ready:()=>prepared};
})();