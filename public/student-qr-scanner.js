(()=>{'use strict';
 const $=id=>document.getElementById(id),open=$('studentScanQr'),card=$('studentQrScannerCard'),feedback=$('studentQrFeedback'),confirm=$('studentQrConfirm'),actions=$('studentQrActions');
 let scanner=null,starting=false,active=false,closing=false,library=null,selection=null,verifying=false,submitting=false,generation=0;
 const visible=(e,v,display='')=>{e.hidden=!v;e.style.display=v?display:'none';};
 function parseQr(raw){
  try{
   const u=new URL(raw),origins=new Set(['https://attendigo.tech','https://www.attendigo.tech','https://student-attendance-tracker-jmp4.onrender.com']);
   if(u.origin!==location.origin&&!(origins.has(u.origin)&&origins.has(location.origin)))return null;
   if(u.pathname!=='/class-qr-checkin.html'||u.username||u.password)return null;
   const sessionId=u.searchParams.get('sessionId'),token=u.searchParams.get('token');
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId||'')||!/^[0-9a-f]{64}$/i.test(token||''))return null;
   return {sessionId,token};
  }catch{return null;}
 }
 function load(){
  if(window.Html5Qrcode)return Promise.resolve();
  if(!library)library=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/vendor/html5-qrcode.min.js';script.onload=()=>window.Html5Qrcode?resolve():reject(Error('Scanner unavailable'));script.onerror=()=>reject(Error('Scanner unavailable'));document.head.append(script);}).catch(e=>{library=null;throw e;});
  return library;
 }
 async function stop(){
  if(active&&scanner){active=false;try{await scanner.stop();}catch{}}
  if(scanner&&!starting){try{scanner.clear();}catch{}scanner=null;}
 }
 function message(text){feedback.textContent=text;}
 function clearSelection(){selection=null;confirm.textContent='Confirm attendance';confirm.disabled=true;visible(actions,false);}
 async function readQr(raw){
  if(closing||selection||verifying||submitting)return;
  const next=parseQr(raw);
  if(!next){message('Scan a valid Attendigo class QR for this school environment.');return;}
  selection=next;verifying=true;const seq=generation;
  message('Checking class attendance in your signed-in portal…');visible(actions,true,'flex');confirm.disabled=true;
  await stop();
  try{
   if(navigator.onLine===false)throw Error('Offline');
   const r=await fetch('/api/class-qr/check-in/status?sessionId='+encodeURIComponent(next.sessionId),{credentials:'same-origin',cache:'no-store'});
   const data=await r.json().catch(()=>({}));
   if(seq!==generation||closing)return;
   if(r.status===401){message('Your student session has expired in this browser. Sign in again before scanning.');return;}
   if(!r.ok){message(data.error||'Unable to verify this class QR. Scan again or ask your teacher.');return;}
   if(data.recorded){message('Attendance already recorded for this class'+(data.status?': '+data.status:'')+'.');return;}
   const details=[data.class?.subject_name,data.class?.section].filter(Boolean).join(' · ');
   message((details?details+' — ':'')+'QR read successfully. Tap Confirm attendance.');confirm.disabled=false;
  }catch{if(seq===generation&&!closing){if(window.StudentQrOffline?.ready()){message('Offline or server unavailable. Tap Save pending scan. This is NOT confirmed attendance.');confirm.textContent='Save pending scan';confirm.disabled=false;}else message('Connection unavailable. Open the Student Portal online first, or ask your teacher.');}}
  finally{if(seq===generation)verifying=false;}
 }
 async function start(){
  if(starting||active||verifying||submitting)return;
  clearSelection();closing=false;generation++;starting=true;open.disabled=true;visible(card,true);message('Opening camera…');
  try{
   await load();if(closing)return;
   scanner=new window.Html5Qrcode('studentQrReader');
   await scanner.start({facingMode:'environment'},{fps:10,qrbox:widthBox},raw=>{void readQr(raw);},()=>{});
   active=true;
   if(!closing&&!selection)message('Point your camera at the teacher QR.');
  }catch{if(!closing&&!selection)message('Camera unavailable. Allow camera access or use the paste QR link option below.');}
  finally{starting=false;if(closing||selection||!active)await stop();open.disabled=active;}
 }
 function widthBox(w,h){const size=Math.max(80,Math.floor(Math.min(w,h,240)*0.8));return {width:size,height:size};}
 confirm.addEventListener('click',async()=>{
  if(!selection||verifying||submitting||confirm.disabled)return;
  submitting=true;confirm.disabled=true;$('studentQrRescan').disabled=true;$('studentQrStop').disabled=true;
  message('Recording your class attendance…');const qr=selection;
  try{
   if(navigator.onLine===false||confirm.textContent==='Save pending scan')throw Error('Queue pending');
   const r=await fetch('/api/class-qr/check-in',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(qr)});
   const data=await r.json().catch(()=>({}));
   if(r.ok||data.alreadyRecorded){
    message(data.alreadyRecorded?'Attendance already recorded for this class.':'Attendance confirmed: '+data.status+'.');
    selection=null;
    window.dispatchEvent(new Event('student-class-attendance-recorded'));
    return;
   }
   if(r.status===401){message('Your student session has expired. Sign in again before scanning.');return;}
   if(r.status===410){message('QR expired or the class session ended. Scan the current teacher QR.');return;}
   message(data.error||'Attendance not confirmed. Please retry.');confirm.disabled=false;
  }catch{try{if(!window.StudentQrOffline?.ready())throw Error('Offline capture not prepared');await window.StudentQrOffline.enqueue(qr);selection=null;message('Saved on this device — pending verification. Reconnect to sync automatically.');void window.StudentQrOffline.sync();}catch{message('Unable to save offline scan. Ask your teacher to record attendance.');confirm.disabled=false;}}
  finally{submitting=false;$('studentQrRescan').disabled=false;$('studentQrStop').disabled=false;}
 });
 open.addEventListener('click',start);
 $('studentQrRescan').addEventListener('click',async()=>{if(submitting)return;generation++;verifying=false;await stop();clearSelection();await start();});
 $('studentQrPasteForm').addEventListener('submit',async e=>{e.preventDefault();if(submitting||verifying)return;const raw=$('studentQrLink').value.trim();$('studentQrLink').value='';if(!parseQr(raw)){message('Paste a valid Attendigo classroom QR link.');return;}clearSelection();await readQr(raw);});
 $('studentQrStop').addEventListener('click',async()=>{if(submitting)return;closing=true;generation++;verifying=false;clearSelection();visible(card,false);await stop();if(!starting)open.disabled=false;});
 window.addEventListener('pagehide',()=>{closing=true;generation++;void stop();});
 window.StudentClassQrScanner={enable:(user)=>{open.disabled=starting||active;visible(open,true,'inline-flex');$('studentQrReady').textContent='Scan your teacher’s QR here, online or offline.';if(user)void window.StudentQrOffline?.enable(user);}};
})();