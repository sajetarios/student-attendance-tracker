'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync('public/smart-attendance-overview.js','utf8');
const schoolHours={AM_IN:'07:30',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'17:00'};
function mockElement(){
 const listeners={};
 return {textContent:'',value:'',disabled:false,hidden:false,children:[],listeners,
  classList:{toggle(){}},append(...items){this.children.push(...items);},
  replaceChildren(){this.children=[];},
  addEventListener(type,fn){listeners[type]=fn;},
  scrollIntoView(){},setAttribute(){}};
}
async function setup(role='SCHOOL_ADMIN',initial={}){
 const defaults={workdays:[1,2,3,4,5],regularHours:{},saturdayHours:{},
  verifiedBy:'Registrar',verifiedPosition:'Admin Officer',
  approvedBy:'Principal',approvedPosition:'School Principal',revision:3,...initial};
 const ids=['smartAttendanceOverview','smartAttendanceDate','smartAttendanceRefresh',
  'smartAttendanceStatus','smartAttendanceItems','smartAttendanceOther',
  'smartAttendanceOtherItems','smartAttendanceHours','smartAttendanceHoursSummary',
  'smartHoursFeedback','smartHoursSave','smartHoursAmIn','smartHoursAmOut',
  'smartHoursPmIn','smartHoursPmOut','smartAttendanceScans',
  'smartAttendanceReviewCount','smartAttendancePendingCount'];
 const elements=Object.fromEntries(ids.map(id=>[id,mockElement()]));
 const requests=[];
 const fetch=async(url,options={})=>{
  requests.push({url,options});
  let response;
  if(url.includes('/defaults')&&options.method==='PUT')
   response={saved:true,revision:4};
  else if(url.includes('/defaults'))response={defaults};
  else response={date:'2026-11-21',safeToApply:false,verifiedGateEvents:1,
   reviewCount:0,pendingCount:1,schoolHoursConfigured:false,items:[]};
  return {ok:true,json:async()=>response};
 };
 const context={
  document:{getElementById:id=>elements[id],createElement:()=>mockElement()},
  window:{attendigoStaffIdentity:Promise.resolve({role}),confirm:()=>true},
  fetch,Date,Intl,URLSearchParams
 };
 vm.runInNewContext(src,context);
 for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));
 return {elements,requests,defaults};
}
test('only School Admin can initialize or save school hours',async()=>{
 const ordinary=await setup('TEACHER');
 assert.equal(ordinary.requests.length,0);
 assert.equal(ordinary.elements.smartHoursSave.listeners.click,undefined);
 const admin=await setup();
 assert.ok(admin.requests.some(r=>r.url.includes('/admin/smart-overview')));
 assert.ok(admin.requests.some(r=>r.url.includes('/admin/form48/defaults')));
});
test('save school defaults preserves signatories and does not touch official DTR',async()=>{
 const {elements,requests}=await setup();
 ['smartHoursAmIn','smartHoursAmOut','smartHoursPmIn','smartHoursPmOut']
  .forEach((id,index)=>{elements[id].value=Object.values(schoolHours)[index];});
 elements.smartHoursAmIn.listeners.input();
 assert.equal(elements.smartHoursSave.disabled,false);
 await elements.smartHoursSave.listeners.click();
 const writes=requests.filter(r=>r.options.method==='PUT');
 assert.equal(writes.length,1);
 assert.match(writes[0].url,/\/api\/staff-attendance\/admin\/form48\/defaults/);
 const payload=JSON.parse(writes[0].options.body);
 assert.deepEqual(payload.workdays,[1,2,3,4,5]);
 assert.deepEqual(payload.regularHours,schoolHours);
 assert.equal(payload.verifiedBy,'Registrar');
 assert.equal(payload.approvedBy,'Principal');
 assert.equal(payload.verifiedPosition,'Admin Officer');
 assert.equal(payload.approvedPosition,'School Principal');
 assert.equal(payload.revision,3);
 assert.equal(requests.filter(r=>r.options.method==='POST').length,0);
 assert.equal(requests.filter(r=>/gatekeeper\/dtr|form48\/config/.test(r.url)).length,0);
});
test('custom Saturday schedule stays protected from the simple Monday-Friday preset',async()=>{
 const existing={workdays:[1,2,3,4,5,6],regularHours:schoolHours,
  saturdayHours:{AM_IN:'08:00',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'16:00'}};
 const {elements,requests}=await setup('SCHOOL_ADMIN',existing);
 assert.equal(elements.smartHoursSave.disabled,true);
 assert.equal(elements.smartHoursAmIn.disabled,true);
 assert.match(elements.smartHoursFeedback.textContent,/custom working days/i);
 assert.equal(requests.filter(r=>r.options.method==='PUT').length,0);
});
