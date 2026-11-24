'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {assertCachedAsset,assertCacheRevisionAtLeast}=require('./support/asset-contract');
const css=fs.readFileSync('public/my-gate-insights.css','utf8');
const html=fs.readFileSync('public/portal.html','utf8');
const sw=fs.readFileSync('public/sw.js','utf8');
test('personal attendance overrides desktop table minimum widths at every mobile nesting level',()=>{
 assert.match(css,/#myGateAttendanceView \.my-gate-table-wrap \.my-gate-table,[\s\S]*?\.my-gate-table tbody td\s*\{[\s\S]*?min-width:0!important;max-width:100%!important/);
 assert.match(css,/:is\(\.my-gate-dtr-grid,\.my-gate-gate-grid\)\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
 assert.match(css,/:is\(\.my-gate-dtr-grid,\.my-gate-gate-grid\)>div\s*\{[^}]*min-width:0!important/);
});
test('mobile native dates are contained and stack on narrow phones',()=>{
 assert.match(css,/\.my-gate-filters input\[type=date\]\s*\{[^}]*box-sizing:border-box!important;[^}]*min-inline-size:0!important;max-width:100%!important/);
 assert.match(css,/@media screen and \(max-width:420px\)\s*\{[^}]*grid-template-columns:minmax\(0,1fr\)!important/);
 assertCachedAsset(html,sw,'my-gate-insights.css',{minimumVersion:4});
 assertCacheRevisionAtLeast(sw,367);
});
