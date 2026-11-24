(()=>{'use strict';
 const $=id=>document.getElementById(id),open=$('studentScanQr'),card=$('studentQrScannerCard'),feedback=$('studentQrFeedback');
 let scanner=null,starting=false,active=false,closing=false,navigating=false,library=null;
 const visible=(e,v)=>{e.hidden=!v;e.style.display=v?'':'none';};
 function destination(raw){
  try{
   const u=new URL(raw),origins=new Set(['https://attendigo.tech','https://www.attendigo.tech','https://student-attendance-tracker-jmp4.onrender.com']);
   if(u.origin!==location.origin&&!(origins.has(u.origin)&&origins.has(location.origin)))return null;
   if(u.pathname!=='/class-qr-checkin.html'||u.username||u.password)return null;
   const sessionId=u.searchParams.get('sessionId'),token=u.searchParams.get('token');
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId||'')||!/^[0-9a-f]{64}$/i.test(token||''))return null;
   return '/class-qr-checkin.html?'+new URLSearchParams({sessionId,token});
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
 async function start(){
  if(starting||active||navigating)return;starting=true;closing=false;open.disabled=true;visible(card,true);feedback.textContent='Opening camera…';
  try{
   await load();if(closing)return;
   scanner=new window.Html5Qrcode('studentQrReader');
   await scanner.start({facingMode:'environment'},{fps:10,qrbox:{width:200,height:200}},raw=>{
    if(closing||navigating)return;
    const target=destination(raw);
    if(!target){feedback.textContent='Scan a valid Attendigo class QR for this school environment.';return;}
    navigating=true;feedback.textContent='Opening attendance confirmation…';
    if(!starting)void stop().then(()=>location.assign(target));
    else pending=target;
   },()=>{});
   active=true;
   if(!closing&&!navigating)feedback.textContent='Point your camera at the teacher QR.';
  }catch{if(!closing)feedback.textContent='Camera unavailable. Allow camera access or open the phone-camera QR link in your signed-in browser.';}
  finally{starting=false;if(closing||navigating||!active)await stop();open.disabled=active||navigating;if(pending)location.assign(pending);}
 }
 let pending=null;
 open.addEventListener('click',start);
 $('studentQrStop').addEventListener('click',async()=>{closing=true;visible(card,false);await stop();if(!starting)open.disabled=false;});
 window.addEventListener('pagehide',()=>{closing=true;void stop();});
 window.StudentClassQrScanner={enable:()=>visible(open,true)};
})();