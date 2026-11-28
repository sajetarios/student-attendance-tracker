'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto,generateKeyPairSync}=require('node:crypto');
const {offlineAuthorizationContext,issueOfflineLease}=require('../offline-authorization-lease');
const source=name=>fs.readFileSync(require.resolve('../public/'+name),'utf8');
const signer=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const privateKey=signer.privateKey.export({format:'der',type:'pkcs8'}).toString('base64');
function device(){
 const records=new Map();
 let clock=Date.now(), unavailable=false;
 class Clock extends Date{static now(){return clock;}}
 const db={close(){},transaction(){
  const tx={abort(){this.onabort?.();}};
  tx.objectStore=()=>({
   get(role){const req={};setImmediate(()=>{
    req.result=records.get(role);req.onsuccess?.();if(!tx.error)tx.oncomplete?.();
   });return req;},
   put(row){records.set(row.role,row);}
  });return tx;
 }};
 const indexedDB={open(name){assert.equal(name,'attendigo-offline-authorization-v1');
  const req={result:db};setImmediate(()=>{if(unavailable){req.error=Error('Storage unavailable');req.onerror?.();}else req.onsuccess?.();});return req;
 }};
 function reopen(fetch){
  const window={};
  const context=vm.createContext({window,indexedDB,crypto:webcrypto,TextEncoder,TextDecoder,btoa,atob,Date:Clock,fetch,AbortController,setTimeout,clearTimeout});
  vm.runInContext(source('offline-lease-crypto.js'),context);
  vm.runInContext(source('offline-authorization-store.js'),context);
  vm.runInContext(source('offline-provisioning.js'),context);
  return Object.assign({},window.AttendigoOfflineAuthorizationStore,{provision:window.AttendigoOfflineProvisioning.provision});
 }
 function inputs(role='TEACHER',account='account-a'){
  return {user:{role,schoolId:'school-a',userId:account,studentAccountId:account,departmentId:'dept-a'},
   sessionId:'session-'+account,expiresAt:new Date(clock+60000).toISOString(),privateKey,now:clock};
 }
 return {reopen,records,inputs,advance(ms){clock+=ms;},fail(){unavailable=true;}};
}
async function prepare(api,input){
 const context=offlineAuthorizationContext(input);
 const attempt=await api.begin(input.user.role,context);
 const lease=issueOfflineLease({...input,devicePublicKey:attempt.devicePublicKey});
 return {context,attempt,lease};
}
test('verified device authorization survives a fresh page context for all seven roles without a bearer credential',async()=>{
 const d=device(),a=d.reopen();
 for(const role of ['SCHOOL_ADMIN','DEPARTMENT_HEAD','PRINCIPAL','TEACHER','GATE_KEEPER','PARENT','STUDENT']){
  const {context,attempt,lease}=await prepare(a,d.inputs(role));
  assert.equal(await a.authorize(role),null);
  assert.equal(await a.complete(role,attempt.generation,lease,context),true);
  const claim=await d.reopen().authorize(role);
  assert.equal(claim.role,role);assert.equal(claim.accountId,'account-a');
  const record=d.records.get(role);
  assert.equal(record.device.privateKey.extractable,false);
  assert.equal(Object.hasOwn(record,'token'),false);
 }
});
test('logout and superseded account provisioning cannot restore a revoked role',async()=>{
 const d=device(),a=d.reopen(),b=d.reopen();
 const old=await prepare(a,d.inputs());
 await b.revoke('TEACHER');
 assert.equal(await a.complete('TEACHER',old.attempt.generation,old.lease,old.context),false);
 assert.equal(await b.authorize('TEACHER'),null);
 const next=await prepare(b,d.inputs('TEACHER','account-b'));
 assert.equal(await a.complete('TEACHER',old.attempt.generation,old.lease,old.context),false);
 assert.equal(await b.complete('TEACHER',next.attempt.generation,next.lease,next.context),true);
 assert.equal((await a.authorize('TEACHER')).accountId,'account-b');
});
test('mismatched confirmation context, expired lease, clock rollback and unavailable storage fail closed',async()=>{
 const d=device(),a=d.reopen(),p=await prepare(a,d.inputs());
 assert.equal(await a.complete('TEACHER',p.attempt.generation,p.lease,{...p.context,expected:{...p.context.expected,departmentId:'dept-b'}}),false);
 assert.equal(await a.complete('TEACHER',p.attempt.generation,p.lease,p.context),true);
 d.advance(1000);assert.ok(await a.authorize('TEACHER'));
 d.advance(-1);assert.equal(await d.reopen().authorize('TEACHER'),null);
 d.advance(60001);assert.equal(await a.authorize('TEACHER'),null);
 d.fail();assert.equal(await a.authorize('TEACHER'),null);
 await assert.rejects(a.revoke('TEACHER'),/Storage unavailable/);
});

