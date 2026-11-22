'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/dashboard-appearance.js'),'utf8');
function appearance(user,storage){
 const root={dataset:{},style:{}};let requestCount=0;
 const window={matchMedia:()=>({matches:true,addEventListener(){}})};
 const context={window,document:{documentElement:root,readyState:'loading',querySelector:()=>null,querySelectorAll:()=>[],getElementById:()=>null,addEventListener(){},dispatchEvent(){}},localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},sessionStorage:{getItem:()=>JSON.stringify(user)},CustomEvent:class{},fetch(){requestCount++;}};
 vm.runInNewContext(source,context);
 return {api:window.DashboardAppearance,root,requests:()=>requestCount};
}
test('each account keeps a separate device appearance and changing it never writes school settings',()=>{
 const storage=new Map();const teacher={userId:'teacher',schoolId:'a'},parent={userId:'parent',schoolId:'a'};
 const first=appearance(teacher,storage);first.api.select('dark');assert.equal(first.root.dataset.uiTheme,'dark');assert.equal(first.requests(),0);
 const second=appearance(parent,storage);assert.equal(second.api.get(),'light');second.api.select('system');assert.equal(second.api.get(),'dark');
 assert.equal(appearance(teacher,storage).api.get(),'dark');
 first.api.select('purple');assert.equal(first.api.get(),'dark');
 assert.equal(storage.size,2);
});

test('appearance choices stay readable at mobile and large text sizes across school roles',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../public/dashboard-ui.css'),'utf8');
 const sw=fs.readFileSync(path.join(__dirname,'../public/sw.js'),'utf8');
 const portals=['portal.html','student-portal.html','parent-portal.html'];
 assert.match(css,/\.ui-theme-options\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:6px;min-width:0\}/);
 assert.match(css,/\.ui-theme-options \[data-dashboard-theme="system"\]\{grid-column:1\/-1\}/);
 assert.match(css,/\.ui-theme-options button\{min-width:0;min-height:40px/);
 assert.match(css,/white-space:nowrap;word-break:normal;overflow-wrap:normal/);
 for(const name of portals){
  const html=fs.readFileSync(path.join(__dirname,'../public',name),'utf8');
  assert.match(html,/\/dashboard-ui\.css\?v=wide11/);
 }
 assert.match(sw,/\/dashboard-ui\.css\?v=wide11/);
 assert.match(source,/\[\['system','Automatic'\],\['light','Light'\],\['dark','Dark'\]\]/);
});
