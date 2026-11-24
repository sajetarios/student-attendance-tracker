'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'..','public/class-qr-checkin.html'),'utf8').split('<script>')[1].split('</script>')[0];
const sid='12345678-1234-1234-1234-123456789abc',token='a'.repeat(64);
const response=(status,data)=>({status,ok:status>=200&&status<300,json:async()=>data});
async function harness(responses){
 const elements={},calls=[],storage=new Map();
 const document={getElementById(id){return elements[id]??={hidden:false,disabled:id==='checkin',value:'',dataset:{},events:{},addEventListener(name,fn){this.events[name]=fn;}};}};
 const sessionStorage={getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 const context={document,location:{pathname:'/class-qr-checkin.html',search:'?sessionId='+sid+'&token='+token},sessionStorage,localStorage:sessionStorage,URLSearchParams,fetch:async(url,options)=>{calls.push({url,options});const next=responses.shift();if(!next)throw Error('Unexpected request');return next;}};
 vm.runInNewContext(script,context);for(let i=0;i<40;i++)await Promise.resolve();return {elements,calls};
}
const student=()=>response(200,{user:{role:'STUDENT',displayName:'Learner'}});
test('active student session bypasses sign-in and PIN',async()=>{const h=await harness([student(),response(200,{recorded:false}),response(201,{status:'PRESENT'})]);assert.equal(h.elements.studentSignIn.hidden,true);assert.equal(h.elements.pinForm.hidden,true);assert.equal(h.elements.checkin.disabled,false);assert.equal(h.calls.length,2);assert.equal(h.calls[0].url,'/api/auth/me');await h.elements.checkin.events.click();assert.equal(h.elements.message.dataset.state,'success');assert.equal(h.calls[2].options.credentials,'same-origin');});
test('signed-out browser offers configured PIN or sign-in with QR continuation',async()=>{for(const pinEnabled of [true,false]){const h=await harness([response(401,{}),response(200,{pinEnabled})]);assert.equal(h.elements.pinForm.hidden,!pinEnabled);assert.equal(h.elements.studentSignIn.hidden,pinEnabled);assert.ok(h.elements.useStudentLogin.href.includes('returnTo='));}});
test('server failure is retryable, not mistaken for logout',async()=>{const h=await harness([response(503,{})]);assert.equal(h.elements.studentSignIn.hidden,true);assert.equal(h.elements.retryCheckin.hidden,false);});
test('already recorded and wrong-school QR do not prompt for sign-in',async()=>{for(const status of [200,404]){const h=await harness([student(),response(status,{recorded:true})]);assert.equal(h.elements.studentSignIn.hidden,true);assert.equal(h.elements.checkin.disabled,true);}});
test('expired QR is distinct from expired authentication',async()=>{const h=await harness([student(),response(200,{recorded:false}),response(410,{})]);await h.elements.checkin.events.click();assert.equal(h.elements.studentSignIn.hidden,true);assert.match(h.elements.message.textContent,/QR code expired/);});
test('canonical production origin preserves staging isolation',()=>{const {classQrOrigin}=require('../class-qr-routes');assert.equal(classQrOrigin('https://student-attendance-tracker-jmp4.onrender.com','production'),'https://attendigo.tech');assert.equal(classQrOrigin('https://attendigo-staging.onrender.com','production'),'https://attendigo-staging.onrender.com');});
