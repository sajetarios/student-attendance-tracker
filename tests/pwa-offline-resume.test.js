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
function launch(localStorage,{standalone=true,online=false,sessionStorage=storage(),fetch=async()=>{throw Error('offline')}}={}){
 const window={matchMedia:()=>({matches:standalone})};
 vm.runInNewContext(source,{window,navigator:{standalone,onLine:online},localStorage,sessionStorage,crypto:{randomUUID:()=>String(++epoch)},fetch,AbortController,setTimeout,clearTimeout});
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
