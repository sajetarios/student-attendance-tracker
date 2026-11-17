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
  const dialog={
    open:false,
    setAttribute(){}, addEventListener(){},
    querySelector(){return {addEventListener(){}};},
    showModal(){this.open=true;},
    close(){this.open=false;}
  };
  const children=[];
  const document={
    readyState:'complete', body:{append(node){children.push(node);}},
    documentElement:{dataset:{}},
    getElementById(id){return id==='connectionStatus'?trigger:null;},
    querySelector(){return null;},
    createElement(tag){if(tag==='dialog')return dialog;throw Error('Unexpected injected control: '+tag);},
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
    fetch:async()=>{throw Error('External fetch must not happen while Sync Center is closed');}
  });
  return {window,document,navigator,trigger,label,badge,listeners,triggerEvents,dialog,children};
}

test('School Admin sees existing cloud-not-configured status and opens one header dialog', async()=>{
  const h=harness('SCHOOL_ADMIN');
  assert.ok(h.triggerEvents.click,'existing header button must open Sync Center');
  assert.equal(h.children.length,1,'only Sync Center dialog, not a duplicate floating button');
  h.window.AttendigoSyncCenter.setCloudStatus({
    configured:false,enabled:false,connectionStatus:'NOT_CONFIGURED',needsReviewCount:0
  });
  assert.equal(h.label.textContent,'Cloud sync not configured');
  assert.equal(h.trigger.dataset.state,'warning');
  assert.equal(h.badge.hidden,true);
  h.window.AttendigoSyncCenter.setCloudStatus({
    configured:true,enabled:true,connectionStatus:'CONNECTED',needsReviewCount:2
  });
  assert.equal(h.label.textContent,'2 cloud conflicts');
  assert.equal(h.badge.textContent,'2');
  assert.equal(h.trigger.dataset.state,'review');
  assert.equal(h.badge.hidden,false);
  h.triggerEvents.click();
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
