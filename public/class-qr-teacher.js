(()=>{'use strict';const $=id=>document.getElementById(id);const token=sessionStorage.getItem('schoolAttendance.accessToken');if(!token){location.replace('/portal-login.html');return;}let session=null,timer=null;
async function api(url,options={}){const r=await fetch(url,{...options,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},cache:'no-store'});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'Request failed');return data;}
async function refresh(){if(!session)return;try{const data=await api('/api/class-qr/sessions/'+session+'/qr');$('qr').src=data.qrImage;$('qr').hidden=false;$('expiry').textContent='Code rotates every 30 seconds. Closes '+new Date(data.closesAt).toLocaleTimeString('en-PH',{timeZone:'Asia/Manila'});}catch(e){$('notice').textContent=e.message;$('qr').hidden=true;clearInterval(timer);timer=null;}}
$('start').onclick=async()=>{try{const periodId=$('period').value;if(!periodId)throw Error('Choose a class.');const data=await api('/api/class-qr/sessions',{method:'POST',body:JSON.stringify({periodId})});session=data.sessionId;$('notice').textContent='Session started.';$('close').disabled=false;$('manual').disabled=false;await refresh();clearInterval(timer);timer=setInterval(refresh,5000);}catch(e){$('notice').textContent=e.message;}};
$('close').onclick=async()=>{if(!session)return;try{await api('/api/class-qr/sessions/'+session+'/close',{method:'POST'});clearInterval(timer);timer=null;$('qr').hidden=true;$('close').disabled=true;$('manual').disabled=true;$('notice').textContent='Session closed.';}catch(e){$('notice').textContent=e.message;}};
$('manual').onclick=async()=>{try{const data=await api('/api/class-qr/sessions/'+session+'/manual',{method:'POST',body:JSON.stringify({studentId:$('studentId').value.trim(),reason:$('reason').value.trim()})});$('manualNotice').textContent='Recorded: '+data.status;}catch(e){$('manualNotice').textContent=e.message;}};
(async()=>{
 try{
  const raw=sessionStorage.getItem('schoolAttendance.user');let user=null;
  try{user=JSON.parse(raw||'null');}catch{}
  if(user?.role==='DEPARTMENT_HEAD'){location.replace('/portal.html');return;}
  const r=await api('/api/class-qr/today');
  const label=new Date(r.date+'T12:00:00+08:00').toLocaleDateString('en-PH',{timeZone:'Asia/Manila',weekday:'long',month:'long',day:'numeric',year:'numeric'});
  $('schoolDate').textContent='School date: '+label+' (Philippine time)';
  $('period').innerHTML='<option value="">Select class</option>';
  for(const p of r.classes){
   const o=document.createElement('option');o.value=p.periodId;
   o.textContent=(p.subjectName||'Class')+' — '+p.gradeLevel+' '+p.section+' ('+p.startTime+'–'+p.endTime+')';
   $('period').append(o);
  }
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
  }else $('notice').textContent='Choose your class. QR attendance can start only during its scheduled time.';
 }catch(e){$('notice').textContent=e.message;}
})();
})();