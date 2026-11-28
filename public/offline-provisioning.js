/* Network-only offline provisioning coordinator. No bearer credentials are
 * persisted. This is a lifecycle primitive, not yet mounted in portal pages.
 * A caller must pass the identity from successful online session validation. */
(()=>{'use strict';
 const roles=new Set(['SCHOOL_ADMIN','DEPARTMENT_HEAD','PRINCIPAL','TEACHER','GATE_KEEPER','PARENT','STUDENT']);
 const flights=new Map();
 const store=()=>window.AttendigoOfflineAuthorizationStore;
 const identity=user=>{
  const account=user?.role==='STUDENT'?user.studentAccountId:user?.userId;
  if(!roles.has(user?.role)||!user.schoolId||!account||user.mustChangePassword)return null;
  return {role:user.role,schoolId:String(user.schoolId),accountId:String(account),
   departmentId:user.departmentId==null?null:String(user.departmentId)};
 };
 const same=(a,b)=>!!a&&!!b&&a.role===b.role&&a.schoolId===b.schoolId&&a.accountId===b.accountId&&
  Object.hasOwn(b,'departmentId')&&a.departmentId===b.departmentId;
 const sameContext=(a,b)=>same(a?.expected,b?.expected)&&a.expected.epoch===b.expected.epoch&&a.kid===b.kid;
 const authFailure=status=>[401,403,428].includes(status);
 async function request(path,body){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),10000);
  try{
   const response=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',
    redirect:'error',signal:controller.signal,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
   if(!response.ok){const error=Error('Offline authorization request unavailable');error.status=response.status;throw error;}
   return await response.json();
  }finally{clearTimeout(timeout);}
 }
 async function run(id){
  const role=id.role;
  let checkpoint, known=false;
  try{
   checkpoint=await store().checkpoint(role);known=true;
   const context=await request('/api/auth/offline-context');
   if(!same(id,context?.expected)){
    await store().revoke(role,checkpoint);
    return {status:'ACCOUNT_CHANGED'};
   }
   if(!await store().revokeOtherRoles(role,checkpoint))return {status:'LOCKED'};
   // Avoid new key generation/lease requests on every visibility event when
   // the same session, issuer and current valid grant already cover this role.
   const prior=await store().authorize(role);
   if(prior&&same(id,prior)&&prior.epoch===context.expected.epoch&&prior.kid===context.kid&&
      prior.expiresAt<=context.expiresAt&&prior.expiresAt-Date.now()>5*60*1000)
    return {status:'READY',renewed:false};
   const attempt=await store().begin(role,context,checkpoint);
   checkpoint=attempt.generation;
   const lease=await request('/api/auth/offline-lease',{devicePublicKey:attempt.devicePublicKey});
   // Confirm the session independently after issuance, not from lease claims.
   const confirmed=await request('/api/auth/offline-context');
   if(!sameContext(context,confirmed)){
    await store().revoke(role,checkpoint);
    return {status:'ACCOUNT_CHANGED'};
   }
   if(!await store().complete(role,checkpoint,lease,confirmed)){
    await store().revoke(role,checkpoint);
    return {status:'LOCKED'};
   }
   return {status:'READY',renewed:true};
  }catch(error){
   if(known&&authFailure(error?.status)){
    try{await store().revoke(role,checkpoint);}catch{return {status:'STORAGE_UNAVAILABLE'};}
    return {status:'LOCKED'};
   }
   return {status:'UNAVAILABLE'};
  }
 }
 function provision(user){
  const id=identity(user);
  if(!id)return Promise.resolve({status:'INELIGIBLE'});
  const current=flights.get(id.role);
  if(current)return same(id,current.id)?current.promise:Promise.resolve({status:'ACCOUNT_CHANGED'});
  const promise=run(id).finally(()=>{if(flights.get(id.role)?.promise===promise)flights.delete(id.role);});
  flights.set(id.role,{id,promise});return promise;
 }
 window.AttendigoOfflineProvisioning=Object.freeze({provision});
})();