'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../public/class-qr-teacher.js'),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function harness(){
 let now=0,interval=null,qrRequests=0,fail=false,closed=false,delay=null;
 const elements=new Map(),events={},windowEvents={};
 const el=id=>{if(!elements.has(id))elements.set(id,{value:'period',disabled:false,hidden:false,textContent:'',classList:{toggle(){},contains(){return false;}},setAttribute(){},addEventListener(){},append(){}});return elements.get(id);};
 const reply=(data,status=200)=>({ok:status<400,status,json:async()=>data});
 const document={getElementById:el,createElement:()=>({}),body:{style:{}},visibilityState:'visible',addEventListener:(name,fn)=>{events[name]=fn;}};
 const window={addEventListener:(name,fn)=>{windowEvents[name]=fn;}};
 const fetch=async(url)=>{
  if(url==='/api/auth/me')return reply({user:{role:'TEACHER'}});
  if(url==='/api/class-qr/today')return reply({date:'2026-11-25',classes:[{periodId:'period',startTime:'00:00',endTime:'23:59'}]});
  if(url==='/api/class-qr/sessions')return reply({sessionId:'session'});
  if(url.endsWith('/close'))return reply({});
  if(url.endsWith('/qr')){
   qrRequests++;
   if(delay)await delay;
   if(closed)return reply({error:'QR attendance closed.'},410);
   if(fail)throw Error('Network disconnected');
   return reply({qrImage:'data:qr-'+qrRequests,serverTime:new Date(0).toISOString(),rotationSeconds:60,validUntil:new Date(60000).toISOString(),acceptUntil:new Date(180000).toISOString(),closesAt:new Date(3600000).toISOString()});
  }
  throw Error('Unexpected URL '+url);
 };
 vm.runInNewContext(source,{document,window,fetch,location:{replace(){}},AbortController,performance:{now:()=>now},setTimeout:()=>1,clearTimeout(){},setInterval:fn=>{interval=fn;return 1;},clearInterval(){interval=null;},Date,Intl});
 await settle();
 return {el,events,windowEvents,start:()=>el('start').onclick(),close:()=>el('close').onclick(),tick:async(ms)=>{now+=ms;interval?.();await settle();},fail:v=>{fail=v;},closed:v=>{closed=v;},count:()=>qrRequests,active:()=>!!interval,delay:v=>{delay=v;}};
}
test('transient QR refresh failure hides old code and retries automatically',async()=>{
 const h=await harness();await h.start();assert.equal(h.el('qr').hidden,false);assert.match(h.el('expiry').textContent,/every 60 seconds/);
 h.fail(true);await h.tick(5000);assert.equal(h.el('qr').hidden,true);assert.equal(h.active(),true);
 h.fail(false);await h.tick(5000);assert.equal(h.el('qr').hidden,false);assert.match(h.el('notice').textContent,/refreshed/);
});
test('teacher returning to page refreshes immediately, even within normal poll window',async()=>{
 const h=await harness();await h.start();const count=h.count();h.events.visibilitychange();await settle();assert.equal(h.count(),count+1);assert.equal(h.el('qr').hidden,false);
});
test('expired displayed image is hidden during a delayed refresh',async()=>{
 const h=await harness();await h.start();let release;h.delay(new Promise(resolve=>{release=resolve;}));await h.tick(5000);await h.tick(55000);assert.equal(h.el('qr').hidden,true);release();await settle();
});
test('closed session does not retry or display obsolete QR',async()=>{
 const h=await harness();await h.start();h.closed(true);await h.tick(5000);assert.equal(h.el('qr').hidden,true);assert.equal(h.active(),false);assert.equal(h.el('close').disabled,true);
});
test('manual closure prevents an in-flight refresh from restoring old QR',async()=>{
 const h=await harness();await h.start();let release;h.delay(new Promise(resolve=>{release=resolve;}));await h.tick(5000);await h.close();release();await settle();assert.equal(h.el('qr').hidden,true);assert.equal(h.active(),false);
});
