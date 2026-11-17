(() => {
 'use strict';
 const host=document.getElementById('manualFolio');
 if(!host)return;
 const token=sessionStorage.getItem('schoolAttendance.accessToken');
 const user=JSON.parse(sessionStorage.getItem('schoolAttendance.user')||'{}');
 if(!token||user.role!=='TEACHER')return;
 const scope=[user.schoolId||'school',user.userId||user.id||'teacher'].join(':');
 // Offline preparation is a separate encrypted workflow; never bypass the dashboard session guard.
 const offlineLink=document.createElement('a');
 offlineLink.href='/offline-sheet.html';
 offlineLink.textContent='Prepare / open offline attendance';
 offlineLink.style.cssText='display:inline-flex;align-items:center;min-height:44px;padding:9px 14px;margin:10px 0;border-radius:12px;background:#164c81;color:white;font-weight:700;text-decoration:none';
 host.prepend(offlineLink);
 const el=id=>document.getElementById(id);
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const dateToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const state={periods:[],students:[],period:null,date:dateToday(),marks:{},synced:{},notes:'',page:0,tab:'sheet',selected:new Set(),busy:false,finalized:false,noteItems:[],editingNoteId:null,historyPage:0,historyTotal:0,historyRows:[],notesLoadedFor:null};
 const statuses=['PRESENT','LATE','ABSENT','EXCUSED'],symbols={PRESENT:'✓',LATE:'◷',ABSENT:'✕',EXCUSED:'!'},names={PRESENT:'Present',LATE:'Late',ABSENT:'Absent',EXCUSED:'Excused'};
 async function api(path,options={}) {
   const r=await fetch(path,{...options,headers:{Authorization:'Bearer '+token,...(options.body?{'Content-Type':'application/json'}:{})},cache:'no-store'});
   if(!r.ok){const v=await r.json().catch(()=>({}));throw Error(v.error||'Request failed ('+r.status+')');}
   return r.json();
 }
 const key=()=>['attendigo.manual.v1',scope,state.period?.periodId||'none',state.date].join(':');
 const rosterKey=()=>['attendigo.manual.roster.v1',scope].join(':');
 function draftSave(){if(!state.period)return;try{localStorage.setItem(key(),JSON.stringify({marks:state.marks,notes:state.notes,updatedAt:new Date().toISOString()}));setSyncPill('local','Saved on device','A local draft exists. Press Sync to records for school-server confirmation.');}catch{setSyncPill('review','Save unavailable','This browser could not retain the attendance draft. Check device storage.');}}
 function draftLoad(){let raw={};try{raw=JSON.parse(localStorage.getItem(key())||'{}')}catch{}state.marks=raw.marks||{};state.notes=raw.notes||'';}
 const roster=()=>state.students.filter(s=>state.period&&s.active!==false&&s.gradeLevel===state.period.gradeLevel&&s.section===state.period.section).sort((a,b)=>a.fullName.localeCompare(b.fullName));
 const counts=()=>{const out={TOTAL:roster().length,PRESENT:0,LATE:0,ABSENT:0,EXCUSED:0,UNMARKED:0};roster().forEach(s=>{const st=state.marks[s.studentId]?.status;if(out[st]!==undefined)out[st]++;else out.UNMARKED++});return out};
 // Balance the last folio page rather than leaving two rows above a large blank area.
 const pageSize=()=>20;
 const selected=(id)=>state.selected.has(id);
 function notice(message,error=false){
   el('mfFeedback').textContent=message;
   el('mfFeedback').dataset.error=String(error);
 }
 function setSyncPill(tone,label,description){
   const pill=el('mfSyncPill'),detail=el('mfSyncExplanation');
   if(pill){pill.dataset.state=tone;pill.textContent=label;}
   if(detail)detail.textContent=description;
 }
 function renderStats(){const c=counts();el('mfStats').innerHTML=[['TOTAL','👥','Total'],['PRESENT','✓','Present'],['LATE','◷','Late'],['ABSENT','✕','Absent'],['EXCUSED','!','Excused']].map(([k,icon,label])=>`<div class="manual-stat"><strong>${icon} ${c[k]}</strong><span>${label}</span></div>`).join('');}
 function renderRows(){
   const all=roster();const size=pageSize();const start=state.page*size;const shown=all.slice(start,start+size);
   const totalPages=Math.max(1,Math.ceil(all.length/size));if(state.page>=totalPages){state.page=totalPages-1;return renderRows()}
   el('mfPageNum').textContent='Page '+(state.page+1)+' of '+totalPages;
   el('mfPageNum').setAttribute('aria-live','polite');
   el('mfPrev').disabled=state.page===0;el('mfNext').disabled=state.page>=totalPages-1;
   el('mfSelectPage').checked=shown.length>0&&shown.every(s=>selected(s.studentId));
   el('mfRows').innerHTML=shown.length?shown.map((s,i)=>{const mark=state.marks[s.studentId]||{};
     const status=mark.status||'';const cardStatus=status==='ABSENT'?'ABSENT':'PRESENT';
     const extras=status==='LATE'||status==='EXCUSED';
     return `<tr class="manual-attendance-row">
     <td><input type="checkbox" data-select="${esc(s.studentId)}" ${selected(s.studentId)?'checked':''} aria-label="Select ${esc(s.fullName)}"></td>
     <td class="manual-learner"><strong>${start+i+1}. ${esc(s.fullName)}</strong><small>${esc(s.studentId)}</small></td>
     <td class="manual-flip-cell"><button type="button" class="manual-flip-card" data-flip-id="${esc(s.studentId)}" data-face="${cardStatus}" data-unmarked="${!status}" aria-label="${status?names[status]:'Unmarked'} for ${esc(s.fullName)}. Tap to flip between Present and Absent" aria-pressed="${status==='ABSENT'}"><span class="manual-flip-inner"><span class="manual-flip-face manual-flip-present"><b>P</b><small>Present</small></span><span class="manual-flip-face manual-flip-absent"><b>A</b><small>Absent</small></span></span></button></td>
     <td class="manual-other-status"><button type="button" class="manual-extra-status" data-id="${esc(s.studentId)}" data-status="LATE" data-active="${status==='LATE'}" aria-pressed="${status==='LATE'}" aria-label="Late for ${esc(s.fullName)}">L</button><button type="button" class="manual-extra-status" data-id="${esc(s.studentId)}" data-status="EXCUSED" data-active="${status==='EXCUSED'}" aria-pressed="${status==='EXCUSED'}" aria-label="Excused for ${esc(s.fullName)}">E</button>${extras?'<small class="manual-other-label">'+esc(names[status])+'</small>':''}</td>
     <td><button class="manual-note-btn" type="button" data-note="${esc(s.studentId)}" data-has-note="${Boolean(mark.note)}" aria-label="Note for ${esc(s.fullName)}" title="Student note"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4Z"/></svg></button></td></tr>`}).join(''):'<tr><td colspan="5" class="manual-empty">No students in this selected class.</td></tr>';

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
   if(document.activeElement!==el('mfTeacherNotes'))el('mfTeacherNotes').value=state.notes;
 }
 function renderTab(){
   document.querySelectorAll('[data-mf-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.mfTab===state.tab)));
   const isHistory=state.tab==='history';
   const isRecord=state.tab==='record';
   const isNotes=state.tab==='notes';
   const isSheet=state.tab==='sheet';
   el('mfBook').hidden=isHistory;
   el('mfBook').classList.toggle('summary-mode',!isSheet&&!isRecord);
   el('mfHistoryPanel').hidden=!isHistory;
   el('mfSheet').hidden=!isSheet;
   el('mfRight').hidden=isRecord||isSheet;
   el('mfRecord').hidden=!isRecord;
   el('mfTeacherNotesWrap').hidden=!isNotes;
   el('mfNotesList').hidden=!isNotes;
   el('mfShowArchived').closest('.manual-notes-filter').hidden=!isNotes;
   el('mfDetails').hidden=isNotes;
   if(isRecord)renderRecord();
   if(isNotes)renderNotes();
   if(isHistory&&state.period&&state.historyLoadedFor!==state.period.periodId)loadHistory(0);
 }

 function renderNotes(){
   const showArchived=el('mfShowArchived').checked;
   const list=state.noteItems.filter(n=>showArchived||!n.archivedAt);
   el('mfSaveNote').textContent=state.editingNoteId?'Update note':'Save dated note';
   el('mfNotesList').innerHTML=list.length?list.map(n=>`<article class="manual-notes-item ${n.archivedAt?'is-archived':''}">
     <div class="manual-notes-meta"><strong>${esc(n.date)}</strong><span>${n.archivedAt?'Archived':'Saved'} · updated ${esc(new Date(n.updatedAt).toLocaleDateString('en-PH'))}</span></div>
     <p>${esc(n.body)}</p><div class="manual-quick">
     <button type="button" class="manual-btn" data-edit-note="${esc(n.noteId)}">Edit</button>
     <button type="button" class="manual-btn" data-archive-note="${esc(n.noteId)}">${n.archivedAt?'Restore':'Archive'}</button>
     <button type="button" class="manual-btn" data-delete-note="${esc(n.noteId)}">Delete</button>
     </div></article>`).join(''):'<p class="manual-empty">No saved notes yet. Save a dated note to retain it across visits.</p>';
 }
 async function loadNotes(){
   if(!state.period||!navigator.onLine)return;
   const periodId=state.period.periodId,date=state.date;
   try{
     const data=await api('/api/manual-attendance/notes?'+new URLSearchParams({periodId,date}));
     if(state.period?.periodId!==periodId)return;
     state.noteItems=data.notes||[];
     renderNotes();
   }catch(error){notice('Notes could not load: '+error.message,true);}
 }
 async function importOlderDeviceNotes(){
   if(!state.period)return notice('Select a class before importing notes.',true);
   if(!navigator.onLine)return notice('Connect to the internet before importing older device notes.',true);
   const prefix=['attendigo.manual.v1',scope,state.period.periodId].join(':')+':';
   const drafts=[];
   try{
     for(let i=0;i<localStorage.length;i++){
       const k=localStorage.key(i);
       if(!k||!k.startsWith(prefix))continue;
       const date=k.slice(prefix.length);
       if(!/^\d{4}-\d{2}-\d{2}$/.test(date))continue;
       const doc=JSON.parse(localStorage.getItem(k)||'{}');
       if(typeof doc.notes==='string'&&doc.notes.trim())drafts.push({date,body:doc.notes.trim()});
     }
   }catch(e){return notice('Could not read previous device notes: '+e.message,true)}
   const missing=drafts.filter(d=>!state.noteItems.some(n=>n.date===d.date&&n.body===d.body));
   if(!missing.length)return notice('No unsaved older notes found on this device.');
   if(!window.confirm('Import '+missing.length+' older device note(s) to school records?'))return;
   el('mfImportNotes').disabled=true;
   let saved=0;let failure='';
   try{
     for(const d of missing){
       try{await api('/api/manual-attendance/notes',{method:'POST',body:JSON.stringify({periodId:state.period.periodId,date:d.date,body:d.body})});saved++}
       catch(e){failure=e.message;break}
     }
     await loadNotes();
     notice('Imported '+saved+' older device note(s).'+(failure?' Remaining notes were not imported: '+failure:''));
   }finally{el('mfImportNotes').disabled=false}
 }
 async function saveNote(){
   if(!state.period)return notice('Select a class before saving a note.',true);
   if(!state.notes.trim())return notice('Write a note before saving.',true);
   if(!navigator.onLine){draftSave();return notice('Offline note stored locally; save it to the server when connected.',true)}
   const editing=state.editingNoteId,oldText=state.notes,oldDate=state.date;
   el('mfSaveNote').disabled=true;
   try{
     if(editing)await api('/api/manual-attendance/notes/'+encodeURIComponent(editing),{method:'PATCH',body:JSON.stringify({action:'edit',body:oldText})});
     else await api('/api/manual-attendance/notes',{method:'POST',body:JSON.stringify({periodId:state.period.periodId,date:state.date,body:oldText})});
     state.editingNoteId=null;state.notes='';draftSave();el('mfTeacherNotes').value='';
     await loadNotes();notice('Dated note saved to school records.');
   }catch(error){notice('Note was not saved: '+error.message,true)}
   finally{el('mfSaveNote').disabled=false}
 }
 async function noteAction(id,action){
   const entry=state.noteItems.find(n=>n.noteId===id);
   if(!entry)return;
   if(action==='edit'){state.editingNoteId=id;state.notes=entry.body;el('mfTeacherNotes').value=entry.body;el('mfTeacherNotes').focus();renderNotes();notice('Editing note from '+entry.date+'. Select Update note to save changes.');return}
   if(action==='delete'&&!window.confirm('Permanently delete the note dated '+entry.date+'? This cannot be undone.'))return;
   try{
     await api('/api/manual-attendance/notes/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({action})});
     await loadNotes();notice('Note '+(action==='delete'?'deleted':action==='archive'?'archived':'restored')+'.');
   }catch(error){notice('Could not update note: '+error.message,true)}
 }
 function renderHistory(){
   const totalPages=Math.max(1,Math.ceil(state.historyTotal/10));
   el('mfHistoryPages').textContent='Page '+(state.historyPage+1)+' of '+totalPages;
   el('mfHistoryPrev').disabled=state.historyPage<=0;
   el('mfHistoryNext').disabled=state.historyPage>=totalPages-1;
   el('mfManualHistoryRows').innerHTML=state.historyRows.length?state.historyRows.map((m,i)=>`<article class="manual-history-entry">
     <div><strong>${esc(m.fullName)}</strong><small>${esc(m.studentId)} · ${esc(m.date)}</small></div>
     <span class="manual-status" data-active="true" data-status="${esc(m.status)}" aria-label="${esc(names[m.status]||m.status)}">${esc(names[m.status]||m.status)}</span>
     ${m.note?'<p>'+esc(m.note)+'</p>':''}
   </article>`).join(''):'<p class="manual-empty">No synced manual attendance history for this class yet.</p>';
 }
 async function loadHistory(page){
   if(!state.period||!navigator.onLine)return;
   const pid=state.period.periodId,day=state.date;
   state.historyLoadedFor=pid;
   try{
     const data=await api('/api/manual-attendance/history?'+new URLSearchParams({periodId:pid,date:day,page}));
     if(state.period?.periodId!==pid)return;
     state.historyPage=data.page;state.historyRows=data.records||[];state.historyTotal=data.total||0;renderHistory();
   }catch(error){state.historyLoadedFor=null;notice('History could not load: '+error.message,true)}
 }
 let historyFlipBusy=false;
 async function historyFlip(direction){
   const pages=Math.max(1,Math.ceil(state.historyTotal/10));
   const target=state.historyPage+direction;
   if(historyFlipBusy||target<0||target>=pages)return;
   const pane=el('mfManualHistoryRows');
   historyFlipBusy=true;
   const leaf=document.createElement('div');
   leaf.className='manual-turn-leaf '+(direction>0?'forward':'backward');
   leaf.setAttribute('aria-hidden','true');
   leaf.innerHTML=pane.innerHTML;
   leaf.querySelectorAll('button,input').forEach(node=>{node.disabled=true;node.tabIndex=-1});
   pane.appendChild(leaf);
   el('mfHistoryPrev').disabled=true;el('mfHistoryNext').disabled=true;
   const duration=window.matchMedia('(prefers-reduced-motion: reduce)').matches?10:260;
   try{
     await new Promise(resolve=>setTimeout(resolve,Math.round(duration*.52)));
     await loadHistory(target);
     await new Promise(resolve=>setTimeout(resolve,Math.round(duration*.48)+30));
   }finally{leaf.remove();historyFlipBusy=false;renderHistory()}
 }

 function renderRecord(){
   const out=Object.entries(state.synced);
   el('mfRecord').innerHTML='<h3>Saved class record</h3><p>Server-confirmed manual entries for the selected date.</p>'+(out.length?'<div class="manual-detail-card">'+out.map(([id,m])=>{const s=state.students.find(v=>v.studentId===id);return '<p>'+esc(s?.fullName||id)+' — '+esc(names[m.status]||m.status)+'</p>'}).join('')+'</div>':'<p class="manual-empty">No server-confirmed entries for this date. Mark your sheet and choose Sync to records.</p>');
 }
 function render(){
 renderStats();renderRows();renderDetails();renderTab();
 host.classList.toggle('is-finalized',Boolean(state.finalized));
 if(el('mfFinalize')){el('mfFinalize').disabled=!state.period;el('mfFinalize').textContent=state.finalized?'↺ Reopen register':'✓ Finalize date';}
 if(el('mfFinalizationState'))el('mfFinalizationState').textContent=state.finalized?'Finalized · editing locked':'Not finalized';
 if(el('mfSync'))el('mfSync').disabled=Boolean(state.finalized);
}
 function changeClass(){
   state.period=state.periods.find(p=>p.periodId===el('mfPeriod').value)||null;state.page=0;state.selected.clear();state.editingNoteId=null;draftLoad();state.synced={};state.finalized=false;state.noteItems=[];state.historyPage=0;state.historyLoadedFor=null;render();
   setSyncPill('local','Saved on device','Check this class draft against the school server before finalizing.');
   if(state.period){loadRemote();loadNotes();}
 }
 async function loadRemote(){
   try{
     const d=await api('/api/manual-attendance?'+new URLSearchParams({periodId:state.period.periodId,date:state.date}));
     state.synced=Object.fromEntries((d.marks||[]).map(m=>[m.studentId,m]));
      state.finalized=Boolean(d.finalization?.finalized);
     for(const [id,m] of Object.entries(state.synced)){if(!state.marks[id])state.marks[id]={status:m.status,note:m.note||''}}
     render();notice('Saved records loaded. Local unsynced marks are retained.');
     const draftedMarks=Object.entries(state.marks).filter(([,mark])=>statuses.includes(mark.status));
     const draftMatchesServer=draftedMarks.length>0&&draftedMarks.every(([id,mark])=>{
       const remote=state.synced[id];
       return remote&&remote.status===mark.status&&(remote.note||'')===(mark.note||'');
     });
     setSyncPill(draftMatchesServer?'synced':'local',
       draftMatchesServer?'Verified in school records':'Saved on device',
       draftMatchesServer?'Current marked entries match school records. Cloud delivery is separate.'
         :'This device has entries that may not match school records. Open Sync Center to review.');
     return true;
   }catch(e){notice('Local attendance sheet is available. Server: '+e.message,true);return false}
 }
 function setMark(id,status){if(state.finalized)return notice('Reopen the finalized register to edit marks.',true);const prev=state.marks[id]||{};state.marks[id]=prev.status===status?{...prev,status:null}:{...prev,status};draftSave();render();}
 let flipBusy=false;
 function pageFlip(direction){
   const pages=Math.max(1,Math.ceil(roster().length/pageSize()));
   const next=state.page+direction;
   if(flipBusy||next<0||next>=pages)return;
   const book=el('mfBook'),source=el('mfSheet');
   flipBusy=true;
   const leaf=document.createElement('div');
   leaf.className='manual-turn-leaf '+(direction>0?'forward':'backward');
   leaf.setAttribute('aria-hidden','true');
   const snapshot=source.cloneNode(true);
   snapshot.removeAttribute('id');
   snapshot.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
   snapshot.querySelectorAll('button,input').forEach(node=>{node.disabled=true;node.tabIndex=-1});
   leaf.appendChild(snapshot);book.appendChild(leaf);
   el('mfPrev').disabled=true;el('mfNext').disabled=true;
   // The turning leaf remains visible while the underlying register advances.
   const duration=window.matchMedia('(prefers-reduced-motion: reduce)').matches?10:330;
   setTimeout(()=>{state.page=next;renderRows();},Math.round(duration*.50));
   setTimeout(()=>{leaf.remove();flipBusy=false;renderRows();},duration+35);
 }
 async function sync(){
   if(state.finalized){notice('Reopen this finalized register before changing marks.',true);return false;}
   if(!state.period){notice('Choose a class first.',true);return false;}
   const allowed=new Set(roster().map(s=>s.studentId));
   const marks=Object.entries(state.marks).filter(([id,m])=>allowed.has(id)&&statuses.includes(m.status))
     .map(([studentId,m])=>({studentId,status:m.status,note:m.note||'',expectedRevision:Number(state.synced[studentId]?.revision||0)}));
   if(!marks.length){notice('No manually marked learners to synchronize.');return true;}
   if(!window.AttendigoOffline?.enqueueOperation) {
     notice('Device synchronization is unavailable; reload Attendigo without clearing device storage.',true);return false;
   }
   el('mfSync').disabled=true;
   try{
     const operationId=crypto.randomUUID();
     const queued=await window.AttendigoOffline.enqueueOperation({
       type:'MANUAL_MARKS',operationId,payload:{periodId:state.period.periodId,date:state.date,marks}
     });
     setSyncPill('waiting','Waiting to sync','Marks queued securely; the school server has not yet confirmed them.');
     await window.AttendigoOffline.sync();
     const remaining=(await window.AttendigoOffline.pending()).find(item=>item.id===queued.operationId);
     if(remaining?.status==='REVIEW')throw Error(remaining.reason||'Attendance requires conflict review.');
     if(remaining){notice('Saved encrypted attendance on this device. Waiting to sync; do not clear site data.');return false;}
     if(!await loadRemote())throw Error('Server accepted the sheet, but the readback failed. Check the device queue before retrying.');
     if(!marks.every(m=>state.synced[m.studentId]?.status===m.status &&
        (state.synced[m.studentId]?.note||'')===(m.note||''))){
       throw Error('Server verification differs from your device; review before retrying.');
     }
     state.historyLoadedFor=null;
     render();setSyncPill('synced','Verified in school records','The school server accepted '+marks.length+' marks. Cloud delivery is separate.');
     notice('Verified '+marks.length+' attendance marks in school records.');
     return true;
   }catch(e){setSyncPill('review','Needs review','The device retains your marks. Open Sync Center before retrying.');notice('Attendance remains on this device. '+e.message,true);return false}
   finally{el('mfSync').disabled=Boolean(state.finalized)}
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
   draftLoad();render();if(state.period&&navigator.onLine){loadRemote();loadNotes();}
 }
 host.addEventListener('click',event=>{
   const b=event.target.closest('button');if(!b)return;
   if(state.finalized&&(b.dataset.flipId||b.dataset.batch||b.dataset.note||b.dataset.status)){
    notice('This register is finalized. Reopen it before editing.',true);return;
   }
   if(b.dataset.flipId){
     const id=b.dataset.flipId,current=state.marks[id]?.status;
     const next=current==='ABSENT'?'PRESENT':current==='PRESENT'?'ABSENT':'PRESENT';
     state.marks[id]={...state.marks[id],status:next};draftSave();
     // Preserve this DOM card so its 300ms CSS rotation can actually finish.
     b.dataset.face=next;b.dataset.unmarked='false';
     b.setAttribute('aria-label',names[next]+' for '+(roster().find(s=>s.studentId===id)?.fullName||'learner')+'. Tap to flip between Present and Absent');
     b.setAttribute('aria-pressed',String(next==='ABSENT'));
     const row=b.closest('tr');row?.querySelectorAll('.manual-extra-status').forEach(extra=>{extra.dataset.active='false';extra.setAttribute('aria-pressed','false')});
     row?.querySelector('.manual-other-label')?.remove();
     renderStats();renderDetails();return;
   }
   if(b.dataset.id&&b.dataset.status){setMark(b.dataset.id,b.dataset.status);return}
   if(b.dataset.editNote!==undefined)return noteAction(b.dataset.editNote,'edit');
   if(b.dataset.archiveNote!==undefined){const entry=state.noteItems.find(n=>n.noteId===b.dataset.archiveNote);return noteAction(b.dataset.archiveNote,entry?.archivedAt?'restore':'archive')}
   if(b.dataset.deleteNote!==undefined)return noteAction(b.dataset.deleteNote,'delete');
   if(b.dataset.note){const id=b.dataset.note;const current=state.marks[id]||{};const text=prompt('Learner attendance note (max 500 characters)',current.note||'');if(text!==null){state.marks[id]={...current,note:text.slice(0,500)};draftSave();render()}return}
   if(b.dataset.mfTab){state.tab=b.dataset.mfTab;renderTab();return}
   if(b.dataset.batch){const ids=state.selected.size?[...state.selected]:roster().map(s=>s.studentId);ids.forEach(id=>state.marks[id]={...state.marks[id],status:b.dataset.batch});draftSave();render();return}
 });
 host.addEventListener('change',event=>{
   if(event.target.id==='mfPeriod')changeClass();
   if(event.target.id==='mfDate'){state.date=event.target.value;changeClass()}
   if(event.target.id==='mfSelectPage'){roster().slice(state.page*pageSize(),state.page*pageSize()+pageSize()).forEach(s=>event.target.checked?state.selected.add(s.studentId):state.selected.delete(s.studentId));renderRows()}
   if(event.target.dataset.select){event.target.checked?state.selected.add(event.target.dataset.select):state.selected.delete(event.target.dataset.select);renderRows()}
 });
 el('mfTeacherNotes').addEventListener('input',e=>{state.notes=e.target.value.slice(0,2000);draftSave()});
 el('mfSaveNote').addEventListener('click',saveNote);
 el('mfImportNotes').addEventListener('click',importOlderDeviceNotes);
 el('mfShowArchived').addEventListener('change',renderNotes);

 let conflictPage=0,conflictCount=0,conflictRecords=[];
 async function refreshConflicts(page=0){
   if(!state.period)return;
   const periodId=state.period.periodId;
   el('mfConflictRows').textContent='Checking accepted QR scans against manual marks…';
   try{
     const result=await api('/api/manual-attendance/conflicts?'+new URLSearchParams({periodId,date:state.date,page}));
     if(state.period?.periodId!==periodId)return;
     conflictPage=result.page;conflictCount=result.total;conflictRecords=result.records||[];
     const pages=Math.max(1,Math.ceil(conflictCount/10));
     const nav='<div class="manual-history-toolbar"><strong>'+conflictCount+' verified conflict(s)</strong><div class="manual-page-nav"><button type="button" class="manual-btn" data-conflict-page="-1" '+(!conflictPage?'disabled':'')+'>‹</button><span>Page '+(conflictPage+1)+' of '+pages+'</span><button type="button" class="manual-btn" data-conflict-page="1" '+(conflictPage>=pages-1?'disabled':'')+'>›</button></div></div>';
     const cards=conflictRecords.map(m=>'<article class="manual-conflict-card"><strong>'+esc(m.fullName)+'</strong><small>'+esc(m.studentId)+' · '+esc(m.date)+'</small><div class="manual-conflict-evidence"><span>Manual: <b>'+esc(m.manualStatus)+'</b></span><span>Accepted QR: <b>'+esc(new Date(m.qrTime).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}))+(m.qrLate?' · Late':'')+'</b></span></div><p class="manual-sync-note">Check the paper register and QR time. If the QR is incorrect, ask the School Admin to review it; QR data cannot be removed from here.</p><div class="manual-quick"><button type="button" class="manual-btn primary" data-conflict-student="'+esc(m.studentId)+'" data-conflict-date="'+esc(m.date)+'" data-conflict-status="PRESENT">Correct to Present</button><button type="button" class="manual-btn" data-conflict-student="'+esc(m.studentId)+'" data-conflict-date="'+esc(m.date)+'" data-conflict-status="LATE">Correct to Late</button></div></article>').join('');
     el('mfConflictRows').innerHTML=nav+(cards||'<p>No confirmed same-period conflicts for this class.</p>');
   }catch(error){el('mfConflictRows').textContent='Conflict check failed: '+error.message;notice(error.message,true);}
 }
 el('mfConflictRows').addEventListener('click',async event=>{
   const nav=event.target.closest('[data-conflict-page]');
   if(nav){refreshConflicts(Math.max(0,conflictPage+Number(nav.dataset.conflictPage)));return;}
   const button=event.target.closest('[data-conflict-student]');
   if(!button)return;
   const {conflictStudent:studentId,conflictDate:date,conflictStatus:status}=button.dataset;
   const mark=conflictRecords.find(m=>m.studentId===studentId&&m.date===date);
   if(!mark||!state.period||!confirm('Correct '+mark.fullName+' to '+names[status]+' after verifying the paper register and QR event? This change will be audited.'))return;
   button.disabled=true;
   try{
     await api('/api/manual-attendance/conflicts/resolve',{method:'POST',body:JSON.stringify({periodId:state.period.periodId,studentId,date,status})});
     // Keep the on-device draft from reverting the server correction.
     const draftKey=['attendigo.manual.v1',scope,state.period.periodId,date].join(':');
     try{const draft=JSON.parse(localStorage.getItem(draftKey)||'{}');if(draft.marks?.[studentId]){draft.marks[studentId].status=status;localStorage.setItem(draftKey,JSON.stringify(draft));}}catch{}
     if(date===state.date){state.marks[studentId]={...state.marks[studentId],status};state.synced[studentId]={...state.synced[studentId],status};draftSave();render();}
     state.historyLoadedFor=null;
     await refreshConflicts(conflictPage);
     notice('Correction saved with audit trail. Refresh SF2 to verify.');
   }catch(error){notice('Could not correct conflict: '+error.message,true);}
   finally{button.disabled=false;}
 });
 let historySource='manual';
 function selectHistorySource(source){
   historySource=source;
   document.querySelectorAll('[data-mf-history]').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.mfHistory===source)));
   el('mfManualHistoryPanel').hidden=source!=='manual';
   el('mfQrHistoryDetails').hidden=source!=='qr';
   el('mfConflictPanel').hidden=source!=='conflicts';
   if(source==='conflicts')refreshConflicts(0); }
 document.querySelectorAll('[data-mf-history]').forEach(button=>button.addEventListener('click',()=>selectHistorySource(button.dataset.mfHistory)));
 el('mfHistoryPrev').addEventListener('click',()=>historyFlip(-1));
 el('mfHistoryNext').addEventListener('click',()=>historyFlip(1));
 el('mfPrev').addEventListener('click',()=>pageFlip(-1));
 el('mfNext').addEventListener('click',()=>pageFlip(1));
 el('mfSave').addEventListener('click',()=>{draftSave();notice('Saved on this device. Use Sync to records when connected.')});
 el('mfSync').addEventListener('click',sync);
 el('mfFinalize')?.addEventListener('click',async()=>{
   if(!state.period)return notice('Select a class first.',true);
   if(!window.AttendigoOffline?.enqueueOperation)return notice('Device queue is not ready. Reload before signing off.',true);
   const action=state.finalized?'REOPEN':'FINALIZE';
   const prompt=action==='FINALIZE'
     ? 'Finalize the class register for '+state.date+'? All learners must have a synced manual mark or verified class QR check-in. You may reopen for corrections.'
     : 'Reopen the finalized class register for '+state.date+'? The action will be audited.';
   const accepted=await window.AppDialog.confirm(prompt,{title:action==='FINALIZE'?'Finalize class attendance':'Reopen class attendance',confirmText:action==='FINALIZE'?'Finalize':'Reopen'});
   if(!accepted)return;
   el('mfFinalize').disabled=true;
   try{
     if(action==='FINALIZE' && Object.values(state.marks).some(m=>statuses.includes(m.status))){
       await sync(); // Enqueue unsent marks before the sign-off in device order.
       const unsent=(await window.AttendigoOffline.pending()).filter(r=>
         r.type==='MANUAL_MARKS' && r.status==='REVIEW');
       if(unsent.length)throw Error('Resolve manual mark conflicts before finalizing attendance.');
     }
     const opId=crypto.randomUUID();
     await window.AttendigoOffline.enqueueOperation({
       type:'REGISTER_SIGNOFF',operationId:opId,
       payload:{periodId:state.period.periodId,date:state.date,action}
     });
     setSyncPill('waiting','Sign-off queued','Finalization/reopening is pending server acceptance. Do not treat it as finalized yet.');
     await window.AttendigoOffline.sync();
     const queued=(await window.AttendigoOffline.pending()).find(r=>r.id===opId);
     if(queued?.status==='REVIEW')throw Error(queued.reason||'Register needs review.');
     if(queued){notice('Sign-off saved on this device, pending server acceptance. The register is not finalized yet.');return;}
     if(!await loadRemote()){
       setSyncPill('waiting','Server readback unavailable','The sign-off request was accepted, but the register status could not be reloaded. Check the Sync Center and refresh this class.');
       notice('School accepted this sign-off, but the register could not be reloaded. Refresh to verify.',true);
       return;
     }
     setSyncPill('synced','Sign-off confirmed','The school server accepted this register action; cloud delivery is separate.');
     notice(action==='FINALIZE'?'Attendance finalized and audited. Editing is locked.':'Attendance reopened. You can correct and re-sync marks.');
   }catch(error){setSyncPill('review','Needs review','The server has not confirmed this sign-off. Open Sync Center.');notice('Sign-off retained for review if queued. '+error.message,true);}
   finally{render();}
 });
 window.addEventListener('attendigo-offline-status',event=>{
   const summary=event.detail||{};
   if(summary.needsReview>0&&el('mfSyncPill')?.dataset.state==='waiting')
     setSyncPill('review','Needs review','At least one queued device operation requires review in Sync Center.');
 });
 window.addEventListener('online',()=>notice('Connection restored. Sync your saved attendance when ready.'));
 initialize();
})();
