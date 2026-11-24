'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const html=read('public/student-portal.html'),source=read('public/student-portal.js');
test('scanner is a visible primary action above attendance summary',()=>{
 const match=html.match(/<button[^>]*id="studentScanQr"[^>]*>/);
 assert.ok(match);assert.match(match[0],/primary-button/);assert.doesNotMatch(match[0],/hidden|display:none/);assert.ok(html.indexOf('id="studentScanQr"')<html.indexOf('id="studentAttendanceSummary"'));
});
async function init(mustChangePassword){
 const calls=[],els={},events=[];
 const document={getElementById(id){return els[id]??={hidden:false,disabled:true,textContent:'',addEventListener(){}};}};
 const window={addEventListener(){},StudentClassQrScanner:{enable(){events.push('enabled');document.getElementById('studentScanQr').disabled=false;}}};
 const sessionStorage={setItem(){throw Error('storage unavailable');},removeItem(){}};
 const never=new Promise(()=>{});
 vm.runInNewContext(source,{document,window,sessionStorage,location:{replace(){throw Error('unexpected redirect');}},Headers:class{has(){return false;}set(){}},fetch:async url=>{calls.push(url);if(url==='/api/auth/me')return {ok:true,status:200,json:async()=>({user:{role:'STUDENT',mustChangePassword}})};return never;}});
 for(let i=0;i<30;i++)await Promise.resolve();
 return {calls,els,events};
}
test('verified student can scan even when profile and attendance requests never finish',async()=>{const h=await init(false);assert.equal(h.events[0],'enabled');assert.equal(h.els.studentScanQr.disabled,false);assert.ok(h.calls.includes('/api/student/profile'));assert.ok(h.calls.includes('/api/student/attendance'));});
test('initial password change still blocks scanner',async()=>{const h=await init(true);assert.equal(h.events.length,0);assert.equal(h.els.studentPasswordRequired.hidden,false);assert.match(h.els.studentQrReady.textContent,/Change your initial password/);assert.ok(!h.calls.includes('/api/student/attendance'));});
