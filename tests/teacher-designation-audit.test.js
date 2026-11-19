'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const portal = fs.readFileSync(path.join(__dirname, '..', 'public', 'portal.js'), 'utf8');
const routeStart = server.indexOf("app.patch('/api/teachers/:userId/designations'");
const routeEnd = server.indexOf("app.post('/api/teachers',", routeStart);
const route = server.slice(routeStart, routeEnd);

test('teacher designation endpoint keeps authorization and adviser assignment protections', () => {
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  assert.match(route, /requireSchoolRoles\('SCHOOL_ADMIN','DEPARTMENT_HEAD'\)/);
  assert.match(route, /department_id\) !== String\(req\.auth\.departmentId\)/);
  assert.match(route, /Remove this teacher/);
  assert.match(route, /WHERE school_id=\$1 AND user_id=\$2 AND role='TEACHER'/);
});

test('designation change and audit entry share one transaction with a bound audit action', () => {
  assert.match(route, /client = await pool\.connect\(\)/);
  assert.match(route, /await client\.query\('BEGIN'\)/);
  assert.match(route, /await client\.query\('COMMIT'\)/);
  assert.match(route, /await client\.query\('ROLLBACK'\)/);
  assert.match(route, /client\?\.release\(\)/);
  assert.match(route, /const auditAction = req\.auth\.role === 'DEPARTMENT_HEAD'/);
  assert.match(route, /VALUES\(\$1,'SCHOOL',\$2,\$5,'school_user',\$3,\$4::jsonb\)/);
  assert.match(route, /JSON\.stringify\(\{ teacherDesignations: designations \}\), auditAction\]/);
  assert.doesNotMatch(route, /VALUES\([^\n]*req\.auth\.role/);
});

test('teacher designation prompt shows success based on server confirmation, not roster refresh', () => {
  const start = portal.indexOf("await api('/api/teachers/' + encodeURIComponent(teacher.userId) + '/designations'");
  const end = portal.indexOf("    $('adviserAssignmentRows').addEventListener", start);
  assert.ok(start >= 0 && end > start);
  const handler = portal.slice(start, end);
  assert.match(handler, /Array\.isArray\(result\?\.teacher\?\.teacherDesignations\)/);
  assert.match(handler, /Designation saved successfully:/);
  assert.match(handler, /Refresh the page to see the updated teacher roster/);
});
