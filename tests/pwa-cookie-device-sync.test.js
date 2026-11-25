const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createAuthMiddleware}=require('../auth-middleware');
const source=fs.readFileSync(path.join(__dirname,'../public/offline-attendance.js'),'utf8');
function fixture({remoteOwner='teacher',responseStatus=200,confirmed=true}={}){
 const records=new Map([['event-1',{id:'event-1',owner:'school:teacher',type:'MANUAL_MARKS',status:'PENDING',createdAt:1,event:{periodId:'period',date:'2026-11-25',marks:[{studentId:'learner',status:'PRESENT',note:''}]}}]]);
 const requests=[];
 const indexedDB={open(){const req={};queueMicrotask(()=>{req.result={close(){},transaction(){const tx={objectStore(){return {index(){return{getAll(owner){const r={result:[...records.values()].filter(x=>x.owner===owner)};queueMicrotask(()=>r.onsuccess?.());return r}}},delete(id){records.delete(id)},put(row){records.set(row.id,row)}}}};queueMicrotask(()=>queueMicrotask(()=>tx.oncomplete?.()));return tx}};req.onsuccess()});return req}};
 const window={dispatchEvent(){}};
 const document={readyState:'loading',addEventListener(){},getElementById(){return null}};
 vm.runInNewContext(source,{window,document,indexedDB,navigator:{onLine:true},sessionStorage:{getItem(k){return k==='schoolAttendance.user'?JSON.stringify({schoolId:'school',userId:'teacher',role:'TEACHER'}):null}},TextEncoder,TextDecoder,URLSearchParams,CustomEvent:class{},fetch:async(url,opts)=>{requests.push({url,opts});if(url==='/api/auth/me')return {ok:true,json:async()=>({user:{schoolId:'school',userId:remoteOwner,role:'TEACHER'}})};if(opts.method==='POST')return {status:responseStatus,ok:responseStatus===200,json:async()=>({saved:1})};return {status:200,ok:true,json:async()=>({marks:confirmed?[{studentId:'learner',status:'PRESENT',note:''}]:[]})}}});
 return {queue:window.AttendigoOffline,records,requests};
}
test('cookie-only session synchronizes queued manual mark only after server readback',async()=>{
 const f=fixture();await f.queue.sync();assert.equal(f.records.size,0);assert.equal(f.requests.length,3);
 for(const r of f.requests.slice(1)){assert.equal(r.opts.credentials,'same-origin');assert.equal(r.opts.headers['X-Attendigo-Queue-Owner'],'school:teacher');assert.equal(r.opts.headers.Authorization,undefined);}
});
test('different signed-in account cannot submit queued records',async()=>{
 const f=fixture({remoteOwner:'another'});await f.queue.sync();assert.equal(f.records.size,1);assert.equal(f.requests.length,1);
});
test('unconfirmed and unauthorized submissions retain pending data',async()=>{
 for(const opts of [{confirmed:false},{responseStatus:401}]){const f=fixture(opts);await f.queue.sync();assert.equal(f.records.get('event-1').status,'PENDING');}
});
test('server refuses a cookie belonging to a different queue owner',async()=>{
 const pool={query:async()=>({rowCount:1,rows:[{school_id:'school',user_id:'other',role:'TEACHER'}]})};
 const {authenticateSchoolClient}=createAuthMiddleware(pool);let status=0,passed=false;
 const res={status(n){status=n;return this},json(){}};
 await authenticateSchoolClient({headers:{cookie:'__Host-attendigo-staff=test','x-attendigo-queue-owner':'school:teacher'}},res,()=>{passed=true});
 assert.equal(status,401);assert.equal(passed,false);
});
test('sync center no longer disables sync for absent tab token',()=>{
 const ui=fs.readFileSync(path.join(__dirname,'../public/attendance-sync-center.js'),'utf8');
 assert.doesNotMatch(ui,/sessionStorage.getItem\(tokenKey\)/);
 assert.match(ui,/!summary.waiting \|\| Boolean\(summary.syncing\)/);
});
