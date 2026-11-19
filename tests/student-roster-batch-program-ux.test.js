'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

test('student roster clearly distinguishes section from special program and explains zero selection',()=>{
  const html=read('public/portal.html');
  const js=read('public/portal.js');
  assert.match(html,/id="studentBatchGuidance"/);
  assert.match(html,/Select students using the checkboxes/);
  assert.match(js,/No special program/);
  assert.match(js,/Select learner checkboxes first/);
  assert.match(js,/Move grade \/ section changes class placement only/);
  assert.match(js,/No learner changes have been made/);
});

test('Class Adviser and Department Head request special program approval; only School Admin can directly assign',()=>{
  const html=read('public/portal.html');
  const js=read('public/portal.js');
  const routes=read('special-program-routes.js');
  const studentRoutes=read('student-management-routes.js');
  assert.match(html,/<option value="REQUEST_PROGRAM">Request special-program change \(School Admin approval\)<\/option>/);
  assert.match(html,/<option value="ASSIGN_PROGRAM">Assign special program to selected \(School Admin\)<\/option>/);
  assert.match(js,/option\.value === 'ASSIGN_PROGRAM' \? isAdmin/);
  assert.match(js,/action === 'ASSIGN_PROGRAM'/);
  assert.match(js,/api\('\/api\/special-programs\/assignments\/bulk'/);
  assert.match(js,/enrollmentIds:body\.enrollmentIds/);
  assert.match(routes,/app\.post\('\/api\/special-programs\/assignments\/bulk',authenticateSchoolClient,admin/);
  assert.match(studentRoutes,/\['ACTIVATE','DEACTIVATE','ARCHIVE','SET_SEX','ASSIGN'\]/);
  assert.match(js,/\['REQUEST_PROGRAM','ASSIGN_PROGRAM'\]/);
});

test('program assignment respects school catalog and validates active enrollment IDs',()=>{
  const html=read('public/portal.html');
  const js=read('public/portal.js');
  assert.match(html,/id="batchProgramGroup" hidden/);
  assert.match(html,/id="batchProgram"/);
  assert.match(js,/api\('\/api\/special-programs\/catalog-access'\)/);
  assert.match(js,/No special program is registered for this school/);
  assert.match(js,/School Years & Programs/);
  assert.match(js,/uuidPattern\.test/);
  assert.match(js,/programTypeId:body\.programTypeId/);
  assert.match(js,/result\.unchangedCount/);
  assert.match(js,/await loadSchoolData\(\)/);
  assert.match(read('public/special-program-batch-ui.js'),/No active special programs exist for this school/);
});
