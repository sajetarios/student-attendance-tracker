'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const portal=fs.readFileSync('public/portal.html','utf8');
const js=fs.readFileSync('public/portal.js','utf8');
const ob=fs.readFileSync('public/staff-ob-ui.js','utf8');
const sw=fs.readFileSync('public/sw.js','utf8');
const server=fs.readFileSync('server.js','utf8');

test('Official Business has a dedicated navigable portal view',()=>{
 assert.match(portal,/id="officialBusinessNav"[^>]*data-view="officialBusiness"/);
 assert.match(portal,/id="officialBusinessView"/);
 assert.match(js,/officialBusinessView/);
 assert.match(js,/official-business:open/);
 assert.match(js,/officialBusinessNav'\)\.hidden = !\(teacher \|\| admin \|\| departmentHead\)/);
});
test('all three staff roles have Official Business access',()=>{
 assert.match(js,/if \(role === 'SCHOOL_ADMIN'\) return \[[^\n]*'officialBusiness'/);
 assert.match(js,/if \(role === 'DEPARTMENT_HEAD'\) return \[[^\n]*'officialBusiness'/);
 assert.match(js,/const views = \[[^\n]*'officialBusiness'/);
 assert.match(ob,/\['TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN'\]/);
});
test('OB endpoints registered and cached without changing student access',()=>{
 assert.match(server,/registerStaffObRoutes\(app, pool, \{ authenticateSchoolClient, requireSchoolRoles \}\)/);
 assert.match(portal,/staff-ob-ui\.js\?v=4/);
 assert.match(sw,/staff-ob-ui\.js\?v=4/);
 assert.match(portal,/staff-ob\.css\?v=1/);
 assert.match(sw,/staff-ob\.css\?v=1/);
 assert.match(js,/if \(role === 'GATE_KEEPER'\) return \['students'\]/);
});
