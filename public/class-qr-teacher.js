(()=>{'use strict';const $=id=>document.getElementById(id);let session=null,timer=null;
async function api(url,options={}){const r=await fetch(url,{...options,headers:{'Content-Type':'application/json'},cache:'no-store'});const data=await r.json().catch(()=>({}));if(r.status===401){location.replace('/portal-login.html');throw Error('Session expired.');}if(!r.ok)throw Error(data.error||'Request failed');return data;}
async function refresh(){if(!session)return;try{const data=await api('/api/class-qr/sessions/'+session+'/qr');$('qr').src=data.qrImage;$('qr').hidden=false;$('qrWrap').hidden=false;$('qrEmpty').hidden=true;$('expiry').textContent='Code refreshes automatically every 30 seconds. After scanning, finish check-in promptly. This code is accepted until '+new Date(data.acceptUntil||data.validUntil).toLocaleTimeString('en-PH',{timeZone:'Asia/Manila'})+'. Session closes '+new Date(data.closesAt).toLocaleTimeString('en-PH',{timeZone:'Asia/Manila'});}catch(e){$('notice').textContent=e.message;$('qr').hidden=true;$('qrWrap').hidden=true;$('qrEmpty').hidden=false;clearInterval(timer);timer=null;}}
$('start').onclick=async()=>{try{const periodId=$('period').value;if(!periodId)throw Error('Choose a class.');let data;try{data=await api('/api/class-qr/sessions',{method:'POST',body:JSON.stringify({periodId})});}catch(error){if(!/already closed/i.test(error.message)||!window.confirm('This QR session was closed. Reopen it for the remaining scheduled class time? Existing attendance will be preserved.'))throw error;data=await api('/api/class-qr/sessions',{method:'POST',body:JSON.stringify({periodId,reopen:true})});}session=data.sessionId;$('notice').textContent=data.reopened?'Session reopened. Previous attendance is preserved.':'Session started.';$('close').disabled=false;await refresh();clearInterval(timer);timer=setInterval(refresh,5000);}catch(e){$('notice').textContent=e.message;}};
$('close').onclick=async()=>{if(!session)return;try{await api('/api/class-qr/sessions/'+session+'/close',{method:'POST'});clearInterval(timer);timer=null;$('qr').hidden=true;$('qrWrap').hidden=true;$('qrEmpty').hidden=false;$('close').disabled=true;$('expiry').textContent='';$('notice').textContent='Session closed.';}catch(e){$('notice').textContent=e.message;}};
const panel=$('qrPanel'),expand=$('expandQr');
function setExpanded(on){panel.classList.toggle('qr-expanded',on);expand.setAttribute('aria-pressed',String(on));expand.textContent=on?'⤢ Exit enlarged view':'⛶ Enlarge QR';document.body.style.overflow=on?'hidden':'';}
expand.addEventListener('click',()=>setExpanded(!panel.classList.contains('qr-expanded')));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&panel.classList.contains('qr-expanded'))setExpanded(false);});
(async()=>{
 try{
  const {user}=await api('/api/auth/me');
  if(user?.role!=='TEACHER'){location.replace('/portal.html');return;}
  const r=await api('/api/class-qr/today');
  const label=new Date(r.date+'T12:00:00+08:00').toLocaleDateString('en-PH',{timeZone:'Asia/Manila',weekday:'long',month:'long',day:'numeric',year:'numeric'});
  $('schoolDate').textContent='School date: '+label+' (Philippine time)';
  $('period').innerHTML='<option value="">Select class</option>';
  for(const p of r.classes){
   const o=document.createElement('option');o.value=p.periodId;
   o.textContent=(p.subjectName||'Class')+' — '+p.gradeLevel+' '+p.section+' ('+p.startTime+'–'+p.endTime+')';
   $('period').append(o);
  }
  // Select the active scheduled class by default, while leaving the dropdown editable.
  const now=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
  const minutes=t=>{const m=/^(\d{1,2}):(\d{2})/.exec(String(t||''));return m?Number(m[1])*60+Number(m[2]):null;};
  const minuteNow=minutes(now);
  const sorted=[...r.classes].sort((a,b)=>(minutes(a.startTime)??1440)-(minutes(b.startTime)??1440));
  const active=sorted.find(p=>minutes(p.startTime)!==null&&minutes(p.endTime)!==null&&minutes(p.startTime)<=minuteNow&&minuteNow<minutes(p.endTime));
  const upcoming=sorted.find(p=>minutes(p.startTime)>minuteNow);
  const defaultClass=active||upcoming||sorted[0];
  if(defaultClass)$('period').value=defaultClass.periodId;
  if(!r.classes.length){
   $('start').disabled=true;
   $('notice').textContent='No class is assigned to you for today. Classes scheduled for other weekdays do not appear here.';
   $('upcoming').textContent='Checking your next seven days of assigned classes…';
   const dates=Array.from({length:7},(_,i)=>{const d=new Date(r.today+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+i+1);return d.toISOString().slice(0,10);});
   const upcoming=await Promise.all(dates.map(async date=>{try{return await api('/api/class-qr/today?date='+date);}catch{return null;}}));
   const next=upcoming.find(x=>x&&x.classes.length);
   if(next){
    const when=new Date(next.date+'T12:00:00+08:00').toLocaleDateString('en-PH',{timeZone:'Asia/Manila',weekday:'long',month:'short',day:'numeric'});
    $('upcoming').textContent='Next assigned class: '+when+' — '+next.classes.map(p=>(p.subjectName||'Class')+' ('+p.startTime+'–'+p.endTime+')').join('; ')+'. QR sessions can only start during class hours.';
   }else $('upcoming').textContent='No assigned classes found in the next seven days. Ask the School Admin to check the teacher assignment, operating weekdays, and class schedule.';
  }else $('notice').textContent=active?'Current scheduled class selected. You may choose another assigned class from the dropdown.':'Choose an assigned class. QR attendance can start only during its scheduled time.';
 }catch(e){$('notice').textContent=e.message;}
})();
})();