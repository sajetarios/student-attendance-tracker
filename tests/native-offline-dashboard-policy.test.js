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
