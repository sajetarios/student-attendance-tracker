'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=file=>fs.readFileSync(file,'utf8');
const route=read('special-program-routes.js');
const server=read('server.js');
const academic=read('academic-routes.js');
const migration=read('migrations/047_special_program_approvals.sql');
const registry=read('scripts/migrate.js');
const portal=read('public/portal.html');
const studentPage=read('public/student-portal.html');
const parentPage=read('public/parent-portal.html');
const js=read('public/portal.js');
const ui=read('public/special-program-ui.js');
const worker=read('public/sw.js');

test('special-program approvals have a new append-only migration with multi-tenant constraints',()=>{
  assert.ok(registry.includes("'047_special_program_approvals.sql'"));
  assert.ok(migration.includes('special_program_change_requests'));
  assert.ok(migration.includes('FOREIGN KEY (school_id,enrollment_id,student_id,school_year_id)'));
  assert.ok(migration.includes("WHERE status='PENDING'"),'one pending request per student/year');
  assert.ok(migration.includes('reviewed_by_user_id'));
  assert.ok(migration.includes("CHECK (action IN ('ASSIGN','REMOVE'))"));
  assert.ok(server.includes('registerSpecialProgramRoutes(app, pool,'));
});

test('only School Admin can alter assignments and review changes; delegated roles only request',()=>{
  assert.ok(route.includes("const admin=requireSchoolRoles('SCHOOL_ADMIN')"));
  assert.ok(route.includes("app.post('/api/special-programs/assignments/bulk',authenticateSchoolClient,admin"));
  assert.ok(route.includes("app.patch('/api/special-programs/catalog/:id',authenticateSchoolClient,admin"));
  assert.ok(route.includes("app.post('/api/special-programs/requests/:id/review',authenticateSchoolClient,admin"));
  assert.ok(route.includes("u.role==='DEPARTMENT_HEAD'||(u.role==='TEACHER'&&u.teacherDesignations?.includes('CLASS_ADVISER'))"));
  assert.ok(route.includes("req.auth.departmentCode==='UNASSIGNED'"));
  assert.ok(route.includes("adviser_user_id=$2 AND grade_level=$3 AND section=$4"));
  assert.ok(route.includes("AND p.department_id=$2"));
  assert.ok(route.includes('await permitted(c,req.auth,e)'));
});

test('changing program retains history and respects active school years and batch bounds',()=>{
  assert.ok(route.includes("e.year_status!=='ACTIVE'||e.enrollment_status!=='ENROLLED'"));
  assert.ok(route.includes("SET status='COMPLETED',is_primary=FALSE"));
  assert.ok(route.includes("AND status='ACTIVE' AND is_primary=TRUE"));
  assert.ok(route.includes('enrollmentIds.length>200'));
  assert.ok(route.includes('new Set(enrollmentIds).size!==enrollmentIds.length'));
  assert.ok(route.includes('await c.query(\'ROLLBACK\')'));
  assert.ok(route.includes("'SPECIAL_PROGRAM_'+action"));
  assert.ok(route.includes("'SPECIAL_PROGRAM_REQUEST_'+status"));
});

test('special-program reads only use current-year enrollment and approved parent links',()=>{
  assert.ok(route.includes("sy.status='ACTIVE'"));
  assert.ok(route.includes("AND e.enrollment_status='ENROLLED'"));
  assert.ok(route.includes("req.auth.type==='STUDENT'"));
  assert.ok(route.includes("AND e.student_id=$2 LIMIT 1"));
  assert.ok(route.includes("req.auth.role!=='PARENT'"));
  assert.ok(route.includes("l.parent_user_id=$2 AND l.status='APPROVED'"));
  assert.ok(server.includes('program.program_code AS "specialProgramCode"'));
  assert.ok(server.includes('active_enrollment.enrollment_id AS "enrollmentId"'));
  assert.ok(server.includes('sp.enrollment_id=active_enrollment.enrollment_id'));
  assert.ok(server.includes('TEACHER_STUDENT_SCOPE'));
  assert.ok(!academic.includes("requireSchoolRoles('DEPARTMENT_HEAD')"),'legacy program writes remain admin-only');
});

test('all dashboards have usable role-appropriate program controls',()=>{
  for(const id of ['studentSpecialProgramFilter','specialProgramAdminTools','specialProgramReviewPanel','specialProgramRequestForm','mySpecialProgramRequests','adminProgramRequestsShortcut'])assert.ok(portal.includes('id="'+id+'"'),id);
  assert.ok(portal.includes('/special-program-ui.js?v=2'));
  assert.ok(portal.includes('/special-program-ui.css?v=2'));
  assert.ok(studentPage.includes('studentSpecialProgramValue'));
  assert.ok(parentPage.includes('/parent-portal.js?v=2'));
  assert.ok(js.includes('student.specialProgramCode'));
  assert.ok(js.includes('special-program-chip'));
  assert.ok(ui.includes("api('/api/special-programs/requestable')"));
  assert.ok(ui.includes("api('/api/special-programs/requests')"));
  assert.ok(ui.includes("api('/api/special-programs/assignments/bulk'"));
});

test('service worker pre-caches all new desktop and portal resources at matching versions',()=>{
  for(const page of [portal,studentPage,parentPage]){
    for(const asset of [...page.matchAll(/(?:src|href)="(\/(?:special-program-ui\.(?:js|css)|student-portal\.js|parent-portal\.js|portal\.js|admin-request-notifications\.js)\?v=[^"]+)"/g)].map(x=>x[1])){
      assert.ok(worker.includes(JSON.stringify(asset)),asset);
    }
  }
  assert.match(worker,/attendigo-v151-special-program-batch/);
});
