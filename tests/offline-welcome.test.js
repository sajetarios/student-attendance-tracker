'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'public/offline-welcome.html'), 'utf8');

function requestServiceWorker(url, { offline = true, mode = 'navigate', hit = {}, method = 'GET' } = {}) {
  let handler;
  const self = {
    location: { origin: 'https://attendigo.tech' },
    addEventListener(name, fn) { if (name === 'fetch') handler = fn; }
  };
  const cache = {
    match: async input => hit[typeof input === 'string' ? input : input.url] || null,
    open: async () => ({ put: async () => {} })
  };
  const context = {
    self, URL, caches: cache,
    fetch: async () => {
      if (offline) throw new Error('Disconnected');
      return { ok: true, live: true, clone() { return this; } };
    },
    Response: { error: () => ({ failed: true }), redirect: () => ({ redirected: true }) }
  };
  vm.runInNewContext(script, context);
  const request = { url, mode, method, headers: { has: () => false } };
  let response = null;
  handler({ request, respondWith(value) { response = value; } });
  return response;
}

test('official homepage falls back to branded cached welcome when offline', async () => {
  const offline = { branded: true };
  const result = await requestServiceWorker('https://attendigo.tech/', {
    hit: { '/offline-welcome.html': offline }
  });
  assert.equal(await result, offline);
});

