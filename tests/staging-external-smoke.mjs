'use strict';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,statSync} from 'node:fs';
const base=process.env.STAGING_BASE_URL;
assert.equal(base,'https://attendigo-staging.onrender.com','Refuse to test any non-staging host');
const checks=[];
async function check(label,fn){try{const details=await fn();checks.push({label,status:'PASS',details});console.log('PASS',label,details??'');}catch(e){checks.push({label,status:'FAIL',error:String(e)});console.error('FAIL',label,String(e));process.exitCode=1;}}
async function get(path,opts={}){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),100000);try{return await fetch(base+path,{...opts,signal:controller.signal,redirect:'manual'});}finally{clearTimeout(timer);}}
await check('health endpoint',async()=>{const r=await get('/api/health');assert.equal(r.status,200);const body=await r.json();assert.equal(body.ok,true);return body.service;});
await check('root redirects to portal login',async()=>{const r=await get('/');assert.equal(r.status,302);assert.match(r.headers.get('location')??'',/portal-login\.html/);});
await check('portal login loads',async()=>{const r=await get('/portal-login.html');assert.equal(r.status,200);const html=await r.text();assert.match(html,/login|sign in/i);return html.length+' bytes';});
await check('unauthenticated dashboard is protected',async()=>{const r=await get('/api/dashboard');assert.ok([401,403,404].includes(r.status),'Unexpected status '+r.status);return r.status;});
await check('Chromium browser renders login',async()=>{mkdirSync('staging-smoke-artifacts',{recursive:true});const p=spawnSync('npx',['--yes','playwright@1.58.2','screenshot','--browser','chromium','--wait-for-timeout','2000','--timeout','90000',base+'/portal-login.html','staging-smoke-artifacts/login.png'],{encoding:'utf8',timeout:120000});assert.equal(p.status,0,p.stderr||p.stdout);assert.ok(statSync('staging-smoke-artifacts/login.png').size>1000);return 'Screenshot captured';});
console.log(JSON.stringify({checks},null,2));
