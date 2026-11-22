'use strict';
// School-Admin Form 48 preview. Only verified DTR punches from the server are printable.
// Draft names are NOT electronic signatures or proof of approval.
(() => {
 const $=id=>document.getElementById(id);
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const api=async(url,options={})=>{
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(body.error||'Unable to load report data.');
  return body;
 };
 const formatTime=value=>{
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(value||''))return '';
  const [h,m]=value.split(':').map(Number);
  return String(h%12||12)+':'+String(m).padStart(2,'0')+' '+(h<12?'AM':'PM');
 };
 const duration=value=>value===null||value===undefined?'Needs schedule':Math.floor(value/60)+'h '+String(value%60).padStart(2,'0')+'m';
 const hoursText=hours=>hours&&hours.AM_IN&&hours.AM_OUT&&hours.PM_IN&&hours.PM_OUT
  ?formatTime(hours.AM_IN)+'–'+formatTime(hours.AM_OUT)+' / '+formatTime(hours.PM_IN)+'–'+formatTime(hours.PM_OUT)
  :'Not configured';
 const slots=['AM_IN','AM_OUT','PM_IN','PM_OUT'];
 const state={review:null,employeeSchedule:null,scheduleDirty:false,draftDirty:false,scheduleSaving:false,loading:false,key:'',data:null,analysis:null};
 const copy=(data,analysis,kind)=>{
  const month=new Date(data.month+'-01T12:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC',month:'long',year:'numeric'});
  const assess=new Map((analysis.assessments||[]).map(item=>[item.date,item]));
  const gateEvidenceShown=data.records.some(row=>!row.slots?.AM_IN&&
    (row.gateEvidence||[]).some(g=>g.direction==='IN'&&g.time<'12:00'));
  const cells=data.records.map(row=>{
   const v=row.slots||{},a=assess.get(row.date);
   const early=a&&a.undertimeMinutes>0&&a.scheduled;
   const hours=early?Math.floor(a.undertimeMinutes/60):'';
   const mins=early?a.undertimeMinutes%60:'';
   const gateArrival=(row.gateEvidence||[]).find(g=>g.direction==='IN'&&g.time<'12:00');
   return '<tr><td>'+row.day+'</td>'+slots.map(k=>'<td>'+
    (v[k]?esc(formatTime(v[k])):k==='AM_IN'&&gateArrival
     ?'<span class="form48-gate-evidence" title="Verified physical gate scan; official DTR slot missing">'+
       esc(formatTime(gateArrival.time))+'*</span>':'')+'</td>').join('')+
    '<td>'+esc(hours)+'</td><td>'+esc(mins)+'</td></tr>';
  }).join('');
  const obEntries=data.records.flatMap(row=>(row.obRemarks||[]).map(ob=>({
   date:row.date,remark:ob.remark,exception:ob.exceptionRemark||'',reviewRequired:Boolean(ob.exception)
  })));
  const hasObExceptions=obEntries.some(item=>item.reviewRequired);
  const leaveEntries=Array.isArray(analysis.approvedLeaveRemarks)?analysis.approvedLeaveRemarks:[];
  const hasLeaveConflicts=leaveEntries.some(item=>item.conflictDates?.length);
  const leaveMarkup=leaveEntries.length
   ?'<div class="form48-leave-remarks">'+leaveEntries.map(item=>
     '<div>'+esc(item.text)+
     (item.conflictDates?.length?' — REVIEW REQUIRED: verified punches on '+
      esc(item.conflictDates.map(date=>Number(date.slice(-2))).join(', '))+'.':'')+
     '</div>').join('')+'</div>'
   :'';
  const obMarkup=obEntries.length
   ?'<div class="form48-ob-remarks">'+obEntries.map(item=>
      '<div><strong>'+esc(item.date.slice(8))+'</strong> '+esc(item.remark)+
      (item.reviewRequired?' — REVIEW REQUIRED: '+esc(item.exception):'')+'</div>'
     ).join('')+'</div>'
   :leaveEntries.length?'':'<div class="form48-line"></div><div class="form48-line"></div>';
  const s=analysis.summary||{};
  const verifiedName=analysis.signatories?.verifiedBy||'',approvedName=analysis.signatories?.approvedBy||'';
  const verifiedPosition=analysis.signatories?.verifiedPosition||'',approvedPosition=analysis.signatories?.approvedPosition||'';
  const lastDay=new Date(Date.UTC(Number(data.month.slice(0,4)),Number(data.month.slice(5,7)),0))
   .toISOString().slice(0,10);
  const periodIncomplete=Boolean(analysis.asOfDate&&lastDay>analysis.asOfDate);
  const reviewNote=s.hasUnreviewed||!s.configured||hasObExceptions||hasLeaveConflicts
   ?'DRAFT — REVIEW REQUIRED':periodIncomplete?'DRAFT — PERIOD NOT COMPLETE':'PREPARED FOR SIGNATURE';
  const gapText=s.pendingAbsentDays?' ('+s.pendingAbsentDays+' missing day(s) for review)':'';
  return '<article class="form48-copy" aria-label="'+esc(kind)+' DTR copy">'+
   '<div class="form48-copy-type">'+esc(kind.toUpperCase())+' COPY</div>'+
   '<div class="form48-form-heading">Civil Service Form No. 48</div>'+
   '<h3>DAILY TIME RECORD</h3>'+
   '<div class="form48-employee">'+esc(data.displayName)+'</div>'+
   '<div class="form48-month">For the month of <strong>'+esc(month)+'</strong></div>'+
   '<div class="form48-official-hours">Official hours for arrival and departure</div>'+
   '<div class="form48-hours-grid"><span>Regular days: '+esc(hoursText(analysis.regularHours))+'</span>'+
   '<span>Saturdays: '+esc(hoursText(analysis.saturdayHours))+'</span></div>'+
   '<table class="form48-sheet"><thead>'+
   '<tr><th rowspan="2">Day</th><th colspan="2">A M</th><th colspan="2">P M</th><th colspan="2">UNDERTIME</th></tr>'+
   '<tr><th>Arrival</th><th>Departure</th><th>Arrival</th><th>Departure</th><th>Hours</th><th>Minutes</th></tr>'+
   '</thead><tbody>'+cells+'</tbody></table>'+
   (gateEvidenceShown?'<div class="form48-gate-note">* Verified physical gate arrival only — official DTR punch not recorded; excluded from calculated DTR totals pending authorized verification.</div>':'')+
   '<div class="form48-certify">I certify on my honor that the above is a true and correct report of the hours of work performed, record of which was made daily at the time of arrival and departure from office.</div>'+
   '<div class="form48-signature"><span>Employee signature</span></div>'+
   '<div class="form48-signature"><strong>'+esc(verifiedName)+'</strong>'+
   '<span class="form48-signer-position">'+esc(verifiedPosition)+'</span>'+
   '<span>Verified as to prescribed office hours — In Charge</span></div>'+
   '<div class="form48-remarks">REMARKS: '+leaveMarkup+
   (!leaveEntries.length&&s.approvedLeaveDays?esc(String(s.approvedLeaveDays)+' documented approved leave day(s).'):'')+
   obMarkup+'</div>'+
   '<div class="form48-summary">'+
   '<span>Days present (verified evidence): '+esc(s.daysPresent)+'</span>'+
   '<span>Days absent (confirmed): '+esc(s.daysAbsent)+esc(gapText)+'</span>'+ 
   '<span>Approved leave days: '+esc(s.approvedLeaveDays||0)+'</span>'+ 
   '<span>Tardy: '+esc(duration(s.tardyMinutes))+'</span>'+
   '<span>Undertime: '+esc(duration(s.undertimeMinutes))+'</span>'+
   '</div>'+
   '<div class="form48-signature form48-approval"><strong>'+esc(approvedName)+'</strong>'+
   '<span class="form48-signer-position">'+esc(approvedPosition)+'</span>'+
   '<span>Approved by (authorized signatory)</span></div>'+
   '<div class="form48-draft-mark">'+esc(reviewNote)+'</div>'+
   '</article>';
 };
 // Shared renderer is read-only; batch reports reuse the exact official copy formatter.
 window.attendigoForm48RenderCopy=copy;

 // Isolated Form 48 print document MUST NOT load the dashboard stylesheet:
 // historic overlapping @media print rules cause a phantom second A4 page in
 // iPad Safari / Chrome despite all visible report content fitting on page one.

