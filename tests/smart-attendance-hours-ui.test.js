'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const script=fs.readFileSync('public/smart-attendance-overview.js','utf8');
const portal=fs.readFileSync('public/portal.html','utf8');
const sw=fs.readFileSync('public/sw.js','utf8');

function element(){
 const listeners=new Map();
 return {
  value:'', disabled:false, textContent:'', hidden:false, open:false,
  classList:{toggle(){}},
  addEventListener(name,fn){const all=listeners.get(name)||[];all.push(fn);listeners.set(name,all);},
  async fire(name){await Promise.all((listeners.get(name)||[]).map(fn=>fn()));},
  append(){},replaceChildren(){},scrollIntoView(){}
 };
}

function harness(givenDefaults){
 const nodes=new Map();
 const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 let defaults=JSON.parse(JSON.stringify(givenDefaults));
 const writes=[];
 const response=value=>({ok:true,async json(){return value;}});
 const fetch=async(url,options={})=>{
  if(url.startsWith('/api/staff-attendance/admin/form48/defaults')){
   if(options.method==='PUT'){
    const body=JSON.parse(options.body);
    writes.push(body);
    defaults={...body,revision:defaults.revision+1};
    return response({saved:true,revision:defaults.revision});
   }
   return response({defaults});
  }
  if(url.startsWith('/api/staff-attendance/admin/smart-overview')){
   return response({safeToApply:false,date:'2026-11-23',items:[],
    verifiedGateEvents:0,reviewCount:0,pendingCount:0,
    schoolHoursConfigured:Boolean(defaults.regularHours.AM_IN)});
  }
  throw Error('Unexpected request '+url);
 };
 vm.runInNewContext(script,{
  window:{attendigoStaffIdentity:Promise.resolve({role:'SCHOOL_ADMIN'}),confirm:()=>true},
  document:{getElementById:get,createElement:element,addEventListener(){}},fetch,Intl,Date,
  URLSearchParams,console
 },{filename:'smart-attendance-overview.js'});
 return {get,writes,latest:()=>defaults};
}
async function settle(){
 for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));
}
const base={
 workdays:[1,2,3,4,5,6],regularHours:{},
 saturdayHours:{AM_IN:'08:00',AM_OUT:'12:00',PM_IN:'13:00',PM_OUT:'17:00'},
 verifiedBy:'Principal',verifiedPosition:'School Head',
 approvedBy:'Authorized official',approvedPosition:'Approving Officer',revision:7
};

test('custom working days do not lock preset or time input; saving preserves all configured days',async()=>{
 const h=harness(base);
 await settle();
 assert.equal(h.get('smartHoursPreset').disabled,false);
 for(const id of ['smartHoursAmIn','smartHoursAmOut','smartHoursPmIn','smartHoursPmOut'])
  assert.equal(h.get(id).disabled,false,id+' should be editable');
 assert.equal(h.get('smartHoursSave').disabled,true);
 h.get('smartHoursPreset').value='7-4';
 await h.get('smartHoursPreset').fire('change');
 assert.deepEqual(
  ['smartHoursAmIn','smartHoursAmOut','smartHoursPmIn','smartHoursPmOut'].map(id=>h.get(id).value),
  ['07:00','12:00','13:00','16:00']
 );
 assert.equal(h.get('smartHoursSave').disabled,false);
 await h.get('smartHoursSave').fire('click');
 await settle();
 assert.equal(h.writes.length,1);
 assert.deepEqual(h.writes[0].workdays,base.workdays);
 assert.deepEqual(h.writes[0].saturdayHours,base.saturdayHours);
 assert.equal(h.writes[0].regularHours.AM_IN,'07:00');
 assert.equal(h.writes[0].regularHours.PM_IN,'13:00');
 assert.equal(h.writes[0].verifiedBy,base.verifiedBy);
 assert.equal(h.writes[0].approvedBy,base.approvedBy);
 assert.equal(h.writes[0].revision,base.revision);
 assert.match(h.get('smartHoursFeedback').textContent,/working days.*Saturday hours.*attendance punches/i);
});

test('nonstandard weekday selections remain intact when admin saves custom working hours',async()=>{
 const h=harness({...base,workdays:[0,2,4],regularHours:{}});
 await settle();
 h.get('smartHoursAmIn').value='06:30';
 h.get('smartHoursAmOut').value='11:30';
 h.get('smartHoursPmIn').value='12:30';
 h.get('smartHoursPmOut').value='15:30';
 await h.get('smartHoursPmOut').fire('input');
 assert.equal(h.get('smartHoursSave').disabled,false);
 await h.get('smartHoursSave').fire('click');
 assert.deepEqual(h.writes[0].workdays,[0,2,4]);
 assert.deepEqual(h.writes[0].saturdayHours,base.saturdayHours);
});

test('invalid or incomplete hours cannot be saved',async()=>{
 const h=harness(base);
 await settle();
 h.get('smartHoursPreset').value='7-4';
 await h.get('smartHoursPreset').fire('change');
 h.get('smartHoursPmOut').value='11:00';
 await h.get('smartHoursPmOut').fire('input');
 assert.equal(h.get('smartHoursSave').disabled,true);
 assert.equal(h.writes.length,0);
});

test('default Monday-Friday schedules still work normally',async()=>{
 const h=harness({...base,workdays:[1,2,3,4,5]});
 await settle();
 h.get('smartHoursPreset').value='8-5';
 await h.get('smartHoursPreset').fire('change');
 await h.get('smartHoursSave').fire('click');
 assert.deepEqual(h.writes[0].workdays,[1,2,3,4,5]);
 assert.equal(h.writes[0].regularHours.PM_OUT,'17:00');
});

test('portal and service worker load matching repaired attendance script',()=>{
 require('./support/asset-contract').assertCachedAsset(portal,sw,'smart-attendance-overview.js',{minimumVersion:3});
 require('./support/asset-contract').assertCachedAsset(portal,sw,'smart-attendance-overview.js',{minimumVersion:3});
 assert.match(portal,/staff-lunch-ui\.js\?v=7/);
});
