const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {platform,installed}=require('../public/attendigo-install.js');
test('install guide detects embedded browsers before OS and handles iPad desktop UA',()=>{
 assert.equal(platform({userAgent:'Android Chrome'}),'android');
 assert.equal(platform({userAgent:'iPhone Safari'}),'ios');
 assert.equal(platform({userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:5}),'ios');
 assert.equal(platform({userAgent:'Android FBAV/123'}),'embedded');
 assert.equal(platform({userAgent:'iPhone Instagram'}),'embedded');
 assert.equal(platform({userAgent:'Desktop Chrome'}),'other');
});
test('installation is detected only from current display mode, not stored consent',()=>{
 assert.equal(installed({navigator:{standalone:true}}),true);
 assert.equal(installed({navigator:{},matchMedia:q=>({matches:q==='(display-mode: standalone)'})}),true);
 assert.equal(installed({navigator:{},matchMedia:()=>({matches:false})}),false);
});
test('public installation entry points reuse the existing manifest and avoid auth or push mutations',()=>{
 const read=p=>fs.readFileSync('public/'+p,'utf8');
 for(const p of ['portal-login.html','parent-portal.html','portal.html','student-portal.html','principal.html']) {
   assert.match(read(p),/href="\/install\.html"/);
   assert.match(read(p),/attendigo-install\.js\?v=3/);
 }
 assert.match(read('install.html'),/manifest\.webmanifest/);
 assert.match(read('install.html'),/Activate phone alerts/);
 assert.doesNotMatch(read('attendigo-install.js'),/requestPermission|localStorage|sessionStorage|\/api\//);
 assert.equal(JSON.parse(read('manifest.webmanifest')).start_url,'/portal-login.html');
});

test('highlight is in flow, finite, and respects reduced motion',()=>{
 const css=fs.readFileSync('public/attendigo-install.css','utf8');
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(css,/animation:attendigo-install-highlight 1\.45s ease-in-out 3/);
 for(const p of ['portal-login.html','parent-portal.html','portal.html','student-portal.html','principal.html']){
   const source=fs.readFileSync('public/'+p,'utf8');
   assert.equal((source.match(/data-attendigo-install-container/g)||[]).length,1);
   assert.match(source,/attendigo-install-cta/);
 }
});
test('app installation uses the browser install event, not the native text prompt',()=>{
 const source=fs.readFileSync('public/attendigo-install.js','utf8');
 assert.match(source,/beforeinstallprompt/);
 assert.match(source,/event\.prompt\(\)/);
 assert.doesNotMatch(source,/(?:\bwindow\s*\.\s*|(?<![\w.]))(?:alert|prompt|confirm)\s*\(/);
});

test('native installation calls the captured browser event directly during the click, without navigation',async()=>{
 const {init}=require('../public/attendigo-install.js');
 const events={},docEvents={},linkEvents={};let called=0,prevented=0;
 const link={hidden:false,addEventListener:(name,cb)=>{linkEvents[name]=cb;}};
 const doc={readyState:'loading',getElementById:()=>null,querySelectorAll:q=>q==='[data-attendigo-install]'||q.includes('[data-attendigo-install-container]')?[link]:[],addEventListener:(name,cb)=>{docEvents[name]=cb;}};
 const win={document:doc,navigator:{userAgent:'Android Chrome'},matchMedia:()=>({matches:false}),addEventListener:(name,cb)=>{events[name]=cb;}};
 init(win);
 events.beforeinstallprompt({preventDefault(){prevented++},prompt(){called++;return Promise.resolve()},userChoice:Promise.resolve({outcome:'accepted'})});
 docEvents.DOMContentLoaded();
 linkEvents.click({preventDefault(){prevented++}});
 assert.equal(called,1);assert.equal(prevented,2);
 await new Promise(resolve=>setImmediate(resolve));
 events.appinstalled();
 assert.equal(link.hidden,true);
});
test('iPhone falls back to guide without suppressing browser behavior',()=>{
 const {init}=require('../public/attendigo-install.js');
 const events={},linkEvents={};let prevented=0;
 const link={addEventListener:(name,cb)=>{linkEvents[name]=cb;}};
 const win={document:{readyState:'complete',getElementById:()=>null,querySelectorAll:q=>q==='[data-attendigo-install]'||q.includes('[data-attendigo-install-container]')?[link]:[]},navigator:{userAgent:'iPhone Safari'},matchMedia:()=>({matches:false}),addEventListener:(n,cb)=>{events[n]=cb;}};
 init(win);events.beforeinstallprompt({preventDefault(){prevented++}});
 linkEvents.click({preventDefault(){prevented++}});assert.equal(prevented,0);
});
test('all main portals declare manifest and capture install event early with animated mascot',()=>{
 for(const p of ['portal-login.html','parent-portal.html','portal.html','student-portal.html','principal.html','install.html']){
 const s=fs.readFileSync('public/'+p,'utf8');
 assert.match(s,/rel="manifest"/);
 assert.match(s,/<head[^>]*><script src="\/attendigo-install\.js\?v=3"><\/script>/);
 assert.match(s,/class="install-robot"/);
 }
 assert.equal(installed({navigator:{},matchMedia:q=>({matches:q==='(display-mode: fullscreen)'})}),false);
});
