'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {assertCachedAsset,assertCacheRevisionAtLeast}=require('./support/asset-contract');
const css=fs.readFileSync('public/app-dialog.css','utf8');
const page=fs.readFileSync('public/portal.html','utf8');
const sw=fs.readFileSync('public/sw.js','utf8');

test('mobile dialogs reserve safe areas without changing confirmation logic',()=>{
 assert.match(css, /@media \(max-width: 560px\)/);
 for(const side of ['top','right','bottom','left'])
  assert.ok(css.includes('env(safe-area-inset-'+side+', 0px)'),side);
 assert.match(css, /max-height:\s*min\(85dvh, calc\(100dvh - 24px/);
 assert.match(css, /\.app-dialog-card\s*\{[^}]*overflow: auto/s);
 assert.match(css, /\.app-dialog-actions\s*\{[^}]*display: flex/s);
});
test('all staff dashboards and offline shell reference the same refreshed dialog CSS',()=>{
 assert.equal(assertCachedAsset(page,sw,'app-dialog.css',{minimumVersion:2}),'/app-dialog.css?v=2');
 assertCacheRevisionAtLeast(sw,269);
});
