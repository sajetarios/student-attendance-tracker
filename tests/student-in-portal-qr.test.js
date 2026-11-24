'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','public/student-qr-scanner.js'),'utf8');
const sid='12345678-1234-1234-1234-123456789abc',token='a'.repeat(64),link='https://attendigo.tech/class-qr-checkin.html?sessionId='+sid+'&token='+token;
const response=(status,data)=>({status,ok:status>=200&&status<300,json:async()=>data});
async function harness(responses){
 const els={},calls=[],events=[];
 const document={getElementById(id){return els[id]??={hidden:false,disabled:false,value:'',style:{},events:{},addEventListener(n,f){this.events[n]=f;}};}};
 const window={addEventListener(){},dispatchEvent(e){events.push(e.type);}};
 const location={origin:'https://attendigo.tech',assign(){throw Error('Navigation is forbidden in portal check-in');}};
 vm.runInNewContext(source,{document,window,location,URL,navigator:{onLine:true},Event:class{constructor(type){this.type=type;}},fetch:async(url,opts)=>{calls.push({url,opts});const res=responses.shift();if(!res)throw Error('Unexpected request');return res;}});
 window.StudentClassQrScanner.enable();
 const paste=async raw=>{els.studentQrLink??=document.getElementById('studentQrLink');els.studentQrLink.value=raw;await els.studentQrPasteForm.events.submit({preventDefault(){}});};
 return {els,calls,events,paste};
}
test('valid pasted QR uses existing session and records inside dashboard',async()=>{const h=await harness([response(200,{recorded:false,class:{subject_name:'English',section:'A'}}),response(201,{status:'PRESENT'})]);await h.paste(link);assert.equal(h.els.studentQrConfirm.disabled,false);await h.els.studentQrConfirm.events.click();assert.match(h.els.studentQrFeedback.textContent,/Attendance confirmed/);assert.equal(h.calls[1].opts.credentials,'same-origin');assert.deepEqual(JSON.parse(h.calls[1].opts.body),{sessionId:sid,token});assert.equal(h.events[0],'student-class-attendance-recorded');});
test('wrong origin is rejected without server call',async()=>{const h=await harness([]);await h.paste(link.replace('attendigo.tech','example.com'));assert.equal(h.calls.length,0);});
test('expired QR is not mistaken for logout',async()=>{const h=await harness([response(200,{recorded:false}),response(410,{})]);await h.paste(link);await h.els.studentQrConfirm.events.click();assert.match(h.els.studentQrFeedback.textContent,/QR expired/);assert.equal(h.els.studentQrConfirm.disabled,true);});
test('expired session prevents attendance submission',async()=>{const h=await harness([response(401,{})]);await h.paste(link);assert.equal(h.els.studentQrConfirm.disabled,true);assert.match(h.els.studentQrFeedback.textContent,/session has expired/);assert.equal(h.calls.length,1);});
test('already recorded avoids duplicate submission',async()=>{const h=await harness([response(200,{recorded:true,status:'PRESENT'})]);await h.paste(link);assert.equal(h.els.studentQrConfirm.disabled,true);assert.match(h.els.studentQrFeedback.textContent,/already recorded/);assert.equal(h.calls.length,1);});
