(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const section=$('platformPlansSection');
 if(!section)return;
 const token=sessionStorage.getItem('schoolAttendance.accessToken');
 const user=(()=>{try{return JSON.parse(sessionStorage.getItem('schoolAttendance.user')||'null')}catch{return null}})();
 if(user?.role!=='SUPER_ADMIN'){section.hidden=true;return;}
 const featureNames={student_management:'Student management',manual_attendance:'Manual attendance',qr_attendance:'QR attendance',parent_portal:'Parent portal',timetable:'Timetable',planner:'Planner',offline_sync:'Offline sync',advanced_analytics:'Advanced analytics',sms_notifications:'SMS notifications',custom_branding:'Custom branding'};
 let plans=[],subscriptions=[],schools=[];
 const message=(text,error=false)=>{const el=$('platformPlansFeedback');el.textContent=text;el.className='inline-feedback'+(error?' error':'');};
 async function api(url,options={}){
  const response=await fetch(url,{...options,cache:'no-store',headers:{'Authorization':'Bearer '+token,...(options.body?{'Content-Type':'application/json'}:{})}});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.error||'Request failed');
  return result;
 }
 const overview=document.createElement('section');overview.className='surface-card section-card';
 const title=document.createElement('h3');title.textContent='Subscription health & change history';
 const counters=document.createElement('div');counters.className='stats-grid platform-stat-grid';
 const historyTitle=document.createElement('h4');historyTitle.textContent='Recent subscription changes';
 const history=document.createElement('div');history.className='table-scroll';
 overview.append(title,counters,historyTitle,history);section.before(overview);
 async function loadSummary(){
  try{
   const data=await api('/api/platform/subscriptions/summary');
   counters.replaceChildren();
   for(const [key,label] of [['assignedSchools','Assigned schools'],['trials','Trials'],['activeSubscriptions','Active'],['renewingSoon','Expiring in 14 days'],['needsAttention','Needs attention']]){
    const card=document.createElement('article');card.className='stat-card';
    const caption=document.createElement('span');caption.className='stat-top';caption.textContent=label;
    const count=document.createElement('strong');count.textContent=String(data.summary?.[key]??0);
    card.append(caption,count);counters.append(card);
   }
   const table=document.createElement('table'),head=document.createElement('thead'),body=document.createElement('tbody');
   const hr=document.createElement('tr');
   for(const label of ['Date','School','Changed by','Plan / status']){const th=document.createElement('th');th.textContent=label;hr.append(th);}
   head.append(hr);
   for(const entry of data.history||[]){
    const tr=document.createElement('tr');
    const values=[new Date(entry.createdAt).toLocaleString('en-PH'),entry.schoolName||'Deleted school',entry.actorName||'Super Admin',String(entry.details?.status||'Updated')];
    for(const value of values){const td=document.createElement('td');td.textContent=value;tr.append(td);}
    body.append(tr);
   }
   if(!body.children.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=4;td.textContent='No subscription changes yet.';tr.append(td);body.append(tr);}
   table.append(head,body);history.replaceChildren(table);
  }catch(error){history.textContent='Unable to load subscription history: '+error.message;}
 }
 const option=(value,label)=>new Option(label,value);
 function renderFeatures(){
  const plan=plans.find(p=>p.planId===$('platformPlansPlan').value);
  const subscription=subscriptions.find(s=>s.schoolId===$('platformPlansSchool').value);
  const overrides=subscription?.planId===plan?.planId?subscription.overrides||{}:{};
  const root=$('platformPlansFeatures');root.replaceChildren();
  for(const [key,label] of Object.entries(featureNames)){
   const wrapper=document.createElement('div');wrapper.className='field-group';
   const title=document.createElement('label');title.textContent=label+' ('+(plan?.features?.[key]?'included':'not included')+')';
   const select=document.createElement('select');select.dataset.feature=key;
   select.append(option('','Use plan default'),option('true','Allow'),option('false','Restrict'));
   select.value=Object.hasOwn(overrides,key)?String(overrides[key]):'';
   wrapper.append(title,select);root.append(wrapper);
  }
 }
 function selectSchool(){
  const subscription=subscriptions.find(s=>s.schoolId===$('platformPlansSchool').value);
  $('platformPlansPlan').value=subscription?.planId||plans[0]?.planId||'';
  $('platformPlansStatus').value=subscription?.status||'TRIAL';
  $('platformPlansEnd').value=subscription?.endsAt?String(subscription.endsAt).slice(0,10):'';
  renderFeatures();
 }
 async function load(){
  message('Loading subscription settings…');
  try{
   const [data,schoolData]=await Promise.all([api('/api/platform/plans'),api('/api/platform/schools')]);
   plans=data.plans;subscriptions=data.subscriptions;schools=schoolData.schools;
   const schoolSelect=$('platformPlansSchool'),planSelect=$('platformPlansPlan');
   const previous=schoolSelect.value;
   schoolSelect.replaceChildren(...schools.map(s=>option(s.schoolId,s.schoolName+' · '+s.schoolCode)));
   planSelect.replaceChildren(...plans.filter(p=>p.active||subscriptions.some(s=>s.planId===p.planId)).map(p=>option(p.planId,p.name+' · ₱'+p.monthlyPricePhp+'/mo (draft pricing)')));
   if(schools.some(s=>s.schoolId===previous))schoolSelect.value=previous;
   selectSchool();
   const previousTemplate=template.value;
   template.replaceChildren(option('','Create a new plan'),...plans.map(p=>option(p.planId,p.name)));
   if(plans.some(p=>p.planId===previousTemplate))template.value=previousTemplate;
   fillTemplate();await loadSummary();message('Subscription settings loaded.');
  }catch(error){message(error.message,true);}
 }
 // Plan editor: configurable pricing, feature defaults, and quotas.
 const editor=document.createElement('section');editor.className='surface-card section-card';
 const heading=document.createElement('h3');heading.textContent='Manage plan templates';
 const explanation=document.createElement('p');explanation.textContent='Create or edit templates. Prices are editable draft settings, not automatic billing. A plan change affects schools using its defaults.';
 const grid=document.createElement('div');grid.className='form-grid platform-school-form';
 function field(label,id,type='text'){
  const group=document.createElement('div');group.className='field-group';
  const title=document.createElement('label');title.htmlFor=id;title.textContent=label;
  const input=document.createElement(type==='select'?'select':'input');input.id=id;
  if(type!=='select')input.type=type;
  group.append(title,input);grid.append(group);return input;
 }
 const template=field('Edit existing plan or create new','platformTemplateSelect','select');
 const code=field('Plan code (new plans only)','platformTemplateCode');
 const name=field('Plan name','platformTemplateName');
 const price=field('Draft monthly price (PHP)','platformTemplatePrice','number');price.min='0';price.step='0.01';
 const students=field('Maximum students (0 = no new enrollment)','platformTemplateStudents','number');students.min='0';students.step='1';
 const sms=field('Monthly SMS limit','platformTemplateSms','number');sms.min='0';sms.step='1';
 const enabled=field('Plan availability','platformTemplateActive','select');
 enabled.append(option('true','Available'),option('false','Unavailable for new assignments'));
 const features=document.createElement('div');features.className='platform-feature-list';
 const featureHeading=document.createElement('h4');featureHeading.textContent='Included features';
 const save=document.createElement('button');save.type='button';save.className='primary-button';save.textContent='Save plan template';
 const feedback=document.createElement('p');feedback.className='inline-feedback';feedback.setAttribute('role','status');
 editor.append(heading,explanation,grid,featureHeading,features,save,feedback);
 section.parentElement.append(editor);
 function fillTemplate(){
  const plan=plans.find(p=>p.planId===template.value);
  code.value=plan?.code||'';code.disabled=!!plan;
  name.value=plan?.name||'';price.value=plan?.monthlyPricePhp??0;
  students.value=plan?.limits?.students??2000;sms.value=plan?.limits?.sms_monthly??0;
  enabled.value=String(plan?.active??true);
  features.replaceChildren();
  for(const [key,label] of Object.entries(featureNames)){
   const wrap=document.createElement('label');wrap.className='platform-feature-row';
   const text=document.createElement('span');text.className='platform-feature-name';text.textContent=label;
   const check=document.createElement('input');check.type='checkbox';check.dataset.planFeature=key;
   check.checked=plan?.features?.[key]??['student_management','manual_attendance','qr_attendance','parent_portal','timetable','planner','offline_sync'].includes(key);
   wrap.append(text,check);features.append(wrap);
  }
 }
 template.addEventListener('change',fillTemplate);
 save.addEventListener('click',async()=>{
  const data={code:code.value.trim(),name:name.value.trim(),monthlyPricePhp:Number(price.value),
   limits:{students:Number(students.value),sms_monthly:Number(sms.value)},
   features:Object.fromEntries([...features.querySelectorAll('input[data-plan-feature]')].map(el=>[el.dataset.planFeature,el.checked])),
   active:enabled.value==='true'};
  if(!data.name||!Number.isFinite(data.monthlyPricePhp)||data.monthlyPricePhp<0||
    !Number.isSafeInteger(data.limits.students)||data.limits.students<0||
    !Number.isSafeInteger(data.limits.sms_monthly)||data.limits.sms_monthly<0){
   feedback.textContent='Check the name, price and quota values.';return;
  }
  if(!confirm('Save plan defaults? Schools assigned to this plan may be affected.'))return;
  save.disabled=true;
  try{
   const existing=!!template.value;
   await api(existing?'/api/platform/plans/'+template.value:'/api/platform/plans',
     {method:existing?'PATCH':'POST',body:JSON.stringify(data)});
   await load();feedback.textContent='Plan template saved.';
  }catch(error){feedback.textContent=error.message;}
  finally{save.disabled=false;}
 });
 $('platformPlansSchool').addEventListener('change',selectSchool);
 $('platformPlansPlan').addEventListener('change',renderFeatures);
 $('platformPlansRefresh').addEventListener('click',load);
 $('platformPlansSave').addEventListener('click',async()=>{
  const schoolId=$('platformPlansSchool').value,planId=$('platformPlansPlan').value;
  if(!schoolId||!planId)return message('Choose a school and plan.',true);
  const overrides={};
  for(const select of $('platformPlansFeatures').querySelectorAll('select[data-feature]'))if(select.value)overrides[select.dataset.feature]=select.value==='true';
  const date=$('platformPlansEnd').value;
  const endsAt=date?new Date(date+'T23:59:59+08:00').toISOString():null;
  if(endsAt && Date.parse(endsAt)<=Date.now())return message('Expiration must be in the future.',true);
  if(!confirm('Save this school subscription and feature overrides?'))return;
  const button=$('platformPlansSave');button.disabled=true;
  try{
   await api('/api/platform/schools/'+encodeURIComponent(schoolId)+'/subscription',{method:'PUT',body:JSON.stringify({planId,status:$('platformPlansStatus').value,endsAt,overrides})});
   const effective=await api('/api/platform/schools/'+encodeURIComponent(schoolId)+'/effective-features');
   await load();
   const smsEnabled=effective.features?.sms_notifications===true;
   const smsSetting=overrides.sms_notifications===true?'Allow':overrides.sms_notifications===false?'Restrict':'Plan default';
   message('Subscription saved and verified. SMS: '+(smsEnabled?'ENABLED':'DISABLED')+' (selected: '+smsSetting+', status: '+effective.status+(effective.expired?', expired':'')+').'+(smsEnabled?' School Admin can reopen the portal to refresh the menu.':' Check the plan default, subscription status and expiration.'),!smsEnabled&&overrides.sms_notifications===true);
  }
  catch(error){message(error.message,true);}
  finally{button.disabled=false;}
 });
 load();
})();