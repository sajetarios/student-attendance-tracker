window.attendigoStaffIdentity.then(user => {
 'use strict';

 if(user?.role!=='SUPER_ADMIN')return;
 const directory=document.querySelector('[data-platform-tab="schoolDirectory"]');
 if(!directory)return;
 const card=document.createElement('section');card.className='surface-card section-card';
 const heading=document.createElement('h3');heading.textContent='School usage & subscription health';
 const description=document.createElement('p');description.textContent='Live school and account counts. Last audit activity is not the same as last login. Storage and sync metrics require separate instrumentation.';
 const refresh=document.createElement('button');refresh.type='button';refresh.className='outline-button';refresh.textContent='Refresh school health';
 const holder=document.createElement('div');holder.className='table-scroll';holder.setAttribute('aria-live','polite');
 card.append(heading,description,refresh,holder);directory.prepend(card);
 async function load(){
  refresh.disabled=true;holder.textContent='Loading school health…';
  try{

   const response=await fetch('/api/platform/schools/health',{cache:'no-store',headers:{}});
   const data=await response.json();
   if(!response.ok)throw Error(data.error||'Unable to load school health');
   const table=document.createElement('table'),thead=document.createElement('thead'),tbody=document.createElement('tbody');
   const tr=document.createElement('tr');
   for(const label of ['School','Students','Accounts','Plan','Status','Expires','Last audit activity']){const th=document.createElement('th');th.textContent=label;tr.append(th);}
   thead.append(tr);
   for(const school of data.schools||[]){
    const row=document.createElement('tr');
    const values=[school.schoolName+' · '+school.schoolCode,school.students,school.accounts,school.planName||'Unassigned',school.subscriptionStatus||'Legacy',school.expiresAt?new Date(school.expiresAt).toLocaleDateString('en-PH'):'—',school.lastAuditAt?new Date(school.lastAuditAt).toLocaleString('en-PH'):'—'];
    for(const value of values){const td=document.createElement('td');td.textContent=String(value);row.append(td);}
    tbody.append(row);
   }
   if(!tbody.children.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=7;cell.textContent='No schools found.';row.append(cell);tbody.append(row);}
   table.append(thead,tbody);holder.replaceChildren(table);
  }catch(error){holder.textContent=error.message;}
  finally{refresh.disabled=false;}
 }
 refresh.addEventListener('click',load);
 load();
});
