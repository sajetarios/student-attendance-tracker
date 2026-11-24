'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const source=read('public/student-qr-scanner.js');
async function harness(online,prepared,failSave=false){
 const els={},calls=[],saved=[];const document={getElementById(id){return els[id]??={hidden:false,disabled:false,value:'',textContent:'',style:{},events:{},addEventListener(k,f){this.events[k]=f;}};}};
 const window={addEventListener(){},dispatchEvent(){},StudentQrOffline:{ready:()=>prepared,enable(){},sync(){},async enqueue(q){if(failSave)throw Error('storage failed');saved.push(q);}}};
 const navigator={onLine:online},fetch=async(...args)=>{calls.push(args);if(!navigator.onLine)throw Error('offline');return {ok:true,status:200,json:async()=>({recorded:false})};};
 vm.runInNewContext(source,{document,window,navigator,location:{origin:'https://attendigo.tech'},URL,fetch});
 window.StudentClassQrScanner.enable();document.getElementById('studentQrLink').value='https://attendigo.tech/class-qr-checkin.html?sessionId=12345678-1234-1234-1234-123456789abc&token='+'a'.repeat(64);
 await els.studentQrPasteForm.events.submit({preventDefault(){}});return {els,calls,saved,navigator};
}
test('offline prepared scanner saves pending scan, never official attendance',async()=>{const h=await harness(false,true);assert.equal(h.els.studentQrConfirm.textContent,'Save pending scan');await h.els.studentQrConfirm.events.click();assert.equal(h.saved.length,1);assert.equal(h.calls.length,0);assert.match(h.els.studentQrFeedback.textContent,/pending verification/);});
test('unprepared browser cannot save offline scan',async()=>{const h=await harness(false,false);assert.equal(h.els.studentQrConfirm.disabled,true);assert.equal(h.saved.length,0);});
test('storage error is not falsely acknowledged',async()=>{const h=await harness(false,true,true);await h.els.studentQrConfirm.events.click();assert.match(h.els.studentQrFeedback.textContent,/Unable to save/);});
test('connection loss before confirming saves pending QR',async()=>{const h=await harness(true,true);h.navigator.onLine=false;await h.els.studentQrConfirm.events.click();assert.equal(h.saved.length,1);});
test('offline fallback contains no protected dashboard and sync binds account',()=>{const sw=read('public/sw.js'),route=read('class-qr-routes.js'),shell=read('public/student-qr-offline.html');assert.match(sw,/caches.match\('\/student-qr-offline.html'\)/);assert.match(route,/expectedStudentAccountId/);assert.match(route,/expectedSchoolId/);assert.doesNotMatch(shell,/studentAttendanceRows|studentIdValue|studentWelcome/);});
