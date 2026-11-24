'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..','public',name),'utf8');
test('layout styles load after page CSS on all key portals',()=>{
 for(const name of ['portal.html','principal.html','student-portal.html','parent-portal.html','portal-login.html','gate-offline.html','offline-sheet.html','student-qr-offline.html']){
  const html=read(name);
  assert.match(html,/<link rel="stylesheet" href="\/attendigo-layout-density\.css\?v=1">\s*<\/head>/);
 }
 const sw=read('sw.js');
 assert.ok(Number(sw.match(/attendigo-v(\d+)-/)?.[1])>=376);
 assert.ok(sw.includes("'/attendigo-layout-density.css'"));
 assert.ok(sw.split('const SHELL')[0].includes('"/attendigo-layout-density.css?v=1"'));
});
test('metric icons are in normal flow, not positioned over text',()=>{
 const css=read('attendigo-layout-density.css');
 assert.match(css,/grid-template-columns:minmax\(0,1fr\) auto/);
 assert.match(css,/position:static!important;grid-column:2;grid-row:1/);
 assert.match(css,/grid-column:1;grid-row:1;align-self:center/);
 assert.match(css,/@media screen/);
});
test('compact roster preserves desktop columns and role-specific details',()=>{
 const js=read('portal.js'),css=read('attendigo-layout-density.css');
 assert.ok(js.includes("classList.toggle('roster-mobile-compact', !teacher)"));
 assert.ok(js.includes('class="roster-mobile-details"'));
 assert.ok(js.includes('${admin ? `<dt>Parent / guardian'));
 assert.ok(js.includes('data-label="Student ID"'));
 assert.ok(js.includes('data-label="Parent / guardian"'));
 assert.match(css,/\.roster-mobile-summary \{display:none;\}/);
 assert.match(css,/@media screen and \(max-width:700px\)/);
 assert.match(css,/\.roster-mobile-details\[open\]/);
 assert.match(css,/\.student-actions-dropdown\[open\]>.student-row-actions \{position:static!important/);
});
