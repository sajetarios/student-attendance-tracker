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
 const state={review:null,loading:false,key:'',data:null,analysis:null};
 const copy=(data,analysis,kind)=>{
  const month=new Date(data.month+'-01T12:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC',month:'long',year:'numeric'});
  const assess=new Map((analysis.assessments||[]).map(item=>[item.date,item]));
  const cells=data.records.map(row=>{
   const v=row.slots||{},a=assess.get(row.date);
   const early=a&&a.undertimeMinutes>0&&a.scheduled;
   const hours=early?Math.floor(a.undertimeMinutes/60):'';
   const mins=early?a.undertimeMinutes%60:'';
   return '<tr><td>'+row.day+'</td>'+slots.map(k=>'<td>'+esc(formatTime(v[k]))+'</td>').join('')+
    '<td>'+esc(hours)+'</td><td>'+esc(mins)+'</td></tr>';
  }).join('');
  const obEntries=data.records.flatMap(row=>(row.obRemarks||[]).map(ob=>({
   date:row.date,remark:ob.remark,exception:ob.exceptionRemark||'',reviewRequired:Boolean(ob.exception)
  })));
  const hasObExceptions=obEntries.some(item=>item.reviewRequired);
  const obMarkup=obEntries.length
   ?'<div class="form48-ob-remarks">'+obEntries.map(item=>
      '<div><strong>'+esc(item.date.slice(8))+'</strong> '+esc(item.remark)+
      (item.reviewRequired?' — REVIEW REQUIRED: '+esc(item.exception):'')+'</div>'
     ).join('')+'</div>'
   :'<div class="form48-line"></div><div class="form48-line"></div>';
  const s=analysis.summary||{};
  const verifiedName=analysis.signatories?.verifiedBy||'',approvedName=analysis.signatories?.approvedBy||'';
  const reviewNote=s.hasUnreviewed||!s.configured||hasObExceptions?'DRAFT — REVIEW REQUIRED':'PREPARED FOR SIGNATURE';
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
   '<div class="form48-certify">I certify on my honor that the above is a true and correct report of the hours of work performed, record of which was made daily at the time of arrival and departure from office.</div>'+
   '<div class="form48-signature"><span>Employee signature</span></div>'+
   '<div class="form48-signature"><strong>'+esc(verifiedName)+'</strong>'+
   '<span>Verified as to prescribed office hours — In Charge</span></div>'+
   '<div class="form48-remarks">REMARKS: '+obMarkup+'</div>'+
   '<div class="form48-summary">'+
   '<span>Days present (verified evidence): '+esc(s.daysPresent)+'</span>'+
   '<span>Days absent (confirmed): '+esc(s.daysAbsent)+esc(gapText)+'</span>'+
   '<span>Tardy: '+esc(duration(s.tardyMinutes))+'</span>'+
   '<span>Undertime: '+esc(duration(s.undertimeMinutes))+'</span>'+
   '</div>'+
   '<div class="form48-signature form48-approval"><strong>'+esc(approvedName)+'</strong>'+
   '<span>Approved by (authorized signatory)</span></div>'+
   '<div class="form48-draft-mark">'+esc(reviewNote)+'</div>'+
   '</article>';
 };
 function init(user){
  if(user?.role!=='SCHOOL_ADMIN')return;
  const form=$('form48FilterForm'),month=$('form48Month'),person=$('form48Employee');
  const button=$('form48Print'),output=$('form48PrintArea'),feedback=$('form48Feedback');
  const settings=$('form48ReportSettings'),reviewHost=$('form48ReviewDays');
  if(!form||!month||!person||!button||!output||!feedback||!settings||!reviewHost)return;
  const format=new Intl.DateTimeFormat('en-US',{year:'numeric',month:'2-digit',timeZone:'Asia/Manila'}).formatToParts(new Date());
  const part=type=>format.find(p=>p.type===type)?.value||'';
  month.value=part('year')+'-'+part('month');
  const reportKey=()=>person.value+'/'+month.value;
  const status=(message,error=false)=>{feedback.textContent=message;feedback.classList.toggle('is-error',error);};
  const invalidate=()=>{button.disabled=true;output.hidden=true;output.replaceChildren();state.data=null;state.analysis=null;reviewHost.hidden=true;};
  const listDays=()=>[...settings.querySelectorAll('[data-form48-day]')];
  const hoursFor=group=>Object.fromEntries([...settings.querySelectorAll('[data-form48-hour="'+group+'"]')].map(x=>[x.dataset.slot,x.value]));
  const snapshot=()=>{
   const r=state.review||{};
   return {staffUserId:person.value,month:month.value,revision:r.revision??0,
    workdays:listDays().filter(x=>x.checked).map(x=>Number(x.value)),
    regularHours:hoursFor('regular'),saturdayHours:hoursFor('saturday'),
    dayReviews:r.dayReviews||{},verifiedBy:$('form48VerifiedBy').value.trim(),
    approvedBy:$('form48ApprovedBy').value.trim()};
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
  };
  const fetchConfig=async()=>{
   const key=reportKey();
   invalidate();state.key=key;state.review=null;
   settings.hidden=!person.value||!month.value;
   if(settings.hidden)return;
   status('Loading report work hours and signatory draft…');
   try{
    const result=await api('/api/staff-attendance/admin/form48/config?'+new URLSearchParams({staffUserId:person.value,month:month.value}));
    if(key!==reportKey())return;
    populate(result);status('Configure prescribed hours and signatories, then generate the preview.');
   }catch(e){if(key===reportKey())status(e.message,true);}
  };
  const renderReviews=analysis=>{
   const list=(analysis.assessments||[]).filter(a=>
    a.status==='MISSING_REVIEW'||a.status==='CONFIRMED_ABSENT'||a.status==='EXCUSED'||
    a.status==='APPROVED_OB_REVIEW'||a.status==='LEAVE_REVIEW');
   reviewHost.hidden=!list.length;
   reviewHost.innerHTML=list.length?'<h4>Review missing workdays</h4>'+
    '<p>Absence is counted only after School Admin confirmation. For leave or approved OB, choose Excused.</p>'+
    '<div class="form48-review-list">'+list.map(item=>{
     const selected=state.review?.dayReviews?.[item.date]||'PENDING';
     return '<label>'+esc(item.date)+
      (item.approvedOB?' · Approved OB':item.leaveDay?' · Recorded leave':' · No verified DTR punches')+
      '<select data-form48-review="'+esc(item.date)+'">'+
      ['PENDING','ABSENT','EXCUSED'].map(v=>'<option value="'+v+'"'+(selected===v?' selected':'')+'>'+
       ({PENDING:'Needs review',ABSENT:'Confirmed absent',EXCUSED:'Excused / approved leave'}[v])+'</option>').join('')+
      '</select></label>';
    }).join('')+'</div>':'';
  };
  async function generate(){
   if(state.loading)return;
   if(!person.value||!month.value){status('Select an employee and month.',true);return;}
   if(!state.review){status('Load report settings before generating.',true);return;}
   const key=reportKey();
   state.loading=true;button.disabled=true;
   const submit=form.querySelector('button[type=submit]');submit.disabled=true;
   try{
    const payload=snapshot();
    const saved=await api('/api/staff-attendance/admin/form48/config',{
     method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
    });
    if(key!==reportKey())return;
    state.review={...state.review,...payload,configured:true,revision:saved.revision};
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
    status('Draft: '+sum.daysPresent+' present, '+sum.daysAbsent+' confirmed absent, '+
      sum.pendingAbsentDays+' missing day(s) for review; tardy '+duration(sum.tardyMinutes)+
      ', undertime '+duration(sum.undertimeMinutes)+'.');
   }catch(e){status(e.message,true);}
   finally{state.loading=false;submit.disabled=false;}
  }
  api('/api/staff-attendance/admin/form48/employees').then(data=>{
   person.replaceChildren(new Option('Select a staff member',''));
   (data.staff||[]).forEach(s=>person.add(new Option(s.displayName+' · '+s.role.replaceAll('_',' '),s.userId)));
  }).catch(e=>status(e.message,true));
  month.addEventListener('change',fetchConfig);
  person.addEventListener('change',fetchConfig);
  form.addEventListener('submit',event=>{event.preventDefault();generate();});
  reviewHost.addEventListener('change',event=>{
   const select=event.target.closest('select[data-form48-review]');
   if(!select||!state.review)return;
   const date=select.dataset.form48Review;
   const reviews={...(state.review.dayReviews||{})};
   if(select.value==='PENDING')delete reviews[date];else reviews[date]=select.value;
   state.review.dayReviews=reviews;
   generate();
  });
  settings.addEventListener('input',()=>{button.disabled=true;});
  settings.addEventListener('change',()=>{button.disabled=true;});
  button.addEventListener('click',()=>{if(!button.disabled&&!output.hidden)window.print();});
 }
 window.attendigoStaffIdentity?.then(init).catch(()=>{});
})();
