'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const code = fs.readFileSync(path.join(__dirname,'..','public','attendance-sync-center.js'),'utf8');

function harness(userRole) {
  const label={textContent:'Checking synchronization…'};
  const badge={textContent:'',hidden:true};
  const listeners={};
  const triggerEvents={};
  const trigger={
    hidden:false, dataset:{}, classList:{add(){}},
    setAttribute(name,value){this[name]=value;},
    addEventListener(name,handler){triggerEvents[name]=handler;},
    querySelector(selector){
      if(selector==='.asc-header-label')return label;
      if(selector==='.asc-header-badge')return badge;
      return null;
    }
  };
  const element = () => ({
    textContent:'', hidden:false, disabled:false, dataset:{},children:[],
    setAttribute(){},addEventListener(){},
    replaceChildren(...items){this.children=items;},
    append(...items){this.children.push(...items);}
  });
  const dialog={
    ...element(),open:false,
    querySelector(){return element();},
    showModal(){this.open=true;},
    close(){this.open=false;}
  };
  const ids=Object.fromEntries([
    'ascNetwork','ascMetrics','ascQueueCount','ascLastConfirmed','ascSyncNow',
    'ascFeedback','ascQueueList','ascCloudSection','ascCloudMetrics',
    'ascCloudReview','ascCloudState'
  ].map(id=>[id,element()]));
  const children=[];
  const document={
    readyState:'complete', body:{append(node){children.push(node);}},
    documentElement:{dataset:{}},
    getElementById(id){return id==='connectionStatus'?trigger:(ids[id]||null);},
    querySelector(){return null;},
    createElement(tag){return tag==='dialog'?dialog:element();},
    addEventListener(){}
  };
  const session=new Map([
    ['schoolAttendance.user',JSON.stringify({schoolId:'school-1',userId:'user-1',role:userRole})],
    ['schoolAttendance.accessToken','fake-token']
  ]);
  const navigator={onLine:true};
  const window={
    AttendigoOffline:{
      snapshot:async()=>({pending:0,waiting:0,needsReview:0,lastConfirmedAt:null}),
      pending:async()=>[]
    },
    addEventListener(name,handler){listeners[name]=handler;}
  };
  vm.runInNewContext(code,{
    window, document, navigator, sessionStorage:{getItem:key=>session.get(key)||null},
    URLSearchParams, Intl, Date, Promise, JSON, String, Number, Set, Map, Error,
    fetch:async()=>({ok:true,json:async()=>({enabled:false,configured:false,pendingCount:0,needsReviewCount:0})})
  });
  return {window,document,navigator,trigger,label,badge,listeners,triggerEvents,dialog,children};
}

test('School Admin header stays Attendance sync after cloud configuration loads and opens one dialog', async()=>{
  const h=harness('SCHOOL_ADMIN');
  assert.ok(h.triggerEvents.click,'existing header button must open Sync Center');
  assert.equal(h.children.length,1,'only Sync Center dialog, not a duplicate floating button');
  h.window.AttendigoSyncCenter.setCloudStatus({
    configured:false,enabled:false,connectionStatus:'NOT_CONFIGURED',needsReviewCount:0
  });
  assert.equal(h.label.textContent,'Attendance sync');
  assert.equal(h.trigger.dataset.state,'idle');
  assert.equal(h.badge.hidden,true);
  h.window.AttendigoSyncCenter.setCloudStatus({
    configured:true,enabled:false,connectionStatus:'NOT_CONNECTED',needsReviewCount:0
  });
  assert.equal(h.label.textContent,'Attendance sync','Disabled cloud forwarding must not rename device Sync Center');
  assert.equal(h.trigger.dataset.state,'idle');
  h.window.AttendigoSyncCenter.setCloudStatus(null,'Cloud status request failed');
  assert.equal(h.label.textContent,'Attendance sync','A cloud status error must be visible in the dialog, not replace the header');
  assert.equal(h.trigger.dataset.state,'idle');
  h.window.AttendigoSyncCenter.setCloudStatus({
    configured:true,enabled:true,connectionStatus:'CONNECTED',needsReviewCount:2
  });
  assert.equal(h.label.textContent,'2 cloud conflicts');
  assert.equal(h.badge.textContent,'2');
  assert.equal(h.trigger.dataset.state,'review');
  assert.equal(h.badge.hidden,false);
  await h.triggerEvents.click();
  assert.equal(h.dialog.open,true,'header opens the shared Sync Center');
});

test('Teachers see only their device status, never administrator cloud settings',()=>{
  const h=harness('TEACHER');
  h.window.AttendigoSyncCenter.setCloudStatus({
    configured:false,enabled:false,needsReviewCount:9
  });
  assert.equal(h.label.textContent,'Attendance sync');
  h.listeners['attendigo-offline-status']({detail:{
    pending:3,waiting:2,needsReview:1
  }});
  assert.match(h.label.textContent,/record needs review/);
  assert.equal(h.badge.textContent,'3');
  assert.equal(h.trigger.dataset.state,'review');
  assert.doesNotMatch(h.label.textContent,/Cloud sync not configured/);
});

test('Super Admin gets no school-scoped synchronization header control',()=>{
  const h=harness('SUPER_ADMIN');
  assert.equal(h.trigger.hidden,true);
  assert.equal(h.children.length,0);
  assert.equal(h.triggerEvents.click,undefined);
});
