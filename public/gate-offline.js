/* Encrypted, capture-only Gatekeeper device outbox. No attendance or DTR confirmation. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const guard=window.AttendigoOfflineAccount;
const matchesGate=scope=>!!guard?.matches('GATE_KEEPER',scope?.schoolId,scope?.userId);
const DB='attendigo-gatekeeper-capture-v1',STORE='prepared';
const KEY='gatekeeper-device';
const encoder=new TextEncoder(),decoder=new TextDecoder();
const QR=/^(JHS|TCH):([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
let data=null,secretKey=null,salt=null,scanner=null,active=false,syncing=false,lastScan='',lastScanAt=0;
let writes=Promise.resolve();
let queueBusy=false,storedDoc=null,recoveryBusy=false;
const sameDoc=(a,b)=>!a&&!b||!!a&&!!b&&a.id===b.id&&a.salt===b.salt&&a.iv===b.iv&&a.ciphertext===b.ciphertext;
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
// Compare the exact encrypted profile inside one transaction, so a stale tab
// cannot resurrect a reset profile or overwrite a newly changed passphrase.
async function replaceDoc(expected,next,check){
 const db=await openDb();try{await new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),req=store.get(KEY);
  let error=null;
  req.onsuccess=()=>{
   try{
    if(!check()||!sameDoc(req.result||null,expected))throw Error('Device profile changed or account access expired. Reopen the scanner before trying again.');
    if(next)store.put(next);else store.delete(KEY);
   }catch(e){error=e;tx.abort();}
  };
  tx.oncomplete=resolve;tx.onerror=()=>reject(error||tx.error);tx.onabort=()=>reject(error||tx.error||Error('Device storage change canceled.'));
 });}finally{db.close();}
}
async function derive(passphrase,s){
 const raw=await crypto.subtle.importKey('raw',encoder.encode(passphrase),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:s,iterations:310000},
   raw,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function save(){
 if(!matchesGate(data?.scope))throw Error('Offline Gatekeeper account changed.');
 if(!data||!secretKey)throw Error('Unlock this device first.');
 const documentCopy=JSON.stringify(data),key=secretKey,documentSalt=salt,scope=data.scope;
 const sessionData=data;
 writes=writes.catch(()=>{}).then(async()=>{
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encoder.encode(documentCopy));
  const next={id:KEY,salt:b64(documentSalt),iv:b64(iv),ciphertext:b64(new Uint8Array(cipher)),owner:{schoolId:String(scope.schoolId),userId:String(scope.userId)}};
  await replaceDoc(storedDoc,next,()=>matchesGate(scope)&&data===sessionData&&secretKey===key);storedDoc=next;
 });
 return writes;
}
function view(){
 const unlocked=!!data&&matchesGate(data.scope);
 $('recoveryPanel').hidden=!guard?.current('GATE_KEEPER')||(!unlocked&&!storedDoc);
 $('changePassphrase').disabled=!unlocked||active||syncing||queueBusy||recoveryBusy;
 $('safeReset').disabled=!unlocked||active||syncing||queueBusy||recoveryBusy;
 $('forgotReset').hidden=unlocked;
 $('forgotReset').disabled=unlocked||recoveryBusy||!online();
 $('scanPanel').hidden=!unlocked;$('syncPanel').hidden=!unlocked;
 $('lock').disabled=!unlocked||recoveryBusy;$('unlock').disabled=unlocked||recoveryBusy;
 $('prepare').disabled=unlocked;
 if(!unlocked)return;
 $('preparedScope').textContent='Authorized device profile: '+data.scope.role+
   ' · valid for NEW captures until '+new Date(Math.min(Date.parse(data.scope.validUntil),guard.current('GATE_KEEPER').until)).toLocaleString()+
   ' · already recorded scans stay pending for review';
 const practiceCount=data.events.filter(item=>item.practice===true).length;
 const officialCount=data.events.length-practiceCount;
 $('pendingCount').textContent=officialCount+' pending local observation'+(officialCount===1?'':'s')+
   (practiceCount?' · '+practiceCount+' practice scan'+(practiceCount===1?'':'s'):'');
 $('clearPending').disabled=recoveryBusy||queueBusy||syncing||active||officialCount===0;
 $('clearPractice').disabled=recoveryBusy||queueBusy||syncing||active||practiceCount===0;
 $('sync').disabled=recoveryBusy||queueBusy||syncing||officialCount===0;
 $('queue').replaceChildren();
 for(const item of data.events.slice(-30).reverse()){
  const li=document.createElement('li');
  const detail=document.createElement('span');
  detail.textContent=(item.qr.startsWith('TCH:')?'Staff':'Learner')+' badge · device clock '+
    new Date(item.capturedAtDevice).toLocaleString()+
    (item.practice===true?' · PRACTICE ONLY':' · pending authorized review');
  li.append(detail);
  const discard=document.createElement('button');
  discard.type='button';discard.className='secondary';discard.textContent='Discard';
  discard.setAttribute('aria-label','Discard '+(item.practice===true?'practice':'pending')+' observation recorded '+new Date(item.capturedAtDevice).toLocaleString());
  discard.disabled=queueBusy||syncing||active;
  discard.addEventListener('click',()=>discardEvents([item.eventId],item.practice===true?'practice observation':'pending observation').catch(error=>notice('syncResult',error.message,true)));
  li.append(discard);
  $('queue').append(li);
 }
 $('start').disabled=recoveryBusy||active||Date.now()>Date.parse(data.scope.validUntil)||data.events.length>=2000;
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
 if(!('serviceWorker' in navigator)||!('caches' in window))
  throw Error('This browser does not support the required offline PWA storage.');
 await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});
 await navigator.serviceWorker.ready;
 // The service worker installs all public offline dependencies atomically.
 // Check a complete release cache, rather than creating an obsolete cache that
 // the next service-worker activation will delete.
 const assets=['/gate-offline.html','/gate-offline.js?v=8','/offline-account-guard.js?v=1','/vendor/html5-qrcode.min.js','/app-dialog.js?v=1','/app-dialog.css?v=2','/offline-welcome.html'];
 for(const cacheName of (await caches.keys()).filter(name=>name.startsWith('attendigo-v'))){
  const results=await Promise.all(assets.map(asset=>caches.match(asset,{cacheName})));
  if(results.every(response=>response?.ok))return;
 }
 throw Error('Offline scanner files are not ready. Stay connected, reload Attendigo and try preparing again.');
}
async function prepare(){
 if(recoveryBusy)throw Error('Device recovery in progress.');
 if(!await guard?.authorize('GATE_KEEPER'))throw Error('Verified Gatekeeper access required.');
 if(!online())throw Error('Online sign-in is required to prepare the scanner.');
 const pass=$('newPass').value;
 if(pass!==$('confirmPass').value)throw Error('The two device passphrases do not match.');
 if(pass.length<12)throw Error('Choose a device passphrase with at least 12 characters.');
 if(await readDoc())throw Error('This device is already prepared. Unlock and sync its existing scans; do not overwrite them.');
 $('prepare').disabled=true;
 try{
  await registerShell();
  const identity=await api('/api/gate/offline/prepare');
  if(identity.role!=='GATE_KEEPER'||!identity.schoolId||!identity.userId)throw Error('Gatekeeper role is required.');
  if(!matchesGate(identity))throw Error('Gatekeeper account mismatch.');
  salt=crypto.getRandomValues(new Uint8Array(16));
  secretKey=await derive(pass,salt);
  storedDoc=null;data={scope:identity,events:[]};
  await save();const resumable=guard.markGatePrepared?.(identity);$('newPass').value='';$('confirmPass').value='';$('pass').value='';
  $('preparePanel').hidden=true;$('unlockPanel').hidden=false;$('unlockStatus').textContent='Device prepared. Keep your passphrase private.';
  $('prepareResult').textContent='Prepared and encrypted. Keep your passphrase private.';
  $('unlockStatus').textContent=resumable?'Offline reopen ready until '+new Date(guard.gateResumeUntil()).toLocaleString()+'. Keep your passphrase private.':'Device prepared, but offline reopen is not confirmed. Keep the scanner open and reconnect to renew.';
  view();
  if(navigator.storage?.persist){
   const persistent=await navigator.storage.persist().catch(()=>false);
   if(!persistent)$('prepareResult').textContent+=' Storage persistence is not guaranteed; do not clear browser data.';
  }
 }catch(error){data=null;secretKey=null;salt=null;throw error;}
 finally{$('prepare').disabled=false;}
}
async function renew(){
 if(recoveryBusy)throw Error('Device recovery in progress.');
 if(!data||!online())throw Error('Unlock the prepared device and connect to the internet to renew.');
 if(!await guard?.authorize('GATE_KEEPER')||!matchesGate(data.scope))throw Error('Verified Gatekeeper account required.');
 await registerShell();
 const identity=await api('/api/gate/offline/prepare');
 if(identity.schoolId!==data.scope.schoolId||identity.userId!==data.scope.userId||identity.role!=='GATE_KEEPER')
  throw Error('Different account: original Gatekeeper must reauthorize this device.');
 const previous=data.scope.validUntil;
 data.scope.validUntil=identity.validUntil;
 try{await save();}catch(error){data.scope.validUntil=previous;throw error;}
 const resumable=guard.markGatePrepared?.(identity);
 $('scanResult').textContent=resumable?'Offline reopen ready until '+new Date(guard.gateResumeUntil()).toLocaleString()+'. Existing encrypted scans are preserved.':'Authorized, but offline reopen is not confirmed. Keep this page open and reconnect to renew.';
 view();
}
async function decodePrepared(doc,pass){
 let deviceSalt,iv,ciphertext;
 try{
  deviceSalt=un64(doc.salt);iv=un64(doc.iv);ciphertext=un64(doc.ciphertext);
  if(deviceSalt.length!==16||iv.length!==12||ciphertext.length<16)throw Error('Invalid encrypted document');
 }catch{throw Error('The saved device profile is damaged or incomplete. Keep your browser data.');}
 let key;
 try{key=await derive(pass,deviceSalt);}
 catch{throw Error('Device encryption is unavailable. Reopen Attendigo in a supported secure browser. Keep your browser data.');}
 let plain;
 try{plain=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,ciphertext);}
 catch{throw Error('The original device passphrase did not unlock this profile, or the encrypted data is damaged. Check the exact characters. Do not clear your browser data.');}
 let decoded;
 try{decoded=JSON.parse(decoder.decode(plain));}
 catch{throw Error('The saved device profile is invalid. Keep your browser data.');}
 if(decoded?.scope?.role!=='GATE_KEEPER'||!decoded.scope.schoolId||!decoded.scope.userId||
   !Array.isArray(decoded.events)||decoded.events.length>2000)throw Error('The saved device profile is invalid. Keep your browser data.');
 return {decoded,key,deviceSalt};
}
function resetPassVisibility(){
 $('pass').type='password';$('showPass').checked=false;
}
async function unlock(){
 if(recoveryBusy)throw Error('Device recovery in progress.');
 if(!await guard?.authorize('GATE_KEEPER'))throw Error('Gatekeeper access is restricted. Reconnect to switch accounts.');
 let doc;
 try{doc=await readDoc();}catch{throw Error('Cannot read local device storage. Keep your browser data and reopen Attendigo.');}
 if(!doc)throw Error('No prepared Gatekeeper profile on this device. Prepare online first.');
 const pass=$('pass').value;if(!pass)throw Error('Enter the original device passphrase, not your sign-in password.');
 try{
  const {decoded,key,deviceSalt}=await decodePrepared(doc,pass);
  if(!matchesGate(decoded.scope))throw Error('This prepared scanner belongs to a different Gatekeeper account or school. Sign in online with the original account. Your encrypted records have not been changed.');
  storedDoc=doc;data=decoded;secretKey=key;salt=deviceSalt;$('pass').value='';resetPassVisibility();
  $('unlockStatus').textContent='Scanner unlocked.';
  $('syncResult').textContent='Unlocked. Internet not required to capture; syncing requires the same signed-in Gatekeeper.';
  // Upgrade an existing encrypted device without a reset. Only a successful
  // online renewal can establish the bounded dedicated-device resume stamp.
  if(guard.markGatePrepared&&online()){
   try{await renew();}catch(error){$('unlockStatus').textContent='Scanner unlocked. Offline readiness could not be renewed: '+error.message;}
  }
  view();
 }catch(error){data=null;salt=null;secretKey=null;resetPassVisibility();throw error;}
}
async function lock(){
 if(active)await stop();
 data=null;secretKey=null;salt=null;lastScan='';view();
 $('scanResult').textContent='Device locked.';
}
async function receive(text){
 if(recoveryBusy)return;
 if(!matchesGate(data?.scope)){await lock();return;}
 if(!data||Date.now()>Date.parse(data.scope.validUntil)){notice('scanResult','Offline authorization expired. Reconnect and renew by preparing a device again after securely syncing existing scans.',true);await stop();return;}
 const raw=String(text||'').trim(),match=QR.exec(raw);
 if(!match){notice('scanResult','Not a valid JHS or TCH Attendigo QR. Nothing saved.',true);return;}
 const now=Date.now();
 if(raw===lastScan&&now-lastScanAt<12000)return; // Repeated camera frames must not create duplicate events.
 if(data.events.length>=2000){notice('scanResult','Device limit reached. Reconnect and synchronize before scanning more.',true);await stop();return;}
 lastScan=raw;lastScanAt=now;
 const practice=$('testMode').checked;
 const item={eventId:crypto.randomUUID(),qr:match[1].toUpperCase()+':'+match[2].toLowerCase(),
  capturedAtDevice:new Date(now).toISOString(),...(practice?{practice:true}:{})};
 data.events.push(item);
 try{
  await save();
  notice('scanResult',(practice?'PRACTICE: ':'')+(match[1].toUpperCase()==='TCH'?'Staff':'Learner')+
    ' QR captured and encrypted locally. NOT official attendance.');
  view();
 }catch(error){
  data.events.pop();notice('scanResult','Device storage failed. This scan was not saved: '+error.message,true);view();
 }
}
async function start(){
 if(!matchesGate(data?.scope))throw Error('Verified Gatekeeper account required.');
 if(!data||recoveryBusy)return;
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
 if(!matchesGate(data?.scope))throw Error('Verified Gatekeeper account required.');
 if(!data||!data.events.some(item=>item.practice!==true))return $('syncResult').textContent='No pending non-practice scans to synchronize.';
 if(!online())throw Error('Connect to Wi-Fi or mobile data to synchronize.');
 if(syncing||queueBusy||recoveryBusy)return;
 syncing=true;$('sync').disabled=true;
 try{
  const identity=await api('/api/gate/offline/prepare');
  if(identity.schoolId!==data.scope.schoolId||identity.userId!==data.scope.userId||identity.role!=='GATE_KEEPER')
   throw Error('Different signed-in school or Gatekeeper. Sign into the exact original account. No scans were uploaded.');
  while(data.events.some(item=>item.practice!==true)){
   const batch=data.events.filter(item=>item.practice!==true).slice(0,50);
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
     ' observations transferred to school review. Practice observations were NOT transferred. NONE recorded as official attendance.';
   view();
  }
 }finally{syncing=false;$('sync').disabled=false;view();}
}
async function discardEvents(ids,description){
 if(!matchesGate(data?.scope))throw Error('Verified Gatekeeper account required.');
 if(!data||!secretKey)throw Error('Unlock the scanner first.');
 if(syncing||queueBusy||active||recoveryBusy)throw Error('Stop scanning or synchronization before discarding observations.');
 const selected=new Set(ids),matching=data.events.filter(event=>selected.has(event.eventId));
 if(!matching.length)return;
 if(!await window.AppDialog.confirm('Permanently discard '+matching.length+' '+description+(matching.length===1?'':'s')+
   ' from this device? This cannot be undone and will not change school attendance or already synchronized records.',{title:'Discard offline observations',confirmText:'Discard',variant:'danger'}))return;
 if(syncing||queueBusy||active)throw Error('Stop scanning or synchronization before discarding observations.');
 queueBusy=true;view();
 try{
  const originalEvents=data.events;
  data.events=originalEvents.filter(event=>!selected.has(event.eventId));
  try{await save();}catch(error){data.events=originalEvents;throw error;}
  $('syncResult').textContent=matching.length+' local '+description+(matching.length===1?'':'s')+
    ' discarded. School attendance records were not changed.';
 }finally{queueBusy=false;view();}
}
async function discardSelected(practice){
 if(!data)return;
 const selected=data.events.filter(item=>(item.practice===true)===practice);
 return discardEvents(selected.map(item=>item.eventId),practice?'practice observation':'pending observation');
}
async function verifyRecoveryAccount(){
 if(!online())throw Error('Connect to the internet before resetting or changing the device passphrase.');
 // A cached authorization alone is insufficient for device recovery.
 const identity=await api('/api/gate/offline/prepare');
 if(identity.role!=='GATE_KEEPER'||!matchesGate(identity))throw Error('Sign in online as the authorized Gatekeeper.');
 return identity;
}
async function withRecovery(action){
 if(active||syncing||queueBusy||recoveryBusy)throw Error('Stop scanning and wait for synchronization before managing the device.');
 recoveryBusy=true;view();
 try{await writes;await action();}finally{recoveryBusy=false;view();}
}
async function changePassphrase(){
 return withRecovery(async()=>{
  const identity=await verifyRecoveryAccount();
  if(!data||!secretKey||!matchesGate(data.scope))throw Error('Unlock the original device first.');
  const original=storedDoc;
  const fields=await window.AppDialog.form('Enter your original passphrase and a new private passphrase. All pending observations will be preserved.',[
   {name:'old',label:'Original passphrase',type:'password',required:true},
   {name:'next',label:'New passphrase',type:'password',required:true},
   {name:'confirm',label:'Confirm new passphrase',type:'password',required:true}
  ],{title:'Change device passphrase',confirmText:'Change passphrase'});
  if(!fields)return;
  if(fields.next.length<12||fields.next!==fields.confirm)throw Error('Use matching new passphrases with at least 12 characters.');
  const {decoded}=await decodePrepared(original,fields.old);
  if(!matchesGate(decoded.scope)||!matchesGate(identity)||!data)throw Error('Gatekeeper account changed.');
  const nextSalt=crypto.getRandomValues(new Uint8Array(16)),nextKey=await derive(fields.next,nextSalt);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},nextKey,encoder.encode(JSON.stringify(decoded)));
  const next={id:KEY,salt:b64(nextSalt),iv:b64(iv),ciphertext:b64(new Uint8Array(cipher)),owner:{schoolId:String(decoded.scope.schoolId),userId:String(decoded.scope.userId)}};
  await replaceDoc(original,next,()=>matchesGate(identity)&&matchesGate(decoded.scope)&&!!data);
  storedDoc=next;data=decoded;secretKey=nextKey;salt=nextSalt;
  $('recoveryStatus').textContent='Passphrase changed. All encrypted pending observations preserved.';
 });
}
async function resetDevice(forgot){
 return withRecovery(async()=>{
  const identity=await verifyRecoveryAccount(),original=await readDoc();
  if(!original)throw Error('No prepared device profile exists.');
  if(original.owner&&!matchesGate(original.owner))throw Error('This profile belongs to another Gatekeeper. Reconnect as the original account.');
  if(!forgot){
   if(!data||!matchesGate(data.scope)||!sameDoc(original,storedDoc))throw Error('Unlock the original device first.');
   if(data.events.some(item=>item.practice!==true))throw Error('Synchronize all pending observations before resetting. Nothing was deleted.');
  }else if(data)throw Error('Use the safe reset option while unlocked.');
  // Older encrypted profiles lack owner metadata. Never discard them without
  // explicitly confirming that the local device data belongs to this user.
  const message=forgot?'The saved profile cannot be recovered without its original passphrase. Resetting permanently deletes ALL unsynchronized observations on this device, including any unknown pending scans. Confirm only if this is your own prepared profile and you accept losing those scans.':'All non-practice observations have been synchronized or none exist. Resetting removes this device profile and any practice scans.';
  const confirmation=await window.AppDialog.prompt(message+' Official attendance and synchronized records will not be changed. Type RESET to continue.','',{title:forgot?'Forgot passphrase — permanent local reset':'Reset offline scanner',confirmText:'Reset device',variant:'danger',required:true,validate:value=>value==='RESET'||'Type RESET exactly.'});
  if(confirmation!=='RESET')return;
  const verified=await verifyRecoveryAccount();
  if(String(verified.schoolId)!==String(identity.schoolId)||String(verified.userId)!==String(identity.userId))throw Error('Gatekeeper account changed. Reset canceled.');
  await replaceDoc(original,null,()=>matchesGate(identity)&&(!original.owner||matchesGate(original.owner)));
  window.AttendigoOfflineAccount?.clearGateResume();storedDoc=null;await lock();$('unlockPanel').hidden=true;$('preparePanel').hidden=false;$('recoveryPanel').hidden=true;
  $('prepareResult').textContent='Offline device reset. Create a new passphrase to prepare this device again.';
 });
}
function connectivity(){
 const on=online();$('forgotReset').disabled=!on||recoveryBusy||!!data;$('network').className='status'+(on?' good':'');
 $('network').textContent=on?'Network available. Scanner can capture locally and sync after Gatekeeper authorization.':
   'Offline · encrypted local captures only. No official attendance has been recorded.';
}
function bind(id,callback){
 $(id).addEventListener('click',async()=>{
  $(id).disabled=true;
  try{if(!guard?.current('GATE_KEEPER'))throw Error('Gatekeeper access restricted. Reconnect and sign in.');await callback();}
  catch(error){
   const target=['changePassphrase','safeReset','forgotReset'].includes(id)?'recoveryStatus':id==='prepare'?'prepareResult':id==='unlock'?'unlockStatus':id==='sync'?'syncResult':'scanResult';
   if(target==='scanResult')notice(target,error.message,true);
   else $(target).textContent=error.message;
  }finally{view();if(id==='prepare'&&!data)$('prepare').disabled=false;if(id==='unlock'&&!data)$('unlock').disabled=false;}
 });
}
$('showPass').addEventListener('change',()=>{$('pass').type=$('showPass').checked?'text':'password';});
bind('prepare',prepare);bind('unlock',unlock);bind('lock',lock);bind('start',start);bind('stop',stop);bind('renew',renew);bind('sync',sync);
bind('changePassphrase',changePassphrase);bind('safeReset',()=>resetDevice(false));bind('forgotReset',()=>resetDevice(true));
bind('clearPractice',()=>discardSelected(true));bind('clearPending',()=>discardSelected(false));
window.addEventListener('online',()=>{connectivity();void refreshAccess().then(()=>{if(data&&data.events.some(item=>item.practice!==true))return sync();}).catch(e=>{$('syncResult').textContent=e.message;});});
window.addEventListener('offline',connectivity);
window.addEventListener('pagehide',()=>{void stop();secretKey=null;data=null;salt=null;lastScan='';lastScanAt=0;$('pass').value='';$('newPass').value='';$('confirmPass').value='';resetPassVisibility();$('queue').replaceChildren();view();}); // never keep decoded badge tokens after navigation
window.addEventListener('pageshow',event=>{if(event.persisted&&guard?.current('GATE_KEEPER'))view();}); // restore the unlock controls after a cached page returns
function deny(){void lock();$('pass').value='';$('newPass').value='';$('confirmPass').value='';resetPassVisibility();$('queue').replaceChildren();for(const id of ['unlockPanel','preparePanel','scanPanel','syncPanel','recoveryPanel'])$(id).hidden=true;$('network').textContent='Offline authorization missing or expired. Reconnect, sign in as the original Gatekeeper in this same app or browser, and unlock the prepared scanner. Do not clear local data.';}
guard?.watch(()=>{if(!guard.current('GATE_KEEPER')||(data&&!matchesGate(data.scope)))deny();});
async function refreshAccess(){
 if(!await guard?.authorize('GATE_KEEPER')||!guard.current('GATE_KEEPER')){deny();return;}
 connectivity();
 $('unlockPanel').hidden=false;$('preparePanel').hidden=true;view();
 try{
  const doc=await readDoc();
  if(!guard.current('GATE_KEEPER')){deny();return;}
  if(data&&!sameDoc(doc,storedDoc)){await lock();$('unlockStatus').textContent='Device profile changed in another tab. Unlock again.';}
  if(!data)storedDoc=doc;$('unlockPanel').hidden=!doc;$('preparePanel').hidden=!!doc;view();
  $('prepareResult').textContent=doc?'':'No prepared device in this app or browser. Connect to prepare it.';
  if(doc&&!data)$('unlockStatus').textContent=guard.gateResumeUntil?.()?'Offline reopen authorized until '+new Date(guard.gateResumeUntil()).toLocaleString()+'. Enter your original device passphrase.':'Unlock while online to check and renew offline reopen readiness.';
 }catch(error){$('unlockStatus').textContent='Local storage unavailable. Do not clear browser data.';}
}
connectivity();void refreshAccess().catch(()=>deny());
})();