'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('server.js','utf8');
function middleware(){
 const start=source.indexOf('const sessionCookiePattern=');
 const end=source.indexOf('app.use(redirectLeakedCredentials);',start);
 assert.ok(start>0&&end>start);
 let fn;
 vm.runInNewContext(source.slice(start,end),{app:{use(cb){fn=cb;}},URL});
 return fn;
}
function run(method,headers={},path='/api/staff-attendance/admin/dtr-review-apply'){
 const req={method,path,headers,get:(name)=>headers[name.toLowerCase()]};
 let code=200,detail,next=false;
 const res={status(n){code=n;return this;},json(x){detail=x;return this;}};
 middleware()(req,res,()=>{next=true});
 return {code,next,detail};
}
const cookie='__Host-attendigo-staff=opaque-session-test-value';
const local={'host':'attendigo.school.example','origin':'https://attendigo.school.example','sec-fetch-site':'same-origin',cookie};
test('safe GET and bearer-only non-cookie clients are not blocked',()=>{
 assert.equal(run('GET',{cookie,'host':'attendigo.school.example'}).next,true);
 assert.equal(run('POST',{'authorization':'Bearer machine-test'}).next,true);
});
test('same-origin cookie action is accepted',()=>{
 assert.equal(run('POST',local).next,true);
 assert.equal(run('POST',{...local,cookie:'unrelated=1;  '+cookie}).next,true);
 assert.equal(run('POST',{...local,cookie:'unrelated=1;  '+cookie,origin:'https://evil.example'}).code,403);
 assert.equal(run('POST',{cookie,'host':'localhost:3000',origin:'http://localhost:3000','sec-fetch-site':'same-origin'}).next,true);
 assert.equal(run('PATCH',{...local,'origin':undefined}).next,true);
});
test('cross-origin CSRF, null origin, and missing proof are rejected',()=>{
 for(const headers of [
  {...local,origin:'https://attendigo.attacker.example'},
  {...local,origin:'null'},
  {...local,'sec-fetch-site':'cross-site'},
  {...local,'sec-fetch-site':'same-site'},
  {...local,origin:undefined,'sec-fetch-site':undefined}
 ]){
  const result=run('POST',headers);
  assert.equal(result.code,403);
  assert.equal(result.next,false);
 }
});
test('security headers include frame, object and base restrictions without breaking legacy scripts',()=>{
 assert.match(source,/Content-Security-Policy'/);
 assert.match(source,/object-src 'none'; base-uri 'self'; frame-ancestors 'none'/);
 assert.match(source,/Content-Security-Policy-Report-Only/);
});
