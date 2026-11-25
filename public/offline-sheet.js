(() => {
'use strict';
const $ = id => document.getElementById(id);
const guard=window.AttendigoOfflineAccount;
const requireTeacher=()=>{if(!guard)throw Error('Offline security check unavailable. Reconnect to update Attendigo.');return guard.requireRole('TEACHER');};
const DB = 'attendigo-encrypted-offline-sheets-v1', STORE = 'sheets';
const encoder = new TextEncoder(), decoder = new TextDecoder();
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const dateToday = () => {const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));return parts.year+'-'+parts.month+'-'+parts.day;};
const message = (s, error=false) => { $('message').textContent=s; $('message').className=error?'error':'success'; };
const openDB = () => new Promise((resolve,reject) => { const r=indexedDB.open(DB,1); r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error); });
async function query(mode, action) { const db=await openDB();try { return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE);const req=action(store);tx.oncomplete=()=>resolve(req.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Offline storage aborted'));}); }finally{db.close();} }
const all = async () => {const db=await openDB();try{return await new Promise((resolve,reject)=>{const r=db.transaction(STORE,'readonly').objectStore(STORE).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});}finally{db.close();}};
const get = id => query('readonly',store=>store.get(id));
const put = doc => query('readwrite',store=>store.put(doc));
const add = doc => query('readwrite',store=>store.add(doc));
async function derive(pass,salt) {const key=await crypto.subtle.importKey('raw',encoder.encode(pass),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},key,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
async function encrypt(data,pass,salt) {const iv=crypto.getRandomValues(new Uint8Array(12));const key=await derive(pass,bytes(salt));const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encoder.encode(JSON.stringify(data)));return {iv:b64(iv),ciphertext:b64(new Uint8Array(ct))};}
async function decrypt(doc,pass) {const key=await derive(pass,bytes(doc.salt));const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(doc.iv)},key,bytes(doc.ciphertext));return JSON.parse(decoder.decode(plain));}
async function api(path,opts={}) {const response=await fetch(path,{...opts,credentials:'same-origin',cache:'no-store',headers:{...(opts.body?{'Content-Type':'application/json'}:{}),...(verifiedTeacher?{'X-Attendigo-Queue-Owner':String(verifiedTeacher.schoolId)+':'+String(verifiedTeacher.userId)}:{})}});if(!response.ok)throw Error((await response.json().catch(()=>({}))).error||'Server returned '+response.status);return response.json();}
let unlocked=null, passphrase='', data=null, available=[], roster=[], verifiedTeacher=null, loading=false, preparing=false, savedCount=0, writing=false, dirty=false;
async function verifyOnlineTeacher(){const response=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});if([401,403,428].includes(response.status)){guard?.clear();throw Error('Your online session expired. Sign in again.');}if(!response.ok)throw Error('Could not verify online session.');const payload=await response.json();const u=payload.user;if(u?.role!=='TEACHER'||u.mustChangePassword){guard?.record(u,payload.expiresAt);throw Error('A verified teacher account is required.');}guard.record(u,payload.expiresAt);if(!guard.matches('TEACHER',u.schoolId,u.userId))throw Error('Teacher account mismatch.');return u;}
const idFor=(u,p)=>String(u.schoolId)+':'+String(u.userId)+':'+String(p.periodId);
async function refresh(){const a=requireTeacher();const docs=(await all()).filter(doc=>String(doc.id).startsWith(a.schoolId+':'+a.accountId+':'));if(!guard.matches('TEACHER',a.schoolId,a.accountId))throw Error('Offline account changed.');savedCount=docs.length;$('savedClassCount').textContent=docs.length+' class'+(docs.length===1?'':'es')+' ready offline';$('unlockFields').hidden=!docs.length;const select=$('unlockClass');const previous=select.value;select.replaceChildren();for(const doc of docs){const option=document.createElement('option');option.value=doc.id;option.textContent=doc.label;select.append(option);} if(docs.some(doc=>doc.id===previous))select.value=previous;$('unlock').hidden=false; $('emptySaved').hidden=!!docs.length; $('open').disabled=!docs.length;$('unlockClass').disabled=!docs.length;$('unlockPass').disabled=!docs.length;}
function checkClass(){if(!unlocked||!data||!guard.matches('TEACHER',data.schoolId,data.userId))throw Error('Offline account changed. Reopen your class.');}
function marksFor(date){return Object.entries(data.marks?.[date]||{}).filter(([id,m])=>m&&m.status&&data.synced?.[date]?.[id]!==m.status).map(([studentId,m])=>({studentId,status:m.status,note:'',expectedRevision:Number(data.revisions?.[date]?.[studentId]||0)}));}
function render(){
 if(!guard?.matches('TEACHER',data?.schoolId,data?.userId))return;
 const date=$('date').value, pending=Boolean(data.outbox?.[date]);
 $('className').textContent=unlocked.label;$('rows').replaceChildren();
 for(const student of data.students){
  const row=document.createElement('div');row.className='row';
  const name=document.createElement('span');name.textContent=student.fullName;
  const select=document.createElement('select');select.setAttribute('aria-label','Attendance for '+student.fullName);
  for(const [value,label] of [['','Unmarked'],['PRESENT','Present'],['LATE','Late'],['ABSENT','Absent'],['EXCUSED','Excused']]){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);}
  select.value=data.marks?.[date]?.[student.studentId]?.status||'';select.disabled=pending||writing;
  select.addEventListener('change',()=>{if(writing||data.outbox?.[date]||!guard?.matches('TEACHER',data?.schoolId,data?.userId))return;data.marks[date] ||= {};if(select.value)data.marks[date][student.studentId]={status:select.value};else delete data.marks[date][student.studentId];dirty=true;$('status').textContent='Unsaved changes — tap Save attendance';});
  row.append(name,select);$('rows').append(row);
 }
 const count=Object.keys(data.marks?.[date]||{}).length;
 $('status').textContent=dirty?'Unsaved changes — tap Save attendance':pending?(data.outbox[date].queued?count+' marked · waiting for school confirmation.':count+' marked · saved locally; queue handoff incomplete. Tap Sync attendance.'):marksFor(date).length?count+' marked · saved locally, awaiting queue handoff':count?count+' marked · no unsent changes for this date':'No attendance marked for this date.';
}
async function persist(){checkClass();const original=unlocked,payload=data;const encrypted=await encrypt(payload,passphrase,original.salt);if(unlocked!==original||data!==payload||!guard.matches('TEACHER',payload.schoolId,payload.userId))throw Error('Offline account changed.');const next={...original,...encrypted,updatedAt:Date.now()};await put(next);checkClass();if(data!==payload)throw Error('Class changed.');unlocked=next;}
async function handoff(){
 checkClass();const queue=window.AttendigoOffline;if(!queue?.enqueueOperation)throw Error('Attendance saved on device. Reopen this class after updating Attendigo to queue it.');
 const original=data;data.outbox ||= {};
 for(const date of Object.keys(data.marks||{})){
  checkClass();if(data!==original)throw Error('Class changed.');
  let batch=data.outbox[date];const marks=marksFor(date);
  if(!batch&&marks.length){batch={id:crypto.randomUUID(),marks,queued:false};data.outbox[date]=batch;await persist();}
  if(!batch)continue;
  const outstanding=(await queue.pending()).find(r=>r.id===batch.id);
  checkClass();
  if(outstanding){if(!batch.queued){batch.queued=true;await persist();}continue;}
  // A previously handed-off operation may have synced from the dashboard.
  // Do not blindly replay it offline; reconcile it with the school first.
  if(batch.queued)continue;
  const result=await queue.enqueueOperation({type:'MANUAL_MARKS',operationId:batch.id,payload:{periodId:data.periodId,date,marks:batch.marks}});
  checkClass();batch.id=result.operationId;batch.queued=true;await persist();
 }
}
async function reconcile(){
 checkClass();if(!navigator.onLine)return;
 const u=await verifyOnlineTeacher();checkClass();
 if(u.schoolId!==data.schoolId||u.userId!==data.userId)throw Error('Reconnect and sign in as the same teacher before syncing.');
 verifiedTeacher=u;
 const queue=window.AttendigoOffline;
 if(!queue?.pending)throw Error('Attendance queue unavailable.');
 for(const [date,batch] of Object.entries(data.outbox||{})){
  checkClass();
  if((await queue.pending()).some(r=>r.id===batch.id))continue;
  const verified=await api('/api/manual-attendance?'+new URLSearchParams({periodId:data.periodId,date}));
  checkClass();
  const byId=Object.fromEntries((verified.marks||[]).map(m=>[m.studentId,m]));
  if(batch.marks.every(m=>byId[m.studentId]?.status===m.status&&(byId[m.studentId]?.note||'')===(m.note||''))){
   data.synced ||= {};data.synced[date] ||= {};data.revisions ||= {};data.revisions[date] ||= {};
   for(const m of batch.marks){data.synced[date][m.studentId]=m.status;data.revisions[date][m.studentId]=Number(byId[m.studentId]?.revision||0);}
   delete data.outbox[date];await persist();
  }else{
   // Retain the original expected revisions. The server must reject conflicts.
   batch.queued=false;await persist();
  }
 }
}
async function withSheetWork(fn){
 if(writing)return;
 checkClass();writing=true;for(const id of ['open','save','sync','lock','date'])$(id).disabled=true;
 for(const row of $('rows').children){if(row.lastElementChild)row.lastElementChild.disabled=true;}
 try{return await fn();}
 finally{writing=false;if(unlocked&&data&&guard.matches('TEACHER',data.schoolId,data.userId)){for(const id of ['open','save','sync','lock','date'])$(id).disabled=false;render();}}
}
async function save(){return withSheetWork(async()=>{
 await persist();dirty=false;await handoff();
 message('Attendance saved on this device and queued for sync.');
 if(navigator.onLine)await syncNow();
});}
async function syncNow(){
 checkClass();if(!navigator.onLine)return;
 await reconcile();await handoff();
 await window.AttendigoOffline.sync();
 await reconcile();
 const remaining=Object.keys(data.outbox||{}).length;
 message(remaining?'Attendance saved. Some records still need school confirmation.':Object.values(data.synced||{}).some(m=>Object.keys(m).length)?'Attendance confirmed by the school server.':'No unsent attendance.');
}
async function prepare(allClasses=false){
 if(preparing||loading)return;
 if(!navigator.onLine)throw Error('Reconnect to prepare your classes.');
 preparing=true;$('prepare').disabled=true;$('prepareAll').disabled=true;$('reloadClasses').disabled=true;
 try{
  const u=await verifyOnlineTeacher();
  if(!verifiedTeacher||String(u.schoolId)!==String(verifiedTeacher.schoolId)||String(u.userId)!==String(verifiedTeacher.userId))throw Error('Account changed. Reload assigned classes first.');
  const pass=$('preparePass').value;if(pass.length<12)throw Error('Use an offline password with at least 12 characters.');
  // Snapshot only the previously verified teacher's assigned periods. Never
  // prepare another teacher's timetable or replace an existing encrypted sheet.
  const selected=allClasses?available.slice():available.filter(p=>String(p.periodId)===$('prepareClass').value);
  const classes=[...new Map(selected.map(p=>[String(p.periodId),p])).values()];
  const learners=roster.slice();
  if(!classes.length)throw Error('Choose an assigned class.');
  let created=0,existing=0,empty=0;
  for(const p of classes){
   if(!guard.matches('TEACHER',u.schoolId,u.userId))throw Error('Account changed. Previously saved classes remain on this device.');
   const id=idFor(u,p);
   if(await get(id)){existing++;continue;}
   const students=learners.filter(s=>s.active!==false&&String(s.gradeLevel)===String(p.gradeLevel)&&s.section===p.section).map(s=>({studentId:s.studentId,fullName:s.fullName}));
   if(!students.length){empty++;continue;}
   message('Downloading classes… '+(created+existing+empty)+' of '+classes.length);
   const salt=b64(crypto.getRandomValues(new Uint8Array(16)));
   const initial={schoolId:u.schoolId,userId:u.userId,periodId:p.periodId,students,marks:{},synced:{}};
   const encrypted=await encrypt(initial,pass,salt);
   if(!guard.matches('TEACHER',u.schoolId,u.userId))throw Error('Account changed.');
   try{await add({id,label:[p.gradeLevel,p.section,p.subjectName||p.periodName].join(' · '),salt,...encrypted,updatedAt:Date.now()});created++;}
   catch(error){if(error?.name==='ConstraintError'){existing++;continue;}throw error;}
  }
  $('preparePass').value='';
  await refresh();
  message(created+' newly prepared · '+existing+' already downloaded · '+empty+' without learners. '+savedCount+' classes ready offline.',empty>0);if(!empty&&savedCount)$('downloadSettings').open=false;
 }finally{
  preparing=false;$('reloadClasses').disabled=false;
  const ready=Boolean(navigator.onLine&&verifiedTeacher&&available.length&&guard.matches('TEACHER',verifiedTeacher.schoolId,verifiedTeacher.userId));
  $('prepare').disabled=!ready;$('prepareAll').disabled=!ready;
  if(guard.current('TEACHER'))await refresh().catch(()=>{});
 }
}

