'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = name => fs.readFileSync(path.join(__dirname,'../public',name),'utf8');

test('night stylesheet is loaded after shared UI for all dashboard roles and cached for offline use',()=>{
 for(const name of ['portal.html','parent-portal.html','student-portal.html']){
   const markup=source(name);
   assert.ok(markup.indexOf('/dashboard-night.css?v=1') > markup.indexOf('/dashboard-ui.css?v=4'), name);
   assert.match(markup,/dashboard-icons.js\?v=3/);
 }
 assert.match(source('sw.js'),/dashboard-night.css\?v=1/);
 assert.match(source('sw.js'),/school-attendance-shell-v59-night-contrast/);
});
test('dark styles cover the previously white School Admin shortcuts and dark text',()=>{
 const css=source('dashboard-night.css');
 for(const name of ['.admin-dashboard-action','.admin-dashboard-action strong','.admin-dashboard-action small',
 '.admin-dashboard-intro h3','.admin-dashboard-intro p','.admin-dashboard-footnote',
 '.quick-card .quick-action','.quick-action strong','.quick-action small',
 '.scope-note']){
   assert.ok(css.includes(name),name);
 }
 assert.match(css,/--ui-text:#f0f5ff/);
 assert.match(css,/--ui-muted:#b9c6da/);
 assert.match(css,/var\(--brand/);
 assert.doesNotMatch(css,/style\.setProperty\('--brand'/);
});
test('reusable SVGs replace placeholder glyphs on actionable School Admin cards',()=>{
 const markup=source('portal.html'),icons=source('dashboard-icons.js');
 for(const name of ['users','shield','building','graduation','calendar','report','chevron']){
   assert.ok(icons.includes(name+":"),name);
 }
 assert.match(markup,/admin-action-icon" data-ui-icon="users"/);
 assert.match(markup,/admin-action-icon" data-ui-icon="shield"/);
 assert.match(markup,/admin-action-icon" data-ui-icon="building"/);
 assert.match(icons,/querySelectorAll\('\.admin-dashboard-action\[data-admin-go\]'\)/);
});
