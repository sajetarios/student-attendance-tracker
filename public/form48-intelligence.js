'use strict';
// School Admin: read-only evidence preview plus explicitly authorized, audited verification.
// Never silently auto-approve a suggested slot; server rechecks original evidence on apply.
(() => {
 const $=id=>document.getElementById(id);
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const slotNames={AM_IN:'AM Time-In',AM_OUT:'AM Time-Out',PM_IN:'PM Time-In',PM_OUT:'PM Time-Out'};
 const reasons={
  SCHEDULE_UNAVAILABLE:'Configure the employee’s official work hours before reviewing gate evidence.',
  GATE_HISTORY_AMBIGUOUS:'Gate movements are out of order, repeated, or missing a matching entry/exit.',
  OB_INTERVAL_AMBIGUOUS:'The approved OB interval requires a separate date or time review.',
  OB_BOUNDARY_GATE_MOVEMENT:'A gate movement overlaps approved OB hours; do not classify it as lunch or an ordinary DTR punch.',
  OB_RETURN_AFTER_APPROVED_END_REVIEW:'Verified gate re-entry occurred after an approved OB interval. Confirm the circumstances; no overtime is inferred.',
  POST_OB_RETURN_MOVEMENT_REVIEW:'Movements following the late OB return require review before any DTR interpretation.',
  OB_COVERAGE_REQUIRES_REVIEW:'Approved OB is authorization, not evidence of a Form 48 clock punch.',
  OUTSIDE_SCHEDULE_WINDOW:'A scan is too far from the prescribed clock boundary to suggest a DTR slot.',
  AMBIGUOUS_SCHEDULE_SLOT:'The scan is equally plausible for AM and PM based on the configured work hours.',
  DUPLICATE_SLOT_CANDIDATES:'Multiple different gate movements could match the same DTR slot; no candidate is selected.',
  SLOT_ALREADY_VERIFIED:'An official verified DTR slot already exists and cannot be replaced by a gate suggestion.',
  CALENDAR_EXCEPTION_REQUIRES_REVIEW:'The school calendar has a closure or shortened day; review the applicable schedule first.',
  NOT_SCHEDULED_WORKDAY:'The selected date is not a scheduled workday for this employee.',
  APPROVED_OB_REQUIRES_REVIEW:'Approved official business must be resolved separately; this quick verification cannot override OB.',
  LEAVE_REQUIRES_REVIEW:'Approved leave or on-leave status needs separate review.',
  UNTRUSTED_GATE_TIMESTAMP:'An older or untrusted device-clock gate entry is present. Do not approve a time without authoritative evidence.',
  UNUSUAL_GATE_SEQUENCE:'The gate sequence is too complex for one-click verification.',
  DAY_ALREADY_REVIEWED:'A confirmed absence or excusal exists for this date. Do not overwrite it.',
  NO_CLEAR_UNVERIFIED_SLOT:'There are no safe unverified DTR slots for this gate history.',
  MORNING_ARRIVAL_UNCONFIRMED:'The first morning arrival is not established.',
  GATE_EVIDENCE_AMBIGUOUS:'The available gate events do not uniquely support this DTR slot.',
  OPTIONS_UNAVAILABLE:'Verification options are unavailable. No official record can be changed.'
 };
 function todayInManila(){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));
  return parts.year+'-'+parts.month+'-'+parts.day;
 }
 const validDate=date=>/^\d{4}-\d{2}-\d{2}$/.test(date||'')&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;
 function init(user){
  if(user?.role!=='SCHOOL_ADMIN')return;
  const person=$('form48Employee'),month=$('form48Month');
  const day=$('form48GateReviewDate'),button=$('form48GateReviewButton');
  const status=$('form48GateReviewStatus'),host=$('form48GateReviewResult');
  if(!person||!month||!day||!button||!status||!host)return;
  let revision=0,loading=false,approving=false;
  const say=(message,error=false)=>{
   status.textContent=message;
   status.classList.toggle('is-error',Boolean(error));
  };
  function validSelection(){
   return Boolean(person.value&&/^\d{4}-(0[1-9]|1[0-2])$/.test(month.value)&&
    validDate(day.value)&&day.value.slice(0,7)===month.value&&
    day.value<=todayInManila()&&day.value>=day.min&&day.value<=day.max);
  }
  function clear(){
   revision++;loading=false;host.replaceChildren();
   button.disabled=!validSelection();
   say(person.value&&month.value?'Select a school date and choose Review evidence.':'Choose an employee and month first.');
  }
  function resetDay(){
   const value=month.value;
   const today=todayInManila();
   if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)){
    day.value='';day.min='';day.max='';day.disabled=true;clear();return;
   }
   const [year,number]=value.split('-').map(Number);
   const end=new Date(Date.UTC(year,number,0)).toISOString().slice(0,10);
   day.min=value+'-01';
   day.max=end<today?end:today;
   day.value=day.min<=day.max?day.max:'';
   day.disabled=!day.value;
   clear();
  }
  function render(data,options){
   // Both previews are read-only. Only a fresh, explicit, server-validated POST may write.

   if(data.safeToApply!==false)throw Error('Unexpected attendance preview status. No changes made.');
   const verified=data.existingSlots||{},suggestions=data.suggestions||{};
   const reviews=Array.isArray(data.review)?data.review:[];
   const slotMarkup=Object.keys(slotNames).map(slot=>{
    const official=verified[slot],candidate=suggestions[slot]?.time;
    const kind=official?'Verified official DTR':candidate?'Suggested gate evidence':'No verified DTR slot';
    const time=official||candidate||'—';
    return '<div class="form48-intelligence-slot"><span>'+esc(slotNames[slot])+'</span>'+
      '<strong>'+esc(time)+'</strong><small>'+esc(kind)+'</small></div>';
   }).join('');
   const flags=reviews.length?'<ul class="form48-intelligence-flags">'+reviews.map(reason=>
    '<li>'+esc(reasons[reason]||'Unrecognized review reason. Ask the School Administrator to verify the source.')+'</li>'
   ).join('')+'</ul>':
    '<p class="form48-intelligence-empty">No rule-based exceptions were found in the available gate evidence. Missing official punches still require verification.</p>';
   const count=Number(data.gateEventCount)||0,obCount=Number(data.approvedObCount)||0;
   const allowed=(options?.status==='ELIGIBLE'&&Array.isArray(options.candidates))
    ?options.candidates.filter(c=>slotNames[c.slot]&&/^[0-9a-f-]{36}$/i.test(c.eventId||'')):[];
   const approval=allowed.length?
    '<section class="form48-approval-panel" aria-label="Verify verified gate times for DTR">'+
    '<h5>Verify &amp; Apply to DTR</h5>'+
    '<p>These eligible times come from original photo-verified, server-timestamped gate events. Confirm the event and DTR slot before applying.</p>'+
    '<label>Approval reason <textarea id="form48GateApprovalReason" rows="2" maxlength="500" placeholder="Example: Reviewed verified gate arrival against employee schedule" aria-describedby="form48GateApprovalHint"></textarea></label>'+
    '<small id="form48GateApprovalHint">At least 10 characters. The decision and original gate-event ID will be audited.</small>'+
    '<div class="form48-approval-actions">'+allowed.map(c=>
     '<button type="button" class="primary-button" data-gate-approve="'+esc(c.eventId)+'" data-dtr-slot="'+esc(c.slot)+'">'+
     'Verify &amp; Apply '+esc(slotNames[c.slot])+' · '+esc(c.time)+'</button>').join('')+'</div>'+
    '</section>':
    (options?.reason&&options.reason!=='NO_CLEAR_UNVERIFIED_SLOT'
     ?'<p class="form48-intelligence-disclaimer">One-click DTR verification unavailable: '+esc(reasons[options.reason]||'Further attendance review is required.')+'</p>':'');
   host.innerHTML='<div class="form48-intelligence-counts">'+esc(count)+' verified gate movement(s) · '+
    esc(obCount)+' approved OB interval(s) · '+esc(data.date||day.value)+'</div>'+
    '<div class="form48-intelligence-slots">'+slotMarkup+'</div>'+
    '<h5>Evidence requiring attention</h5>'+flags+
    (count===0?'<p class="form48-intelligence-empty">No gate evidence was found for this date. This is not proof of absence.</p>':'')+
    approval+
    '<p class="form48-intelligence-disclaimer">Read-only evidence preview. Suggestions alone are not official Form 48 punches or proof of completed OB. No record was changed by this preview.</p>';
  }
  async function load(){
   if(loading||!validSelection())return;
   const token=++revision,personId=person.value,monthValue=month.value,schoolDate=day.value;
   loading=true;button.disabled=true;host.replaceChildren();say('Checking verified gate movements and DTR evidence…');
   try{
    const params=new URLSearchParams({staffUserId:personId,date:schoolDate});
    const [response,optionResponse]=await Promise.all([
     fetch('/api/staff-attendance/admin/dtr-reconciliation-preview?'+params,
      {method:'GET',credentials:'same-origin',cache:'no-store'}),
     fetch('/api/staff-attendance/admin/dtr-review-options?'+params,
      {method:'GET',credentials:'same-origin',cache:'no-store'}).catch(()=>null)
    ]);
    const data=await response.json().catch(()=>({}));
    const options=optionResponse?.ok
      ?await optionResponse.json().catch(()=>({status:'REVIEW_REQUIRED',reason:'OPTIONS_UNAVAILABLE'}))
      :{status:'REVIEW_REQUIRED',reason:'OPTIONS_UNAVAILABLE'};
    if(token!==revision||person.value!==personId||month.value!==monthValue||day.value!==schoolDate)return;
    if(!response.ok)throw Error(data.error||'Unable to load the attendance review.');
    render(data,options);
    say('Review loaded for '+schoolDate+'. No official DTR times were changed.');
   }catch(error){
    if(token!==revision)return;
    host.replaceChildren();say(error.message||'Unable to load the attendance review.',true);
   }finally{
    if(token===revision){loading=false;button.disabled=!validSelection();}
   }
  }
  host.addEventListener('click',async event=>{
   const action=event.target.closest?.('button[data-gate-approve]');
   if(!action||!host.contains(action)||loading||approving||!validSelection())return;
   const reason=$('form48GateApprovalReason')?.value?.trim()||'';
   if(reason.length<10||reason.length>500){
    say('Enter a specific approval reason of 10–500 characters before verifying.',true);
    return;
   }
   const slot=action.dataset.dtrSlot,gateEventId=action.dataset.gateApprove;
   if(!slotNames[slot]||!gateEventId)return;
   const personId=person.value,schoolDate=day.value,token=revision;
   if(!window.confirm('Verify the original gate evidence as '+slotNames[slot]+' for '+schoolDate+
     '? This creates an audited official DTR entry and cannot be undone from this screen.'))return;
   approving=true;action.disabled=true;button.disabled=true;
   let verified=false;
   try{
    const response=await fetch('/api/staff-attendance/admin/dtr-review-apply',{
     method:'POST',credentials:'same-origin',cache:'no-store',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({staffUserId:personId,date:schoolDate,gateEventId,slot,reason})
    });
    const result=await response.json().catch(()=>({}));
    if(token!==revision||personId!==person.value||schoolDate!==day.value)return;
    if(!response.ok)throw Error(result.error||'Approval was not saved.');
    verified=true;
    const print=$('form48Print'),area=$('form48PrintArea');
    if(print)print.disabled=true;
    if(area)area.hidden=true;
    const feedback=$('form48Feedback');
    if(feedback)feedback.textContent='DTR evidence was verified. Generate a fresh Form 48 preview to see the approved time.';
    if(typeof CustomEvent!=='undefined')
     document.dispatchEvent(new CustomEvent('attendigo:dtr-verified',{detail:{staffUserId:personId,schoolDate,slot}}));
   }catch(error){
    if(token===revision)say('DTR verification not saved: '+error.message,true);
   }finally{
    approving=false;action.disabled=false;
    if(token===revision)button.disabled=!validSelection();
   }
   if(verified&&token===revision){
    await load();
    say(slotNames[slot]+' verified using original gate time. Generate a new Form 48 preview.');
   }
  });
  person.addEventListener('change',clear);
  month.addEventListener('change',resetDay);
  day.addEventListener('change',clear);
  button.addEventListener('click',load);
  resetDay();
 }
 window.attendigoStaffIdentity?.then(init).catch(()=>{});
})();
