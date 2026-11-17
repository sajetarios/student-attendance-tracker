'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

test('Department Heads may onboard only teachers in their assigned active department', () => {
  const server = read('server.js');
  const start = server.indexOf("app.post('/api/school-users'");
  const end = server.indexOf("app.patch('/api/school-users", start);
  const route = end > start ? server.slice(start, end) : server.slice(start, start + 7000);
  assert.match(route, /requireSchoolAdminOrDepartmentHead/);
  assert.match(route, /if \(role !== 'TEACHER'\) return res\.status\(403\)/);
  assert.match(route, /req\.auth\.departmentCode === 'UNASSIGNED'/);
  assert.match(route, /String\(departmentId\) !== String\(req\.auth\.departmentId\)/);
  assert.match(route, /departmentId = req\.auth\.departmentId/);
  assert.match(route, /DEPARTMENT_HEAD_CREATE_TEACHER/);
  assert.match(route, /role === 'TEACHER'/);
  assert.match(route, /teacherDesignations/);
});

test('Department Heads can find Add teacher and cannot select a privileged role or another department', () => {
  const portal = read('public/portal.js');
  assert.match(portal, /departmentHead \? '＋ Add teacher' : '＋ Create account'/);
  assert.match(portal, /function openTeacherCreation\(\)/);
  assert.match(portal, /\$\('newAccountRole'\)\.value = 'TEACHER'/);
  assert.match(portal, /\$\('newAccountRole'\)\.disabled = true/);
  assert.match(portal, /\$\('newTeacherDepartment'\)\.value = user\.departmentId/);
  assert.match(portal, /accountSelect\.disabled = user\.role === 'DEPARTMENT_HEAD'/);
});

test('Unassigned department schedules provide working list and weekly assignment controls', () => {
  const portal = read('public/portal.js');
  const grid = read('public/timetable-grid.js');
  const server = read('server.js');
  assert.match(portal, /data-list-teacher/);
  assert.match(portal, /data-list-assign/);
  assert.match(portal, /\$\('scheduleRows'\)\?\.addEventListener\('click'/);
  assert.match(portal, /data-go-add-teacher/);
  assert.match(portal, /onAddTeacher:\(\)=>openTeacherCreation\(\)/);
  assert.match(grid, /data-tt-add-teacher/);
  assert.match(grid, /data-tt-assign/);
  assert.match(grid, /data-tt-error/);
  assert.match(server, /teacher\.rows\[0\]\.department_id\) !== String\(period\.rows\[0\]\.department_id\)/);
  assert.match(server, /Teacher is already assigned to an overlapping schedule/);
});
