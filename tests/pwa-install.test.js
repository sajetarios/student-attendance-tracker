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
   assert.match(read(p),/attendigo-install\.js\?v=2/);
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
