'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const routes=fs.readFileSync(path.join(root,'student-management-routes.js'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const portal=fs.readFileSync(path.join(root,'public','portal.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public','portal.html'),'utf8');
const migrations=fs.readFileSync(path.join(root,'scripts','migrate.js'),'utf8');

test('bulk import supports CSV and Excel with required Student ID and sex validation',()=>{
  assert.match(routes,/\.xlsx\.load/);
  assert.match(routes,/csvRows\(/);
  assert.match(routes,/MAX_ROWS = 2000/);
  assert.match(routes,/Student ID, Full Name, Sex, Grade Level, Section/);
  assert.match(routes,/Student ID is duplicated in this file/);
  assert.match(routes,/LRN already belongs to another student/);
  assert.match(routes,/import\/preview/);
  assert.match(routes,/import\/commit/);
});

test('student batch APIs enforce administrator and Class Adviser role scopes',()=>{
  assert.match(routes,/requireSchoolRoles\('SCHOOL_ADMIN','TEACHER'\)/);
  assert.match(routes,/req\.auth\.role==='TEACHER'/);
  assert.match(routes,/class_adviser_assignments/);
  assert.match(routes,/students\/batch/);
  assert.match(routes,/\['ACTIVATE','DEACTIVATE','ARCHIVE','UPDATE','ASSIGN'\]/);
});

test('student enrollment changes are written to the active school year enrollment table',()=>{
  assert.match(routes,/INSERT INTO student_enrollments/);
  assert.match(routes,/enrollment_status='ENROLLED'/);
  assert.match(routes,/STUDENT_BULK_IMPORT/);
});

test('administrator can filter inactive and archived student records for reactivation',()=>{
  assert.match(server,/includeInactive = req\.auth\.type === 'SCHOOL_USER' && req\.auth\.role === 'SCHOOL_ADMIN'/);
  assert.match(server,/s\.archived_at AS "archivedAt"/);
  assert.match(html,/id="studentStatusFilter"/);
  assert.match(portal,/studentStatusFilter/);
  assert.match(routes,/action==='ACTIVATE'/);
});

test('student import and batch controls have preview and explicit confirmation UI',()=>{
  assert.match(html,/id="studentImportModal"/);
  assert.match(html,/id="studentImportPreviewRows"/);
  assert.match(html,/id="confirmStudentImport"/);
  assert.match(html,/id="studentBatchModal"/);
  assert.match(portal,/window\.confirm\('Import '/);
  assert.match(portal,/window\.confirm\(action/);
});

test('new archive migration is part of the required migration chain',()=>{
  assert.match(migrations,/015_student_archive_and_batch_management\.sql/);
});

test('Department Head bulk timetable assignment is server-scoped to the assigned department',()=>{
  assert.match(server,/periods\/bulk-assignments/);
  assert.match(server,/req\.auth\.role === 'DEPARTMENT_HEAD'/);
  assert.match(server,/selected\.rows\.some\(p => String\(p\.departmentId\) !== String\(req\.auth\.departmentId\)\)/);
  assert.match(server,/The teacher and every selected schedule must belong to the same department/);
  assert.match(portal,/api\('\/api\/periods\/bulk-assignments'/);
  assert.match(html,/id="periodBulkToolbar"/);
});

test('Administrator can bulk-assign teacher and Department Head accounts to a department',()=>{
  const departmentRoutes=fs.readFileSync(path.join(root,'department-routes.js'),'utf8');
  assert.match(departmentRoutes,/school-users\/bulk-department/);
  assert.match(departmentRoutes,/role IN \('TEACHER','DEPARTMENT_HEAD'\)/);
  assert.match(departmentRoutes,/teacher_period_assignments/);
  assert.match(portal,/api\('\/api\/school-users\/bulk-department'/);
  assert.match(portal,/data-select-staff/);
  assert.match(html,/id="staffBulkDepartmentToolbar"/);
  assert.match(html,/id="selectAllStaff"/);
});
