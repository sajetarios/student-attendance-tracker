'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync(require.resolve('../public/form48-intelligence.js'),'utf8');
const html=fs.readFileSync(require.resolve('../public/portal.html'),'utf8');
const sw=fs.readFileSync(require.resolve('../public/sw.js'),'utf8');
const route=fs.readFileSync(require.resolve('../staff-gate-dtr-routes.js'),'utf8');
const staffId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function elem(value=''){
 const events={};
 return {value,events,min:'',max:'',disabled:false,innerHTML:'',textContent:'',
  classList:{toggle(){}},replaceChildren(){this.innerHTML='';},
  addEventListener(name,listener){events[name]=listener;}};
}
async function setup(role='SCHOOL_ADMIN',fetcher=async()=>({ok:true,json:async()=>({
  safeToApply:false,date:'2025-05-31',existingSlots:{},suggestions:{},
  review:[],gateEventCount:0,approvedObCount:0
 })})){
 const fields={
  form48Employee:elem(staffId),form48Month:elem('2025-05'),
  form48GateReviewDate:elem(),form48GateReviewButton:elem(),
  form48GateReviewStatus:elem(),form48GateReviewResult:elem()
 };
 const calls=[];
 vm.runInNewContext(src,{document:{getElementById:id=>fields[id]},
  window:{attendigoStaffIdentity:Promise.resolve({role})},
  fetch:async(url,opts)=>{calls.push({url,opts});return fetcher(url,opts);},
  Date,Intl,URLSearchParams});
 await new Promise(resolve=>setImmediate(resolve));
 return {fields,calls};
}
test('Form 48 intelligence is school-admin only and preserves existing DTR controls',async()=>{
 assert.match(html,/id="form48GateIntelligence"/);
 assert.match(html,/id="form48GateReviewDate"/);
 assert.match(html,/id="form48Print"/);
 assert.match(html,/id="form48PrintArea"/);
 assert.match(html,/form48-intelligence\.js\?v=1/);
 assert.match(sw,/form48-intelligence\.js\?v=1/);
 const user=await setup('TEACHER');
 assert.equal(user.fields.form48GateReviewButton.events.click,undefined);
 assert.equal(user.calls.length,0);
});
test('review fetch is administrator-triggered, GET-only, and not a DTR mutation',async()=>{
 const {fields,calls}=await setup();
 assert.equal(fields.form48GateReviewDate.value,'2025-05-31');
 assert.equal(fields.form48GateReviewButton.disabled,false);
 assert.equal(calls.length,0);
 await fields.form48GateReviewButton.events.click();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,1);
 assert.match(calls[0].url,/staffUserId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/);
 assert.match(calls[0].url,/date=2025-05-31/);
 assert.equal(calls[0].opts.method,'GET');
 assert.equal(calls[0].opts.cache,'no-store');
 assert.match(fields.form48GateReviewResult.innerHTML,/No gate evidence/);
 assert.doesNotMatch(src,/method:\s*['"](?:PUT|POST|PATCH|DELETE)['"]/);
 const part=route.slice(route.indexOf("app.get('/api/staff-attendance/admin/dtr-reconciliation-preview'"),
  route.indexOf("app.post('/api/staff-attendance/gatekeeper/dtr'"));
 assert.match(part,/requireSchoolRoles\('SCHOOL_ADMIN'\)/);
 assert.doesNotMatch(part,/INSERT INTO|UPDATE staff_attendance_events|DELETE FROM/);
});
test('review distinguishes verified DTR punches from gate suggestions and escapes unsafe text',async()=>{
 const {fields}=await setup('SCHOOL_ADMIN',async()=>({ok:true,json:async()=>({
  safeToApply:false,date:'2025-05-31',gateEventCount:4,approvedObCount:1,
  existingSlots:{AM_IN:'07:25'},suggestions:{PM_IN:{time:'<img src=x>'}},
  review:['OB_RETURN_AFTER_APPROVED_END_REVIEW','POST_OB_RETURN_MOVEMENT_REVIEW']
 })}));
 await fields.form48GateReviewButton.events.click();
 await new Promise(resolve=>setImmediate(resolve));
 const value=fields.form48GateReviewResult.innerHTML;
 assert.match(value,/Verified official DTR/);
 assert.match(value,/Suggested gate evidence/);
 assert.match(value,/return/);
 assert.match(value,/&lt;img src=x&gt;/);
 assert.doesNotMatch(value,/<img src=x>/);
 assert.match(value,/No record was changed/);
});
test('employee changes invalidate an in-flight response without showing stale records',async()=>{
 let resolveResponse;
 const pending=new Promise(resolve=>{resolveResponse=resolve;});
 const {fields}=await setup('SCHOOL_ADMIN',()=>pending);
 const work=fields.form48GateReviewButton.events.click();
 fields.form48Employee.value='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 fields.form48Employee.events.change();
 resolveResponse({ok:true,json:async()=>({safeToApply:false,existingSlots:{AM_IN:'07:25'},suggestions:{},review:[]})});
 await work;
 assert.equal(fields.form48GateReviewResult.innerHTML,'');
 assert.match(fields.form48GateReviewStatus.textContent,/Select a school date/);
});
