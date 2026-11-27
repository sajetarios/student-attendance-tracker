'use strict';
const {assertCachedAsset}=require('./support/asset-contract');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {registerGateOfflineRoutes}=require('../gate-offline-routes');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
function harness({existing=null,subject=null}={}){
 const routes=new Map(),queries=[];
 const app={
  get:(route,...handlers)=>routes.set('GET '+route,handlers[handlers.length-1]),
  post:(route,...handlers)=>routes.set('POST '+route,handlers[handlers.length-1])
 };
 const client={
  async query(sql,params=[]){
   queries.push({sql,params});
   if(sql.startsWith('SELECT school_id,gatekeeper_user_id'))return {rowCount:existing?1:0,rows:existing?[existing]:[]};
   if(sql.startsWith('SELECT s.student_id')||sql.startsWith('SELECT su.user_id'))return {rowCount:subject?1:0,rows:subject?[subject]:[]};
   if(sql.startsWith('UPDATE offline_gate_observations'))return {rowCount:1,rows:[{event_id:params[1]}]};
   return {rowCount:1,rows:[]};
  },
  release(){}
 };
 const pool={connect:async()=>client,query:client.query};
 registerGateOfflineRoutes(app,pool,{authenticateSchoolClient(){},requireSchoolRoles:()=>()=>{}});
 const call=async(method,route,body={},auth={role:'GATE_KEEPER',type:'SCHOOL_USER',schoolId:randomUUID(),userId:randomUUID()},params={})=>{
  const req={body,auth,params},out={statusCode:200,body:null,headers:{}};
  const res={
   set(k,v){out.headers[k]=v;return this;},
   status(value){out.statusCode=value;return this;},
   json(value){out.body=value;return this;}
  };
  await routes.get(method+' '+route)(req,res);
  return out;
 };
 return {call,queries};
}
test('prepare is Gatekeeper-only and uses 12-hour online authorization',async()=>{
 const h=harness(),r=await h.call('GET','/api/gate/offline/prepare');
 assert.equal(r.statusCode,200);
 assert.equal(r.body.role,'GATE_KEEPER');
 assert.ok(Date.parse(r.body.validUntil)>Date.now()+11*3600000);
 assert.equal(r.headers['Cache-Control'],'no-store, private');
 const src=read('gate-offline-routes.js');
 assert.match(src,/requireSchoolRoles\('GATE_KEEPER'\)/);
 assert.match(src,/requireSchoolRoles\('SCHOOL_ADMIN'\)/);
});
test('invalid/forged offline QR never reaches database writes',async()=>{
 const h=harness();
 const bad=await h.call('POST','/api/gate/offline/reconcile',{
  events:[{eventId:randomUUID(),qr:'fake',capturedAtDevice:new Date().toISOString()}]
 });
 assert.equal(bad.statusCode,400);
 assert.equal(h.queries.length,0);
});
test('valid offline QR is only stored in review queue, never official attendance',async()=>{
 const h=harness({subject:{id:'S-123',has_photo:true}});
 const eventId=randomUUID(),stamp=new Date().toISOString();
 const r=await h.call('POST','/api/gate/offline/reconcile',{events:[{
  eventId,qr:'JHS:'+randomUUID(),capturedAtDevice:stamp
 }]});
 assert.equal(r.statusCode,200);
 assert.equal(r.body.officialAttendance,false);
 assert.equal(r.body.results[0].status,'REVIEW_REQUIRED');
 assert.ok(h.queries.some(q=>q.sql.includes('INSERT INTO offline_gate_observations')));
 assert.ok(h.queries.some(q=>q.sql.includes('GATE_OFFLINE_OBSERVATION_RECEIVED')));
 assert.ok(h.queries.every(q=>!q.sql.includes('INSERT INTO attendance_events')));
 assert.ok(h.queries.every(q=>!q.sql.includes('INSERT INTO staff_attendance_events')));
 assert.ok(h.queries.every(q=>!q.sql.includes('UPDATE students')));
});
test('unknown badge stays in invalid review state and never creates an attendance event',async()=>{
 const h=harness(),r=await h.call('POST','/api/gate/offline/reconcile',{events:[{
  eventId:randomUUID(),qr:'TCH:'+randomUUID(),capturedAtDevice:new Date().toISOString()
 }]});
 assert.equal(r.body.results[0].status,'INVALID_BADGE');
 assert.equal(r.body.results[0].officialAttendance,false);
});
test('replaying another school idempotency key fails closed',async()=>{
 const schoolId=randomUUID(),userId=randomUUID(),rival=randomUUID(),key=randomUUID(),code='JHS:'+randomUUID();
 const h=harness({existing:{school_id:rival,gatekeeper_user_id:userId,
  subject_kind:'STUDENT',badge_sha256:'a'.repeat(64),captured_at_device:new Date()}});
 const result=await h.call('POST','/api/gate/offline/reconcile',{events:[{
  eventId:key,qr:code,capturedAtDevice:new Date().toISOString()
 }]},{role:'GATE_KEEPER',type:'SCHOOL_USER',schoolId,userId});
 assert.equal(result.statusCode,409);
 assert.ok(h.queries.some(q=>q.sql==='ROLLBACK'));
});
test('device encryption, scope matching and cache controls preserve online permissions',()=>{
 const js=read('public/gate-offline.js'),html=read('public/gate-offline.html');
 const sw=read('public/sw.js'),sql=read('migrations/064_offline_gate_observation_review.sql');
 const server=read('server.js'),portal=read('public/portal.js');
 assert.match(js,/AES-GCM/);assert.match(js,/PBKDF2/);assert.match(js,/310000/);
 assert.match(js,/secretKey/);assert.match(js,/navigator\.storage\?\.persist/);
 assert.match(js,/identity\.schoolId!==data\.scope\.schoolId/);
 assert.match(js,/identity\.userId!==data\.scope\.userId/);
 assert.match(js,/officialAttendance!==false/);
 assert.match(js,/await save\(\)/);
 assert.match(js,/await api\('\/api\/gate\/offline\/prepare'\)/);
 assert.match(js,/Date\.now\(\)>Date\.parse\(data\.scope\.validUntil\)/);
 assert.match(html,/html5-qrcode\.min\.js/);
 assert.match(sw,/\"\/gate-offline\.html\"/);
 assertCachedAsset(html,sw,'gate-offline.js',{minimumVersion:1});
 assert.match(sw,/\"\/vendor\/html5-qrcode\.min\.js\"/);
 assert.doesNotMatch(sw.split('const SHELL = [')[1]?.split('];')[0]||'',/\"\/portal\.html\"/);
 assert.match(sql,/CHECK\(status IN \('REVIEW_REQUIRED','INVALID_BADGE','CLOSED_REVIEWED','DISMISSED'\)\)/);
 assert.match(server,/registerGateOfflineRoutes\(app,pool/);
 assert.match(portal,/gateOfflineCaptureLink/);
 assert.doesNotMatch(js,/localStorage\.setItem/);
});


test('gate offline preparation requires one complete release cache, not an obsolete cache',async()=>{
 const vm=require('node:vm'),js=read('public/gate-offline.js');
 const source=js.slice(js.indexOf('async function registerShell(){'),js.indexOf('async function prepare(){'));
 const files=new Map([['attendigo-v359-old',new Set(['/gate-offline.html'])],['attendigo-v479-gatekeeper-cold-reopen',new Set(['/gate-offline.html','/gate-offline.js?v=9','/offline-account-guard.js?v=2','/vendor/html5-qrcode.min.js','/app-dialog.js?v=1','/app-dialog.css?v=2','/offline-welcome.html'])]]);
 const caches={keys:async()=>[...files.keys()],match:async(asset,{cacheName})=>files.get(cacheName).has(asset)?{ok:true}:undefined};
 const MessageChannel=class{constructor(){this.port1={close(){}};this.port2=this.port1;}};
 const controller={postMessage(message,[port]){assert.equal(message.type,'ATTENDIGO_OFFLINE_RELEASE');port.onmessage({data:{offlineRelease:'attendigo-v479-gatekeeper-cold-reopen'}});}};
 const registerShell=vm.runInNewContext(source+'\nregisterShell',{navigator:{serviceWorker:{register:async()=>{},ready:Promise.resolve(),controller}},window:{caches},caches,MessageChannel,setTimeout,clearTimeout});
 await registerShell();
 files.get('attendigo-v479-gatekeeper-cold-reopen').delete('/vendor/html5-qrcode.min.js');
 files.get('attendigo-v359-old').add('/vendor/html5-qrcode.min.js');
 await assert.rejects(registerShell(),/Offline scanner files are not ready/);
});
test('returning to the gate scanner resets unlock controls without retaining decrypted data',()=>{
 const js=read('public/gate-offline.js');
 assert.match(js,/pagehide[^\n]*secretKey=null;data=null;salt=null;[^\n]*view\(\)/);
 assert.match(js,/pageshow[^\n]*event.persisted\)void refreshAccess\(\)/);
 assert.match(js,/\$\('unlock'\)\.disabled=unlocked/);
});


test('the primary Gatekeeper scanner action routes offline before opening the online camera',async()=>{
 const vm=require('node:vm'),js=read('public/portal.js');
 const start=js.indexOf("  $('studentScannerToggle').addEventListener('click', async () => {");
 const end=js.indexOf("  $('gateScanType')?.addEventListener",start);
 assert.ok(start>=0&&end>start);
 let click,target,opened=0;
 vm.runInNewContext(js.slice(start,end),{$:()=>({addEventListener:(event,fn)=>{click=fn;}}),studentQrScanner:null,user:{role:'GATE_KEEPER'},navigator:{onLine:false},window:{location:{assign:path=>{target=path;}}},startStudentScanner:async()=>{opened++;}});
 await click();assert.equal(target,'/gate-offline.html');assert.equal(opened,0);
});


test('real encrypted Gatekeeper device unlock distinguishes a wrong passphrase, malformed storage and wrong account without rewriting data',async()=>{
 const vm=require('node:vm'),{webcrypto:crypto}=require('node:crypto');
 const js=read('public/gate-offline.js');
 const derive=js.slice(js.indexOf('async function derive('),js.indexOf('async function save('));
 const unlock=js.slice(js.indexOf('async function decodePrepared('),js.indexOf('async function lock('));
 const fields=new Map();const $=id=>{if(!fields.has(id))fields.set(id,{});return fields.get(id);};
 const pass='CaseSensitive-123',scope={role:'GATE_KEEPER',schoolId:'school',userId:'gate'};
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
 const raw=await crypto.subtle.importKey('raw',new TextEncoder().encode(pass),'PBKDF2',false,['deriveKey']);
 const key=await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:310000},raw,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify({scope,events:[]})));
 const doc={salt:Buffer.from(salt).toString('base64'),iv:Buffer.from(iv).toString('base64'),ciphertext:Buffer.from(cipher).toString('base64')};
 let stored=doc,match=false;
 const fn=vm.runInNewContext("let data=null,secretKey=null,salt=null,storedDoc=null,recoveryBusy=false; const encoder=new TextEncoder(),decoder=new TextDecoder(); const un64=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));"+derive+unlock+";unlock",{crypto,TextEncoder,TextDecoder,atob,$,guard:{authorize:async()=>true},readDoc:async()=>stored,matchesGate:()=>match,view:()=>{}});
 $('pass').value=pass;await assert.rejects(fn(),/different Gatekeeper account or school/);
 match=true;$('pass').value='wrong-password';await assert.rejects(fn(),/original device passphrase did not unlock/);
 stored={...doc,iv:''};$('pass').value=pass;await assert.rejects(fn(),/damaged or incomplete/);
 stored=doc;await fn();assert.equal($('unlockStatus').textContent,'Scanner unlocked.');
 assert.equal($('pass').value,'');assert.equal($('pass').type,'password');assert.equal(stored,doc);
});