test('generation checkpoints reject delayed provisioning after logout and stale revocation after account switch',async()=>{
 const d=device(),a=d.reopen(),b=d.reopen(),context=offlineAuthorizationContext(d.inputs());
 const checkpoint=await a.checkpoint('TEACHER');
 await b.revoke('TEACHER');
 await assert.rejects(a.begin('TEACHER',context,checkpoint),/superseded/);
 const p=await prepare(b,d.inputs('TEACHER','account-b'));
 assert.equal(await b.complete('TEACHER',p.attempt.generation,p.lease,p.context),true);
 assert.equal(await a.revoke('TEACHER',checkpoint),false);
 assert.equal((await a.authorize('TEACHER')).accountId,'account-b');
});
test('provisions every role through independent context, signed lease and fresh session confirmation',async()=>{
 const d=device();
 for(const role of ['SCHOOL_ADMIN','DEPARTMENT_HEAD','PRINCIPAL','TEACHER','GATE_KEEPER','PARENT','STUDENT']){
  const input=d.inputs(role),calls=[];
  const api=d.reopen(async(path,opts)=>{
   calls.push(path);
   assert.equal(opts.credentials,'same-origin');assert.equal(opts.cache,'no-store');
   assert.equal(opts.redirect,'error');
   const value=path.endsWith('offline-context')?offlineAuthorizationContext(input):
    issueOfflineLease({...input,...JSON.parse(opts.body)});
   return {ok:true,json:async()=>value};
  });
  const result=await api.provision(input.user);
  assert.equal(result.status,'READY');assert.equal(result.renewed,true);
  assert.deepEqual(calls,['/api/auth/offline-context','/api/auth/offline-lease','/api/auth/offline-context']);
  assert.equal((await d.reopen().authorize(role)).accountId,'account-a');
 }
});
test('logout during context request does not resurrect an offline authorization',async()=>{
 const d=device(),input=d.inputs();let entered,release;
 const wait=new Promise(r=>{entered=r;}),blocked=new Promise(r=>{release=r;});
 const api=d.reopen(async()=>{entered();await blocked;return {ok:true,json:async()=>offlineAuthorizationContext(input)};});
 const attempt=api.provision(input.user);
 await wait;await d.reopen().revoke('TEACHER');release();
 assert.notEqual((await attempt).status,'READY');
 assert.equal(await api.authorize('TEACHER'),null);
});
test('session switch after issuance locks authorization rather than trusting the issued lease',async()=>{
 const d=device(),input=d.inputs(),next=d.inputs('TEACHER','account-b');let contexts=0;
 const api=d.reopen(async(path,opts)=>{
  const value=path.endsWith('offline-context')?offlineAuthorizationContext(contexts++?next:input):
   issueOfflineLease({...input,...JSON.parse(opts.body)});
  return {ok:true,json:async()=>value};
 });
 assert.equal((await api.provision(input.user)).status,'ACCOUNT_CHANGED');
 assert.equal(await api.authorize('TEACHER'),null);
});

test('browser-wide sign-out revokes all seven roles and blocks delayed completion without touching other stores',async()=>{
 const d=device(),a=d.reopen(),b=d.reopen();
 const roles=['SCHOOL_ADMIN','DEPARTMENT_HEAD','PRINCIPAL','TEACHER','GATE_KEEPER','PARENT','STUDENT'];
 const pending=[];
 for(const role of roles){
  const p=await prepare(a,d.inputs(role));pending.push({role,...p});
  if(role!=='STUDENT')assert.equal(await a.complete(role,p.attempt.generation,p.lease,p.context),true);
 }
 const checkpoints=await Promise.all(roles.map(role=>a.checkpoint(role)));
 assert.equal(await b.revokeAll(),true);
 for(const [i,p] of pending.entries()){
  assert.equal(await a.authorize(p.role),null);
  assert.equal(await a.complete(p.role,p.attempt.generation,p.lease,p.context),false);
  await assert.rejects(a.begin(p.role,p.context,checkpoints[i]),/superseded/);
  assert.equal(d.records.get(p.role).state,'REVOKED');
  assert.equal(Object.hasOwn(d.records.get(p.role),'device'),false);
 }
});

test('authenticated role switching invalidates prior grants without permitting a stale role checkpoint to revoke the new role',async()=>{
 const d=device(),a=d.reopen(),old=await prepare(a,d.inputs('TEACHER'));
 assert.equal(await a.complete('TEACHER',old.attempt.generation,old.lease,old.context),true);
 const prior=await a.checkpoint('TEACHER');
 const input=d.inputs('GATE_KEEPER','guard-b');
 const b=d.reopen(async(path,opts)=>({ok:true,json:async()=>path.endsWith('offline-context')?
  offlineAuthorizationContext(input):issueOfflineLease({...input,...JSON.parse(opts.body)})}));
 assert.equal((await b.provision(input.user)).status,'READY');
 assert.equal(await a.authorize('TEACHER'),null);
 assert.equal(await a.revokeOtherRoles('TEACHER',prior),false);
 assert.equal((await b.authorize('GATE_KEEPER')).accountId,'guard-b');
});

test('authoritative 401 invalidates browser-wide grants without deleting attendance stores',async()=>{
 const d=device(),api=d.reopen(async()=>({ok:false,status:401}));
 for(const role of ['TEACHER','GATE_KEEPER']){
  const p=await prepare(api,d.inputs(role));
  assert.equal(await api.complete(role,p.attempt.generation,p.lease,p.context),true);
 }
 assert.equal((await api.provision(d.inputs().user)).status,'LOCKED');
 assert.equal(await api.authorize('TEACHER'),null);
 assert.equal(await api.authorize('GATE_KEEPER'),null);
});
test('a delayed 401 cannot revoke a newer authenticated role',async()=>{
 const d=device(),input=d.inputs();let entered,release;
 const wait=new Promise(r=>{entered=r;}),blocked=new Promise(r=>{release=r;});
 const a=d.reopen(async()=>{entered();await blocked;return {ok:false,status:401};});
 const pending=a.provision(input.user);
 await wait;
 const next=d.inputs('GATE_KEEPER','guard-b');
 const b=d.reopen(async(path,opts)=>({ok:true,json:async()=>path.endsWith('offline-context')?
  offlineAuthorizationContext(next):issueOfflineLease({...next,...JSON.parse(opts.body)})}));
 assert.equal((await b.provision(next.user)).status,'READY');
 release();await pending;
 assert.equal((await b.authorize('GATE_KEEPER')).accountId,'guard-b');
});
