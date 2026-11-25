'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const script=fs.readFileSync('public/staff-lunch-ui.js','utf8');
class Element {
 constructor(){this.children=[];this.handlers={};this.value='';this.checked=false;this.disabled=false;this.classList={toggle(){}};this.textContent='';}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;}
 addEventListener(name,handler){this.handlers[name]=handler;}
 setAttribute(){}
 querySelectorAll(selector){
   const all=this.children.flatMap(c=>[c,...c.querySelectorAll('*')]);
   if(selector==='*')return all;
   if(selector==='button')return all.filter(c=>c.tag==='button');
   if(selector==='input[type="checkbox"]')return all.filter(c=>c.type==='checkbox');
   if(selector==='input[type="checkbox"]:checked')return all.filter(c=>c.type==='checkbox'&&c.checked);
   throw Error('unexpected selector '+selector);
 }
}
test('department head can tap two eligible teachers, save the chosen slot, and reset selection',async()=>{
 const ids=['staffLunchAdminCard','staffLunchAdminStatus','staffLunchAdminSlot','staffLunchAdminDay','staffLunchAssign','staffLunchRevoke','staffLunchTeacher','staffLunchTeacherCount','staffLunchDepartment','staffLunchAssignedList'];
 const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));
 elements.staffLunchAdminSlot.value='PM_IN';
 elements.staffLunchDepartment.value='dep-1';
 const writes=[];
 const teachers=[
  {active:true,departmentId:'dep-1',userId:'t1',displayName:'Teacher A'},
  {active:true,departmentId:'dep-1',userId:'t2',displayName:'Teacher B'},
  {active:true,departmentId:'dep-2',userId:'outside',displayName:'Other department'},
  {active:false,departmentId:'dep-1',userId:'inactive',displayName:'Inactive'},
  {active:true,departmentId:'dep-1',teacherStatus:'ON_LEAVE',userId:'leave',displayName:'On leave'}
 ];
 const fetch=async(path,options={})=>{
  if(options.method==='PUT')writes.push(JSON.parse(options.body));
  return {ok:true,json:async()=>path==='/api/teachers'?{teachers}:{presenters:[],enabled:true}};
 };
 const document={getElementById:id=>elements[id]||null,createElement:tag=>Object.assign(new Element(),{tag})};
 function Option(text,value){return Object.assign(new Element(),{textContent:text,value});}
 const user={role:'DEPARTMENT_HEAD',departmentId:'dep-1',departmentName:'Department'};
 let initialized;
 const window={attendigoStaffIdentity:{then(fn){initialized=fn(user);return initialized;}}};
 vm.runInNewContext(script,{window,document,fetch,Option,URLSearchParams,Intl,Date});
 await initialized;
 const picker=elements.staffLunchTeacher;
 const boxes=picker.querySelectorAll('input[type="checkbox"]');
 assert.deepEqual(boxes.map(b=>b.value),['t1','t2']);
 assert.equal(elements.staffLunchTeacherCount.textContent,'0 teachers selected');
 await elements.staffLunchAssign.handlers.click();
 assert.equal(writes.length,0);
 boxes[0].checked=true;picker.handlers.change();
 assert.equal(elements.staffLunchTeacherCount.textContent,'1 teacher selected');
 boxes[1].checked=true;picker.handlers.change();
 assert.equal(elements.staffLunchTeacherCount.textContent,'2 teachers selected');
 boxes[0].checked=false;picker.handlers.change();
 assert.equal(elements.staffLunchTeacherCount.textContent,'1 teacher selected');
 boxes[0].checked=true;picker.handlers.change();
 await elements.staffLunchAssign.handlers.click();
 assert.deepEqual(writes,[{slot:'PM_IN',presenterUserId:'t1'},{slot:'PM_IN',presenterUserId:'t2'}]);
 assert.equal(elements.staffLunchTeacherCount.textContent,'0 teachers selected');
 assert.ok(boxes.every(b=>!b.checked&&!b.disabled));
});
