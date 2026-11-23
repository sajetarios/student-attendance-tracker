'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const {hasPermission}=require('../role-permissions');
const {destinationForRole}=require('../login-routing');
const {manilaToday}=require('../principal-routes');
test('Principal role is independent, school-scoped and read-only',()=>{
 assert.equal(hasPermission('PRINCIPAL','principal.insights.view'),true);
 assert.equal(hasPermission('PRINCIPAL','teachers.manage'),false);
 assert.equal(hasPermission('PRINCIPAL','students.manage'),false);
 assert.equal(hasPermission('PRINCIPAL','attendance.corrections.manage'),false);
 assert.equal(destinationForRole('PRINCIPAL'),'/principal.html');
 assert.equal(manilaToday(new Date('2026-11-23T02:30:00Z')),'2026-11-23');
});
test('Principal dashboard never uses fake attendance or self-approval links',()=>{
 const html=read('public/principal.html'),js=read('public/principal-dashboard.js');
 const css=read('public/principal-dashboard.css'),server=read('principal-routes.js');
 for(const id of ['plTrend','plDepartment','plRange','plExport','plExplain','plDepartmentRows','plPriorityItems'])
  assert.ok(html.includes('id="'+id+'"'),id+' accessible');
 assert.ok(js.includes('/api/principal/overview?'));
 assert.ok(js.includes('activeStudents'));
 assert.ok(js.includes('windowPendingScans'));
 assert.ok(js.includes('selected dates'));
 assert.ok(js.includes('not a student attendance rate'));
 assert.ok(css.includes('@media(max-width:720px)'));
 assert.match(server,/requireSchoolRoles\('PRINCIPAL'\)/);
 assert.match(server,/requireSchoolRoles\('SCHOOL_ADMIN'\)/);
 assert.doesNotMatch(server,/Math\.random\(/);
 assert.doesNotMatch(js,/Math\.random\(/);
 assert.match(server,/No figures have been estimated/);
});
test('Principal access is an additive database role, not existing role promotion',()=>{
 const sql=read('migrations/077_principal_leadership_role.sql');
 const migrations=read('scripts/migrate.js');
 assert.ok(migrations.includes('077_principal_leadership_role.sql'));
 assert.ok(sql.includes("'PRINCIPAL'::TEXT"));
 assert.doesNotMatch(sql,/UPDATE school_users SET role/i);
 assert.ok(read('public/portal.html').includes('id="principalCreateForm"'));
 assert.ok(read('public/portal.html').includes('principal-admin-account.js?v=1'));
 assert.ok(read('public/portal.html').includes('id="principalAdminAccountCard"'));
 assert.ok(read('server.js').includes('registerPrincipalRoutes'));
});