const standalonePrintCss = [
 '@page{size:A4 portrait;margin:5mm}',
 '*{box-sizing:border-box}',
 'html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,sans-serif}',
 '#form48PrintArea{width:194mm;max-width:194mm;margin:0;padding:0;overflow:visible}',
 '.form48-sheets{display:grid;width:194mm;grid-template-columns:96mm 96mm;column-gap:2mm;align-items:stretch}',
 '.form48-copy{display:flex;flex-direction:column;width:96mm;min-height:260mm;padding:0 .8mm;font-size:7pt;line-height:1.15;overflow:visible}',
 '.form48-copy-type{text-align:right;font-size:6.8pt;font-weight:700}',
 '.form48-form-heading{font-size:6.8pt}',
 '.form48-copy h3{text-align:center;font-size:10pt;line-height:1.1;margin:2mm 0 1mm}',
 '.form48-employee{text-transform:uppercase;text-align:center;font-weight:700;font-size:8pt;border-bottom:1px solid #111;padding:1mm 0;overflow-wrap:anywhere}',
 '.form48-month{margin:2mm 0 1mm;font-size:7pt}',
 '.form48-official-hours{margin:1mm 0;font-size:7pt}',
 '.form48-hours-grid{display:block;font-size:6.8pt;line-height:1.15;margin:1mm 0 2mm}',
 '.form48-hours-grid span{display:block}',
 '.form48-sheet{width:100%;table-layout:fixed;border-collapse:collapse;font-size:6.6pt}',
 '.form48-sheet th,.form48-sheet td{border:1px solid #222;text-align:center;height:4.1mm;min-height:4.1mm;padding:0;font-size:6.6pt;line-height:1;white-space:nowrap;overflow:hidden}',
 '.form48-sheet th{font-weight:700}',
 '.form48-sheet thead tr:first-child th:first-child,.form48-sheet tbody td:first-child{width:7mm;min-width:7mm}',
 '.form48-certify{text-align:center;font-size:6.5pt;margin:2mm 0 1mm;line-height:1.18}',
 '.form48-signature{border-top:1px solid #111;text-align:center;font-size:6.7pt;margin:3mm 2mm 0;padding-top:1mm}',
 '.form48-signature strong,.form48-signature span{display:block;font-size:6.7pt;line-height:1.13}',
 '.form48-signature strong{text-transform:uppercase;font-weight:700}',
 '.form48-signer-position{font-style:italic;margin:1mm 0}',
 '.form48-remarks{margin:2mm 0 1mm;font-size:6.7pt;line-height:1.15;overflow-wrap:anywhere}',
 '.form48-line{display:block;border-bottom:1px solid #111;height:3mm}',
 '.form48-leave-remarks,.form48-ob-remarks{font-size:6.3pt;line-height:1.12;overflow-wrap:anywhere}',
 '.form48-leave-remarks>div,.form48-ob-remarks>div{margin:1mm 0}',
 '.form48-summary{display:grid;gap:.6mm;margin:1mm 0;font-size:6.7pt;line-height:1.15}',
 '.form48-approval{margin-top:auto;padding-top:2mm;margin-bottom:0}',
 '.form48-draft-mark{text-align:center;font-size:6pt;font-weight:700;margin:1mm 0 0;line-height:1.12}',
 '.form48-gate-note{font-size:6pt;line-height:1.1;margin:1mm 0}',
 '.form48-gate-evidence{font-weight:700;text-decoration:underline dotted}',
 '.form48-print-toolbar{padding:12px 16px;font:14px Arial,sans-serif;background:#f3f6fb;color:#223}',
 '.form48-print-toolbar button{padding:9px 14px;border:0;background:#14579b;color:#fff;border-radius:6px;cursor:pointer}',
 '@media screen{body{width:max-content;min-width:100%}#form48PrintArea{margin:12px auto}}',
 '@media print{.form48-print-toolbar{display:none!important}html,body{height:auto!important;min-height:0!important;overflow:visible!important}#form48PrintArea{height:auto!important;min-height:0!important}}'
].join('\n');

 function printDtrFromIsolatedPage(output,status){
  const sheets=output.querySelector('.form48-sheets');
  if(!sheets){status('Generate the DTR preview before printing.',true);return;}
  const popup=window.open('', '_blank');
  if(!popup){status('Allow pop-ups for Attendigo, then try Print / Save PDF again.',true);return;}
  // No external CSS, images, scripts or dashboard widgets are loaded.
  // A self-contained document avoids iOS print paging and cache conflicts.
  const html='<!doctype html><html lang="en" class="form48-print-document"><head><meta charset="utf-8">'+
   '<meta name="viewport" content="width=device-width,initial-scale=1">'+
   '<title>Attendigo — Form 48 Daily Time Record</title>'+
   '<style>'+standalonePrintCss+'</style></head><body>'+
   '<div class="form48-print-toolbar">DTR print copy · A4 portrait · Two copies on one page. <button id="form48PrintAgain" type="button">Print / Save PDF</button></div>'+
   '<main id="form48PrintArea" class="form48-print-area">'+sheets.outerHTML+'</main>'+
   '</body></html>';
  popup.addEventListener('load',()=>{
   // The inline CSS is ready at document load; do not depend on cached app assets.
   popup.setTimeout(()=>{popup.focus();popup.print();},150);
  },{once:true});
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  popup.document.getElementById('form48PrintAgain')?.addEventListener('click',()=>popup.print());
 }
 function init(user){
  if(user?.role!=='SCHOOL_ADMIN')return;
  const form=$('form48FilterForm'),month=$('form48Month'),person=$('form48Employee');
  const button=$('form48Print'),output=$('form48PrintArea'),feedback=$('form48Feedback');
  const settings=$('form48ReportSettings'),reviewHost=$('form48ReviewDays');
  const saveSchedule=$('form48SaveSchedule'),scheduleStatus=$('form48ScheduleSaveStatus');
  const saveDraft=$('form48SaveDraft');
  const summaryStrip=$('form48SummaryStrip'),previewToolbar=$('form48PreviewToolbar');
  if(!form||!month||!person||!button||!output||!feedback||!settings||!reviewHost)return;
  const format=new Intl.DateTimeFormat('en-US',{year:'numeric',month:'2-digit',timeZone:'Asia/Manila'}).formatToParts(new Date());
  const part=type=>format.find(p=>p.type===type)?.value||'';
  month.value=part('year')+'-'+part('month');
  const reportKey=()=>person.value+'/'+month.value;
  const status=(message,error=false)=>{feedback.textContent=message;feedback.classList.toggle('is-error',error);};
  const invalidate=()=>{button.disabled=true;output.hidden=true;output.replaceChildren();state.data=null;state.analysis=null;reviewHost.hidden=true;if(summaryStrip)summaryStrip.hidden=true;if(previewToolbar)previewToolbar.hidden=true;};
  output.dataset.copyView='office';
  previewToolbar?.addEventListener('click',event=>{
   const choice=event.target.closest('button[data-form48-copy]');
   if(!choice||!previewToolbar.contains(choice))return;
   output.dataset.copyView=choice.dataset.form48Copy;
   previewToolbar.querySelectorAll('button[data-form48-copy]').forEach(item=>item.setAttribute('aria-pressed',String(item===choice)));
  });
  const listDays=()=>[...settings.querySelectorAll('[data-form48-day]')];
  const hoursFor=group=>Object.fromEntries([...settings.querySelectorAll('[data-form48-hour="'+group+'"]')].map(x=>[x.dataset.slot,x.value]));
  const clock=v=>/^([01]\d|2[0-3]):[0-5]\d$/.test(v||'')?Number(v.slice(0,2))*60+Number(v.slice(3)):null;
  const validScheduleHours=hours=>{
   const arr=['AM_IN','AM_OUT','PM_IN','PM_OUT'].map(k=>clock(hours[k]));
   return arr.every(Number.isInteger)&&arr[0]<arr[1]&&arr[1]<=arr[2]&&arr[2]<arr[3];
  };
  const scheduleReady=()=>{
   const days=listDays().filter(x=>x.checked).map(x=>Number(x.value));
   return days.length>0&&(!days.some(d=>d!==6)||validScheduleHours(hoursFor('regular')))&&
    (!days.includes(6)||validScheduleHours(hoursFor('saturday')));
  };
  const scheduleMessage=(text,error=false)=>{
   if(scheduleStatus){scheduleStatus.textContent=text;scheduleStatus.classList.toggle('is-error',error);}
  };
  const updateScheduleSummary=()=>{
   const days=listDays().filter(x=>x.checked).map(x=>Number(x.value));
   const names=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
   const label=days.length===5&&[1,2,3,4,5].every(d=>days.includes(d))
    ?'Mon–Fri':days.length?days.map(d=>names[d]).join(', '):'No workdays chosen';
   const regular=hoursFor('regular');
   const hasRegular=validScheduleHours(regular);
   const saturday=hoursFor('saturday');
   const hasSaturday=validScheduleHours(saturday);
   const needsSaturday=days.includes(6),needsRegular=days.some(d=>d!==6);
   const badge=$('form48ScheduleSummary');
   if(badge)badge.textContent=label+' · '+((!needsRegular||hasRegular)&&(!needsSaturday||hasSaturday)
    ?(state.scheduleDirty?'Unsaved work hours':'Office hours configured'):'Office hours need setup');
   if(saveSchedule)saveSchedule.disabled=!person.value||!state.review||state.scheduleSaving||!scheduleReady();
   const saturdayPanel=$('form48SaturdayHours');
   if(saturdayPanel)saturdayPanel.hidden=!needsSaturday;
  };
  const snapshot=()=>{
   const r=state.review||{};
   return {staffUserId:person.value,month:month.value,revision:r.revision??0,
    workdays:listDays().filter(x=>x.checked).map(x=>Number(x.value)),
    regularHours:hoursFor('regular'),saturdayHours:hoursFor('saturday'),
    dayReviews:r.dayReviews||{},verifiedBy:$('form48VerifiedBy').value.trim(),
    approvedBy:$('form48ApprovedBy').value.trim(),
    verifiedPosition:$('form48VerifiedPosition').value.trim(),
    approvedPosition:$('form48ApprovedPosition').value.trim()};
  };
  const populate=data=>{
   const r=data.review||{};
   state.review=r;
   listDays().forEach(x=>{x.checked=(r.workdays||[]).includes(Number(x.value));});
   for(const group of ['regular','saturday']){
    for(const input of settings.querySelectorAll('[data-form48-hour="'+group+'"]')){
     const data=group==='regular'?r.regularHours:r.saturdayHours;
     input.value=data?.[input.dataset.slot]||'';
    }
   }
   $('form48VerifiedBy').value=r.verifiedBy||'';
   $('form48ApprovedBy').value=r.approvedBy||'';
   $('form48VerifiedPosition').value=r.verifiedPosition||'';
   $('form48ApprovedPosition').value=r.approvedPosition||'';
   state.scheduleDirty=false;state.draftDirty=false;
   updateScheduleSummary();
   scheduleMessage(state.employeeSchedule?.revision>0?'Employee schedule saved (applies across months).':
    'Complete the prescribed hours, then save once for this employee.');
  };
  const fetchConfig=async()=>{
   const key=reportKey();
   invalidate();state.key=key;state.review=null;state.employeeSchedule=null;
   if(saveSchedule)saveSchedule.disabled=true;
   scheduleMessage('Loading employee schedule…');
   settings.hidden=!person.value||!month.value;
   if(settings.hidden)return;
   status('Loading report work hours and signatory draft…');
   try{
    const query=new URLSearchParams({staffUserId:person.value,month:month.value});
    const [result,schedule]=await Promise.all([
     api('/api/staff-attendance/admin/form48/config?'+query),
     api('/api/staff-attendance/admin/form48/schedule?'+new URLSearchParams({staffUserId:person.value}))
    ]);
    if(key!==reportKey())return;
    state.employeeSchedule=schedule.schedule||{revision:0};
    populate(result);
    status('Work hours save separately. Generate preview when ready to review the DTR.');
   }catch(e){if(key===reportKey())status(e.message,true);}
  };
  const renderReviews=analysis=>{
   const list=(analysis.assessments||[]).filter(a=>
    a.status==='MISSING_REVIEW'||a.status==='CONFIRMED_ABSENT'||a.status==='EXCUSED'||
    a.status==='APPROVED_OB_REVIEW'||a.status==='LEAVE_REVIEW'||
    a.status==='INCOMPLETE_DTR'||a.status==='TIME_SLOT_REVIEW'||a.status==='LEAVE_PUNCH_CONFLICT');
   reviewHost.hidden=!list.length;
   reviewHost.innerHTML=list.length?'<h4>Review missing workdays</h4>'+
    '<p>Absence is counted only after School Admin confirmation. For leave or approved OB, choose Excused.</p>'+
    '<div class="form48-review-list">'+list.map(item=>{
     const selected=state.review?.dayReviews?.[item.date]||'PENDING';
     const recordReview=['INCOMPLETE_DTR','TIME_SLOT_REVIEW','LEAVE_PUNCH_CONFLICT'].includes(item.status);
     if(recordReview)return '<label>'+esc(item.date)+' · '+
      (item.status==='TIME_SLOT_REVIEW'?'Recorded scan outside prescribed time slot':
       item.status==='LEAVE_PUNCH_CONFLICT'?'Approved leave overlaps verified punches':'Incomplete verified DTR punches')+
      '<span class="form48-record-review">Requires evidence review. Punches remain unchanged.</span></label>';
     return '<label>'+esc(item.date)+
      (item.approvedOB?' · Approved OB':item.leaveDay?' · Recorded leave':' · No verified DTR punches')+
      '<select data-form48-review="'+esc(item.date)+'">'+
      ['PENDING','ABSENT','EXCUSED'].map(v=>'<option value="'+v+'"'+(selected===v?' selected':'')+'>'+
       ({PENDING:'Needs review',ABSENT:'Confirmed absent',EXCUSED:'Excused / approved leave'}[v])+'</option>').join('')+
      '</select></label>';
    }).join('')+'</div>':'';
  };
  async function persistDraft(){
   if(!person.value||!month.value||!state.review)throw Error('Select an employee and month first.');
   if(state.scheduleDirty)throw Error('Save the employee work schedule first.');
   if(!scheduleReady())throw Error('Configure approved working hours before saving monthly reviews.');
   const key=reportKey(),payload=snapshot();
   const saved=await api('/api/staff-attendance/admin/form48/config',{
    method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
   });
   if(key!==reportKey())return false;
   state.review={...state.review,...payload,configured:true,revision:saved.revision};
   state.draftDirty=false;
   invalidate();
   status('Report details saved with an audit trail. Generate a fresh preview.');
   return true;
  }
  if(saveDraft)saveDraft.addEventListener('click',async()=>{
   saveDraft.disabled=true;
   try{await persistDraft();}catch(error){status('Nothing saved: '+error.message,true);}
   finally{saveDraft.disabled=false;}
  });
  async function generate(){
   if(state.loading)return;
   if(!person.value||!month.value){status('Select an employee and month.',true);return;}
   if(!state.review){status('Load report settings before generating.',true);return;}
   if(state.scheduleDirty||state.draftDirty){
    status('Save your changes before generating a fresh preview.',true);return;
   }
   const key=reportKey();
   state.loading=true;button.disabled=true;
   const submit=form.querySelector('button[type=submit]');submit.disabled=true;
   try{
    const params=new URLSearchParams({staffUserId:person.value,month:month.value});
    const [data,analysis]=await Promise.all([
     api('/api/staff-attendance/admin/form48?'+params),
     api('/api/staff-attendance/admin/form48/analysis?'+params)
    ]);
    if(key!==reportKey())return;
    state.data=data;state.analysis=analysis;
    output.innerHTML='<div class="form48-sheets">'+copy(data,analysis,"Office's")+copy(data,analysis,"Employee's")+'</div>'+
     '<p class="form48-preview-note">'+esc(analysis.notice||'Verified entries only. Review missing punches and sign the paper copies.')+'</p>';
    output.hidden=false;button.disabled=false;
    renderReviews(analysis);
    const sum=analysis.summary;
    if(summaryStrip){
     $('form48VerifiedDays').textContent=String(sum.daysPresent);
     $('form48IncompleteDays').textContent=String(sum.partialRecordDays)+' incomplete';
     $('form48ToReview').textContent=String(sum.pendingAbsentDays);
     $('form48Tardy').textContent=duration(sum.tardyMinutes);
     $('form48Undertime').textContent=duration(sum.undertimeMinutes);
     summaryStrip.hidden=false;
    }
    if(previewToolbar)previewToolbar.hidden=false;
    status('Draft preview · '+sum.daysAbsent+' confirmed absent'+
     (sum.timeAnomalyDays?' · '+sum.timeAnomalyDays+' unexpected time slot(s) need review':'')+
     '. Only verified punches contribute to time calculations.');
   }catch(e){status(e.message,true);}
   finally{state.loading=false;submit.disabled=false;}
  }
  if(saveSchedule){
   saveSchedule.addEventListener('click',async()=>{
    if(state.scheduleSaving||!state.review||!person.value||!month.value)return;
    if(!scheduleReady()){scheduleMessage('Enter all four chronological prescribed hours for each selected day type.',true);return;}
    const key=reportKey(),current=snapshot();
    const payload={staffUserId:current.staffUserId,month:current.month,
     monthlyRevision:state.review.revision??0,revision:state.employeeSchedule?.revision??0,
     workdays:current.workdays,regularHours:current.regularHours,saturdayHours:current.saturdayHours};
    state.scheduleSaving=true;saveSchedule.disabled=true;
    scheduleMessage('Saving prescribed hours…');
    try{
     const result=await api('/api/staff-attendance/admin/form48/schedule',{
      method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
     });
     if(key!==reportKey())return;
     state.employeeSchedule={...payload,revision:result.revision};
     state.review={...state.review,workdays:payload.workdays,
      regularHours:payload.regularHours,saturdayHours:payload.saturdayHours,
      configured:true,revision:result.monthlyRevision||state.review.revision||0};
     state.scheduleDirty=false;
     invalidate();
     scheduleMessage('Saved for this employee across report months. The selected month is updated; earlier monthly reviews remain unchanged.');
     status('Employee prescribed hours saved. Generate a fresh preview to calculate tardiness and undertime.');
    }catch(err){if(key===reportKey())scheduleMessage(err.message,true);}
    finally{state.scheduleSaving=false;updateScheduleSummary();}
   });
  }
  api('/api/staff-attendance/admin/form48/employees').then(data=>{
   person.replaceChildren(new Option('Select a staff member',''));
   (data.staff||[]).forEach(s=>person.add(new Option(s.displayName+' · '+s.role.replaceAll('_',' '),s.userId)));
   window.attendigoForm48Staff=data.staff||[];
   document.dispatchEvent(new CustomEvent('attendigo:form48-staff-loaded',{detail:{staff:data.staff||[]}}));
  }).catch(e=>status(e.message,true));
  month.addEventListener('change',fetchConfig);
  person.addEventListener('change',fetchConfig);
  form.addEventListener('submit',event=>{event.preventDefault();generate();});
  reviewHost.addEventListener('change',async event=>{
   const select=event.target.closest('select[data-form48-review]');
   if(!select||!state.review)return;
   const date=select.dataset.form48Review,previous={...(state.review.dayReviews||{})};
   const reviews={...previous};
   if(select.value==='PENDING')delete reviews[date];else reviews[date]=select.value;
   state.review.dayReviews=reviews;
   select.disabled=true;
   try{if(await persistDraft())await generate();}
   catch(error){state.review.dayReviews=previous;status('Review not saved: '+error.message,true);}
   finally{select.disabled=false;}
  });
  const onSettingsChange=event=>{
   button.disabled=true;
   output.hidden=true;
   if(summaryStrip)summaryStrip.hidden=true;
   if(previewToolbar)previewToolbar.hidden=true;
   if(event.target.matches('[data-form48-day],[data-form48-hour]')){
    state.scheduleDirty=true;
    scheduleMessage('Unsaved work hours. Select Save employee work schedule.');
   }else if(['form48VerifiedBy','form48ApprovedBy','form48VerifiedPosition','form48ApprovedPosition'].includes(event.target.id)){
    state.draftDirty=true;
    status('Unsaved certification details. Select Save report details.');
   }
   updateScheduleSummary();
  };
  settings.addEventListener('input',onSettingsChange);
  settings.addEventListener('change',onSettingsChange);
  button.addEventListener('click',()=>{if(!button.disabled&&!output.hidden)printDtrFromIsolatedPage(output,status);});
 }
 window.attendigoStaffIdentity?.then(init).catch(()=>{});
})();
