const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/offline-account-guard.js'),'utf8');
const guardSource=fs.readFileSync(path.join(__dirname,'../public/session-guard.js'),'utf8');
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}};
const teacher={role:'TEACHER',schoolId:'school',userId:'teacher'};
const gate={role:'GATE_KEEPER',schoolId:'school',userId:'guard'};
const student={role:'STUDENT',schoolId:'school',studentAccountId:'student'};
const expires=()=>new Date(Date.now()+3600000).toISOString();
let epoch=0;
function launch(localStorage,{standalone=true,online=false,sessionStorage=storage(),fetch=async()=>{throw Error('offline')},indexedDB}={}){
 const window={matchMedia:()=>({matches:standalone})};
 vm.runInNewContext(source,{window,navigator:{standalone,onLine:online},localStorage,sessionStorage,crypto:{randomUUID:()=>String(++epoch)},fetch,AbortController,setTimeout,clearTimeout,indexedDB});
 return {guard:window.AttendigoOfflineAccount,sessionStorage};
}
test('installed teacher and gatekeeper can resume only their own unexpired stamp after close',()=>{
 for(const account of [teacher,gate]){
  const local=storage(), first=launch(local,{online:true});
  first.guard.record(account,expires());
  const reopened=launch(local);
  assert.equal(reopened.guard.current(account.role).accountId,account.userId);
  assert.equal(reopened.guard.current(account===teacher?'GATE_KEEPER':'TEACHER'),null);
 }
});
test('normal browser tab cannot restore a closed installed session',async()=>{
 const local=storage();launch(local,{online:true}).guard.record(teacher,expires());
 const browser=launch(local,{standalone:false});
 assert.equal(browser.guard.current(),null);assert.equal(await browser.guard.authorize('TEACHER'),null);
});
test('ordinary browser sign-in does not establish an installed resume stamp',()=>{
 const local=storage();launch(local,{standalone:false,online:true}).guard.record(teacher,expires());
 assert.equal(launch(local).guard.current(),null);
});
test('student sessions and unverified or expired staff cannot be restored',()=>{
 for(const [u,end] of [[student,expires()],[teacher,undefined],[teacher,new Date(Date.now()-100).toISOString()]]){
  const local=storage();launch(local,{online:true}).guard.record(u,end);
  assert.equal(launch(local).guard.current(),null);
 }
});
test('logout and account changes invalidate the previous installed stamp',()=>{
 const local=storage(),first=launch(local,{online:true});
 first.guard.record(teacher,expires());first.guard.clear();
 assert.equal(launch(local).guard.current(),null);
 first.guard.record(teacher,expires());launch(local,{standalone:false,online:true}).guard.record(gate,expires());
 assert.equal(launch(local).guard.current(),null);
});
test('explicit server rejection clears the offline resume authorization',async()=>{
 const local=storage();launch(local,{online:true}).guard.record(teacher,expires());
 const reopened=launch(local,{online:true,fetch:async()=>({status:401,ok:false})});
 assert.equal(await reopened.guard.authorize('TEACHER'),null);
 assert.equal(launch(local).guard.current(),null);
});
test('network failure offers recovery rather than displaying protected dashboard',async()=>{
 let target=null;const handlers={};const root={dataset:{protectedRole:'STAFF'},style:{}};
 const document={documentElement:root,addEventListener:()=>{}};
 const window={location:{replace:value=>{target=value}},addEventListener:(name,fn)=>{handlers[name]=fn}};
 vm.runInNewContext(guardSource,{document,window,navigator:{onLine:false,serviceWorker:{controller:{}}},sessionStorage:storage(),fetch:async()=>{throw Error('offline')}});
 handlers.pageshow({persisted:true});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(target,'/offline-welcome.html');assert.equal(root.style.visibility,'hidden');
});


test('verified Gatekeeper recovers directly into scanner, never a cached private dashboard',async()=>{
 let target=null;const handlers={};const root={dataset:{protectedRole:'STAFF'},style:{}};
 const document={documentElement:root,addEventListener:()=>{}};
 const window={AttendigoOfflineAccount:{current:role=>role==='GATE_KEEPER'?{role}:null},location:{replace:value=>{target=value}},addEventListener:(name,fn)=>{handlers[name]=fn}};
 vm.runInNewContext(guardSource,{document,window,navigator:{onLine:false,serviceWorker:{controller:{}}},sessionStorage:storage(),fetch:async()=>{throw Error('offline')}});
 handlers.pageshow({persisted:true});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(target,'/gate-offline.html');assert.equal(root.style.visibility,'hidden');
});


