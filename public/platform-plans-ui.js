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
   selectSchool();message('Subscription settings loaded.');
  }catch(error){message(error.message,true);}
 }
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
  try{await api('/api/platform/schools/'+encodeURIComponent(schoolId)+'/subscription',{method:'PUT',body:JSON.stringify({planId,status:$('platformPlansStatus').value,endsAt,overrides})});await load();message('School subscription saved.');}
  catch(error){message(error.message,true);}
  finally{button.disabled=false;}
 });
 load();
})();