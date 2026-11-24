'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {registerPrincipalWorkspaceRoutes}=require('../principal-workspace-routes');

test('principal workspace registers read-only role-scoped endpoint',()=>{
 const registered=[];
 const app={get(...args){registered.push(args);}};
 registerPrincipalWorkspaceRoutes(app,{query:async()=>({rows:[]})},{
  authenticateSchoolClient:(_req,_res,next)=>next(),
  requireSchoolRoles:(...roles)=>{assert.deepEqual(roles,['PRINCIPAL']);return (_req,_res,next)=>next();}
 });
 assert.equal(registered.length,1);
 assert.equal(registered[0][0],'/api/principal/workspace');
});

test('principal workspace binds caller school and staff identity, not query identity',async()=>{
 let handler,seen=[];
 const app={get(_path,_auth,_roles,fn){handler=fn;}};
 const pool={query:async(sql,params)=>{seen.push({sql,params});return {rows:[]};}};
 registerPrincipalWorkspaceRoutes(app,pool,{
  authenticateSchoolClient:()=>{},requireSchoolRoles:()=>()=>{}
 });
 const today=require('../staff-lunch-routes').manilaDate();
 const req={auth:{schoolId:'school-from-session',userId:'principal-from-session'},
  query:{date:today,schoolId:'untrusted-school',userId:'untrusted-user'}};
 const res={headers:{},set(k,v){this.headers[k]=v;return this;},
  json(data){this.payload=data;return this;},
  status(code){this.statusCode=code;return this;}};
 await handler(req,res);
 assert.equal(res.statusCode,undefined);
 assert.ok(seen.length>=6);
 for(const item of seen){
  assert.equal(item.params[0],'school-from-session');
  assert.ok(!item.params.includes('untrusted-school'));
  assert.ok(!item.params.includes('untrusted-user'));
  assert.ok(/^SELECT\s/i.test(item.sql));
 }
 assert.equal(res.payload.sections.personalLeave.available,true);
 assert.equal(res.payload.sections.gateActivity.available,true);
});

test('principal workspace rejects invalid date without querying data',async()=>{
 let handler,called=false;
 registerPrincipalWorkspaceRoutes({get(_p,_a,_b,fn){handler=fn;}},{
  query:async()=>{called=true;throw Error('should not run');}
 },{authenticateSchoolClient:()=>{},requireSchoolRoles:()=>()=>{}});
 const req={auth:{schoolId:'one',userId:'two'},query:{date:'2025-02-30'}};
 const res={set(){return this;},status(code){this.code=code;return this;},json(x){this.payload=x;return this;}};
 await handler(req,res);
 assert.equal(res.code,400);
 assert.equal(called,false);
});
