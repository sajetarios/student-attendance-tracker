'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validMemoDocument,memoViewer,canReadMemo,registerSchoolMemoRoutes}=require('../school-memo-routes');

test('school memo audiences allow all signed-in school accounts but not devices',()=>{
 const principal=memoViewer({type:'SCHOOL_USER',schoolId:'s',userId:'p',role:'PRINCIPAL'});
 const teacher=memoViewer({type:'SCHOOL_USER',schoolId:'s',userId:'t',role:'TEACHER'});
 const parent=memoViewer({type:'SCHOOL_USER',schoolId:'s',userId:'u',role:'PARENT'});
 const student=memoViewer({type:'STUDENT',schoolId:'s',studentAccountId:'a'});
 assert.equal(canReadMemo(principal,'ALL_USERS'),true);
 assert.equal(canReadMemo(teacher,'SCHOOL_STAFF'),true);
 assert.equal(canReadMemo(parent,'ALL_USERS'),true);
 assert.equal(canReadMemo(student,'ALL_USERS'),true);
 assert.equal(canReadMemo(parent,'SCHOOL_STAFF'),false);
 assert.equal(canReadMemo(student,'SCHOOL_STAFF'),false);
 assert.equal(memoViewer({type:'DEVICE',schoolId:'s',deviceId:'d'}),null);
});
test('secure document whitelist checks MIME, magic, empty and oversized content',()=>{
 assert.equal(validMemoDocument(Buffer.from('%PDF-1.7\ncontent'),'application/pdf'),true);
 assert.equal(validMemoDocument(Buffer.from('plain text'),'application/pdf'),false);
 assert.equal(validMemoDocument(Buffer.from([137,80,78,71,13,10,26,10,0]),'image/png'),true);
 assert.equal(validMemoDocument(Buffer.from([255,216,255,0]),'image/jpeg'),true);
 assert.equal(validMemoDocument(Buffer.from([255,216,255,0]),'text/html'),false);
 assert.equal(validMemoDocument(Buffer.alloc(4194305,1),'image/png'),false);
 assert.equal(validMemoDocument(Buffer.alloc(0),'application/pdf'),false);
});
test('principal writes and signed-in school reads use separate route middleware',()=>{
 const entries=[];
 const app={get(path,...handlers){entries.push({method:'GET',path,handlers});},
  post(path,...handlers){entries.push({method:'POST',path,handlers});}};
 const roleCalls=[];
 registerSchoolMemoRoutes(app,{},{
  authenticateSchoolClient:()=>{},
  requireSchoolRoles:(...roles)=>{roleCalls.push(roles);return()=>{};}
 });
 assert.deepEqual(roleCalls,[['PRINCIPAL']]);
 assert.ok(entries.some(x=>x.path==='/api/school-memos'&&x.method==='GET'));
 assert.ok(entries.some(x=>x.path==='/api/school-memos'&&x.method==='POST'));
 assert.ok(entries.some(x=>x.path==='/api/school-memos/:id/file'));
 assert.ok(entries.some(x=>x.path==='/api/school-memos/:id/acknowledge'));
 assert.ok(entries.some(x=>x.path==='/api/school-memos/:id/receipts'));
 assert.ok(entries.some(x=>x.path==='/api/school-memos/:id/archive'));
});
test('a fabricated PDF cannot be published or create notification records',async()=>{
 let connected=false;
 const routes=new Map();
 const app={get(){},post(path,...handlers){routes.set(path,handlers.at(-1));}};
 registerSchoolMemoRoutes(app,{connect:()=>{connected=true;throw Error('must not connect');}},{
  authenticateSchoolClient:()=>{},requireSchoolRoles:()=>()=>{}
 });
 const handler=routes.get('/api/school-memos');
 const req={headers:{
  'x-memo-title':encodeURIComponent('Official school announcement'),
  'x-memo-category':'GENERAL','x-memo-audience':'ALL_USERS',
  'x-filename':'fake.pdf','content-type':'application/pdf'
 },body:Buffer.from('fake pdf'),auth:{schoolId:'school',userId:'principal'}};
 const res={set(){return this;},status(code){this.code=code;return this;},json(data){this.payload=data;return this;}};
 await handler(req,res);
 assert.equal(res.code,400);
 assert.equal(connected,false);
});
