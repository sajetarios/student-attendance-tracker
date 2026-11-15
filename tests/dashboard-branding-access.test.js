'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {registerSchoolRoutes}=require('../school-routes');
const {createAuthMiddleware}=require('../auth-middleware');
function routes(){
 const result={};const app={};
 for(const method of ['get','put','delete'])app[method]=(path,...handlers)=>{result[method+' '+path]=handlers;};
 registerSchoolRoutes(app,{},createAuthMiddleware({}));return result;
}
function allowed(guard,role,type='SCHOOL_USER'){
 let passed=false,status=null;guard({auth:{type,role}},{status(code){status=code;return this;},json(){}},()=>{passed=true;});return {passed,status};
}
test('every school role can read school colors, only the school administrator can change them',()=>{
 const all=routes();
 for(const role of ['SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER','GATE_KEEPER','STUDENT','PARENT']){
  assert.equal(allowed(all['get /api/school/branding'][1],role).passed,true,role+' read');
  for(const route of ['put /api/school/branding','put /api/school/branding/logo','delete /api/school/branding/logo']){
   assert.equal(allowed(all[route][1],role).passed,role==='SCHOOL_ADMIN',role+' '+route);
  }
 }
 assert.equal(allowed(all['get /api/school/branding'][1],'STUDENT','DEVICE').status,401);
});
test('branding reads are scoped to the authenticated school, never a client-selected school',async()=>{
 let parameters;const registered={};const app={get:(p,...h)=>registered[p]=h,put(){},delete(){}};
 const pool={async query(sql,params){parameters=params;return {rowCount:1,rows:[{schoolName:'Test School',brandColor:'#7042a3'}]};}};
 registerSchoolRoutes(app,pool,createAuthMiddleware(pool));
 let data;await registered['/api/school/branding'].at(-1)({auth:{schoolId:'school-a'},query:{schoolId:'school-b'}},{json(value){data=value;}});
 assert.deepEqual(parameters,['school-a']);assert.equal(data.branding.brandColor,'#7042a3');
});
