'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Department Heads can create a department-owned class schedule before assigning a teacher', () => {
  const server = read('server.js');
  const portal = read('public/portal.js');
  const html = read('public/portal.html');
  const start = server.indexOf("app.post('/api/periods'");
  const end = server.indexOf('// Teacher attendance history', start);
  const route = server.slice(start, end);
  assert.match(route, /req\.body\?\.teacherUserId \|\| null/);
  assert.match(route, /SELECT subject_id AS "subjectId",subject_name AS "subjectName",department_id AS "departmentId" FROM school_subjects/);
  assert.match(route, /String\(departmentId\) !== String\(req\.auth\.departmentId\)/);
  assert.match(route, /if \(teacherUserId\) \{[\s\S]*INSERT INTO teacher_period_assignments/);
  assert.match(route, /teacherName: teacher\.rows\[0\]\?\.displayName \|\| null/);
  assert.match(portal, /user\.role === 'DEPARTMENT_HEAD' && user\.departmentId/);
  assert.match(portal, /teacherUserId: teacher\?\.userId \|\| ''/);
  assert.match(portal, /Class schedule saved\. Assign a Subject Teacher when ready\./);
  assert.match(html, /Subject Teacher <span class="optional-label">Optional for unassigned schedules<\/span>/);
});
