'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

test('dashboard polish loads after shared theme across role entry points',()=>{
 for(const name of ['portal','student-portal','parent-portal']){
  const markup=read('public/'+name+'.html');
  assert.ok(markup.includes('/dashboard-polish.css?v=1'),name);
  assert.ok(markup.indexOf('/dashboard-polish.css?v=1')>markup.indexOf('/dashboard-night.css?v=1'),name);
  assert.ok(markup.includes('/dashboard-icons.js?v=4'),name);
 }
 assert.match(read('public/sw.js'),/school-attendance-shell-v60-dashboard-polish/);
 assert.match(read('public/sw.js'),/dashboard-polish.css\?v=1/);
});
test('sidebar appearance is brand-derived and collapse control is accessible and reversible',()=>{
 const css=read('public/dashboard-polish.css');
 const html=read('public/portal.html');
 const js=read('public/portal.js');
 const icons=read('public/dashboard-icons.js');
 assert.match(css,/background:\s*radial-gradient/);
 assert.match(css,/var\(--brand/);
 assert.match(css,/#sidebarCollapseButton/);
 assert.match(html,/data-ui-icon="panel-collapse"/);
 assert.match(js,/panel-expand/);
 assert.match(js,/Expand menu/);
 assert.match(js,/aria-pressed/);
 assert.match(icons,/'panel-collapse'/);
 assert.match(icons,/'panel-expand'/);
});
test('role and department are distinct readable lines with efficient status width',()=>{
 const css=read('public/dashboard-polish.css');
 const html=read('public/portal.html');
 const js=read('public/portal.js');
 assert.match(css,/\.security-role-cell/);
 assert.match(css,/text-overflow:ellipsis/);
 assert.match(css,/\.security-accounts-table :is\(th,td\):nth-child\(3\)\{width:10%\}/);
 assert.match(html,/<colgroup><col style="width:17%"><col style="width:23%"><col style="width:10%"/);
 assert.match(js,/class="security-role-cell"/);
 assert.match(js,/class="department-line"/);
 assert.match(js,/data-reset-staff-password/);
 assert.match(js,/data-revoke-staff-sessions/);
});
test('shortcut typography is legible for desktop and mobile in both themes',()=>{
 const css=read('public/dashboard-polish.css');
 assert.match(css,/font-size:17px!important/);
 assert.match(css,/font-size:14px!important/);
 assert.match(css,/font-size:16px!important/);
 assert.match(css,/font-size:13px!important/);
 assert.match(css,/data-ui-theme="dark"/);
});
