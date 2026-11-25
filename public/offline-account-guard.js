/* Offline UI authorization: a passphrase is not an account login.
 * No credential/token is persisted here. Offline browser checks are not a substitute for server authentication. */
(()=>{'use strict';
 const KEY='attendigo.offline.activeAccount.v1',TAB='attendigo.offline.verifiedTab.v1',STUDENT='attendigo.studentQrCapture';
 const INSTALLED='attendigo.offline.installedStaff.v1';
 const installed=()=>navigator.standalone===true||window.matchMedia?.('(display-mode: standalone)').matches===true;
 const staffOffline=role=>role==='TEACHER'||role==='GATE_KEEPER';
 const ROLES=new Set(['STUDENT','TEACHER','GATE_KEEPER']);
 const parse=(store,key)=>{try{return JSON.parse(store.getItem(key)||'null');}catch{return null;}};
 const identity=u=>u&&!u.mustChangePassword&&ROLES.has(u.role)&&u.schoolId&&(u.role==='STUDENT'?u.studentAccountId:u.userId)?{role:u.role,schoolId:String(u.schoolId),accountId:String(u.role==='STUDENT'?u.studentAccountId:u.userId)}:null;
 const same=(a,b)=>!!a&&!!b&&a.role===b.role&&a.schoolId===b.schoolId&&a.accountId===b.accountId;
 function clear(){try{sessionStorage.removeItem(TAB);sessionStorage.removeItem(STUDENT);localStorage.removeItem(KEY);localStorage.removeItem(INSTALLED);}catch{}}
 function record(user,expiresAt){
  const id=identity(user);if(!id){clear();return null;}
  try{
   const old=parse(localStorage,KEY),prior=parse(sessionStorage,TAB);
   const end=Date.parse(expiresAt||(same(prior,id)?sessionStorage.getItem('schoolAttendance.expiresAt'):'')||'');
   const until=Math.min(Date.now()+12*60*60*1000,Number.isFinite(end)?end:Infinity);
   if(until<=Date.now()){clear();return null;}
   const epoch=same(old,id)&&old.until>Date.now()&&old.epoch?old.epoch:crypto.randomUUID();
   if(!same(prior,id))sessionStorage.removeItem(STUDENT);
   const stamp={...id,epoch,until};
   localStorage.setItem(KEY,JSON.stringify(stamp));sessionStorage.setItem(TAB,JSON.stringify(stamp));
   // Only an online-verified installed teacher/gatekeeper session can establish
   // a resumable stamp. The actual encrypted data still requires its passphrase.
   if(installed()&&staffOffline(stamp.role)&&Number.isFinite(Date.parse(expiresAt||'')))localStorage.setItem(INSTALLED,JSON.stringify(stamp));
   else if(!same(old,stamp)||old?.epoch!==stamp.epoch)localStorage.removeItem(INSTALLED);
   return stamp;
  }catch{return null;}
 }
 function restoreInstalled(role){
  try{
   if(!installed()||sessionStorage.getItem(TAB)!==null)return null;
   const saved=parse(localStorage,INSTALLED),active=parse(localStorage,KEY);
   if(!saved||!staffOffline(saved.role)||!same(saved,active)||!saved.epoch||saved.epoch!==active.epoch||
      !Number.isFinite(saved.until)||!Number.isFinite(active.until)||saved.until<=Date.now()||active.until<=Date.now()||
      (role&&saved.role!==role))return null;
   const stamp={...saved,until:Math.min(saved.until,active.until)};
   sessionStorage.setItem(TAB,JSON.stringify(stamp));return stamp;
  }catch{return null;}
 }
 function current(role){
  try{
   const a=parse(sessionStorage,TAB)||(navigator.onLine===false?restoreInstalled(role):null),b=parse(localStorage,KEY);
   if(!same(a,b)||!a.epoch||a.epoch!==b.epoch||a.until<=Date.now()||b.until<=Date.now()||(role&&a.role!==role))return null;
   return a;
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
    if([401,403,428].includes(r.status)){clear();return null;}
    if(r.ok){const d=await r.json();record(d.user,d.expiresAt);return current(role);}
   }catch{}
  }
  return current(role)||restoreInstalled(role);
 }
 function watch(fn){window.addEventListener('storage',e=>{if(e.key===KEY||e.key===null)fn();});window.addEventListener('pageshow',fn);document.addEventListener('visibilitychange',()=>{if(!document.hidden)fn();});}
 window.AttendigoOfflineAccount={record,clear,current,matches,requireRole,authorize,watch};
})();
