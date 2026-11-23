'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {isFile,registerPrincipalSdoRoutes}=require('../principal-sdo-routes');
const {nextStatus,allowReviewer}=require('../staff-leave-policy');

test('principal leave files directly for documented external decision, never self-approves',()=>{
 assert.equal(nextStatus('PRINCIPAL',false),'PENDING_EXTERNAL');
 assert.equal(nextStatus('TEACHER',true),'PENDING_HEAD');
 const principalRequest={staff_user_id:'principal',requester_role:'PRINCIPAL',status:'PENDING_EXTERNAL'};
 assert.equal(allowReviewer('PRINCIPAL','principal',null,principalRequest,'EXTERNAL'),false);
 assert.equal(allowReviewer('SCHOOL_ADMIN','admin',null,principalRequest,'EXTERNAL'),true);
 assert.equal(allowReviewer('DEPARTMENT_HEAD','head',null,principalRequest,'EXTERNAL'),false);
});

test('signed external evidence accepts recognized small PDFs and images only',()=>{
 assert.equal(isFile(Buffer.from('%PDF-1.6\n'),'application/pdf'),true);
 assert.equal(isFile(Buffer.from('not-a-document'),'application/pdf'),false);
 assert.equal(isFile(Buffer.from([137,80,78,71,13,10,26,10,0]),'image/png'),true);
 assert.equal(isFile(Buffer.from([255,216,255,200]),'image/jpeg'),true);
 assert.equal(isFile(Buffer.from('abc'),'image/jpeg'),false);
 assert.equal(isFile(Buffer.alloc(4194305),'application/pdf'),false);
});

test('principal and coordinator endpoints have separate server-authorized roles',()=>{
 const routes={};
 const auth=[];
 const app={post(path,...handlers){routes[path]=handlers;},
  get(path,...handlers){routes[path]=handlers;}};
 const requireSchoolRoles=(...roles)=>{auth.push(roles);return (_req,_res,next)=>next();};
 registerPrincipalSdoRoutes(app,{query:async()=>({rows:[]})},{
  authenticateSchoolClient:(_req,_res,next)=>next(),requireSchoolRoles
 });
 assert.deepEqual(auth,[['PRINCIPAL'],['SCHOOL_ADMIN'],['PRINCIPAL','SCHOOL_ADMIN']]);
 assert.ok(routes['/api/principal/ob']);
 assert.ok(routes['/api/principal/sdo-requests']);
 assert.ok(routes['/api/principal/sdo-requests/:kind/:id/handoff']);
 assert.ok(routes['/api/principal/sdo-requests/ob/:id/decision']);
 assert.ok(routes['/api/principal/sdo-requests/ob/:id/document']);
});

test('malformed principal OB cannot touch the database',async()=>{
 const routes={};
 const app={post(path,...handlers){routes[path]=handlers;},get(){}};
 let queried=false;
 registerPrincipalSdoRoutes(app,{connect:async()=>{queried=true;throw Error('should not connect');}},{
  authenticateSchoolClient:()=>{},requireSchoolRoles:()=>()=>{}
 });
 const handler=routes['/api/principal/ob'].at(-1);
 const req={auth:{role:'PRINCIPAL',schoolId:'s',userId:'u'},body:{
  purpose:'Duty',destination:'SDO',startsAt:'2026-11-23T10:00:00+08:00',endsAt:'2026-11-22T10:00:00+08:00'}};
 const res={set(){return this;},status(n){this.code=n;return this;},json(o){this.payload=o;return this;}};
 await handler(req,res);
 assert.equal(res.code,400);
 assert.equal(queried,false);
});
