'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const read=path=>fs.readFileSync(path,'utf8');
const html=read('public/principal.html'),js=read('public/principal-dashboard.js');
const css=read('public/principal-dashboard.css'),sw=read('public/sw.js');
test('Principal daily briefing exposes four actionable, source-labeled focus areas',()=>{
 for(const id of ['principalBriefing','principalBriefingTitle','briefingActions','briefingSummary',
  'briefingScope','presentationToggle'])
  assert.ok(html.includes('id="'+id+'"'),id+' must appear');
 assert.ok(js.includes('renderBriefing(data)'),'renders from API result');
 assert.ok(js.includes("name:'Attendance evidence'"));
 assert.ok(js.includes("name:'Administrative workflow reference'") || js.includes("name:'Decisions and requests'"));
 assert.ok(js.includes("name:'Department QR readiness'"));
 assert.ok(js.includes("name:'Learner scan activity'"));
 assert.ok(js.includes("switchSection('staff')"));
 assert.ok(js.includes("switchSection('priorities')"));
 assert.ok(js.includes("switchSection('departments')"));
 assert.ok(js.includes("switchSection('definitions')"));
});
test('Briefing never treats missing punches, pending leave or classroom QR as official attendance findings',()=>{
 assert.ok(js.includes('No employee absence or punctuality is inferred'));
 assert.ok(js.includes('not the official SF2 attendance count'));
 assert.ok(js.includes('Review the original evidence before accepting DTR slots'));
 assert.ok(html.includes('not judgments of attendance, tardiness, employee performance'));
 assert.ok(!js.includes('Math.random'));
 assert.ok(!js.includes("fetch('/api/principal/approve"));
});
test('Presentation mode is optional, accessible and does not alter attendance data',()=>{
 assert.ok(html.includes('aria-pressed="false"'));
 assert.ok(js.includes("document.body.classList.toggle('principal-presentation',enabled)"));
 assert.ok(js.includes("event.key==='Escape'"));
 assert.ok(js.includes("presentation.setAttribute('aria-pressed',String(enabled))"));
 assert.ok(css.includes('.principal-presentation .hero h1'));
 assert.ok(css.includes('@media(max-width:560px)'));
 assert.ok(css.includes('prefers-reduced-motion'));
});
test('Principal assets are coherently cache-busted for production',()=>{
 for(const file of ['principal-dashboard.css','principal-dashboard.js']){
  const found=html.match(new RegExp(file.replace('.', '\\.')+'\\?v=\\d+'));
  assert.ok(found,file+' must have an explicit version in the Principal page');
  assert.ok(sw.includes(found[0]),file+' must use the same version in the service worker');
 }
});
