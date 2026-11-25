'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('offline roster uses a consistent two-column grid at mobile widths',()=>{
 const html=read('public/offline-sheet.html');
 const css=html.split('<style id="offlineCompactRoster">')[1].split('</style>')[0];
 assert.match(css,/#rows>\.row\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(112px,132px\)/);
 assert.match(css,/#rows>\.row>span\{min-width:0;white-space:normal;overflow-wrap:anywhere;font-size:16px/);
 assert.match(css,/#rows>\.row>select\{width:100%;min-width:0;max-width:100%;min-height:44px/);
 assert.match(css,/@media\(max-width:380px\).*grid-template-columns:minmax\(0,1fr\) 112px/);
 assert.ok(html.indexOf('id="offlineCompactRoster"')>html.indexOf('/attendigo-layout-density.css'));
});
test('compact action bar retains all existing attendance controls and safe area',()=>{
 const html=read('public/offline-sheet.html');
 assert.match(html,/<div class="ow-sheet-actions"><button id="save">Save attendance<\/button><button id="sync">Sync attendance<\/button><button id="lock"/);
 assert.match(html,/\.ow-sheet-actions\{position:sticky;bottom:0/);
 assert.match(html,/env\(safe-area-inset-bottom,0px\)/);
 assert.ok(read('public/sw.js').includes('/offline-sheet.html'));
});
