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
   assert.match(read(p),/attendigo-install\.js\?v=5/);
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
 assert.match(s,/<head[^>]*><script src="\/attendigo-install\.js\?v=5"><\/script>/);
 assert.match(s,/class="install-robot"/);
 }
 assert.equal(installed({navigator:{},matchMedia:q=>({matches:q==='(display-mode: fullscreen)'})}),false);
});

test('illustrated device guides and walkthrough are local and optional',()=>{
 const page=fs.readFileSync('public/install.html','utf8');
 assert.equal((page.match(/data-walk-step/g)||[]).length,8);
 assert.match(page,/Add to Home Screen/);
 assert.match(page,/Watch walkthrough/);
 assert.match(page,/attendigo-install-walkthrough\.js\?v=2/);
 assert.match(fs.readFileSync('public/sw.js','utf8'),/attendigo-install-walkthrough\.js\?v=2/);
});
test('walkthrough plays only on click, advances, pauses and supports manual navigation',()=>{
 const {mount}=require('../public/attendigo-install-walkthrough.js');
 const node=()=>({hidden:true,disabled:false,textContent:'',events:{},addEventListener(n,f){this.events[n]=f}});
 const steps=Array.from({length:4},node),controls=node(),play=node(),prev=node(),next=node(),count=node();
 const elements={'.walk-controls':controls,'[data-walk-play]':play,'[data-walk-prev]':prev,'[data-walk-next]':next,'[data-walk-count]':count};
 let tick=null;const doc=node();doc.hidden=false;const win={document:doc,addEventListener(){},setInterval(f){tick=f;return 1},clearInterval(){tick=null}};
 const guide={dataset:{},querySelectorAll:()=>steps,querySelector:q=>elements[q],closest:()=>null};
 mount(win,guide);
 assert.equal(tick,null);assert.equal(controls.hidden,false);assert.equal(count.textContent,'1 / 4');
 next.events.click();assert.equal(count.textContent,'2 / 4');
 play.events.click();assert.equal(count.textContent,'1 / 4');tick();assert.equal(count.textContent,'2 / 4');
 play.events.click();assert.equal(tick,null);prev.events.click();assert.equal(count.textContent,'1 / 4');
 play.events.click();tick();tick();tick();assert.equal(count.textContent,'4 / 4');tick();assert.equal(tick,null);
 // Backgrounding the page must halt playback without advancing.
 play.events.click();doc.hidden=true;doc.events.visibilitychange();assert.equal(tick,null);assert.equal(count.textContent,'1 / 4');
 doc.hidden=false;play.events.click();tick();assert.equal(count.textContent,'2 / 4');
 doc.hidden=true;tick();assert.equal(tick,null);assert.equal(count.textContent,'2 / 4');
});

test('portal fallback opens and closes the installation dialog without navigation',()=>{
 const {init}=require('../public/attendigo-install.js');
 const events={},linkEvents={},dialogEvents={},buttonEvents={};
 let prevented=0,focused=0,opened=0,closed=0;
 const link={addEventListener:(name,cb)=>{linkEvents[name]=cb},focus:()=>{focused++}};
 const closeButton={addEventListener:(name,cb)=>{buttonEvents[name]=cb}};
 const dialog={open:false,querySelectorAll:()=>[closeButton],addEventListener:(n,cb)=>{dialogEvents[n]=cb},showModal(){this.open=true;opened++},close(){this.open=false;closed++;dialogEvents.close()}};
 const win={document:{readyState:'complete',getElementById:id=>id==='attendigoInstallDialog'?dialog:null,querySelectorAll:q=>q==='[data-attendigo-install]'||q.includes('[data-attendigo-install-container]')?[link]:[]},navigator:{userAgent:'iPhone Safari'},matchMedia:()=>({matches:false}),addEventListener:(n,cb)=>{events[n]=cb}};
 init(win);
 linkEvents.click({preventDefault(){prevented++}});assert.equal(prevented,1);assert.equal(opened,1);
 buttonEvents.click();assert.equal(closed,1);assert.equal(focused,1);
 linkEvents.click({preventDefault(){prevented++}});assert.equal(opened,2);
});
test('every portal uses a branded in-place guide with no return link that navigates',()=>{
 const guide=fs.readFileSync('public/install.html','utf8').match(/<main class="install-card">([\s\S]*?)<\/main>/)[1];
 for(const p of ['portal-login.html','parent-portal.html','portal.html','student-portal.html','principal.html']){
 const source=fs.readFileSync('public/'+p,'utf8');
 const modal=source.match(/<dialog id="attendigoInstallDialog"[\s\S]*?<\/dialog>/)[0];
 assert.match(modal,/attendigo-official-lockup/);
 assert.match(modal,/data-install-close>Close<\/button>/);assert.doesNotMatch(modal,/href="\/"\s*>/);
 assert.equal((modal.match(/data-walk-step/g)||[]).length,(guide.match(/data-walk-step/g)||[]).length);
 assert.match(source,/target="_blank" rel="noopener" aria-haspopup="dialog"/);
 }
 const login=fs.readFileSync('public/portal-login.html','utf8');
 assert.ok(login.indexOf('data-attendigo-install-container')<login.indexOf('id="loginForm"'));
});

test('installer follows approved login brand and avoids the former green primary controls',()=>{
 const css=fs.readFileSync('public/attendigo-install.css','utf8');
 assert.match(css,/linear-gradient\(130deg,#08183c,#174089\)/);
 assert.match(css,/linear-gradient\(115deg,#3921bc,#6231e6/);
 assert.doesNotMatch(css,/#08705d|#075b4e|#147664/i);
 for(const p of ['install.html','portal-login.html','portal.html','parent-portal.html','student-portal.html','principal.html']){
  const s=fs.readFileSync('public/'+p,'utf8');
  assert.match(s,/install-brand-logo[^>]+attendigo-official-lockup/);
  assert.match(s,/attendigo-install\.css\?v=6/);
 }
 assert.match(fs.readFileSync('public/sw.js','utf8'),/attendigo-install\.css\?v=6/);
});
