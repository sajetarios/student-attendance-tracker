'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const script=read('public/offline-account-guard.js');
function storage(){const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};}
let seq=0;
function tab(shared,fetcher=async()=>{throw Error('offline');}){
 const sessionStorage=storage(),window={addEventListener(){}},navigator={onLine:false};
 vm.runInNewContext(script,{window,document:{addEventListener(){}},sessionStorage,localStorage:shared,navigator,crypto:{randomUUID:()=>String(++seq)},fetch:fetcher});
 return {guard:window.AttendigoOfflineAccount,sessionStorage,navigator};
}
const teacher={role:'TEACHER',schoolId:'school',userId:'teacher'};
const student={role:'STUDENT',schoolId:'school',studentAccountId:'student'};
const gate={role:'GATE_KEEPER',schoolId:'school',userId:'gate'};
test('offline student cannot switch into another role even with a prepared teacher or gatekeeper account',async()=>{
 const shared=storage(),a=tab(shared),b=tab(shared);
 assert.equal(a.guard.current(),null);
 a.guard.record(teacher);assert.equal(a.guard.matches('TEACHER','school','teacher'),true);
 assert.equal(a.guard.matches('TEACHER','school','other'),false);
 assert.equal(a.guard.matches('TEACHER','other','teacher'),false);
 assert.equal(b.guard.current(),null,'fresh tab needs verified sign-in');
 b.guard.record(student);
 assert.equal(a.guard.current(),null,'previous teacher tab revoked');
 assert.equal(b.guard.matches('STUDENT','school','student'),true);
 assert.equal(await b.guard.authorize('TEACHER'),null);
 assert.equal(await b.guard.authorize('GATE_KEEPER'),null);
 assert.throws(()=>b.guard.requireRole('TEACHER'),/restricted/);
 b.guard.record(gate);assert.equal(b.guard.current('STUDENT'),null);
 assert.equal(b.guard.matches('GATE_KEEPER','school','gate'),true);
 assert.equal(b.guard.matches('GATE_KEEPER','school','other'),false);
 b.guard.clear();assert.equal(b.guard.current(),null);
 b.guard.record({...student,mustChangePassword:true});assert.equal(b.guard.current(),null);
 b.guard.record(student,new Date(Date.now()-1000).toISOString());assert.equal(b.guard.current(),null);
});
test('server rejection revokes offline access instead of using stale role',async()=>{
 const a=tab(storage(),async()=>({status:401,ok:false}));a.guard.record(teacher);a.navigator.onLine=true;
 assert.equal(await a.guard.authorize('TEACHER'),null);assert.equal(a.guard.current(),null);
});
test('server verified wrong role does not authorize requested offline tool',async()=>{
 const a=tab(storage(),async()=>({status:200,ok:true,json:async()=>({user:student})}));a.guard.record(teacher);a.navigator.onLine=true;
 assert.equal(await a.guard.authorize('TEACHER'),null);assert.equal(a.guard.matches('STUDENT','school','student'),true);
});
test('direct offline pages fail closed and verify encrypted record owners',()=>{
 const sheet=read('public/offline-sheet.js'),gateScript=read('public/gate-offline.js'),studentScript=read('public/student-qr-offline.js');
 assert.match(sheet,/authorize\('TEACHER'\)/);assert.match(sheet,/guard\.matches\('TEACHER',payload\.schoolId,payload\.userId\)/);
 assert.match(sheet,/doc\.id\)\.startsWith\(a\.schoolId\+':'\+a\.accountId/);
 assert.match(gateScript,/authorize\('GATE_KEEPER'\)/);assert.match(gateScript,/matchesGate\(decoded\.scope\)/);
 assert.match(studentScript,/!allowed\(marker\)/);
 for(const p of ['offline-sheet.html','gate-offline.html','student-qr-offline.html','offline-welcome.html'])assert.match(read('public/'+p),/offline-account-guard\.js\?v=1/);
 const hub=read('public/offline-welcome.html');for(const role of ['STUDENT','TEACHER','GATE_KEEPER'])assert.ok(hub.includes('data-offline-role="'+role+'" hidden'));
 assert.match(read('public/sw.js'),/OFFLINE_REQUIRED = \[[\s\S]*?"\/offline-account-guard\.js\?v=1"/);
});
