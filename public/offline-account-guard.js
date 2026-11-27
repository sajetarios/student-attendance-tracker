/* Offline UI authorization: a passphrase is not an account login.
 * No credential/token is persisted here. Offline browser checks are not a substitute for server authentication. */
(()=>{'use strict';
 const KEY='attendigo.offline.activeAccount.v1',TAB='attendigo.offline.verifiedTab.v1',STUDENT='attendigo.studentQrCapture';
 const INSTALLED='attendigo.offline.installedStaff.v1',GATE='attendigo.offline.preparedGate.v1';
 // The dedicated Gatekeeper lease is also stored in IndexedDB. The Web
 // Storage active-account / prepared markers remain continuity fences: if
 // both have vanished, do not resurrect a possibly logged-out account.
 const GATE_REVOKED='attendigo.offline.gateRevoked.v1',AUTH_DB='attendigo-offline-authorization-v1',AUTH_STORE='leases',AUTH_KEY='gatekeeper';
 let gateWrites=Promise.resolve(),memoryTab=null,tabStorageUnavailable=false,gateDiagnostic='not-checked';
 const installed=()=>navigator.standalone===true||window.matchMedia?.('(display-mode: standalone)').matches===true;
 const staffOffline=role=>role==='TEACHER'||role==='GATE_KEEPER';
 const ROLES=new Set(['STUDENT','TEACHER','GATE_KEEPER']);
 const parse=(store,key)=>{try{return JSON.parse(store.getItem(key)||'null');}catch{return null;}};
 const identity=u=>u&&!u.mustChangePassword&&ROLES.has(u.role)&&u.schoolId&&(u.role==='STUDENT'?u.studentAccountId:u.userId)?{role:u.role,schoolId:String(u.schoolId),accountId:String(u.role==='STUDENT'?u.studentAccountId:u.userId)}:null;
 const same=(a,b)=>!!a&&!!b&&a.role===b.role&&a.schoolId===b.schoolId&&a.accountId===b.accountId;
 function sameEpoch(a,b){return same(a,b)&&typeof a.epoch==='string'&&!!a.epoch&&a.epoch===b.epoch;}
 function validStamp(a){return !!a&&ROLES.has(a.role)&&!!a.schoolId&&!!a.accountId&&typeof a.epoch==='string'&&!!a.epoch&&Number.isFinite(a.until)&&a.until>Date.now();}
 function tabRaw(){try{if(!tabStorageUnavailable)return sessionStorage.getItem(TAB);}catch{tabStorageUnavailable=true;}return memoryTab?JSON.stringify(memoryTab):null;}
 function tabStamp(){try{return JSON.parse(tabRaw()||'null');}catch{return null;}}
 function writeTab(stamp){memoryTab=stamp?.role==='GATE_KEEPER'?stamp:null;try{sessionStorage.setItem(TAB,JSON.stringify(stamp));tabStorageUnavailable=false;}catch{tabStorageUnavailable=true;}}
 function removeTab(){memoryTab=null;try{sessionStorage.removeItem(TAB);sessionStorage.removeItem(STUDENT);tabStorageUnavailable=false;}catch{tabStorageUnavailable=true;}}
 function openAuthDb(){return new Promise((resolve,reject)=>{
  if(typeof indexedDB==='undefined'){reject(Error('Persistent authorization storage unavailable'));return;}
  const request=indexedDB.open(AUTH_DB,1);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(AUTH_STORE))request.result.createObjectStore(AUTH_STORE);};
  let settled=false;
  const timer=setTimeout(()=>finish(Error('Persistent authorization storage timed out')),2500);
  function finish(error){if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(request.result);}
  request.onsuccess=()=>{if(settled){request.result.close();return;}finish();};
  request.onerror=()=>finish(request.error||Error('Persistent authorization storage unavailable'));
  request.onblocked=()=>finish(Error('Persistent authorization storage blocked'));
 });}
 async function leaseTx(mode,action){
  const db=await openAuthDb();
  try{return await new Promise((resolve,reject)=>{
   const tx=db.transaction(AUTH_STORE,mode),store=tx.objectStore(AUTH_STORE);let value,error;
   const timer=setTimeout(()=>{try{tx.abort();}catch{}reject(Error('Authorization transaction timed out'));},2500);
   tx.oncomplete=()=>{clearTimeout(timer);resolve(value);};tx.onabort=()=>{clearTimeout(timer);reject(error||tx.error||Error('Authorization transaction aborted'));};tx.onerror=()=>{clearTimeout(timer);reject(error||tx.error);};
   try{const req=action(store);req.onsuccess=()=>{value=req.result;};req.onerror=()=>{error=req.error;};}catch(e){error=e;tx.abort();}
  });}finally{db.close();}
 }
 function queueLease(action){const next=gateWrites.catch(()=>{}).then(action);gateWrites=next.catch(()=>{});return next;}
 function revokeGateLease(){
  try{localStorage.setItem(GATE_REVOKED,'1');localStorage.removeItem(GATE);}catch{}
  gateDiagnostic='revoked';
  return queueLease(()=>leaseTx('readwrite',store=>store.delete(AUTH_KEY))).then(()=>true,()=>false);
 }
 function flushGate(){return gateWrites;}
 function clear(){removeTab();try{localStorage.removeItem(KEY);localStorage.removeItem(INSTALLED);}catch{}return revokeGateLease();}
 function record(user,expiresAt){
  const id=identity(user);if(!id){clear();return null;}
  try{
   const old=parse(localStorage,KEY),prior=tabStamp();
   let priorExpiry='';try{if(same(prior,id))priorExpiry=sessionStorage.getItem('schoolAttendance.expiresAt')||'';}catch{}
   const end=Date.parse(expiresAt||priorExpiry||'');
   const until=Math.min(Date.now()+12*60*60*1000,Number.isFinite(end)?end:Infinity);
   if(until<=Date.now()){clear();return null;}
   const epoch=same(old,id)&&old.until>Date.now()&&old.epoch?old.epoch:crypto.randomUUID();
   if(!same(prior,id)){try{sessionStorage.removeItem(STUDENT);}catch{}}
   const stamp={...id,epoch,until};
   if(!sameEpoch(old,stamp))void revokeGateLease();
   localStorage.setItem(KEY,JSON.stringify(stamp));writeTab(stamp);
   // Only an online-verified installed teacher/gatekeeper session can establish
   // a resumable stamp. The actual encrypted data still requires its passphrase.
   if(installed()&&staffOffline(stamp.role)&&Number.isFinite(Date.parse(expiresAt||'')))localStorage.setItem(INSTALLED,JSON.stringify(stamp));
   else if(!same(old,stamp)||old?.epoch!==stamp.epoch)localStorage.removeItem(INSTALLED);
   return stamp;
  }catch{return null;}
 }
 // Only the encrypted Gatekeeper scanner can opt in after a successful server
 // preparation/renewal and durable profile write. No token or passphrase is saved.
 function markGatePrepared(scope){
  try{
   const a=current('GATE_KEEPER'),end=Date.parse(scope?.validUntil);
   if(navigator.onLine===false||!a||scope?.role!=='GATE_KEEPER'||a.schoolId!==String(scope.schoolId)||a.accountId!==String(scope.userId)||!Number.isFinite(end))return false;
   const until=Math.min(a.until,end);
   if(until<=Date.now())return false;
   localStorage.setItem(GATE,JSON.stringify({...a,until}));localStorage.removeItem(GATE_REVOKED);return true;
  }catch{return false;}
 }
 // Only called after the online Gatekeeper endpoint and encrypted profile
 // write succeeded. Read back the committed lease before reporting readiness.
 async function persistGatePrepared(scope){
  if(!markGatePrepared(scope)){gateDiagnostic='invalid-preparation';return false;}
  const stamp=parse(localStorage,GATE);
  try{
   await queueLease(()=>leaseTx('readwrite',store=>{
    if(localStorage.getItem(GATE_REVOKED)||!sameEpoch(stamp,parse(localStorage,KEY))||!sameEpoch(stamp,parse(localStorage,GATE)))throw Error('Account changed');
    return store.put(stamp,AUTH_KEY);
   }));
   const saved=await leaseTx('readonly',store=>store.get(AUTH_KEY));
   if(!validStamp(saved)||!sameEpoch(saved,stamp)||saved.until!==stamp.until||!gateResumeUntil())throw Error('Lease not persisted');
   gateDiagnostic='ready';return true;
  }catch{gateDiagnostic='persistent-storage-unavailable';return false;}
 }
 function clearGateResume(){return revokeGateLease();}
 async function restoreGateLease(role){
  if(role&&role!=='GATE_KEEPER')return null;
  try{
   if(localStorage.getItem(GATE_REVOKED)){gateDiagnostic='revoked';return null;}
   await flushGate();
   const saved=await leaseTx('readonly',store=>store.get(AUTH_KEY));
   if(!saved){gateDiagnostic='lease-missing';return null;}
   if(saved.role!=='GATE_KEEPER'||!validStamp(saved)){gateDiagnostic='lease-expired';return null;}
   const rawActive=localStorage.getItem(KEY),rawPrepared=localStorage.getItem(GATE),rawTab=tabRaw();
   const active=parse(localStorage,KEY),prepared=parse(localStorage,GATE),tab=tabStamp();
   if(localStorage.getItem(GATE_REVOKED)){gateDiagnostic='revoked';return null;}
   if(rawActive===null&&rawPrepared===null){gateDiagnostic='continuity-missing';return null;}
   if((rawActive!==null&&(!sameEpoch(active,saved)||!validStamp(active)))||
      (rawPrepared!==null&&(!sameEpoch(prepared,saved)||!validStamp(prepared)))||
      (rawTab!==null&&!sameEpoch(tab,saved))){gateDiagnostic='account-mismatch';return null;}
   const until=Math.min(saved.until,active?.until??Infinity,prepared?.until??Infinity);
   if(until<=Date.now()){gateDiagnostic='lease-expired';return null;}
   const stamp={...saved,until};
   localStorage.setItem(KEY,JSON.stringify(stamp));localStorage.setItem(GATE,JSON.stringify(stamp));writeTab(stamp);
   gateDiagnostic='recovered';return stamp;
  }catch{gateDiagnostic='persistent-storage-unavailable';return null;}
 }
 function gateResumeDiagnostic(){return gateDiagnostic;}
 function gateResumeMessage(){return ({'revoked':'This device’s previous offline authorization was revoked or reset. Sign in online as the original Gatekeeper and unlock to renew.', 'lease-missing':'No persistent scanner authorization was found in this browser. Reconnect and unlock your existing scanner to register it.', 'lease-expired':'The saved offline authorization has expired. Reconnect and unlock to renew it.', 'continuity-missing':'Chrome no longer has the account continuity markers. Reconnect as the original Gatekeeper; saved encrypted scans have not been cleared by Attendigo.', 'account-mismatch':'The restored browser session does not match the prepared device authorization. Reconnect as the original Gatekeeper.', 'persistent-storage-unavailable':'Persistent browser authorization storage could not be accessed. Reconnect in the same browser; do not clear browser data.', 'invalid-preparation':'The device authorization could not be confirmed. Reconnect and unlock to renew.'})[gateDiagnostic]||'Offline authorization is missing or expired. Reconnect and sign in as the original Gatekeeper in this same app or browser.';}
 function gateResumeUntil(){
  try{
   if(localStorage.getItem(GATE_REVOKED))return null;
   const saved=parse(localStorage,GATE),active=parse(localStorage,KEY);
   if(saved?.role!=='GATE_KEEPER'||!same(saved,active)||!saved.epoch||saved.epoch!==active.epoch||!Number.isFinite(saved.until)||!Number.isFinite(active.until)||saved.until<=Date.now()||active.until<=Date.now())return null;
   return Math.min(saved.until,active.until);
  }catch{return null;}
 }
 function restoreInstalled(role){
  try{
   const rawTab=tabRaw(),tab=tabStamp();
   const gateUntil=(!role||role==='GATE_KEEPER')?gateResumeUntil():null;
   // Safari may restore an older, expired tab after a different tab renewed
   // the same dedicated scanner. Only replace an absent tab or a well-formed
   // tab with the same account AND epoch; never override a different identity.
   const prepared=parse(localStorage,GATE);
   if(gateUntil&&(rawTab===null||(same(tab,prepared)&&tab.epoch===prepared.epoch))){const stamp={...prepared,until:gateUntil};writeTab(stamp);return stamp;}
   if(rawTab!==null)return null;
   if(!installed())return null;
   const saved=parse(localStorage,INSTALLED),active=parse(localStorage,KEY);
   if(!saved||!staffOffline(saved.role)||!same(saved,active)||!saved.epoch||saved.epoch!==active.epoch||
      !Number.isFinite(saved.until)||!Number.isFinite(active.until)||saved.until<=Date.now()||active.until<=Date.now()||
      (role&&saved.role!==role))return null;
   const stamp={...saved,until:Math.min(saved.until,active.until)};
   writeTab(stamp);return stamp;
  }catch{return null;}
 }
 function current(role){
  try{
   const a=tabStamp(),b=parse(localStorage,KEY);
   if(same(a,b)&&a.epoch&&a.epoch===b.epoch&&Number.isFinite(a.until)&&Number.isFinite(b.until)&&a.until>Date.now()&&b.until>Date.now()&&(!role||a.role===role))return a;
   return navigator.onLine===false?restoreInstalled(role):null;
  }catch{return null;}
 }
 function matches(role,schoolId,accountId){const a=current(role);return !!a&&a.schoolId===String(schoolId)&&a.accountId===String(accountId);}
 function requireRole(role){const a=current(role);if(!a)throw Error('Offline access is restricted to your last verified account. Reconnect and sign in with the correct role.');return a;}
 async function authorize(role){
  if(navigator.onLine!==false){
   try{
    const controller=typeof AbortController==='function'?new AbortController():null;
    const timer=controller?setTimeout(()=>controller.abort(),4500):null;
    let r;try{r=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store',...(controller?{signal:controller.signal}:{})});}finally{if(timer!==null)clearTimeout(timer);}
    if([401,403,428].includes(r.status)){await clear();return null;}
    if(r.ok){const d=await r.json();record(d.user,d.expiresAt);await flushGate();return current(role);}
   }catch{}
  }
  return current(role)||restoreInstalled(role)||await restoreGateLease(role);
 }
 function watch(fn){window.addEventListener('storage',e=>{if(e.key===KEY||e.key===null)fn();});window.addEventListener('pageshow',fn);document.addEventListener('visibilitychange',()=>{if(!document.hidden)fn();});}
 window.AttendigoOfflineAccount={record,clear,current,matches,requireRole,authorize,watch,markGatePrepared,persistGatePrepared,clearGateResume,gateResumeUntil,gateResumeDiagnostic,gateResumeMessage,flushGate};
})();