test('only explicitly prepared Gatekeeper browser can reopen offline, with bounded account and device expiry',async()=>{
 const local=storage(),first=launch(local,{standalone:false,online:true});
 first.guard.record(gate,expires());
 assert.equal(launch(local,{standalone:false}).guard.current(),null);
 const deadline=Date.now()+1800000;
 assert.equal(first.guard.markGatePrepared({role:'GATE_KEEPER',schoolId:'other',userId:'guard',validUntil:new Date(deadline).toISOString()}),false);
 assert.equal(first.guard.markGatePrepared({role:'GATE_KEEPER',schoolId:'school',userId:'guard',validUntil:new Date(deadline).toISOString()}),true);
 const reopened=launch(local,{standalone:false});
 assert.equal(reopened.guard.current('GATE_KEEPER').accountId,'guard');
 assert.equal(reopened.guard.current('GATE_KEEPER').until,deadline);
 assert.equal(reopened.guard.current('TEACHER'),null);
 first.guard.clearGateResume();assert.equal(launch(local,{standalone:false}).guard.current(),null);
 assert.equal(first.guard.markGatePrepared({role:'GATE_KEEPER',schoolId:'school',userId:'guard',validUntil:new Date(deadline).toISOString()}),true);
 first.guard.clear();assert.equal(launch(local,{standalone:false}).guard.current(),null);
});
test('prepared Gatekeeper browser cannot resume after server rejection, account switch or expired device',async()=>{
 const local=storage(),first=launch(local,{standalone:false,online:true});
 first.guard.record(gate,expires());
 const scope={role:'GATE_KEEPER',schoolId:'school',userId:'guard',validUntil:expires()};
 assert.equal(first.guard.markGatePrepared({...scope,validUntil:new Date(Date.now()-1000).toISOString()}),false);
 assert.equal(first.guard.markGatePrepared(scope),true);
 const rejected=launch(local,{standalone:false,online:true,fetch:async()=>({status:401,ok:false})});
 assert.equal(await rejected.guard.authorize('GATE_KEEPER'),null);
 assert.equal(launch(local,{standalone:false}).guard.current(),null);
 first.guard.record(gate,expires());first.guard.markGatePrepared(scope);
 launch(local,{standalone:false,online:true}).guard.record(teacher,expires());
 assert.equal(launch(local,{standalone:false}).guard.current(),null);
});


