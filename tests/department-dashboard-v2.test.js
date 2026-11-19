'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {assertCachedAsset,assertCacheRevisionAtLeast}=require('./support/asset-contract');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = file => fs.readFileSync(path.join(__dirname,'..','public',file),'utf8');
const ui = source('department-dashboard-v2.js');
const css = source('department-dashboard-v2.css');
const portal = source('portal.html');
const sw = source('sw.js');
test('UI enhancement parses, is role-scoped, and never accesses attendance mutation APIs',()=>{
 assert.doesNotThrow(()=>new vm.Script(ui));
 assert.match(ui,/user\?\.role !== 'DEPARTMENT_HEAD'/);
 assert.match(ui,/window\.attendigoStaffIdentity\.then\(init\)/);
 assert.doesNotMatch(ui,/fetch\s*\(|\/api\/|method\s*:\s*['"](?:POST|PATCH|PUT|DELETE)/);
});
test('Existing overview, planner, monitoring and SARDO nodes are reused',()=>{
 for(const id of ['departmentHeadOverview','plannerDashboardWidget','sardoCard']) assert.match(ui,new RegExp(id));
 assert.match(ui,/\.dh-insights:not/);
 assert.match(ui,/\.dh-command-metrics/);
 assert.match(ui,/\.dh-monitor-heading/);
 assert.match(ui,/const sardo = \$\('sardoCard'\)/);
 assert.match(ui,/addToggle\(sardo, heading, children, 'SARDO Monitoring'\)/);
 assert.match(ui,/container\.insertBefore\(content, firstTarget\)/);
 assert.match(ui,/targets\.forEach\(el => \{ if \(el\) content\.append\(el\); \}\)/);
});
test('Only existing permission-checked navigation and coverage handlers are invoked',()=>{
 assert.match(ui,/source\.click\(\)/);
 assert.match(ui,/\[data-dh-go="teachers"\]/);
 assert.match(ui,/\[data-dh-coverage\]/);
 assert.match(ui,/source\.hidden \|\| source\.disabled/);
 assert.match(ui,/event\.key === 'Enter' \|\| event\.key === ' '/);
});
test('Accessible collapsible sections preserve content, and use expanded state',()=>{
 assert.match(ui,/aria-expanded/);
 assert.match(ui,/aria-controls/);
 assert.match(ui,/content\.hidden = !expanded/);
 assert.match(ui,/Department Overview/);
 assert.match(ui,/My Planner/);
 assert.match(ui,/Department Monitoring/);
 assert.match(ui,/SARDO Monitoring/);
});
test('Design is scoped, responsive, branded and dark-mode compatible',()=>{
 assert.match(css,/html\.attendigo-dh-v2/);
 assert.match(css,/var\(--ui-accent/);
 assert.match(css,/@media\(max-width:700px\)/);
 assert.match(css,/html\[data-ui-theme="dark"\]/);
 assert.match(css,/prefers-reduced-motion/);
});
test('Portal and service worker reference the same versioned assets',()=>{
 assertCachedAsset(portal,sw,'department-dashboard-v2.js',{minimumVersion:1});
 assertCachedAsset(portal,sw,'department-dashboard-v2.css',{minimumVersion:1});
 assertCacheRevisionAtLeast(sw,250);
});
