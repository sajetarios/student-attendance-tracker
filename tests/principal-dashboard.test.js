'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {ROLE_PERMISSIONS,hasPermission}=require('../role-permissions');
const {destinationForRole}=require('../login-routing');
const {scopeParams,validSchoolDate}=require('../principal-overview-routes');
const read=f=>fs.readFileSync(f,'utf8');

test('Principal has dedicated login destination and read-only permissions',()=>{
 assert.equal(destinationForRole('PRINCIPAL'),'/principal.html');
 assert.equal(hasPermission('PRINCIPAL','principal.oversight.view'),true);
 for(const denied of ['teachers.manage','schedules.manage','students.manage',
  'devices.manage','attendance.corrections.manage','sf2.official.generate'])
  assert.equal(hasPermission('PRINCIPAL',denied),false,'must not grant '+denied);
 assert.equal(destinationForRole('SCHOOL_ADMIN'),'/portal.html');
 assert.equal(hasPermission('SCHOOL_ADMIN','teachers.manage'),true);
});
test('Principal report dates, history and department scope are validated before SQL',()=>{
 const today='2026-11-23';
 assert.deepEqual(scopeParams({}, {},today),{schoolDate:today,range:7,departmentId:null});
 assert.ok(scopeParams({}, {days:'14',date:'2026-11-20'},today));
 assert.ok(scopeParams({}, {days:'30'},today));
 for(const query of [
  {date:'2026-11-24'},{date:'2025-01-01'},{date:'2026-02-30'},
  {days:'1'},{days:'365'},{departmentId:'not-a-uuid'}
 ])assert.equal(scopeParams({},query,today),null,JSON.stringify(query));
 assert.equal(validSchoolDate('2024-02-29','2024-03-01'),true);
});
test('Principal database migration is additive and account creation is school-admin controlled',()=>{
 const migration=read('migrations/077_principal_leadership_role.sql');
 const migrate=read('scripts/migrate.js');
 const server=read('server.js');
 assert.match(migration,/ADD CONSTRAINT school_users_role_check/);
 assert.match(migration,/'PRINCIPAL'::TEXT/);
 assert.doesNotMatch(migration,/UPDATE school_users SET role|DELETE FROM staff_attendance_events|UPDATE staff_attendance_events/);
 assert.match(migrate,/077_principal_leadership_role.sql/);
 assert.match(server,/allowedRoles = \['TEACHER', 'DEPARTMENT_HEAD', 'GATE_KEEPER', 'PRINCIPAL'\]/);
 assert.match(server,/Department Heads can create teacher accounts only/);
 assert.match(server,/registerPrincipalRoutes\(app, pool,/);
});
test('Principal overview is read-only, tenant-bound and honest about verified evidence',()=>{
 const routes=read('principal-overview-routes.js');
 assert.match(routes,/app.get\('\/api\/principal\/overview'/);
 assert.match(routes,/requireSchoolRoles\('PRINCIPAL','SCHOOL_ADMIN'\)/);
 assert.doesNotMatch(routes,/app\.(post|put|patch|delete)\(/);
 assert.match(routes,/req.auth.schoolId/);
 assert.match(routes,/e.verification_status='VERIFIED'/);
 assert.match(routes,/e.event_kind='DTR_SLOT'/);
 assert.match(routes,/COUNT\(DISTINCT e.student_id\)/);
 assert.match(routes,/e.attendance_scope IN \('CLASS','ADVISORY'\)/);
 assert.match(routes,/No estimates or substitute figures are shown/);
 assert.doesNotMatch(routes,/attendanceRate|tardinessRate|predictedAbsence|Math.random/);
 assert.match(routes,/staffRowsLimited/);
});
test('Principal leadership interface has real interaction and source definitions',()=>{
 const html=read('public/principal.html');
 const js=read('public/principal-dashboard.js');
 const css=read('public/principal-dashboard.css');
 const sw=read('public/sw.js');
 for(const id of ['reportDate','departmentFilter','periodFilter','refreshDashboard',
  'trendChart','departmentPreview','staffTable','staffSearch','staffStatus',
  'downloadStaff','priorityBreakdown','definitionList','feedback','generatedAt'])
  assert.ok(html.includes('id="'+id+'"'),'missing interactive control '+id);
 assert.ok(js.includes("'/api/principal/overview?'"));
 assert.match(js,/getSession\(\)/);
 assert.match(js,/if\(response.status===401\)/);
 assert.match(js,/staffRowsLimited/);
 assert.match(js,/data-jump/);
 assert.match(js,/downloadCsv/);
 assert.match(js,/aria-label/);
 assert.match(js,/No verified punch/);
 assert.match(js,/Not a punctuality or absence determination/);
 assert.match(css,/@media\(max-width:470px\)/);
 assert.match(css,/prefers-color-scheme:dark/);
 assert.match(sw,/attendigo-v\d+-/);
});

test('Principal action inbox attributes pending requests by school department without exposing leave reasons',()=>{
 const routes=read('principal-overview-routes.js');
 const html=read('public/principal.html');
 const js=read('public/principal-dashboard.js');
 const css=read('public/principal-dashboard.css');
 assert.match(routes,/approvalDepartments:approvalDepartmentRows\.rows\.map/);
 assert.match(routes,/r\.school_id=\$1/);
 assert.match(routes,/COALESCE\(r\.department_id,u\.department_id\)/);
 assert.match(routes,/FROM staff_official_business_requests r/);
 assert.match(routes,/COALESCE\(d\.department_name,'Unassigned \/ unavailable department'\)/);
 assert.match(routes,/departmentName:r\.departmentName,total:integer\(r\.total\)/);
 assert.ok(html.includes('id="actionInboxDepartmentSummary"'));
 assert.ok(js.includes('renderPriorities(data)'));
 assert.ok(js.includes('r.kind===kind&&r.status===stage'));
 assert.ok(js.includes("item.addEventListener('click',()=>{"));
 assert.ok(js.includes("$('departmentFilter').value=row.departmentId"));
 assert.ok(js.includes('Show all departments'));
 assert.match(css,/\.priority-department-row/);
 assert.doesNotMatch(routes,/app\.(post|put|patch|delete)\(/);
});

test('Teacher Recognition redesign keeps evidence source contracts and responsive empty states',()=>{
 const html=read('public/principal.html');
 const css=read('public/principal-dashboard.css');
 const js=read('public/principal-dashboard.js');
 const routes=read('principal-overview-routes.js');
 for(const id of ['principalRecognitionTitle','earlyArrivalsSubtitle','earlyArrivalsCount',
  'earlyArrivalsList','principalWatchPeriod','principalWatchCount','principalWatchNomineeList']){
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,'duplicate or missing '+id);
 }
 assert.match(html,/class="recognition-hero"/);
 assert.match(html,/class="principal-recognition-grid"/);
 assert.match(html,/<details class="principal-recognition-watch" open>/);
 assert.match(html,/Recognition consideration only—not an official award or punctuality finding/);
 assert.match(html,/Missing scans do not establish absence/);
 assert.match(css,/\.principal-recognition \.principal-recognition-grid\s*\{/);
 assert.match(css,/@media\(max-width:920px\)/);
 assert.match(css,/@media\(max-width:600px\)/);
 assert.match(css,/:root\[data-theme="dark"\] \.principal-recognition/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(js,/function recognitionEmpty\(/);
 assert.match(js,/No verified early arrivals on this date/);
 assert.match(js,/No candidates in this period/);
 assert.match(js,/count\.dataset\.state=entries\.length\?'active':'empty'/);
 assert.match(js,/count\.dataset\.state=award\.entries\.length\?'active':'empty'/);
 assert.match(routes,/watchNominees/);
 assert.match(routes,/earlyArrivals/);
 assert.match(html,/principal-dashboard\.css\?v=14/);
 const principalJsVersion=html.match(/principal-dashboard\.js\?v=(\d+)/);
 assert.ok(principalJsVersion && Number(principalJsVersion[1])>=13,'principal JS revision must not regress');
});
