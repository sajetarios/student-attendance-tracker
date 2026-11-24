'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {registerPrincipalClassImpactRoutes}=require('../principal-class-impact-routes');
const code=f=>fs.readFileSync(f,'utf8');
const UUID='12345678-1234-4234-8234-123456789abc';
const SCHOOL='abcdefab-cdef-4def-8def-abcdefabcdef';
function routeHarness(){
 let handler,roles,queries=[];
 const pool={async query(sql,args){
  queries.push({sql,args});
  if(sql.includes("FROM school_departments WHERE"))return {rowCount:1,rows:[{count:1}]};
  if(sql.includes("SELECT DISTINCT 'OB'::text AS \"kind\""))return {rows:[
   {kind:'OB',date:'2026-11-24',periodId:UUID,periodName:'English',gradeLevel:'8',
    section:'A',startTime:'08:00',endTime:'09:00',departmentId:UUID,departmentName:'English',total:1}]};
  if(sql.includes("SELECT DISTINCT 'LEAVE'::text AS \"kind\""))return {rows:[]};
  throw Error('Unexpected query');
 }};
 registerPrincipalClassImpactRoutes({get(route,...handlers){
  assert.equal(route,'/api/principal/class-impact');handler=handlers.at(-1);
 }},pool,{authenticateSchoolClient:()=>{},requireSchoolRoles:(...r)=>{roles=r;return ()=>{};}});
 return {handler,roles,queries};
}
function response(){
 const out={code:200,headers:{},value:null};
 const res={set(k,v){out.headers[k]=v;return res},
  status(c){out.code=c;return res},json(v){out.value=v;return res}};
 return {out,res};
}
test('Principal class-impact endpoint is read only and has no cross-school identifiers from client',async()=>{
 const h=routeHarness(),{out,res}=response();
 assert.deepEqual(h.roles,['PRINCIPAL']);
 await h.handler({auth:{schoolId:SCHOOL},query:{departmentId:UUID}},res);
 assert.equal(out.code,200);
 assert.equal(out.headers['Cache-Control'],'no-store, private');
 assert.equal(out.value.cases[0].departmentName,'English');
 assert.equal(out.value.unresolvedCount,1);
 assert.equal(out.value.cases[0].kind,'OB');
 assert.equal(out.value.cases[0].date,'2026-11-24');
 assert.ok(h.queries.every(q=>q.args[0]===SCHOOL));
 assert.ok(h.queries.every(q=>!q.args.includes('fake-school-id')));
 assert.equal(out.value.cases[0].staffName,undefined);
 assert.equal(out.value.cases[0].purpose,undefined);
 assert.equal(out.value.cases[0].leaveReason,undefined);
});
test('Invalid department is rejected without querying the database',async()=>{
 const h=routeHarness(),{out,res}=response();
 await h.handler({auth:{schoolId:SCHOOL},query:{departmentId:'not-uuid'}},res);
 assert.equal(out.code,400);
 assert.equal(h.queries.length,0);
});
test('Unresolved class SQL excludes resolved coverage and unapproved leave/OB',()=>{
 const routes=code('principal-class-impact-routes.js');
 assert.match(routes,/o.status='APPROVED'/);
 assert.match(routes,/c.status='NEEDS_COVERAGE'/);
 assert.match(routes,/l.revoked_at IS NULL/);
 assert.match(routes,/schedule_day_adjustments a/);
 assert.match(routes,/a.adjustment_type='CANCEL'/);
 assert.match(routes,/teacher_period_substitutions ts/);
 assert.match(routes,/ts.status='ACTIVE'/);
 assert.match(routes,/c.status='SUBSTITUTE_ASSIGNED'/);
 assert.match(routes,/school_calendar_exceptions ce/);
 assert.match(routes,/school_operating_days op/);
 assert.doesNotMatch(routes,/app\.(post|patch|put|delete)\(/);
 assert.doesNotMatch(routes,/o\.purpose|o\.destination|l\.leave_type|u\.display_name/);
});
test('Principal interface raises only unresolved class coverage as an attention item',()=>{
 const ui=code('public/principal-dashboard.js');
 const html=code('public/principal.html');
 assert.match(ui,/\/api\/principal\/class-impact/);
 assert.match(ui,/function renderClassImpact/);
 assert.doesNotMatch(ui,/addAttention\(host,'Leave applications in progress'/);
 assert.doesNotMatch(ui,/addAttention\(host,'Official Business in progress'/);
 assert.match(ui,/if\(classImpact&&\(classImpact\.limited\|\|numeric\(classImpact\.unresolvedCount\)>0\)\)/);
 assert.match(html,/id="principalClassImpactList"/);
 assert.match(html,/id="principalWorkflowDetails"/);
 assert.match(html,/class="surface principal-workflow-overview"/);
 assert.match(html,/not class-coverage alerts/);
});
