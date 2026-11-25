'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {mergeSchoolForm48Defaults}=require('../form48-bulk-routes');
const {documentIdentity,matiFields,drawMatiForm}=require('../mati-locator-slip');
test('School Identity and DTR verifier use independent existing fields',()=>{
 const html=fs.readFileSync('public/portal.html','utf8'),js=fs.readFileSync('public/portal.js','utf8'),ui=fs.readFileSync('public/form48-bulk-ui.js','utf8');
 for(const id of ['form48ApprovedBy','form48ApprovedPosition','form48VerifiedBy','form48VerifiedPosition','form48SaveSignatories','schoolHeadSaveSignatory'])assert.equal(html.split('id="'+id+'"').length,2,id);
 const identity=html.slice(html.indexOf('id="schoolHeadSignatoryCard"'),html.indexOf('id="documentBrandingCard"'));
 const dtr=html.slice(html.indexOf('id="form48SchoolSignatories"'),html.indexOf('id="form48FilterForm"'));
 assert.match(identity,/School Head Name/);assert.match(identity,/form48ApprovedBy/);assert.doesNotMatch(identity,/form48VerifiedBy/);
 assert.match(dtr,/form48VerifiedBy/);assert.doesNotMatch(dtr,/form48ApprovedBy/);
 assert.match(js,/const useIdentitySignatories = admin && schoolEntitlements\?\.features\?\.custom_branding !== false/);
 assert.match(js,/signatoryHome\.after\(signatoryBlock\)/);
 assert.match(html,/id="form48SignatoryShortcut"/);
 assert.match(ui,/savePair\('head'\)/);assert.match(ui,/savePair\('verifier'\)/);
});
test('school head and verifier are independently inherited by DTR',()=>{
 const saved={approvedBy:'Legacy Head',approvedPosition:'Principal I',verifiedBy:'Legacy Verifier',verifiedPosition:'Clerk'};
 const head=mergeSchoolForm48Defaults(saved,{approvedBy:'Current Head',approvedPosition:'Principal II'});
 assert.equal(head.approvedBy,'Current Head');assert.equal(head.verifiedBy,'Legacy Verifier');
 const verifier=mergeSchoolForm48Defaults(saved,{verifiedBy:'Current Verifier',verifiedPosition:'Administrative Officer'});
 assert.equal(verifier.approvedBy,'Legacy Head');assert.equal(verifier.verifiedBy,'Current Verifier');
});
test('Mati layout is explicitly school-selected, never platform-wide',()=>{
 assert.equal(documentIdentity({},{}).layout,'ANNEX_E');
 assert.equal(documentIdentity({locatorSlipLayout:'MATI'},{}).layout,'MATI');
 const {parseSettings}=require('../school-document-branding');
 assert.throws(()=>parseSettings({layout:'AUTO',locatorSlipLayout:'INVALID'}),/Locator Slip/);
 assert.equal(parseSettings({layout:'AUTO',locatorSlipLayout:'MATI'}).locatorSlipLayout,'MATI');
});
const identity=documentIdentity({locatorSlipLayout:'MATI',region:'XI',division:'DepEd - Division of the City of Mati'},{approvedBy:'Juan A. Dela Cruz, EdD',approvedPosition:'Principal II'});
const data={staffName:'Maria Dela Cruz',position:'Teacher III',schoolName:'Sample National High School',purpose:'Submission of school reports',destination:'Schools Division Office',submittedAt:'2026-11-25T08:00:00+08:00',startsAt:'2026-11-26T08:00:00+08:00',endsAt:'2026-11-26T12:00:00+08:00'};
test('Mati form maps filing date and school head; no requester or DH printed in left signature area',()=>{
 const fields=matiFields(data,identity);
 assert.equal(fields.head,'Juan A. Dela Cruz, EdD');
 assert.notEqual(fields.filed,fields.event);
 assert.throws(()=>matiFields(data,{...identity,schoolHeadName:''}),/Complete head/);
 assert.throws(()=>matiFields({...data,endsAt:'2026-11-27T12:00:00+08:00'},identity),/same-day/);
 const {createCanvas}=require('@napi-rs/canvas');
 const c=createCanvas(596,842),ctx=c.getContext('2d'),printed=[];
 const proxy=new Proxy(ctx,{get(t,k){if(k==='fillText')return (...args)=>{printed.push(args[0]);t.fillText(...args);};const v=t[k];return typeof v==='function'?v.bind(t):v;},set(t,k,v){t[k]=v;return true;}});
 drawMatiForm(proxy,fields,null);
 assert.equal(printed.filter(x=>x===data.staffName).length,1);
 assert.ok(printed.includes(fields.head));assert.ok(printed.includes(fields.headPosition));
 assert.ok(printed.includes('CERTIFICATION'));assert.ok(printed.includes('Recommending Approval'));
 assert.ok(c.toBuffer('image/png').length>10000);
});
test('OB identity snapshot is appended to audit and legacy approved forms retain Annex E',()=>{
 const routes=fs.readFileSync('staff-ob-routes.js','utf8');
 assert.match(routes,/a\.details \? 'locatorIdentity'/);
 assert.match(routes,/data\.status==='APPROVED'\?\(data\.approvedIdentity\|\|\{layout:'ANNEX_E'\}\)/);
 assert.match(routes,/locatorIdentity:require\('\.\/mati-locator-slip'\)\.documentIdentity/);
});
