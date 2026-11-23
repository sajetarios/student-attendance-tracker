'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const ui=fs.readFileSync(path.join(root,'public/staff-leave-ui.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public/staff-leave-ui.css'),'utf8');
const html=fs.readFileSync(path.join(root,'public/portal.html'),'utf8');
const sw=fs.readFileSync(path.join(root,'public/sw.js'),'utf8');

test('gate review date and Check date action remain a single grouped control',()=>{
 assert.match(ui,/class="leave-overlap-header"/);
 assert.match(ui,/class="leave-overlap-controls"/);
 assert.match(ui,/class="leave-overlap-date"/);
 assert.match(ui,/class="leave-btn leave-check-overlaps"/);
 const start=ui.indexOf('class="leave-overlap-controls"');
 const end=ui.indexOf('class="leave-overlap-list"',start);
 assert.ok(start>0 && end>start);
 const group=ui.slice(start,end);
 assert.match(group,/class="leave-overlap-date"/);
 assert.match(group,/class="leave-btn leave-check-overlaps"/);
 assert.doesNotMatch(group,/leave-section-title/);
});
test('gate date action, tabs and dialog header have explicit responsive overflow guards',()=>{
 assert.match(css,/\.leave-overlap-header\s*\{/);
 assert.match(css,/grid-template-columns:minmax\(0,1fr\) max-content/);
 assert.match(css,/\.leave-overlap-controls\s*\{[\s\S]*?flex-wrap:nowrap/);
 assert.match(css,/@media\(max-width:850px\)[\s\S]*?\.leave-overlap-header\{grid-template-columns:minmax\(0,1fr\)\}/);
 assert.match(css,/@media\(max-width:460px\)[\s\S]*?\.leave-overlap-controls\{display:grid;grid-template-columns:minmax\(0,1fr\);width:100%\}/);
 assert.match(css,/\.leave-tabs\{flex-wrap:wrap/);
 assert.match(css,/\.leave-header > div:first-child\{min-width:0/);
});
test('cache versions match, preventing iPad from retaining overlapping old controls',()=>{
 assert.match(html,/\/staff-leave-ui\.js\?v=7/);
 assert.match(html,/\/staff-leave-ui\.css\?v=4/);
 assert.match(sw,/"\/staff-leave-ui\.js\?v=7"/);
 assert.match(sw,/"\/staff-leave-ui\.css\?v=4"/);
 assert.match(sw,/attendigo-v314-sf1-auto-grade/);
});