test('offline direct login uses welcome fallback without ever verifying attendance', async () => {
  const offline = { branded: true };
  const result = await requestServiceWorker('https://attendigo.tech/portal-login.html', {
    hit: { '/offline-welcome.html': offline }
  });
  assert.equal(await result, offline);
  assert.doesNotMatch(page, /fetch\(['"]\/api\/(?:attendance|gate|class-qr)/);
});

test('existing student offline QR fallback remains authoritative', async () => {
  const studentOffline = { studentOffline: true };
  const result = await requestServiceWorker('https://attendigo.tech/student-portal.html', {
    hit: { '/student-qr-offline.html': studentOffline }
  });
  assert.equal(await result, studentOffline);
});

test('API traffic is never cached or intercepted by offline welcome', async () => {
  const result = requestServiceWorker('https://attendigo.tech/api/startup-readiness');
  assert.equal(result, null);
});

test('online homepage still prefers the network', async () => {
  const result = await requestServiceWorker('https://attendigo.tech/', {
    offline: false,
    hit: { '/offline-welcome.html': { branded: true } }
  });
  assert.equal((await result).live, true);
});

test('fallback markup is branded, responsive, and has retry but no sign-in form', () => {
  assert.match(page, /attendigo-official-lockup\.svg/);
  assert.match(page, /id="retry"/);
  assert.match(page, /window\.addEventListener\('online'/);
  assert.match(page, /@media\(max-width:720px\)/);
  assert.doesNotMatch(page, /<form\b/i);
});

test('offline worker installs even when an optional shell asset fails', async () => {
  const handlers = {};
  const added = [];
  let activated = false;
  const self = {
    addEventListener(name, fn) { handlers[name] = fn; },
    skipWaiting: async () => { activated = true; }
  };
  const cache = {
    add: async url => {
      added.push(url);
      if (url === '/portal.css?v=0.9.121') throw new Error('Temporary CDN failure');
    },
    addAll: async () => { throw new Error('Legacy atomic install must not run'); }
  };
  vm.runInNewContext(script, {
    self, caches: { open: async () => cache }, Promise,
    URL, Response, fetch: async () => ({ ok: true })
  });
  let installation;
  handlers.install({ waitUntil(task) { installation = task; } });
  await installation;
  assert.equal(activated, true);
  assert.equal(added[0], '/offline-welcome.html');
  assert.equal(added.filter(url => url === '/vendor/html5-qrcode.min.js').length, 1);
  assert.equal(new Set(added).size, added.length);
  assert.ok(added.includes('/student-qr-offline.html'));
  assert.ok(added.includes('/gate-offline.html'));
});

test('offline worker refuses installation when the welcome fallback itself is missing', async () => {
  const handlers = {};
  let skipWaitingCalled = false;
  const self = {
    addEventListener(name, fn) { handlers[name] = fn; },
    skipWaiting: async () => { skipWaitingCalled = true; }
  };
  vm.runInNewContext(script, {
    self, caches: { open: async () => ({
      add: async url => { if (url === '/offline-welcome.html') throw new Error('Offline page missing'); }
    }) },
    Promise, URL, Response, fetch: async () => ({ ok: true })
  });
  let installation;
  handlers.install({ waitUntil(task) { installation = task; } });
  await assert.rejects(installation, /Offline page missing/);
  assert.equal(skipWaitingCalled, false);
});

test('offline welcome links to the existing prepared attendance tools, not dashboard bypass', () => {
  for (const route of ['/offline-sheet.html', '/gate-offline.html', '/student-qr-offline.html']) {
    assert.ok(page.includes('href="' + route + '"'), 'Missing prepared offline route: ' + route);
    assert.ok(script.includes('"' + route + '"'), 'Offline route not precached: ' + route);
  }
  assert.match(page, /Full portal login still requires internet/i);
  assert.doesNotMatch(page, /<form\b/i);
});


test('staff portal offline navigation returns the public tools hub, not a cached dashboard', async () => {
  const hub = { branded: true };
  const result = await requestServiceWorker('https://attendigo.tech/portal.html', { hit: {'/offline-welcome.html':hub,'/portal.html':{private:true}} });
  assert.equal(await result, hub);
});
test('staff online portal continues to use the live authenticated response', async () => {
  assert.equal((await requestServiceWorker('https://attendigo.tech/portal.html',{offline:false})).live,true);
});
test('explicit offline tools hub remains available on disconnected devices', async () => {
  const hub={branded:true};
  assert.equal(await requestServiceWorker('https://attendigo.tech/offline-welcome.html',{hit:{'/offline-welcome.html':hub}}),hub);
});
test('all three offline tools and the sign-in page link directly to the shared hub', () => {
  for(const name of ['offline-sheet.html','gate-offline.html','student-qr-offline.html','portal-login.html']) {
    assert.match(fs.readFileSync(path.join(root,'public',name),'utf8'),/href="\/offline-welcome\.html"/);
  }
});
test('protected dashboards without an approved offline fallback remain fail closed', async () => {
  await assert.rejects(requestServiceWorker('https://attendigo.tech/principal.html',{hit:{'/principal.html':{private:true}}}),/Disconnected/);
});


test('all offline attendance pages share responsive branding and direct navigation',()=>{
  for(const name of ['offline-sheet.html','gate-offline.html','student-qr-offline.html']){
    const html=fs.readFileSync(path.join(root,'public',name),'utf8');
    assert.match(html,/class="offline-workspace"/);
    assert.match(html,/attendigo-official-lockup\.svg\?v=5/);
    assert.match(html,/href="\/offline-welcome\.html"/);
    assert.match(html,/@media\(max-width:420px\)/);
  }
});
test('student scanner displays real queue counters, not hard-coded zeroes',()=>{
  const html=fs.readFileSync(path.join(root,'public/student-qr-offline.html'),'utf8');
  const js=fs.readFileSync(path.join(root,'public/student-qr-offline.js'),'utf8');
  assert.match(html,/id="studentQrPendingCount">—/);
  assert.match(html,/id="studentQrReviewCount">—/);
  assert.match(js,/pendingCount.textContent=String\(pending\)/);
  assert.match(js,/reviewCount.textContent=String\(review\)/);
  assert.match(js,/You are offline\. Reconnect to sync saved scans/);
});

test('offline tools use the branded light palette independently of OS dark mode',()=>{
  for(const name of ['offline-sheet.html','gate-offline.html','student-qr-offline.html','offline-welcome.html','staff-lunch-checkin.html','class-qr-checkin.html']){
    const html=fs.readFileSync(path.join(root,'public',name),'utf8');
    assert.match(html,/<html lang="en" data-theme="light"/,name);
    assert.match(html,/color-scheme:only light/,name);
    assert.doesNotMatch(html,/@media\s*\(\s*prefers-color-scheme\s*:\s*dark/,name);
    assert.doesNotMatch(html,/color-scheme\s*:\s*light\s+dark/,name);
  }
  const sheet=fs.readFileSync(path.join(root,'public','offline-sheet.html'),'utf8');
  assert.match(sheet,/html\[data-offline-sheet="true"\]\[data-theme="light"\]\{--asc-surface:#ffffff/);
});

test('each offline tool survives reload including query-string variations', async () => {
  for (const route of ['/offline-sheet.html','/gate-offline.html','/student-qr-offline.html']) {
    const shell = { tool: route };
    const options = { hit: { [route]: shell, '/offline-welcome.html': { hub: true } } };
    assert.equal(await requestServiceWorker('https://attendigo.tech'+route, options), shell);
    assert.equal(await requestServiceWorker('https://attendigo.tech'+route+'?reload=1', options), shell);
  }
});
test('missing tool falls back to offline hub rather than a blank browser error', async () => {
  const hub = { hub: true };
  assert.equal(await requestServiceWorker('https://attendigo.tech/gate-offline.html', {hit:{'/offline-welcome.html':hub}}),hub);
});
test('online offline-tool reload still refreshes the shell from network', async () => {
  assert.equal((await requestServiceWorker('https://attendigo.tech/student-qr-offline.html',{offline:false})).live,true);
});
test('worker will not activate a partial offline cache after a required tool fails', async () => {
  const handlers = {}; let activated=false;
  vm.runInNewContext(script,{
    self:{addEventListener(name,fn){handlers[name]=fn;},skipWaiting:async()=>{activated=true;}},
    caches:{open:async()=>({add:async url=>{if(url==='/gate-offline.html')throw Error('Required gate shell unavailable');}})},
    Promise,URL,Response,fetch:async()=>({ok:true})
  });
  let installation;
  handlers.install({waitUntil(task){installation=task;}});
  await assert.rejects(installation,/Required gate shell unavailable/);
  assert.equal(activated,false);
});

test('offline hub reconnects without navigating away and exposes explicit online link',async()=>{
 const source=[...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
 const elements={},events={},links=['STUDENT','TEACHER','GATE_KEEPER'].map(role=>({dataset:{offlineRole:role},hidden:true}));
 const document={getElementById(id){return elements[id]??={hidden:true,textContent:'',addEventListener(k,fn){this[k]=fn;}};},querySelectorAll:()=>links};
 const navigator={onLine:true};
 const window={AttendigoOfflineAccount:{current:()=>({role:'STUDENT'}),authorize:async()=>({role:'STUDENT'}),watch(){}},addEventListener(k,fn){events[k]=fn;},location:{replace(){throw Error('Unexpected navigation');}}};
 vm.runInNewContext(source,{document,window,navigator,AbortController,setTimeout,clearTimeout,fetch:async()=>({ok:true,json:async()=>({ready:true,service:'attendigo'})})});
 for(let i=0;i<12;i++)await Promise.resolve();
 assert.equal(elements['connection-heading'].textContent,'Connected');
 assert.equal(elements.returnOnline.hidden,false);
 assert.deepEqual(links.map(x=>x.hidden),[false,true,true]);
 navigator.onLine=false;events.offline();assert.equal(elements.returnOnline.hidden,true);
 navigator.onLine=true;events.online();for(let i=0;i<12;i++)await Promise.resolve();
 assert.equal(elements['connection-heading'].textContent,'Connected');
 assert.equal(elements.returnOnline.hidden,false);
 assert.match(page,/id="returnOnline"[^>]*href="\/portal-login.html"/);
 assert.doesNotMatch(source,/location\.(replace|assign)|setInterval/);
});
test('student portal offers one scan action and standalone counters avoid duplicated warnings',()=>{
 const html=fs.readFileSync(path.join(root,'public/student-portal.html'),'utf8');
 const offline=fs.readFileSync(path.join(root,'public/student-qr-offline.html'),'utf8');
 assert.equal((html.match(/id="studentScanQr"/g)||[]).length,1);
 assert.doesNotMatch(html,/Open offline-capable scanner/);
 assert.doesNotMatch(offline,/<p class="ow-note">Pending scans are not official attendance/);
});

test('offline appearance defaults to light and changes only through an explicit choice',()=>{
 const names=['offline-sheet.html','gate-offline.html','student-qr-offline.html'];
 let stored=null;
 for(const name of names){
   const html=fs.readFileSync(path.join(root,'public',name),'utf8');
   assert.match(html,/id="offlineThemeToggle"/);
   assert.match(html,/html\[data-theme="dark"\] body\.offline-workspace/);
   const source=html.match(/<script id="offlineAppearanceScript">([\s\S]*?)<\/script>/)[1];
   const rootEl={dataset:{theme:'light'}},meta={},button={textContent:'',setAttribute(k,v){this[k]=v;},addEventListener(k,fn){this[k]=fn;}};
   const listeners={};
   const document={documentElement:rootEl,querySelector:()=>meta,getElementById:()=>button,addEventListener(k,fn){listeners[k]=fn;}};
   const window={addEventListener(){}};
   vm.runInNewContext(source,{document,window,localStorage:{getItem:()=>stored,setItem:(k,v)=>{stored=v;}}});
   listeners.DOMContentLoaded();
   assert.equal(rootEl.dataset.theme,stored==='dark'?'dark':'light');
   const before=rootEl.dataset.theme;
   button.click();
   assert.equal(rootEl.dataset.theme,before==='dark'?'light':'dark');
   assert.equal(stored,rootEl.dataset.theme);
   assert.equal(button['aria-pressed'],String(stored==='dark'));
 }
});
