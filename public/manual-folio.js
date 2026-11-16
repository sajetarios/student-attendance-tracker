(() => {
 'use strict';
 const host=document.getElementById('manualFolio');
 if(!host)return;
 const token=sessionStorage.getItem('schoolAttendance.accessToken');
 const user=JSON.parse(sessionStorage.getItem('schoolAttendance.user')||'{}');
 if(!token||user.role!=='TEACHER')return;
 const scope=[user.schoolId||'school',user.userId||user.id||'teacher'].join(':');
 const el=id=>document.getElementById(id);
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const dateToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const state={periods:[],students:[],period:null,date:dateToday(),marks:{},synced:{},notes:'',page:0,tab:'sheet',selected:new Set(),busy:false};
 const statuses=['PRESENT','LATE','ABSENT','EXCUSED'],symbols={PRESENT:'✓',LATE:'◷',ABSENT:'✕',EXCUSED:'!'},names={PRESENT:'Present',LATE:'Late',ABSENT:'Absent',EXCUSED:'Excused'};
 async function api(path,options={}) {
   const r=await fetch(path,{...options,headers:{Authorization:'Bearer '+token,...(options.body?{'Content-Type':'application/json'}:{})},cache:'no-store'});
   if(!r.ok){const v=await r.json().catch(()=>({}));throw Error(v.error||'Request failed ('+r.status+')');}
   return r.json();
 }
 const key=()=>['attendigo.manual.v1',scope,state.period?.periodId||'none',state.date].join(':');
 const rosterKey=()=>['attendigo.manual.roster.v1',scope].join(':');
 function draftSave(){if(!state.period)return;try{localStorage.setItem(key(),JSON.stringify({marks:state.marks,notes:state.notes,updatedAt:new Date().toISOString()}));}catch{}}
 function draftLoad(){let raw={};try{raw=JSON.parse(localStorage.getItem(key())||'{}')}catch{}state.marks=raw.marks||{};state.notes=raw.notes||'';}
 const roster=()=>state.students.filter(s=>state.period&&s.active!==false&&s.gradeLevel===state.period.gradeLevel&&s.section===state.period.section).sort((a,b)=>a.fullName.localeCompare(b.fullName));
 const counts=()=>{const out={TOTAL:roster().length,PRESENT:0,LATE:0,ABSENT:0,EXCUSED:0,UNMARKED:0};roster().forEach(s=>{const st=state.marks[s.studentId]?.status;if(out[st]!==undefined)out[st]++;else out.UNMARKED++});return out};
 const selected=(id)=>state.selected.has(id);
 function notice(message,error=false){el('mfFeedback').textContent=message;el('mfFeedback').style.color=error?'#b42335':'#526e96'}
 function renderStats(){const c=counts();el('mfStats').innerHTML=[['TOTAL','👥','Total'],['PRESENT','✓','Present'],['LATE','◷','Late'],['ABSENT','✕','Absent'],['EXCUSED','!','Excused']].map(([k,icon,label])=>`<div class="manual-stat"><strong>${icon} ${c[k]}</strong><span>${label}</span></div>`).join('');}
 function renderRows(){
   const all=roster();const start=state.page*10;const shown=all.slice(start,start+10);
   const totalPages=Math.max(1,Math.ceil(all.length/10));if(state.page>=totalPages){state.page=totalPages-1;return renderRows()}
   el('mfPageNum').textContent='Page '+(state.page+1)+' of '+totalPages;
   el('mfPrev').disabled=state.page===0;el('mfNext').disabled=state.page>=totalPages-1;
   el('mfSelectPage').checked=shown.length>0&&shown.every(s=>selected(s.studentId));
   el('mfRows').innerHTML=shown.length?shown.map((s,i)=>{const mark=state.marks[s.studentId]||{};return `<tr>
     <td><input type="checkbox" data-select="${esc(s.studentId)}" ${selected(s.studentId)?'checked':''} aria-label="Select ${esc(s.fullName)}"></td>
     <td><strong>${start+i+1}. ${esc(s.fullName)}</strong><small>${esc(s.studentId)}</small></td>
     ${statuses.map(st=>`<td><button type="button" class="manual-status" data-id="${esc(s.studentId)}" data-status="${st}" data-active="${mark.status===st}" aria-label="${names[st]} for ${esc(s.fullName)}" aria-pressed="${mark.status===st}">${symbols[st]}</button></td>`).join('')}
     <td><button class="manual-note-btn" type="button" data-note="${esc(s.studentId)}" data-has-note="${Boolean(mark.note)}" aria-label="Note for ${esc(s.fullName)}">✎</button></td></tr>`}).join(''):'<tr><td colspan="7" class="manual-empty">No students in this selected class.</td></tr>';
 }
 function renderDetails(){
   const c=counts(),marked=c.TOTAL-c.UNMARKED;
   const fill=c.TOTAL?Math.round(marked/c.TOTAL*100):0;
   el('mfDetails').innerHTML=`<div class="manual-detail-grid">
   <div class="manual-detail-card"><h4>Daily summary</h4><p><strong>${c.TOTAL}</strong> learners · ${fill}% marked</p>
   <div class="manual-bar" role="img" aria-label="Attendance summary">
   <span style="width:${c.PRESENT/Math.max(1,c.TOTAL)*100}%;background:#22ba70"></span>
   <span style="width:${c.LATE/Math.max(1,c.TOTAL)*100}%;background:#ffad3d"></span>
   <span style="width:${c.ABSENT/Math.max(1,c.TOTAL)*100}%;background:#f34c5e"></span>
   <span style="width:${c.EXCUSED/Math.max(1,c.TOTAL)*100}%;background:#8557e9"></span></div>
   <p>✓ Present: ${c.PRESENT} · ◷ Late: ${c.LATE}</p><p>✕ Absent: ${c.ABSENT} · ! Excused: ${c.EXCUSED}</p><p>Unmarked: ${c.UNMARKED}</p></div>
   <div class="manual-detail-card"><h4>Attendance totals</h4><p><strong>${c.PRESENT+c.LATE}</strong> present / on time or late</p><p><strong>${c.TOTAL?Math.round((c.PRESENT+c.LATE)/c.TOTAL*100):0}%</strong> participation</p><p>Manual entries are stored separately from QR time-in data.</p></div>
   <div class="manual-detail-card"><h4>Class details</h4><p>${esc(state.period?.gradeLevel||'—')} · ${esc(state.period?.section||'—')}</p><p>${esc(state.period?.subjectName||'Class attendance')}</p><p>${esc(state.period?.startTime||'')}–${esc(state.period?.endTime||'')}</p></div>
   <div class="manual-detail-card"><h4>Legend</h4><p>✓ Present — attended on time</p><p>◷ Late — arrived after start</p><p>✕ Absent — did not attend</p><p>! Excused — officially excused</p></div>
   </div>`;
   el('mfTeacherNotes').value=state.notes;
 }
 function renderTab(){
   document.querySelectorAll('[data-mf-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.mfTab===state.tab)));
   el('mfSheet').hidden=state.tab!=='sheet';
   el('mfRight').hidden=state.tab==='record';
   el('mfRecord').hidden=state.tab!=='record';
   el('mfTeacherNotesWrap').hidden=state.tab!=='notes'&&state.tab!=='sheet';
   el('mfDetails').hidden=state.tab==='notes';
   if(state.tab==='record')renderRecord();
 }
 function renderRecord(){
   const out=Object.entries(state.synced);
   el('mfRecord').innerHTML='<h3>Saved class record</h3><p>Server-confirmed manual entries for the selected date.</p>'+(out.length?'<div class="manual-detail-card">'+out.map(([id,m])=>{const s=state.students.find(v=>v.studentId===id);return '<p>'+esc(s?.fullName||id)+' — '+esc(names[m.status]||m.status)+'</p>'}).join('')+'</div>':'<p class="manual-empty">No server-confirmed entries for this date. Mark your sheet and choose Sync to records.</p>');
 }
 function render(){renderStats();renderRows();renderDetails();renderTab()}
 function changeClass(){
   state.period=state.periods.find(p=>p.periodId===el('mfPeriod').value)||null;state.page=0;state.selected.clear();draftLoad();state.synced={};render();
   if(state.period)loadRemote();
 }
 async function loadRemote(){
   try{
     const d=await api('/api/manual-attendance?'+new URLSearchParams({periodId:state.period.periodId,date:state.date}));
     state.synced=Object.fromEntries((d.marks||[]).map(m=>[m.studentId,m]));
     for(const [id,m] of Object.entries(state.synced)){if(!state.marks[id])state.marks[id]={status:m.status,note:m.note||''}}
     render();notice('Saved records loaded. Local unsynced marks are retained.');
   }catch(e){notice('Local attendance sheet is available. Server: '+e.message,true)}
 }
 function setMark(id,status){const prev=state.marks[id]||{};state.marks[id]=prev.status===status?{...prev,status:null}:{...prev,status};draftSave();render();}
 function pageFlip(direction){
   const book=el('mfBook');book.classList.remove('turn-next','turn-prev');void book.offsetWidth;book.classList.add(direction>0?'turn-next':'turn-prev');
   state.page+=direction;render();setTimeout(()=>book.classList.remove('turn-next','turn-prev'),550);
 }
 async function sync(){
   if(!state.period)return notice('Choose a class first.',true);
   if(!navigator.onLine)return notice('Offline: your attendance remains saved on this device until you sync.',true);
   const allowed=new Set(roster().map(s=>s.studentId));
   const marks=Object.entries(state.marks).filter(([id,m])=>allowed.has(id)&&statuses.includes(m.status)).map(([studentId,m])=>({studentId,status:m.status,note:m.note||''}));
   if(!marks.length)return notice('Mark at least one learner before syncing.',true);
   el('mfSync').disabled=true;
   try{
     await api('/api/manual-attendance/sync',{method:'POST',body:JSON.stringify({periodId:state.period.periodId,date:state.date,marks})});
     state.synced=Object.fromEntries(marks.map(m=>[m.studentId,m]));
     render();notice('Synced '+marks.length+' manual attendance marks to class records.');
   }catch(e){notice('Sync failed; your offline draft is still saved. '+e.message,true)}
   finally{el('mfSync').disabled=false}
 }
 async function initialize(){
   host.hidden=false;
   el('mfDate').value=state.date;
   try{
     const [ps,ss]=await Promise.all([api('/api/periods'),api('/api/students')]);
     state.periods=(ps.periods||[]).filter(p=>p.periodId&&p.section&&p.gradeLevel&&p.assignedTeacherUserId===user.userId);
     // Authorization is always rechecked server-side.
     state.students=ss.students||[];
     try{localStorage.setItem(rosterKey(),JSON.stringify({periods:state.periods,students:state.students}))}catch{}
   }catch(e){
     try{const cached=JSON.parse(localStorage.getItem(rosterKey())||'{}');state.periods=cached.periods||[];state.students=cached.students||[];notice('Offline roster: local-only until connected. '+e.message,true)}
     catch{notice('Could not load classes: '+e.message,true)}
   }
   el('mfPeriod').innerHTML=state.periods.length?state.periods.map(p=>`<option value="${esc(p.periodId)}">${esc(p.gradeLevel)} – ${esc(p.section)} · ${esc(p.subjectName||p.periodName||'Advisory')}</option>`).join(''):'<option value="">No assigned classes available</option>';
   state.period=state.periods[0]||null;
   draftLoad();render();if(state.period&&navigator.onLine)loadRemote();
 }
 host.addEventListener('click',event=>{
   const b=event.target.closest('button');if(!b)return;
   if(b.dataset.id&&b.dataset.status){setMark(b.dataset.id,b.dataset.status);return}
   if(b.dataset.note){const id=b.dataset.note;const current=state.marks[id]||{};const text=prompt('Learner attendance note (max 500 characters)',current.note||'');if(text!==null){state.marks[id]={...current,note:text.slice(0,500)};draftSave();render()}return}
   if(b.dataset.mfTab){state.tab=b.dataset.mfTab;renderTab();return}
   if(b.dataset.batch){const ids=state.selected.size?[...state.selected]:roster().map(s=>s.studentId);ids.forEach(id=>state.marks[id]={...state.marks[id],status:b.dataset.batch});draftSave();render();return}
 });
 host.addEventListener('change',event=>{
   if(event.target.id==='mfPeriod')changeClass();
   if(event.target.id==='mfDate'){state.date=event.target.value;changeClass()}
   if(event.target.id==='mfSelectPage'){roster().slice(state.page*10,state.page*10+10).forEach(s=>event.target.checked?state.selected.add(s.studentId):state.selected.delete(s.studentId));renderRows()}
   if(event.target.dataset.select){event.target.checked?state.selected.add(event.target.dataset.select):state.selected.delete(event.target.dataset.select);renderRows()}
 });
 el('mfTeacherNotes').addEventListener('input',e=>{state.notes=e.target.value.slice(0,500);draftSave()});
 el('mfPrev').addEventListener('click',()=>pageFlip(-1));
 el('mfNext').addEventListener('click',()=>pageFlip(1));
 el('mfSave').addEventListener('click',()=>{draftSave();notice('Saved on this device. Use Sync to records when connected.')});
 el('mfSync').addEventListener('click',sync);
 window.addEventListener('online',()=>notice('Connection restored. Sync your saved attendance when ready.'));
 initialize();
})();