async function unlock(){const a=await guard?.authorize('TEACHER');if(!a)throw Error('Teacher access is restricted. Reconnect to switch accounts.');const id=$('unlockClass').value;if(!id.startsWith(a.schoolId+':'+a.accountId+':'))throw Error('This saved class belongs to another account.');const doc=await get(id);if(!doc)throw Error('Class not found.');const pass=$('unlockPass').value;if(!pass)throw Error('Enter your offline password.');const payload=await decrypt(doc,pass);if(!payload.students||!payload.periodId||!payload.schoolId||!payload.userId)throw Error('Invalid offline class data.');if(!guard.matches('TEACHER',payload.schoolId,payload.userId))throw Error('This saved class belongs to another account.');unlocked=doc;data=payload;passphrase=pass;dirty=false;$('unlockPass').value='';$('date').value=dateToday();$('sheet').hidden=false;render();message('Class ready. Record attendance and tap Save attendance.');if(Object.keys(data.outbox||{}).length||Object.keys(data.marks||{}).some(date=>marksFor(date).length))await withSheetWork(async()=>{if(navigator.onLine)await syncNow();else await handoff();});}
async function sync(){return withSheetWork(async()=>{await persist();dirty=false;await handoff();if(navigator.onLine)await syncNow();else message('Attendance saved. It will sync when internet returns.');});}
function handle(id,fn){$(id).addEventListener('click',()=>{ $(id).disabled=true;Promise.resolve().then(fn).catch(e=>message(e.name==='OperationError'?'Incorrect offline password, or the saved class could not be opened.':e.message,true)).finally(()=>{$(id).disabled=false;});});}
handle('prepare',()=>prepare(false));$('prepareAll').addEventListener('click',()=>{void prepare(true).catch(e=>message(e.message,true));});handle('open',unlock);handle('save',save);handle('sync',sync);handle('lock',async()=>{if(writing)return;if(dirty)await save();unlocked=null;data=null;passphrase='';dirty=false;$('rows').replaceChildren();$('sheet').hidden=true;message('Class closed.');});
$('date').addEventListener('change',()=>{if(unlocked)render();});
async function loadClasses(){
  if(loading||preparing||writing)return;loading=true;
  $('prepare').disabled=true;$('prepareAll').disabled=true;$('prepareClass').disabled=true;$('reloadClasses').disabled=true;
  $('prepareClass').replaceChildren();available=[];roster=[];verifiedTeacher=null;
  try{
    const account=await guard?.authorize('TEACHER');if(!account){deny();return;}
    $('assignedClassCount').textContent='Loading class list…';await refresh();
    updateConnection();
    if(!navigator.onLine){message(savedCount?'Choose a downloaded class to take attendance.':'Connect to the internet to download your classes.',!savedCount);return;}
    $('downloadSettings').open=!savedCount;
    message('Loading your assigned classes…');
    const u=await verifyOnlineTeacher();
    verifiedTeacher=u;
    const [p,studentsResponse]=await Promise.all([api('/api/periods?weekDate='+encodeURIComponent(dateToday())),api('/api/students')]);
    if(!guard.matches('TEACHER',u.schoolId,u.userId))throw Error('Teacher account changed.');
    if(!Array.isArray(p.periods)||!Array.isArray(studentsResponse.students))throw Error('The school server returned an incomplete class list.');
    available=p.periods.filter(x=>x.periodId&&String(x.assignedTeacherUserId)===String(u.userId));
    roster=studentsResponse.students;verifiedTeacher=u;
    for(const period of available){const option=document.createElement('option');option.value=period.periodId;option.textContent=[period.gradeLevel,period.section,period.subjectName||period.periodName].join(' · ');$('prepareClass').append(option);}
    $('prepareClass').disabled=!available.length;$('prepare').disabled=!available.length;$('prepareAll').disabled=!available.length;$('assignedClassCount').textContent=available.length+' assigned class'+(available.length===1?'':'es');
    message(available.length?(savedCount?'Your downloaded classes are ready.':'Download your classes to get started.'):'No assigned classes found. Ask your Department Head to check your schedule.',!available.length);
  }catch(e){if(navigator.onLine)$('downloadSettings').open=true;message('Could not load teacher classes: '+e.message+'. Tap Refresh class list to try again.',true);}
  finally{loading=false;$('reloadClasses').disabled=false;}
}
$('reloadClasses').addEventListener('click',loadClasses);
window.addEventListener('online',()=>{if(guard.current('TEACHER'))updateConnection();void loadClasses();if(unlocked&&!writing&&!dirty)void withSheetWork(syncNow).catch(e=>message(e.message,true));});
function updateConnection(){const online=navigator.onLine!==false;$('connectionHint').dataset.state=online?'online':'offline';$('connectionHint').textContent=online?'Online · Download or sync classes.':'Offline · Open a downloaded class to take attendance.';$('setup').hidden=!online;}
window.addEventListener('offline',()=>{if(guard.current('TEACHER'))updateConnection();$('prepare').disabled=true;$('prepareAll').disabled=true;$('prepareClass').disabled=true;});
void loadClasses();

function deny(){dirty=false;data=null;passphrase='';unlocked=null;available=[];roster=[];verifiedTeacher=null;$('prepareClass').replaceChildren();$('prepare').disabled=true;$('prepareAll').disabled=true;$('rows').replaceChildren();$('unlockClass').replaceChildren();$('unlockPass').value='';$('preparePass').value='';for(const id of ['unlock','setup','sheet'])$(id).hidden=true;message('Teacher access is restricted to the verified teacher account. Reconnect and sign in to switch accounts.',true);}
guard?.watch(()=>{if(!guard.current('TEACHER')||(data&&!guard.matches('TEACHER',data.schoolId,data.userId)))deny();});
window.addEventListener('pagehide',()=>{dirty=false;data=null;passphrase='';unlocked=null;$('rows').replaceChildren();$('sheet').hidden=true;});
})();