'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {registerPlatformBootstrapRoutes}=require('../platform-bootstrap-routes');

function build() {
 const handlers={},seen=[];
 let count=0;
 const client={
  async query(sql,params=[]) {
   seen.push({sql,params});
   if(sql.includes('SELECT EXISTS'))return {rows:[{exists:count>0}],rowCount:1};
   if(sql.includes('INSERT INTO platform_users')){count++;return {rowCount:1};}
   return {rows:[],rowCount:0};
  },release(){}
 };
 const pool={
  async query(sql){if(sql.includes('SELECT EXISTS'))return {rows:[{hasOwner:count>0}],rowCount:1};throw Error('Unexpected query');},
  async connect(){return client;}
 };
 const app={
  post(path,...callbacks){handlers[path]=callbacks.at(-1);},
  get(path,...callbacks){handlers[path]=callbacks.at(-1);}
 };
 registerPlatformBootstrapRoutes(app,pool);
 async function request(path,body) {
  let code=200,output;
  const res={status(v){code=v;return this;},json(v){output=v;return this;}};
  await handlers[path]({body,headers:{}},res);
  return {status:code,body:output};
 }
 return {request,seen,get count(){return count;}};
}

test('setup is protected by an unpredictable token and closes after first account',async()=>{
 const oldCode=process.env.PLATFORM_BOOTSTRAP_CODE, oldExpiry=process.env.PLATFORM_BOOTSTRAP_EXPIRES_AT;
 process.env.PLATFORM_BOOTSTRAP_CODE='q7fXe8ReUtGzb66WGeaW8nVwAbtRdwQqA5';
 process.env.PLATFORM_BOOTSTRAP_EXPIRES_AT='2099-12-31T23:59:59.000Z';
 try {
  const b=build();
  const url='/api/platform/bootstrap/first-admin';
  const identity={username:'owner_test',displayName:'Platform Owner',password:'This is a safe test passphrase 123!',confirmPassword:'This is a safe test passphrase 123!'};
  assert.deepEqual((await b.request('/api/platform/bootstrap/status')).body,{available:true});
  assert.equal((await b.request(url,{...identity,setupCode:'wrong'})).status,403);
  assert.equal((await b.request(url,{...identity,setupCode:process.env.PLATFORM_BOOTSTRAP_CODE,password:'short',confirmPassword:'short'})).status,400);
  assert.equal(b.count,0);
  const created=await b.request(url,{...identity,setupCode:process.env.PLATFORM_BOOTSTRAP_CODE});
  assert.equal(created.status,201);
  assert.equal(created.body.username,'owner_test');
  assert.equal(b.count,1);
  const insert=b.seen.find(q=>q.sql.includes('INSERT INTO platform_users'));
  assert.ok(insert);
  assert.notEqual(insert.params[2],identity.password);
  assert.match(insert.params[2],/^scrypt\$/);
  assert.equal((await b.request(url,{...identity,setupCode:process.env.PLATFORM_BOOTSTRAP_CODE})).status,409);
  assert.deepEqual((await b.request('/api/platform/bootstrap/status')).body,{available:false});
 }finally {
  if(oldCode===undefined)delete process.env.PLATFORM_BOOTSTRAP_CODE;else process.env.PLATFORM_BOOTSTRAP_CODE=oldCode;
  if(oldExpiry===undefined)delete process.env.PLATFORM_BOOTSTRAP_EXPIRES_AT;else process.env.PLATFORM_BOOTSTRAP_EXPIRES_AT=oldExpiry;
 }
});

test('bootstrap stays closed without a configured secret',async()=>{
 const oldCode=process.env.PLATFORM_BOOTSTRAP_CODE,oldExpiry=process.env.PLATFORM_BOOTSTRAP_EXPIRES_AT;
 delete process.env.PLATFORM_BOOTSTRAP_CODE;
 delete process.env.PLATFORM_BOOTSTRAP_EXPIRES_AT;
 try {
  const b=build();
  const r=await b.request('/api/platform/bootstrap/first-admin',{username:'fake',displayName:'Fake',password:'SecureLongPassphrase21$',confirmPassword:'SecureLongPassphrase21$',setupCode:'anything'});
  assert.equal(r.status,404);
  assert.equal(b.count,0);
 }finally{
  if(oldCode!==undefined)process.env.PLATFORM_BOOTSTRAP_CODE=oldCode;
  if(oldExpiry!==undefined)process.env.PLATFORM_BOOTSTRAP_EXPIRES_AT=oldExpiry;
 }
});
