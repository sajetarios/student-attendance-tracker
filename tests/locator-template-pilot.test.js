'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {fields,parseUpload,validateMapping,overlay}=require('../locator-template-pilot');
const {buildPrintPdf}=require('../locator-slip-print-pdf');
const {renderCustomLocatorPilot}=require('../locator-slip-preview');
const {createCanvas}=require('@napi-rs/canvas');
const valid=()=>Object.fromEntries(fields.filter(f=>f[3]).map((f,i)=>[f[0],[.18,.12+i*.09,.65,.065]]));
test('pilot rejects invalid PDF uploads and oversized data',()=>{
 const pdf=Buffer.from('%PDF-1.4\n');
 assert.deepEqual(parseUpload(pdf.toString('base64')),pdf);
 assert.throws(()=>parseUpload('not-a-pdf'),/Choose/);
 assert.throws(()=>parseUpload(Buffer.alloc(2*1024*1024+1).toString('base64')),/Choose/);
 assert.throws(()=>parseUpload(Buffer.from('Hello').toString('base64')),/Choose/);
});
test('pilot requires valid disjoint boxes for required fields',()=>{
 const mapping=valid();
 assert.equal(Object.keys(validateMapping(mapping)).length,6);
 assert.throws(()=>validateMapping({...mapping,name:[0,0,.001,.001]}),/larger/);
 assert.throws(()=>validateMapping({...mapping,name:mapping.position}),/overlap/);
 assert.throws(()=>validateMapping({...mapping,name:[.9,.1,.2,.1]}),/inside/);
 assert.throws(()=>validateMapping({...mapping,unknown:[.1,.1,.1,.1]}),/Unknown/);
 delete mapping.name;assert.throws(()=>validateMapping(mapping),/Employee name/);
});
test('pilot detects occupied spaces and text that cannot fit',()=>{
 const canvas=createCanvas(596,842),ctx=canvas.getContext('2d');
 ctx.fillStyle='#fff';ctx.fillRect(0,0,596,842);
 ctx.fillStyle='#000';ctx.fillRect(110,105,100,30);
 assert.throws(()=>overlay(ctx,596,842,validateMapping(valid())),/existing content/);
 ctx.fillStyle='#fff';ctx.fillRect(0,0,596,842);
 assert.throws(()=>overlay(ctx,596,842,validateMapping({...valid(),name:[.18,.12,.013,.01]})),/does not fit|larger/);
});
test('blank PDF and populated sample render; output remains a conventional single-page PDF',async()=>{
 const blank=buildPrintPdf({rgb:Buffer.from([255,255,255]),width:1,height:1,pageWidth:595.44,pageHeight:841.68});
 const preview=await renderCustomLocatorPilot(blank,null,false);
 assert.equal(preview.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 const sample=await renderCustomLocatorPilot(blank,validateMapping(valid()),false);
 assert.equal(sample.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.notDeepEqual(sample,preview);
 const pdf=await renderCustomLocatorPilot(blank,validateMapping(valid()),true);
 assert.match(pdf.toString('latin1'),/^%PDF-1\.4/);
 assert.ok(pdf.length>10000);
 const js=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=js.getDocument({data:new Uint8Array(pdf),verbosity:0});
 try{assert.equal((await task.promise).numPages,1);}finally{await task.destroy();}
});
test('pilot is admin-only and does not modify current templates, approval or DTR records',()=>{
 const server=fs.readFileSync('locator-template-pilot.js','utf8');
 const ui=fs.readFileSync('public/locator-template-pilot.js','utf8');
 const html=fs.readFileSync('public/portal.html','utf8');
 assert.match(server,/requireSchoolRoles\('SCHOOL_ADMIN'\),canCustomizeBranding/);
 assert.match(server,/SAMPLE – NOT FOR OFFICIAL USE/);
 assert.doesNotMatch(server,/pool\.query|INSERT INTO|UPDATE schools/);
 assert.match(ui,/No template has been saved or activated/);
 assert.match(html,/Try guided setup/);
 assert.match(html,/locator-template-pilot\.js\?v=1/);
 assert.match(html,/value="ANNEX_E"/);assert.match(html,/value="MATI"/);
});
