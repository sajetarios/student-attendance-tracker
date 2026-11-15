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
