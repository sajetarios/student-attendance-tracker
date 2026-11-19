'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..','public',p),'utf8');
const html=read('portal.html'),portal=read('portal.js'),ob=read('staff-ob-ui.js'),css=read('attendigo-unified-workspace.css'),nav=read('attendigo-unified-navigation.js'),sw=read('sw.js');
test('new presentation assets parse and are loaded by the portal and PWA',()=>{
 assert.doesNotThrow(()=>new vm.Script(nav));
 for(const asset of ['attendigo-unified-workspace.css?v=1','attendigo-unified-navigation.js?v=1']){
  assert.ok(html.includes(asset),asset+' in portal');
  assert.ok(sw.includes(asset),asset+' in offline shell');
 }
 assert.match(sw,/attendigo-v256-unified-workspace/);
});
test('navigation remains role-scoped and preserves links and events',()=>{
 assert.match(nav,/Only replace legacy text glyphs/);
 assert.doesNotMatch(nav,/\.hidden\s*=|setAttribute\('hidden'|fetch\(|\.click\(|location\./);
 for(const role of ['SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER','GATE_KEEPER']){
  assert.match(portal,new RegExp("role === '"+role+"'"));
 }
 assert.match(portal,/function allowedViewsForUser\(\)/);
 assert.match(css,/#sidebar \.nav-item:focus-visible/);
});
test('school header is in normal document flow instead of obscuring tables',()=>{
 assert.match(css,/\.content-wrap > \.school-heading\{/);
 assert.match(css,/position:relative!important/);
 assert.match(css,/top:auto!important/);
 assert.match(css,/max-width:100%/);
 assert.match(css,/@media screen and \(max-width:700px\)/);
});
test('OB form, tab actions and backend permissions remain untouched',()=>{
 assert.match(ob,/\/api\/staff-attendance\/official-business/);
 assert.match(ob,/PENDING_HEAD/);
 assert.match(ob,/PENDING_ADMIN/);
 assert.match(ob,/role==='DEPARTMENT_HEAD'/);
 assert.match(ob,/role==='SCHOOL_ADMIN'/);
 assert.match(css,/#obScopeTabs/);
 assert.match(css,/#obNew/);
 assert.match(css,/#obStatus/);
});
test('no new attendance writes or role overrides are introduced',()=>{
 assert.doesNotMatch(nav,/\/api\/|POST|PATCH|DELETE|attendance\/|localStorage/);
 assert.doesNotMatch(css,/\.sf2-matrix|@media print|\.dtr-print/);
 assert.match(css,/html\[data-ui-theme="dark"\]/);
 assert.match(css,/prefers-reduced-motion/);
});
