'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=name=>fs.readFileSync('public/'+name,'utf8');

test('all four active dashboard families embed the same memo UI assets',()=>{
 const pages=['principal.html','portal.html','student-portal.html','parent-portal.html'];
 for(const p of pages){
  const s=read(p);
  assert.match(s,/\/school-memo-banner\.js\?v=8/,'shared memo JS in '+p);
  assert.match(s,/\/school-memo-banner\.css\?v=8/,'shared memo styling in '+p);
  assert.doesNotMatch(s,/href="\/school-memos\.html/,'no standalone memo link in '+p);
 }
});
test('memo reader remains inside current dashboard and previews attached documents inline',()=>{
 const s=read('school-memo-banner.js');
 assert.match(s,/document\.querySelector\('#schoolWorkspace'\)\|\|document\.querySelector\('main'\)/);
 assert.match(s,/host\.insertBefore\(panel,host\.firstChild\)/);
 assert.match(s,/panel\.hidden=false/);
 assert.match(s,/kind==='application\/pdf'\?make\('iframe','attendigo-memo-frame'\)/);
 assert.match(s,/const uri='\/api\/school-memos\/'/);
 assert.match(s,/URL\.createObjectURL\(new Blob\(\[bytes\],\{type:kind\}\)\)/);
 assert.match(s,/URL\.revokeObjectURL/);
 assert.match(s,/\/acknowledge'/);
 assert.match(s,/window\.AttendigoSchoolMemos=\{open,refresh\}/);
 assert.doesNotMatch(s,/window\.open\(|window\.location\.assign\(|location\.replace\(/);
});
test('principal publication and inbox shortcuts open embedded memoranda',()=>{
 const js=read('principal-dashboard.js'),html=read('principal.html');
 assert.match(html,/data-school-memo-open/);
 assert.match(js,/window\.AttendigoSchoolMemos\?\.open\?\./);
 assert.match(js,/window\.AttendigoSchoolMemos\?\.refresh\?\./);
 assert.match(js,/requestType==='MEMORANDUM'/);
});
test('shared notification drawer opens memo without leaving the current portal',()=>{
 const js=read('universal-notifications.js');
 assert.match(js,/function isSchoolMemo\(item\)/);
 assert.match(js,/window\.AttendigoSchoolMemos\?\.open\?\.\(item\.requestId\)/);
 assert.match(js,/isSchoolMemo\(item\)\?'Read memorandum'/);
});
test('old memoranda URLs redirect to role-specific dashboards',()=>{
 const s=read('school-memos-redirect.js'),page=read('school-memos.html');
 assert.match(s,/role==='PRINCIPAL'\?'\/principal\.html'/);
 assert.match(s,/role==='PARENT'\?'\/parent-portal\.html'/);
 assert.match(s,/role==='STUDENT'\?'\/student-portal\.html'/);
 assert.match(s,/location\.replace\(path\+/);
 assert.match(page,/school-memos-redirect\.js\?v=1/);
});
test('PWA caches new memo UI and always fetches authenticated portal pages online',()=>{
 const s=read('sw.js');
 for(const file of ['/school-memo-banner.js?v=8','/school-memo-banner.css?v=8',
    '/school-memos-redirect.js?v=1'])assert.ok(s.includes(file),file);
 assert.match(s,/"\/portal\.html", "\/class-qr-monitor\.html", "\/principal\.html", "\/school-memos\.html"/);
 assert.match(s,/fetch\(request, \{ cache: "no-store" \}\)/);
});

test('School Memoranda inherits active Light, Dark and Automatic settings across roles',()=>{
 const styles=read('school-memo-banner.css');
 const appearance=read('dashboard-appearance.js');
 const principal=read('principal-dashboard.js');
 assert.match(styles,/\.attendigo-memo-workspace\s*\{\s*color-scheme:light/);
 assert.match(styles,/:root\[data-ui-theme="dark"\] \.attendigo-memo-workspace/);
 assert.match(styles,/:root\[data-theme="dark"\] \.attendigo-memo-workspace/);
 assert.match(styles,/@media\(prefers-color-scheme:dark\)\s*\{\s*:root\[data-theme="system"\] \.attendigo-memo-workspace/);
 assert.match(styles,/--memo-panel:linear-gradient\(125deg,#ffffff/);
 assert.match(styles,/--memo-panel:linear-gradient\(115deg,#0b2238/);
 assert.match(styles,/:root\[data-ui-theme="dark"\] \.attendigo-memo-banner/);
 assert.match(styles,/:root\[data-theme="system"\] \.attendigo-memo-banner/);
 assert.match(appearance,/root\.dataset\.uiTheme=current/);
 assert.match(principal,/document\.documentElement\.dataset\.theme=selected/);
 // Explicit Light must take precedence over the device's dark media query.
 const base=styles.lastIndexOf('.attendigo-memo-banner{\n background:#eef9fa;');
 const oldMedia=styles.indexOf('@media(prefers-color-scheme:dark)');
 assert.ok(base>oldMedia,'Light appearance override must follow older OS media rule');
});

test('principal memorandum management reuses the authorized publication form in the shared panel',()=>{
 const s=read('school-memo-banner.js'),css=read('school-memo-banner.css'),html=read('principal.html');
 assert.match(s,/if\(state\.role!=='PRINCIPAL'\|\|!panel\|\|manager\)return/);
 assert.match(s,/document\.getElementById\('principalMemoPublishPanel'\)/);
 assert.match(s,/manager\.append\(publisher\)/);
 assert.match(s,/\+ Create memorandum/);
 assert.match(s,/managerSearch\.type='search'/);
 assert.match(s,/strip\.hidden=state\.open/);
 assert.match(css,/\.attendigo-memo-banner\[hidden\]/);
 assert.match(css,/\.attendigo-memo-embedded-publisher \.principal-memo-published\{display:none!important\}/);
 assert.equal((html.match(/id="principalMemoForm"/g)||[]).length,1);
 assert.doesNotMatch(s,/\/api\/school-memos['"],\{method:'POST'/,'publication remains in existing principal handler');
});

test('principal memo form constrains native pickers and stacks touch-device dates',()=>{
 const css=read('school-memo-banner.css'),html=read('principal.html');
 assert.match(html,/principal-memo-fields principal-memo-date-fields/);
 assert.match(html,/principal-memo-fields principal-memo-attachment/);
 assert.match(css,/#attendigoSchoolMemoPanel #principalMemoForm\{[\s\S]*?grid-template-columns:minmax\(0,1fr\)/);
 assert.match(css,/input\[type=date\],input\[type=time\]\)\{\s*-webkit-appearance:none/);
 assert.match(css,/@media\(pointer:coarse\)\{[\s\S]*?\.principal-memo-date-fields[\s\S]*?grid-template-columns:minmax\(0,1fr\)/);
});

test('shared memo shortcut is role-aware and uses the existing acknowledgment feed',()=>{
 const s=read('school-memo-banner.js');
 const source=s.slice(s.indexOf(' function currentList('),s.indexOf(' function setStatus('));
 const make=(tag,cls,value)=>({tag,cls,value,children:[],attrs:{},classes:new Set(),
  append(...v){this.children.push(...v)},replaceChildren(...v){this.children=v},
  setAttribute(k,v){this.attrs[k]=v},addEventListener(k,v){this.handler=v},
  get classList(){return {add:x=>this.classes.add(x),toggle:(x,v)=>v?this.classes.add(x):this.classes.delete(x)}}});
 const render=new Function('state','strip','make','document','open','close',source+'\nbanner();return strip;');
 for(const role of ['PRINCIPAL','SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER','GATE_KEEPER','STUDENT','PARENT','SUPER_ADMIN']){
  for(const n of [0,1,2]){
   let opened=false;
   const card=render({role,open:false,memos:Array.from({length:n},()=>({acknowledgedAt:null})).concat({acknowledgedAt:'2026-11-24'})},make('aside'),make,{createElementNS:(ns,tag)=>make(tag)},()=>{opened=true},()=>{});
   const button=card.children[0],info=button.children[1],badge=info.children[0].children[1];
   assert.equal(card.hidden,role==='SUPER_ADMIN');
   assert.ok(card.classes.has('attendigo-memo-compact'));
   assert.ok(card.classes.has('attendigo-memo-launcher-shell'));
   assert.equal(card.children.length,1);assert.equal(button.tag,'button');
   assert.equal(info.children[2].value,role==='PRINCIPAL'?'Manage memoranda':n?'Read memoranda':'View memoranda');
   assert.equal(badge?.value,n?n+' unread':undefined);
   button.handler();assert.ok(opened);
  }
 }
});
