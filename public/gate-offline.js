/* Encrypted, capture-only Gatekeeper device outbox. No attendance or DTR confirmation. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const DB='attendigo-gatekeeper-capture-v1',STORE='prepared';
const KEY='gatekeeper-device';
const encoder=new TextEncoder(),decoder=new TextDecoder();
const QR=/^(JHS|TCH):([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
let data=null,secretKey=null,salt=null,scanner=null,active=false,syncing=false,lastScan='',lastScanAt=0;
let writes=Promise.resolve();
const notice=(id,value,error=false)=>{
 const el=$(id);el.textContent=value;
 if(id==='scanResult'||id==='network')el.className='status'+(error?' error':'');
};
const online=()=>navigator.onLine;
const b64=bytes=>btoa(Array.from(bytes,x=>String.fromCharCode(x)).join(''));
const un64=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
function openDb(){return new Promise((resolve,reject)=>{
 const request=indexedDB.open(DB,1);
 request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'id'});
 request.onsuccess=()=>resolve(request.result);
 request.onerror=()=>reject(request.error||Error('Device storage unavailable'));
});}
async function readDoc(){
 const db=await openDb();try{return await new Promise((resolve,reject)=>{
  const req=db.transaction(STORE,'readonly').objectStore(STORE).get(KEY);
  req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);
 });}finally{db.close();}
}
async function writeDoc(doc){
 const db=await openDb();try{await new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(doc);
  tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
 });}finally{db.close();}
}
async function derive(passphrase,s){
 const raw=await crypto.subtle.importKey('raw',encoder.encode(passphrase),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:s,iterations:310000},
   raw,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function save(){
 if(!data||!secretKey)throw Error('Unlock this device first.');
 const documentCopy=JSON.stringify(data),key=secretKey,documentSalt=salt;
 writes=writes.catch(()=>{}).then(async()=>{
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encoder.encode(documentCopy));
  await writeDoc({id:KEY,salt:b64(documentSalt),iv:b64(iv),ciphertext:b64(new Uint8Array(cipher))});
 });
 return writes;
}
function view(){
 const unlocked=!!data;
 $('scanPanel').hidden=!unlocked;$('syncPanel').hidden=!unlocked;
 $('lock').disabled=!unlocked;$('unlock').disabled=unlocked;
 $('prepare').disabled=unlocked;
 if(!unlocked)return;
 $('preparedScope').textContent='Authorized device profile: '+data.scope.role+
   ' · valid for NEW captures until '+new Date(data.scope.validUntil).toLocaleString()+
   ' · already recorded scans stay pending for review';
 $('pendingCount').textContent=data.events.length+' pending local observation'+(data.events.length===1?'':'s');
 $('queue').replaceChildren();
 for(const item of data.events.slice(-30).reverse()){
  const li=document.createElement('li');
  li.textContent=(item.qr.startsWith('TCH:')?'Staff':'Learner')+' badge · device clock '+
    new Date(item.capturedAtDevice).toLocaleString()+' · pending authorized review';
  $('queue').append(li);
 }
 $('start').disabled=active||Date.now()>Date.parse(data.scope.validUntil)||data.events.length>=2000;
 $('stop').disabled=!active;
}
async function api(path,opts={}){
 const response=await fetch(path,{...opts,cache:'no-store',credentials:'same-origin',
  headers:{...(opts.body?{'Content-Type':'application/json'}:{})}});
 const json=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(json.error||('Server response '+response.status));
 return json;
}
async function registerShell(){
 if(!('serviceWorker' in navigator))throw Error('This browser does not support offline installation.');
 await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});
 await navigator.serviceWorker.ready;
 // The service worker precaches HTML, scanner library and JavaScript on installation.
 const cached=await caches.match('/gate-offline.html');
 if(!cached)throw Error('Offline scanner files are not cached. Keep internet connected and refresh once.');
}
async function prepare(){
 if(!online())throw Error('Online sign-in is required to prepare the scanner.');
 const pass=$('newPass').value;
 if(pass.length<12)throw Error('Choose a device passphrase with at least 12 characters.');
 if(await readDoc())throw Error('This device is already prepared. Unlock and sync its existing scans; do not overwrite them.');
 $('prepare').disabled=true;
 try{
  await registerShell();
  const identity=await api('/api/gate/offline/prepare');
  if(identity.role!=='GATE_KEEPER'||!identity.schoolId||!identity.userId)throw Error('Gatekeeper role is required.');
  salt=crypto.getRandomValues(new Uint8Array(16));
  secretKey=await derive(pass,salt);
  data={scope:identity,events:[]};
  await save();$('newPass').value='';$('pass').value='';
  $('prepareResult').textContent='Prepared and encrypted. Keep your passphrase private.';
  view();
  if(navigator.storage?.persist){
   const persistent=await navigator.storage.persist().catch(()=>false);
   if(!persistent)$('prepareResult').textContent+=' Storage persistence is not guaranteed; do not clear browser data.';
  }
 }catch(error){data=null;secretKey=null;salt=null;throw error;}
 finally{$('prepare').disabled=false;}
}
async function unlock(){
 const doc=await readDoc();
 if(!doc)throw Error('No prepared Gatekeeper profile on this device. Prepare online first.');
 const pass=$('pass').value;if(!pass)throw Error('Enter the device passphrase.');
 try{
  salt=un64(doc.salt);secretKey=await derive(pass,salt);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(doc.iv)},secretKey,un64(doc.ciphertext));
  const decoded=JSON.parse(decoder.decode(plain));
  if(decoded?.scope?.role!=='GATE_KEEPER'||!decoded.scope.schoolId||!decoded.scope.userId||
   !Array.isArray(decoded.events)||decoded.events.length>2000)throw Error('Invalid device profile.');
  data=decoded;$('pass').value='';
  $('syncResult').textContent='Unlocked. Internet not required to capture; syncing requires the same signed-in Gatekeeper.';
  view();
 }catch(error){data=null;salt=null;secretKey=null;throw Error('Passphrase incorrect or encrypted device data unavailable. Do not clear your browser data.');}
}
async function lock(){
 if(active)await stop();
 data=null;secretKey=null;salt=null;lastScan='';view();
 $('scanResult').textContent='Device locked.';
}
async function receive(text){
 if(!data||Date.now()>Date.parse(data.scope.validUntil)){notice('scanResult','Offline authorization expired. Reconnect and renew by preparing a device again after securely syncing existing scans.',true);await stop();return;}
 const raw=String(text||'').trim(),match=QR.exec(raw);
 if(!match){notice('scanResult','Not a valid JHS or TCH Attendigo QR. Nothing saved.',true);return;}
 const now=Date.now();
 if(raw===lastScan&&now-lastScanAt<12000)return; // Repeated camera frames must not create duplicate events.
 if(data.events.length>=2000){notice('scanResult','Device limit reached. Reconnect and synchronize before scanning more.',true);await stop();return;}
 lastScan=raw;lastScanAt=now;
 const item={eventId:crypto.randomUUID(),qr:match[1].toUpperCase()+':'+match[2].toLowerCase(),
  capturedAtDevice:new Date(now).toISOString()};
 data.events.push(item);
 try{
  await save();
  notice('scanResult',(match[1].toUpperCase()==='TCH'?'Staff':'Learner')+' QR captured and encrypted locally. NOT official attendance.');
  view();
 }catch(error){
  data.events.pop();notice('scanResult','Device storage failed. This scan was not saved: '+error.message,true);view();
 }
}
async function start(){
 if(!data)return;
 if(Date.now()>Date.parse(data.scope.validUntil))throw Error('Prepared scanner expired. Reconnect to prepare a new session after syncing.');
 if(typeof Html5Qrcode==='undefined')throw Error('Offline camera library not available. Reconnect and reload after preparation.');
 if(!scanner)scanner=new Html5Qrcode('reader');
 await scanner.start({facingMode:'environment'},{fps:8,qrbox:230},decoded=>{
  // Every scan stays UNVERIFIED until the server acknowledges review intake.
  receive(decoded).catch(error=>notice('scanResult',error.message,true));
 },()=>{});
 active=true;view();
}
async function stop(){
 if(scanner&&active)await scanner.stop().catch(()=>{});
 active=false;view();
}
async function sync(){
 if(!data||!data.events.length)return $('syncResult').textContent='No pending scans on this device.';
 if(!online())throw Error('Connect to Wi-Fi or mobile data to synchronize.');
 if(syncing)return;
 syncing=true;$('sync').disabled=true;
 try{
  const identity=await api('/api/gate/offline/prepare');
  if(identity.schoolId!==data.scope.schoolId||identity.userId!==data.scope.userId||identity.role!=='GATE_KEEPER')
   throw Error('Different signed-in school or Gatekeeper. Sign into the exact original account. No scans were uploaded.');
  while(data.events.length){
   const batch=data.events.slice(0,50);
   const response=await api('/api/gate/offline/reconcile',{
    method:'POST',body:JSON.stringify({events:batch})});
   if(response.officialAttendance!==false||!Array.isArray(response.results))
    throw Error('Sync acknowledgment was not safe to accept. Encrypted records retained.');
   const acknowledgments=new Set(response.results.filter(x=>
     ['REVIEW_REQUIRED','INVALID_BADGE','ALREADY_RECEIVED'].includes(x.status)&&x.officialAttendance===false)
     .map(x=>x.eventId));
   if(acknowledgments.size!==batch.length||batch.some(x=>!acknowledgments.has(x.eventId)))
    throw Error('Not all observations were acknowledged. Unconfirmed device copies are retained.');
   data.events=data.events.filter(x=>!acknowledgments.has(x.eventId));
   await save();
   $('syncResult').textContent=acknowledgments.size+
     ' observations transferred to school review. NONE recorded as official attendance.';
   view();
  }
 }finally{syncing=false;$('sync').disabled=false;view();}
}
function connectivity(){
 const on=online();$('network').className='status'+(on?' good':'');
 $('network').textContent=on?'Network available. Scanner can capture locally and sync after Gatekeeper authorization.':
   'Offline · encrypted local captures only. No official attendance has been recorded.';
}
function bind(id,callback){
 $(id).addEventListener('click',async()=>{
  $(id).disabled=true;
  try{await callback();}
  catch(error){
   const target=id==='prepare'?'prepareResult':id==='sync'?'syncResult':id==='start'?'scanResult':'scanResult';
   if(target==='scanResult')notice(target,error.message,true);
   else $(target).textContent=error.message;
  }finally{view();if(id==='prepare'&&!data)$('prepare').disabled=false;if(id==='unlock'&&!data)$('unlock').disabled=false;}
 });
}
bind('prepare',prepare);bind('unlock',unlock);bind('lock',lock);bind('start',start);bind('stop',stop);bind('sync',sync);
window.addEventListener('online',()=>{connectivity();if(data&&data.events.length)sync().catch(e=>{$('syncResult').textContent=e.message;});});
window.addEventListener('offline',connectivity);
window.addEventListener('pagehide',()=>{secretKey=null;data=null;}); // never keep decoded badge tokens after navigation
connectivity();readDoc().then(doc=>{
 $('prepareResult').textContent=doc?'Device already prepared. Unlock using its passphrase.':'No prepared device on this browser.';
}).catch(error=>{$('prepareResult').textContent='Local storage unavailable: '+error.message;});
})();