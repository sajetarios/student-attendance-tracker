const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/sw.js'),'utf8');
function worker({cache={},networkError=true,cacheError=false}={}){
  const listeners={};
  const origin='https://attendigo.tech';
  const context={URL,Response,AbortController,setTimeout,clearTimeout,
    self:{location:{origin},addEventListener:(name,fn)=>{listeners[name]=fn}},
    caches:{match:async key=>{if(cacheError)throw Error('storage unavailable');return cache[typeof key==='string'?key:new URL(key.url).pathname]},open:async()=>{if(cacheError)throw Error('storage unavailable');return {put:async()=>{}}}},
    fetch:async()=>{if(networkError)throw TypeError('Load failed');return new Response('online portal',{headers:{'Content-Type':'text/html'}})}
  };
  vm.runInNewContext(source,context);
  return async (pathname)=>{let pending;listeners.fetch({request:{url:origin+pathname,method:'GET',mode:'navigate',headers:new Headers()},respondWith:p=>{pending=p}});return await pending};
}
test('offline root uses prepared welcome page',async()=>{
  const go=worker({cache:{'/offline-welcome.html':new Response('cached welcome')}});
  assert.equal(await (await go('/')).text(),'cached welcome');
});
test('missing cache returns a safe self-contained HTML document for every portal navigation',async()=>{
  const go=worker();
  for(const url of ['/','/portal-login.html','/portal.html','/student-portal.html','/parent-portal.html','/principal.html','/offline-sheet.html','/gate-offline.html','/student-qr-offline.html']){
    const response=await go(url);assert.equal(response.ok,true);const html=await response.text();assert.match(html,/Connection unavailable/);assert.doesNotMatch(html,/href="\/(?:gate-offline|offline-sheet|student-qr-offline)/);
  }
});
test('cache storage rejection still produces HTML',async()=>{
  const go=worker({cacheError:true});
  for(const url of ['/','/offline-welcome.html','/portal.html'])assert.match(await(await go(url)).text(),/Connection unavailable/);
});
test('student portal prefers prepared student offline tool',async()=>{
  const go=worker({cache:{'/student-qr-offline.html':new Response('student tool')}});
  assert.equal(await(await go('/student-portal.html')).text(),'student tool');
});
test('online root remains online even if cache storage is unavailable',async()=>{
  const go=worker({cacheError:true,networkError:false});
  assert.equal(await(await go('/')).text(),'online portal');
});
test('API requests remain outside service worker interception',async()=>{
  const go=worker();assert.equal(await go('/api/auth/me'),undefined);
});

test('unapproved offline dashboards receive only a neutral document, even when the public hub is cached',async()=>{
  const go=worker({cache:{'/offline-welcome.html':new Response('cached welcome'),'/principal.html':new Response('private data')}});
  const html=await(await go('/principal.html')).text();assert.match(html,/Connection unavailable/);assert.doesNotMatch(html,/cached welcome|private data/);
});