test('device recovery requires a real online server identity and explicit reset; safe reset refuses pending observations',async()=>{
 const vm=require('node:vm'),js=read('public/gate-offline.js');
 const src=js.slice(js.indexOf('async function verifyRecoveryAccount('),js.indexOf('async function withRecovery(')) + js.slice(js.indexOf('async function resetDevice('),js.indexOf('function connectivity('));
 const identity={role:'GATE_KEEPER',schoolId:'s',userId:'g'},doc={id:'gatekeeper-device',owner:identity},fields=new Map();let connected=true,confirmed='RESET',deletes=0,match=true;
 const ctx={online:()=>connected,api:async()=>identity,matchesGate:()=>match,withRecovery:async fn=>fn(),readDoc:async()=>doc,data:{scope:identity,events:[{practice:false}]},storedDoc:doc,sameDoc:(a,b)=>a===b,window:{AppDialog:{prompt:async()=>confirmed}},replaceDoc:async(a,b,check)=>{assert.equal(a,doc);assert.equal(b,null);assert.equal(check(),true);deletes++;},lock:async()=>{},$:id=>{if(!fields.has(id))fields.set(id,{});return fields.get(id);}};
 const reset=vm.runInNewContext(src+';resetDevice',ctx);
 await assert.rejects(reset(false),/Synchronize all pending/);assert.equal(deletes,0);
 connected=false;await assert.rejects(reset(true),/Connect to the internet/);connected=true;
 ctx.data=null;match=false;await assert.rejects(reset(true),/Sign in online/);match=true;
 confirmed=null;await reset(true);assert.equal(deletes,0);
 confirmed='RESET';await reset(true);assert.equal(deletes,1);
});
