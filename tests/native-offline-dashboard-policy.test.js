'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const policy=require('../public/offline-dashboard-policy.js');
const routing=require('../public/login-routing.js');
const roles=['SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER','GATE_KEEPER','PRINCIPAL','STUDENT','PARENT'];
test('all seven school roles use the canonical existing dashboard path',()=>{
  for(const role of roles){
    const route=policy.routeForRole(role);
    assert.equal(route,routing.destinationForRole(role));
    assert.ok(policy.matchesRoute(route,role));
    assert.ok(policy.workspaceForPath(route).roles.includes(role));
    for(const other of roles){
      if(routing.destinationForRole(other)!==route)assert.equal(policy.matchesRoute(route,other),false);
    }
  }
});
test('unknown or platform roles and noncanonical routes cannot select an offline workspace',()=>{
  for(const role of ['SUPER_ADMIN','ADMIN','teacher','__proto__',null,{},undefined])assert.equal(policy.routeForRole(role),null);
  for(const route of ['/api/auth/me','/portal.html?role=TEACHER','/portal.html#attendance','//evil.example/portal.html','__proto__','constructor','/offline-dashboard.html',null,{}]){
    assert.equal(policy.workspaceForPath(route),null);
    assert.equal(policy.matchesRoute(route,'TEACHER'),false);
  }
});
test('route policy is immutable and has no account authorization API',()=>{
  assert.deepEqual(Object.keys(policy).sort(),['matchesRoute','routeForRole','workspaceForPath']);
  assert.ok(Object.isFrozen(policy));
  assert.throws(()=>policy.workspaceForPath('/portal.html').roles.push('SUPER_ADMIN'),TypeError);
});
test('public shell is nonpersonal and fail-closed until verified authorization is implemented',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../public/offline-dashboard.html'),'utf8');
  assert.match(html,/<meta name="attendigo-public-shell" content="native-dashboard-v1">/);
  assert.match(html,/<section id="offline-authorized-workspace" hidden aria-label="Authorized workspace"><\/section>/);
  assert.match(html,/stay locked until this device's offline authorization can be verified/);
  assert.doesNotMatch(html,/<script\b|<iframe\b|<input\b|localStorage|sessionStorage|https?:\/\//i);
  assert.match(html,/href="\/offline-welcome\.html"/);
  assert.ok(fs.existsSync(path.join(__dirname,'../public/offline-dashboard-shell.css')));
});

const vm=require('node:vm');
const swSource=fs.readFileSync(path.join(__dirname,'../public/sw.js'),'utf8');
const origin='https://attendigo.test';
function workerHarness({network=async()=>{throw Error('offline');},shell=true}={}){
  const listeners=new Map(),matched=[],requests=[],added=[],writes=[];
  const cache={
    add:async url=>{added.push(url);},
    put:async(...args)=>{writes.push(args);}
  };
  const self={location:{origin},addEventListener:(name,fn)=>listeners.set(name,fn),skipWaiting:async()=>{}};
  const caches={open:async()=>cache,match:async url=>{
    matched.push(url);
    if(shell&&url==='/offline-dashboard.html')return new Response('locked public dashboard shell');
    if(url==='/offline-welcome.html')return new Response('legacy recovery');
    if(url==='/student-qr-offline.html')return new Response('legacy student scanner');
  }};
  vm.runInNewContext(swSource,{self,caches,URL,Response,AbortController,setTimeout,clearTimeout,
    fetch:async(...args)=>{requests.push(args);return network(...args);}});
  async function navigate(route){
    let result;
    listeners.get('fetch')({request:{url:new URL(route,origin).href,mode:'navigate',method:'GET',headers:new Headers()},
      respondWith:p=>{result=p;}});
    return await result;
  }
  async function install(){
    let pending;
    listeners.get('install')({waitUntil:p=>{pending=p;}});
    await pending;
  }
  return {navigate,install,matched,requests,added,writes};
}
test('public dashboard shell and stylesheet are required before service worker activation',async()=>{
  const h=workerHarness();
  await h.install();
  assert.ok(h.added.includes('/offline-dashboard.html'));
  assert.ok(h.added.includes('/offline-dashboard-shell.css?v=1'));
  for(const route of ['/portal.html','/principal.html','/parent-portal.html','/student-portal.html'])
    assert.ok(!h.added.includes(route));
});
test('Principal and Parent cold reopen return a locked public shell at their existing route',async()=>{
  for(const route of ['/principal.html','/parent-portal.html']){
    const h=workerHarness();
    assert.equal(await (await h.navigate(route)).text(),'locked public dashboard shell');
    assert.deepEqual(h.matched,['/offline-dashboard.html']);
    assert.equal(h.requests[0][1].cache,'no-store');
    assert.equal(h.writes.length,0);
  }
});
test('server errors select the public shell but authorization denials remain authoritative',async()=>{
  for(const route of ['/principal.html','/parent-portal.html']){
    for(const status of [500,503]){
      const h=workerHarness({network:async()=>new Response('outage',{status})});
      assert.equal(await (await h.navigate(route)).text(),'locked public dashboard shell');
    }
    for(const status of [401,403,428,200]){
      const h=workerHarness({network:async()=>new Response('server response',{status})});
      assert.equal((await h.navigate(route)).status,status);
      assert.equal(h.matched.length,0);
      assert.equal(h.writes.length,0);
    }
  }
});
test('missing shell fails closed and does not replace existing Student or Staff recovery',async()=>{
  const h=workerHarness({shell:false});
  assert.match(await (await h.navigate('/principal.html')).text(),/Connection unavailable/);
  assert.equal(await (await h.navigate('/student-portal.html')).text(),'legacy student scanner');
  assert.equal(await (await h.navigate('/portal.html')).text(),'legacy recovery');
  assert.equal(h.writes.length,0);
});
test('credential query on Principal dashboard is redirected before network access',async()=>{
  const h=workerHarness();
  const r=await h.navigate('/principal.html?password=example');
  assert.equal(r.status,303);
  assert.equal(h.requests.length,0);
  assert.equal(h.matched.length,0);
});
