(() => {
'use strict';
const $ = id => document.getElementById(id);
const DB = 'attendigo-encrypted-offline-sheets-v1', STORE = 'sheets';
const encoder = new TextEncoder(), decoder = new TextDecoder();
const token = () => sessionStorage.getItem('schoolAttendance.accessToken');
const user = () => { try { return JSON.parse(sessionStorage.getItem('schoolAttendance.user') || '{}'); } catch { return {}; } };
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const dateToday = () => new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date());
const message = (s, error=false) => { $('message').textContent=s; $('message').className=error?'error':'success'; };
const openDB = () => new Promise((resolve,reject) => { const r=indexedDB.open(DB,1); r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error); });
async function query(mode, action) { const db=await openDB();try { return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE);const req=action(store);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);}); }finally{db.close();} }
const all = async () => {const db=await openDB();try{return await new Promise((resolve,reject)=>{const r=db.transaction(STORE,'readonly').objectStore(STORE).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});}finally{db.close();}};
const get = id => query('readonly',store=>store.get(id));
const put = doc => query('readwrite',store=>store.put(doc));
async function derive(pass,salt) {const key=await crypto.subtle.importKey('raw',encoder.encode(pass),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},key,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
async function encrypt(data,pass,salt) {const iv=crypto.getRandomValues(new Uint8Array(12));const key=await derive(pass,bytes(salt));const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encoder.encode(JSON.stringify(data)));return {iv:b64(iv),ciphertext:b64(new Uint8Array(ct))};}
async function decrypt(doc,pass) {const key=await derive(pass,bytes(doc.salt));const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(doc.iv)},key,bytes(doc.ciphertext));return JSON.parse(decoder.decode(plain));}
async function api(path,opts={}) {const t=token();if(!t)throw Error('Sign in to the teacher dashboard while online first.');const response=await fetch(path,{...opts,cache:'no-store',headers:{Authorization:'Bearer '+t,...(opts.body?{'Content-Type':'application/json'}:{})}});if(!response.ok)throw Error((await response.json().catch(()=>({}))).error||'Server returned '+response.status);return response.json();}
let unlocked=null, passphrase='', data=null, available=[];
const idFor=(u,p)=>String(u.schoolId)+':'+String(u.userId)+':'+String(p.periodId);
async function refresh(){const docs=await all();const select=$('unlockClass');select.replaceChildren();for(const doc of docs){const option=document.createElement('option');option.value=doc.id;option.textContent=doc.label;select.append(option);} $('unlock').hidden=false; $('emptySaved').hidden=!!docs.length; $('open').disabled=!docs.length;}
function render(){ $('className').textContent=unlocked.label; $('rows').replaceChildren();for(const student of data.students){const row=document.createElement('div');row.className='row';const name=document.createElement('span');name.textContent=student.fullName;const select=document.createElement('select');select.setAttribute('aria-label','Attendance for '+student.fullName);for(const [value,label] of [['','Unmarked'],['PRESENT','Present'],['LATE','Late'],['ABSENT','Absent'],['EXCUSED','Excused']]){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);}select.value=data.marks?.[$('date').value]?.[student.studentId]?.status||'';select.addEventListener('change',()=>{const date=$('date').value;data.marks[date] ||= {};if(select.value)data.marks[date][student.studentId]={status:select.value};else delete data.marks[date][student.studentId];$('status').textContent='Unsaved changes — tap Save encrypted marks';});row.append(name,select);$('rows').append(row);}const count=Object.values(data.marks||{}).reduce((sum,day)=>sum+Object.keys(day).length,0);$('status').textContent=count+' marked entries on device · not confirmed by server';}
async function save(){if(!unlocked)return;const encrypted=await encrypt(data,passphrase,unlocked.salt);await put({...unlocked,...encrypted,updatedAt:Date.now()});message('Encrypted attendance saved on this device. Not yet sent to server.');render();}
async function prepare(){const u=user();if(!navigator.onLine||!token()||u.role!=='TEACHER')throw Error('Online teacher sign-in is required to prepare offline classes.');const pass=$('preparePass').value;if(pass.length<12)throw Error('Use a passphrase with at least 12 characters.');const p=available.find(p=>p.periodId===$('prepareClass').value);if(!p)throw Error('Choose an assigned class.');const id=idFor(u,p);if(await get(id))throw Error('This class is already prepared. Unlock it instead; preparation must not overwrite unsent attendance.');const students=(window.__offlineRoster||[]).filter(s=>s.active!==false&&s.gradeLevel===p.gradeLevel&&s.section===p.section).map(s=>({studentId:s.studentId,fullName:s.fullName}));if(!students.length)throw Error('No students found in this class.');const salt=b64(crypto.getRandomValues(new Uint8Array(16)));const initial={schoolId:u.schoolId,userId:u.userId,periodId:p.periodId,students,marks:{},synced:{}};const encrypted=await encrypt(initial,pass,salt);await put({id,label:[p.gradeLevel,p.section,p.subjectName||p.periodName].join(' · '),salt,...encrypted,updatedAt:Date.now()});$('preparePass').value='';await refresh();message('Encrypted class prepared. Open it with your passphrase to record attendance.');}
async function unlock(){const doc=await get($('unlockClass').value);if(!doc)throw Error('Class not found.');const pass=$('unlockPass').value;if(!pass)throw Error('Enter your device passphrase.');const payload=await decrypt(doc,pass);if(!payload.students||!payload.periodId||!payload.schoolId||!payload.userId)throw Error('Invalid offline class data.');unlocked=doc;data=payload;passphrase=pass;$('unlockPass').value='';$('date').value=dateToday();$('sheet').hidden=false;render();message('Class unlocked. Marks stay on this device until synchronized.');}
async function sync(){if(!unlocked||!data)throw Error('Unlock a class first.');const u=user();if(!navigator.onLine||!token()||u.schoolId!==data.schoolId||u.userId!==data.userId||u.role!=='TEACHER')throw Error('Reconnect and sign in as the same teacher before syncing.');await save();let sent=0;for(const [date,marksByStudent] of Object.entries(data.marks)){const marks=Object.entries(marksByStudent).filter(([id,m])=>m&&m.status&&data.synced?.[date]?.[id]!==m.status).map(([studentId,m])=>({studentId,status:m.status,note:''}));if(!marks.length)continue;const result=await api('/api/manual-attendance/sync',{method:'POST',body:JSON.stringify({periodId:data.periodId,date,marks})});if(result.saved!==marks.length)throw Error('Server did not confirm all marks for '+date+'.');const verified=await api('/api/manual-attendance?'+new URLSearchParams({periodId:data.periodId,date}));const byId=Object.fromEntries((verified.marks||[]).map(m=>[m.studentId,m.status]));if(!marks.every(m=>byId[m.studentId]===m.status))throw Error('Server verification failed for '+date+'.');data.synced ||= {};data.synced[date] ||= {};for(const m of marks)data.synced[date][m.studentId]=m.status;await save();sent+=marks.length;}message(sent?sent+' marks confirmed by the school server.':'No unsynchronized changes to send.');render();}
function handle(id,fn){$(id).addEventListener('click',()=>{ $(id).disabled=true;Promise.resolve().then(fn).catch(e=>message(e.name==='OperationError'?'Incorrect passphrase or damaged offline data.':e.message,true)).finally(()=>{$(id).disabled=false;});});}
handle('prepare',prepare);handle('open',unlock);handle('save',save);handle('sync',sync);handle('lock',()=>{unlocked=null;data=null;passphrase='';$('sheet').hidden=true;message('Offline sheet locked.');});
$('date').addEventListener('change',()=>{if(unlocked)render();});
(async()=>{
  await refresh();
  const u=user();
  if (!navigator.onLine) {
    $('prepare').disabled=true;
    message('You are offline. Unlock a previously prepared class below. To prepare a new class, reconnect and sign in as a teacher.',true);
    return;
  }
  if (!token() || u.role!=='TEACHER') {
    $('prepare').disabled=true;
    message('No active teacher session in this browser tab. Open Attendigo teacher dashboard, sign in, then use Manual Attendance → Prepare / open offline attendance. Previously prepared classes can still be unlocked below.',true);
    return;
  }
  try {
    const [p,studentsResponse]=await Promise.all([api('/api/periods'),api('/api/students')]);
    available=(p.periods||[]).filter(x=>x.periodId&&String(x.assignedTeacherUserId)===String(u.userId));
    window.__offlineRoster=studentsResponse.students||[];
    for (const period of available) {
      const option=document.createElement('option');
      option.value=period.periodId;
      option.textContent=[period.gradeLevel,period.section,period.subjectName||period.periodName].join(' · ');
      $('prepareClass').append(option);
    }
    if (!available.length) {
      $('prepare').disabled=true;
      message('No assigned classes found. Ask your school administrator to assign a class schedule to this teacher account.',true);
    } else message('Ready: select an assigned class and set a device passphrase to prepare offline attendance.');
  } catch(e) {
    $('prepare').disabled=true;
    message('Could not load teacher classes: '+e.message+'. Check your connection and sign-in, then reload.',true);
  }
})().catch(e=>message('Offline storage unavailable: '+e.message,true));
window.addEventListener('pagehide',()=>{data=null;passphrase='';unlocked=null;});
})();