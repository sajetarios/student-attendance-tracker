(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const ui={select:$('subjectChild'),date:$('subjectDate'),refresh:$('subjectRefresh'),
   gate:$('subjectGate'),items:$('subjectItems'),feedback:$('subjectFeedback')};
 if(!ui.items)return;
 const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;',"'":'&#39;'}[c]));
 const t=raw=>{const m=/^(\d{2}):(\d{2})/.exec(raw||'');if(!m)return 'Time not available';
    const h=Number(m[1]);return (h%12||12)+':'+m[2]+' '+(h>=12?'PM':'AM');};
 const stamp=v=>{if(!v)return null;const d=new Date(v);return Number.isNaN(d.getTime())?null:d.toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'});};
 const labels={PRESENT:'Present',LATE:'Late',ABSENT:'Absent',EXCUSED:'Excused',
   REVIEW:'Needs reconciliation',PENDING:'Awaiting teacher',UPCOMING:'Upcoming',
   IN_PROGRESS:'Not yet finalized',CANCELLED:'Cancelled'};
 const descriptions={
   PRESENT:'Confirmed by the subject teacher.',LATE:'Confirmed late attendance for this subject.',
   ABSENT:'Subject absence confirmed by the teacher.',EXCUSED:'Excused status confirmed by the teacher.',
   REVIEW:'QR and manual attendance disagree. The subject teacher must reconcile this.',
   PENDING:'No finalized subject attendance yet. This does not mean absent.',
   IN_PROGRESS:'Class may still be in progress. Unfinalized records are not absences.',
   UPCOMING:'Scheduled for this date. Attendance has not yet been recorded.',
   CANCELLED:'Class was cancelled or the school day was closed.'
 };
 async function api(path){
   const r=await fetch(path,{credentials:'same-origin',cache:'no-store'});
   if(r.status===401){location.replace('/portal-login.html');throw Error('Parent session expired.');}
   const result=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(result.error||'Could not load subject attendance.');
   return result;
 }
 let selected='',loading=false;
 function render(data){
   const first=data.gate?.arrival,leave=data.gate?.departure;
   ui.gate.innerHTML='<strong>School gate (separate from subjects)</strong>'+
      '<span>Entry: '+esc(stamp(first)||'No verified scan')+'</span>'+
      '<span>Exit: '+esc(stamp(leave)||'No verified scan')+'</span>';
   const subjects=data.subjects||[];
   ui.items.innerHTML=subjects.length?subjects.map(s=>{
      const state=labels[s.status]?s.status:'PENDING';
      const confirmation=s.finalized?'Finalized subject register':s.source?'Attendance entered; awaiting finalization':'No finalized class record';
      return '<article class="parent-subject-item" role="listitem"><div>'+
        '<h3>'+esc(s.subjectName)+'</h3><p>'+esc(t(s.startTime))+' – '+esc(t(s.endTime))+
        ' · '+esc(s.periodName)+'</p><p>'+esc(descriptions[state])+'</p>'+
        '<p>'+esc(confirmation)+'</p></div>'+
        '<span class="parent-subject-status" data-state="'+esc(state)+'">'+esc(labels[state])+'</span></article>';
     }).join(''):'<p class="parent-note">No subject schedules were found for this child on the selected date. Check the school timetable or enrollment if this seems incorrect.</p>';
   const absences=subjects.filter(s=>s.finalized&&s.status==='ABSENT').length;
   ui.feedback.textContent=subjects.length+' scheduled subjects · '+absences+
     ' confirmed absent. Only finalized subject attendance is counted.';
 }
 async function refresh(){
   if(loading||!selected)return;
   loading=true;ui.refresh.disabled=true;ui.feedback.textContent='Loading verified subject attendance…';
   try{
      const data=await api('/api/parent/children/'+encodeURIComponent(selected)+'/subjects?date='+encodeURIComponent(ui.date.value));
      if(selected===data.studentId)render(data);
   }catch(error){ui.feedback.textContent=error.message;ui.items.textContent='Subject attendance is temporarily unavailable.';}
   finally{loading=false;ui.refresh.disabled=false;}
 }
 async function init(){
   ui.date.value=today();
   ui.items.textContent='Loading linked learners…';
   try{
      const r=await api('/api/parent/children');
      const children=r.children||[];
      ui.select.replaceChildren();
      for(const child of children){
       const option=document.createElement('option');
       option.value=child.studentId;option.textContent=child.fullName+' ('+child.gradeLevel+' '+child.section+')';
       ui.select.append(option);
      }
      if(!children.length){ui.items.textContent='Only approved parent-child links can view subject attendance.';ui.refresh.disabled=true;return;}
      selected=children[0].studentId;
      await refresh();
   }catch(error){ui.items.textContent='Unable to load linked children.';ui.feedback.textContent=error.message;}
 }
 ui.select.addEventListener('change',()=>{selected=ui.select.value;refresh();});
 ui.date.addEventListener('change',()=>{if(ui.date.value)refresh();});
 ui.refresh.addEventListener('click',()=>refresh());
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&ui.date.value===today())refresh();});
 setInterval(()=>{if(!document.hidden&&ui.date.value===today())refresh();},60000);
 init();
})();