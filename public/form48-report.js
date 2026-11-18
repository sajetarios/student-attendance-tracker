'use strict';
// Form 48 monthly DTR preview. School administrator access is enforced by the API.
(() => {
  const $=id=>document.getElementById(id);
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const api=async url=>{
    const response=await fetch(url,{credentials:'same-origin',cache:'no-store'});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(result.error||'Unable to load attendance data.');
    return result;
  };
  const humanTime=value=>{
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(value||''))return '';
    const [h,m]=value.split(':').map(Number);
    return String(h%12||12)+':'+String(m).padStart(2,'0')+' '+(h<12?'AM':'PM');
  };
  const copy=(data,kind)=>{
    const month=new Date(data.month+'-01T12:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC',month:'long',year:'numeric'});
    const cells=data.records.map(row=>{
      const s=row.slots||{};
      return '<tr><td>'+row.day+'</td>'+
        ['AM_IN','AM_OUT','PM_IN','PM_OUT'].map(k=>'<td>'+escapeHtml(humanTime(s[k]))+'</td>').join('')+
        '<td></td><td></td></tr>';
    }).join('');
    return '<article class="form48-copy" aria-label="'+kind+' DTR copy">'+
      '<div class="form48-copy-type">'+escapeHtml(kind.toUpperCase())+' COPY</div>'+
      '<div class="form48-form-heading">Civil Service Form No. 48</div>'+
      '<h3>DAILY TIME RECORD</h3>'+
      '<div class="form48-employee">'+escapeHtml(data.displayName)+'</div>'+
      '<div class="form48-month">For the month of <strong>'+escapeHtml(month)+'</strong></div>'+
      '<div class="form48-official-hours">Official hours for arrival and departure: <span class="form48-line"></span></div>'+
      '<table class="form48-sheet"><thead>'+
       '<tr><th rowspan="2">Day</th><th colspan="2">A M</th><th colspan="2">P M</th><th colspan="2">UNDERTIME</th></tr>'+
       '<tr><th>Arrival</th><th>Departure</th><th>Arrival</th><th>Departure</th><th>Hours</th><th>Minutes</th></tr>'+
       '</thead><tbody>'+cells+'</tbody></table>'+
      '<div class="form48-certify">I certify on my honor that the above is a true and correct report of the hours of work performed, record of which was made daily at the time of arrival and departure from office.</div>'+
      '<div class="form48-signature"><span>Employee signature</span></div>'+
      '<div class="form48-signature"><span>Verified as to prescribed office hours — In Charge</span></div>'+
      '<div class="form48-remarks">REMARKS: <div class="form48-line"></div><div class="form48-line"></div></div>'+
      '<div class="form48-summary"><span>Days present: ______</span><span>Days absent: ______</span><span>Tardy: ______</span><span>Undertime: ______</span></div>'+
      '<div class="form48-signature form48-approval"><span>Approved by (authorized signatory)</span></div>'+
      '</article>';
  };
  function init(user){
    if(user?.role!=='SCHOOL_ADMIN')return;
    const form=$('form48FilterForm'),month=$('form48Month'),person=$('form48Employee');
    const button=$('form48Print'),output=$('form48PrintArea'),feedback=$('form48Feedback');
    if(!form||!month||!person||!button||!output||!feedback)return;
    const current=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',timeZone:'Asia/Manila'}).format(new Date());
    month.value=current.slice(0,7);
    const status=(msg,fail=false)=>{feedback.textContent=msg;feedback.classList.toggle('is-error',fail);};
    api('/api/staff-attendance/admin/form48/employees').then(data=>{
      person.replaceChildren(new Option('Select a staff member',''));
      (data.staff||[]).forEach(s=>person.add(new Option(s.displayName+' · '+s.role.replaceAll('_',' '),s.userId)));
    }).catch(e=>status(e.message,true));
    function invalidate(){button.disabled=true;output.hidden=true;output.replaceChildren();}
    month.addEventListener('change',invalidate);
    person.addEventListener('change',invalidate);
    form.addEventListener('submit',async ev=>{
      ev.preventDefault();invalidate();
      if(!person.value||!month.value){status('Select an employee and month.',true);return;}
      const submit=form.querySelector('button[type=submit]');submit.disabled=true;
      status('Loading verified DTR entries…');
      try{
        const data=await api('/api/staff-attendance/admin/form48?'+new URLSearchParams({staffUserId:person.value,month:month.value}));
        // Render only escaped text from server data; no unsigned/unsupported entries are synthesized.
        output.innerHTML='<div class="form48-sheets">'+copy(data,"Office's")+copy(data,"Employee's")+'</div>'+
          '<p class="form48-preview-note">Only verified four-slot events are populated. Empty cells are unrecorded or unverified. Undertime, days present/absent, tardiness, remarks and signatures require authorized review.</p>';
        output.hidden=false;button.disabled=false;
        status('Report ready: '+data.verifiedEntries+' verified entries. Review blanks and print on A4 landscape.');
      }catch(e){status(e.message,true);}finally{submit.disabled=false;}
    });
    button.addEventListener('click',()=>{if(!button.disabled&&!output.hidden)window.print();});
  }
  window.attendigoStaffIdentity?.then(init).catch(()=>{});
})();
