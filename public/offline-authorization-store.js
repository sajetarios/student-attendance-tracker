/* Persistent, fail-closed offline authorization state. Isolated from attendance
 * records and legacy fallback; no access token, password or snapshot stored here.
 * Callers must supply independently authenticated online context. This module
 * is not yet connected to login, logout or dashboard rendering. */
(()=>{'use strict';
 const DB='attendigo-offline-authorization-v1', STORE='roles';
 const ROLES=new Set(['SCHOOL_ADMIN','DEPARTMENT_HEAD','PRINCIPAL','TEACHER','GATE_KEEPER','PARENT','STUDENT']);
 const roleKey=role=>{if(!ROLES.has(role))throw Error('Invalid offline role');return role;};
 const open=()=>new Promise((resolve,reject)=>{
  const req=indexedDB.open(DB,1);
  req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE,{keyPath:'role'});};
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error||Error('Authorization storage unavailable'));
 });
 // Read/modify/write is atomic across tabs. Async cryptography runs outside
 // transactions; generation comparisons prevent a late result undoing revocation.
 async function transact(role,mode,action){
  roleKey(role);const db=await open();
  try{return await new Promise((resolve,reject)=>{
   const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE);
   let result, failure;
   tx.oncomplete=()=>resolve(result);
   tx.onabort=()=>reject(failure||tx.error||Error('Authorization storage aborted'));
   tx.onerror=()=>reject(tx.error||Error('Authorization storage failed'));
   const req=store.get(role);
   req.onsuccess=()=>{try{result=action(req.result||null,store);}catch(error){failure=error;tx.abort();}};
  });}finally{db.close();}
 }
 const read=role=>transact(role,'readonly',row=>row);
 const generation=()=>crypto.randomUUID();
 const sameScope=(a,b)=>a&&b&&a.role===b.role&&a.schoolId===b.schoolId&&a.accountId===b.accountId&&
  Object.hasOwn(a,'departmentId')&&Object.hasOwn(b,'departmentId')&&a.departmentId===b.departmentId&&a.epoch===b.epoch;
 const validScope=(role,s)=>s?.role===role&&typeof s.schoolId==='string'&&!!s.schoolId&&
  typeof s.accountId==='string'&&!!s.accountId&&typeof s.epoch==='string'&&!!s.epoch&&
  Object.hasOwn(s,'departmentId')&&(s.departmentId===null||typeof s.departmentId==='string');
 // Call only after a successful authenticated context fetch. A new attempt
 // locks the previous role authorization; incomplete provisioning fails closed.
 async function checkpoint(role){const row=await read(role);return row?.generation??null;}
 async function begin(role,context,expectedGeneration){
  roleKey(role);
  if(!validScope(role,context?.expected)||!Number.isSafeInteger(context.serverTime)||
     !Number.isSafeInteger(context.expiresAt)||context.expiresAt<=context.serverTime||
     !context.trustedIssuer||!context.kid)throw Error('Invalid online authorization context');
  const id=generation();
  const started=await transact(role,'readwrite',(old,store)=>{
   if(expectedGeneration!==undefined&&(old?.generation??null)!==expectedGeneration)return false;
   store.put({role,generation:id,state:'PROVISIONING'});return true;
  });
  if(!started)throw Error('Offline provisioning superseded');
  const device=await window.AttendigoOfflineLeaseCrypto.createDeviceKey();
  const ok=await transact(role,'readwrite',(row,store)=>{
   if(row?.generation!==id||row.state!=='PROVISIONING')return false;
   store.put({...row,device,expected:context.expected,trustedIssuer:context.trustedIssuer,
    kid:context.kid,contextExpiresAt:context.expiresAt,serverTime:context.serverTime});
   return true;
  });
  if(!ok)throw Error('Offline provisioning superseded');
  return {generation:id,devicePublicKey:device.publicKey};
 }
 async function complete(role,id,lease,confirmedContext){
  const row=await read(role),now=Date.now();
  if(row?.generation!==id||row.state!=='PROVISIONING'||!row.device||
     !sameScope(row.expected,confirmedContext?.expected)||row.kid!==confirmedContext.kid||
     !Number.isSafeInteger(confirmedContext.serverTime)||!Number.isSafeInteger(confirmedContext.expiresAt)||
     now<row.serverTime||now<confirmedContext.serverTime)return false;
  const verifier=window.AttendigoOfflineLeaseCrypto;
  if(await verifier.thumbprint(row.trustedIssuer)!==row.kid||
     await verifier.thumbprint(confirmedContext.trustedIssuer)!==row.kid)return false;
  const c=await verifier.verifyLease({lease,trustedIssuer:row.trustedIssuer,expected:row.expected,
   device:row.device,now,lastObservedAt:row.serverTime});
  if(!c||c.expiresAt>confirmedContext.expiresAt||c.issuedAt<row.serverTime)return false;
  return transact(role,'readwrite',(latest,store)=>{
   if(latest?.generation!==id||latest.state!=='PROVISIONING')return false;
   if(Date.now()<now||Date.now()>=c.expiresAt)return false;
   store.put({...latest,state:'AUTHORIZED',lease,lastObservedAt:Date.now()});return true;
  });
 }
 async function authorize(role){
  try{
   const row=await read(role),now=Date.now();
   if(row?.state!=='AUTHORIZED'||!validScope(role,row.expected))return null;
   const c=await window.AttendigoOfflineLeaseCrypto.verifyLease({lease:row.lease,
    trustedIssuer:row.trustedIssuer,expected:row.expected,device:row.device,now,lastObservedAt:row.lastObservedAt});
   if(!c)return null;
   return await transact(role,'readwrite',(latest,store)=>{
    const current=Date.now();
    if(latest?.generation!==row.generation||latest.state!=='AUTHORIZED'||
       !Number.isSafeInteger(latest.lastObservedAt)||current<now||current<latest.lastObservedAt||
       current>=c.expiresAt)return null;
    store.put({...latest,lastObservedAt:current});return c;
   });
  }catch{return null;}
 }
 async function revoke(role,expectedGeneration){
  // Never delete any attendance queue or legacy profile. Tombstone prevents
  // in-flight provisioning from restoring an authorization after sign-out.
  return transact(role,'readwrite',(row,store)=>{
   if(expectedGeneration!==undefined&&(row?.generation??null)!==expectedGeneration)return false;
   store.put({role,generation:generation(),state:'REVOKED'});return true;
  });
 }
 // The existing cookie session is browser-wide. Sign-out must invalidate every
 // role slot in one IndexedDB transaction, including incomplete provisioning.
 async function revokeAll(){
  return transact('TEACHER','readwrite',(_row,store)=>{
   for(const role of ROLES)store.put({role,generation:generation(),state:'REVOKED'});
   return true;
  });
 }
 window.AttendigoOfflineAuthorizationStore=Object.freeze({checkpoint,begin,complete,authorize,revoke,revokeAll});
})();