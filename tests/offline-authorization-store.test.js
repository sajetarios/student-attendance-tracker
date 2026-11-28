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
 function reopen(){
  const window={};
  const context=vm.createContext({window,indexedDB,crypto:webcrypto,TextEncoder,TextDecoder,btoa,atob,Date:Clock});
  vm.runInContext(source('offline-lease-crypto.js'),context);
  vm.runInContext(source('offline-authorization-store.js'),context);
  return window.AttendigoOfflineAuthorizationStore;
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
