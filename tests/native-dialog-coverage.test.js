'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const publicDir=path.join(__dirname,'..','public');
// Legacy explicitly guarded fallbacks are tracked, not a license to add new
// native prompts. Browser permission prompts use separate browser APIs.
const fallbackLimits={
 'attendance-sync-center.js':2,
 'offline-attendance.js':2,
 'special-program-batch-ui.js':1,
 'student-portal-accounts.js':1,
 'missing-scan-ui.js':2,
 'staff-leave-ui.js':1,
 'staff-lunch-ui.js':4,
 'form48-intelligence.js':1,
 'principal-dashboard.js':1
};
const native=/(?:\bwindow\s*\.\s*|(?<![\w.]))(?:alert|prompt|confirm)\s*\(/g;
function* files(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
 if(e.name==='vendor')continue;
 const p=path.join(dir,e.name);
 if(e.isDirectory())yield* files(p);else if(/\.(js|html)$/.test(p))yield p;
}}
test('application source has no untracked direct native prompt calls',()=>{
 const unexpected=[];
 for(const p of files(publicDir)){
  const name=path.relative(publicDir,p);
  if(name==='app-dialog.js')continue;
  let source=fs.readFileSync(p,'utf8');
  if(name==='portal.js')source=source.replace('coverage alert(s)','coverage alerts');
  if(name.endsWith('.js'))new vm.Script(source,{filename:name});
  else source=[...source.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).join('\n');
  const count=[...source.matchAll(native)].length;
  if(count>(fallbackLimits[name]||0))unexpected.push(name+': '+count+' native call(s)');
  if(count&&fallbackLimits[name])assert.match(source,/AppDialog/,'Legacy fallback must have shared dialog path: '+name);
 }
 assert.deepEqual(unexpected,[]);
});
test('the separate QR teacher page loads the shared dialog component',()=>{
 const page=fs.readFileSync(path.join(publicDir,'class-qr-teacher.html'),'utf8');
 const worker=fs.readFileSync(path.join(publicDir,'sw.js'),'utf8');
 assert.match(page,/href="\/app-dialog\.css\?v=2"/);
 assert.match(page,/src="\/app-dialog\.js\?v=1"/);
 assert.match(worker,/attendigo-v(\d+)-/);
 assert.ok(Number(worker.match(/attendigo-v(\d+)-/)[1])>=380);
});
test('Official Business decision cancellation, note and duplicate guard preserve the API contract',async()=>{
 const src=fs.readFileSync(path.join(publicDir,'staff-ob-ui.js'),'utf8');
 const start=src.indexOf('     async function decide(kind,decision){');
 const end=src.indexOf("     if(user.role==='DEPARTMENT_HEAD'",start);
 assert.ok(start>=0&&end>start);
 const handler=src.slice(start,end);
 const calls=[],controls=[{disabled:false},{disabled:false}];
 let refreshes=0,opened=0,resolveNote;
 const ctx=vm.createContext({
  busy:false,window:{AppDialog:{prompt:async(...args)=>{opened++;assert.equal(args[2].maxLength,1000);return new Promise(resolve=>resolveNote=resolve);}}},
  actions:{querySelectorAll:()=>controls},ob:{requestId:'fixture',staffName:'Sample staff'},api:'/api/staff-ob',
  call:async(...args)=>calls.push(JSON.parse(JSON.stringify(args))),say:()=>{},refresh:async()=>refreshes++,
  document:{dispatchEvent(){}},Event:class {}
 });
 vm.runInContext(handler,ctx);
 const canceled=ctx.decide('decide','APPROVE');
 await ctx.decide('decide','REJECT');
 assert.equal(opened,1);
 assert.ok(controls.every(b=>b.disabled));
 resolveNote(null);await canceled;
 assert.equal(calls.length,0);assert.ok(controls.every(b=>!b.disabled));
 const approved=ctx.decide('decide','APPROVE');resolveNote('');await approved;
 assert.deepEqual(calls,[['/api/staff-ob/fixture/decide','POST',{decision:'APPROVE',note:''}]]);
 assert.equal(refreshes,1);assert.ok(controls.every(b=>!b.disabled));
 const rejected=ctx.decide('recommend','REJECT');resolveNote('Reviewed evidence');await rejected;
 assert.deepEqual(calls[1],['/api/staff-ob/fixture/recommend','POST',{decision:'REJECT',note:'Reviewed evidence'}]);
});