test('restored expired tab can recover same renewed Gatekeeper epoch but not another account',async()=>{
 const local=storage(),first=launch(local,{standalone:false,online:true});
 first.guard.record(gate,expires());
 const scope={role:'GATE_KEEPER',schoolId:'school',userId:'guard',validUntil:expires()};
 assert.equal(first.guard.markGatePrepared(scope),true);
 const tab=storage(),key='attendigo.offline.verifiedTab.v1',stamp=JSON.parse(first.sessionStorage.getItem(key));
 tab.setItem(key,JSON.stringify({...stamp,until:Date.now()-1000}));
 const reopened=launch(local,{standalone:false,sessionStorage:tab});
 assert.equal(reopened.guard.current('GATE_KEEPER').accountId,'guard');
 for(const bad of [{...stamp,epoch:'different'},{...stamp,accountId:'other'},'bad']){
  const stale=storage();stale.setItem(key,JSON.stringify(bad));
  assert.equal(launch(local,{standalone:false,sessionStorage:stale}).guard.current('GATE_KEEPER'),null);
 }
});
test('prepared browser with Wi-Fi but no server resumes after failed verification',async()=>{
 const local=storage(),first=launch(local,{standalone:false,online:true});first.guard.record(gate,expires());
 first.guard.markGatePrepared({role:'GATE_KEEPER',schoolId:'school',userId:'guard',validUntil:expires()});
 const cold=launch(local,{standalone:false,online:true});
 assert.equal(await cold.guard.authorize('GATE_KEEPER').then(a=>a.accountId),'guard');
});

 
// An asynchronous transaction fake intentionally completes after the request
// succeeds, exercising the production read-after-commit check.
function persistentAuthorizationStorage(){
 const entries=new Map();
 let created=false;
 const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
 const db={
  objectStoreNames:{contains:()=>created},
  createObjectStore(){created=true;},
  close(){},
  transaction(){
   let aborted=false;
   const tx={
    abort(){aborted=true;queueMicrotask(()=>tx.onabort?.());},
    objectStore(){
     const request=action=>{
      const req={};
      queueMicrotask(()=>{
       if(aborted)return;
       req.result=action();
       req.onsuccess?.();
       queueMicrotask(()=>{if(!aborted)tx.oncomplete?.();});
      });
      return req;
     };
     return {get:key=>request(()=>clone(entries.get(key))),put:(value,key)=>request(()=>{entries.set(key,clone(value));return key;}),delete:key=>request(()=>entries.delete(key))};
    }
   };
   return tx;
  }
 };
 return {entries,open(){const request={result:db};queueMicrotask(()=>{if(!created)request.onupgradeneeded?.();request.onsuccess?.();});return request;}};
}
const activeKey='attendigo.offline.activeAccount.v1',preparedKey='attendigo.offline.preparedGate.v1',tabKey='attendigo.offline.verifiedTab.v1',revokedKey='attendigo.offline.gateRevoked.v1';
async function prepareDurable(local,indexedDB,validUntil=expires()){
 const first=launch(local,{standalone:false,online:true,indexedDB});
 first.guard.record(gate,expires());
 assert.equal(await first.guard.persistGatePrepared({role:'GATE_KEEPER',schoolId:'school',userId:'guard',validUntil}),true);
 return first;
}
test('durable gate authorization repairs either missing Web Storage marker after browser close, within the original bound',async()=>{
 for(const missing of [activeKey,preparedKey]){
  const local=storage(),indexedDB=persistentAuthorizationStorage(),end=Date.now()+1800000;
  await prepareDurable(local,indexedDB,new Date(end).toISOString());
  local.removeItem(missing);
  const cold=launch(local,{standalone:false,indexedDB});
  const restored=await cold.guard.authorize('GATE_KEEPER');
  assert.equal(restored.accountId,'guard');assert.equal(restored.until,end);
  assert.equal(cold.guard.gateResumeDiagnostic(),'recovered');
  assert.equal(cold.guard.matches('GATE_KEEPER','school','guard'),true);
  assert.equal(cold.guard.current('TEACHER'),null);
 }
});
test('durable recovery supports unavailable session storage without accepting a conflicting local account',async()=>{
 const local=storage(),indexedDB=persistentAuthorizationStorage();
 await prepareDurable(local,indexedDB);
 local.removeItem(preparedKey);
 const unavailable={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
 const cold=launch(local,{standalone:false,indexedDB,sessionStorage:unavailable});
 assert.equal((await cold.guard.authorize('GATE_KEEPER')).accountId,'guard');
 assert.equal(cold.guard.matches('GATE_KEEPER','school','guard'),true);
 const active=JSON.parse(local.getItem(activeKey));local.setItem(activeKey,JSON.stringify({...active,accountId:'other'}));
 assert.equal(cold.guard.matches('GATE_KEEPER','school','guard'),false);
 assert.equal(await cold.guard.authorize('GATE_KEEPER'),null);
});
test('durable authorization never overrides a conflicting tab or resurrects an account after loss of both continuity markers',async()=>{
 const local=storage(),indexedDB=persistentAuthorizationStorage();
 const first=await prepareDurable(local,indexedDB);
 const tab=storage();tab.setItem(tabKey,JSON.stringify({...JSON.parse(first.sessionStorage.getItem(tabKey)),epoch:'other-epoch'}));
 const conflicting=launch(local,{standalone:false,indexedDB,sessionStorage:tab});
 assert.equal(await conflicting.guard.authorize('GATE_KEEPER'),null);
 assert.equal(conflicting.guard.gateResumeDiagnostic(),'account-mismatch');
 local.removeItem(activeKey);local.removeItem(preparedKey);
 const cold=launch(local,{standalone:false,indexedDB});
 assert.equal(await cold.guard.authorize('GATE_KEEPER'),null);
 assert.equal(cold.guard.gateResumeDiagnostic(),'continuity-missing');
});
test('durable lease is removed by explicit logout, account switch, or server rejection',async()=>{
 for(const action of ['logout','switch','rejection']){
  const local=storage(),indexedDB=persistentAuthorizationStorage();
  const first=await prepareDurable(local,indexedDB);
  const old=local.getItem(activeKey);
  if(action==='logout')await first.guard.clear();
  else if(action==='switch'){first.guard.record(teacher,expires());await first.guard.flushGate();}
  else {const rejected=launch(local,{standalone:false,indexedDB,online:true,fetch:async()=>({status:401,ok:false})});await rejected.guard.authorize('GATE_KEEPER');}
  assert.equal(indexedDB.entries.has('gatekeeper'),false);
  local.removeItem(revokedKey);local.setItem(activeKey,old);
  assert.equal(await launch(local,{standalone:false,indexedDB}).guard.authorize('GATE_KEEPER'),null);
 }
});
test('expired persistent lease cannot be recovered even if account continuity remains',async()=>{
 const local=storage(),indexedDB=persistentAuthorizationStorage();
 await prepareDurable(local,indexedDB);
 const lease=indexedDB.entries.get('gatekeeper');indexedDB.entries.set('gatekeeper',{...lease,until:Date.now()-1000});
 local.removeItem(preparedKey);
 const cold=launch(local,{standalone:false,indexedDB});
 assert.equal(await cold.guard.authorize('GATE_KEEPER'),null);
 assert.equal(cold.guard.gateResumeDiagnostic(),'lease-expired');
});
