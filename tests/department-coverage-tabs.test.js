'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'portal.html'), 'utf8');
const portal = fs.readFileSync(path.join(root, 'public', 'portal.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'portal.css'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'department-routes.js'), 'utf8');

test('Department Head coverage uses My Department and Other Departments tabs instead of a wide table', () => {
  assert.match(html, /id="coverageMyDepartmentTab"[\s\S]*?data-coverage-tab="MY_DEPARTMENT"/);
  assert.match(html, /id="coverageOtherDepartmentsTab"[\s\S]*?data-coverage-tab="OTHER_DEPARTMENTS"/);
  const card = html.slice(html.indexOf('id="teacherCoverageCard"'), html.indexOf('id="learnerSummaryCard"'));
  assert.doesNotMatch(card, /<table[\s>]/i);
  assert.match(card, /class="coverage-card-list"[^>]*id="teacherCoverageRows"/);
});

test('Coverage department grouping is derived by the backend from authenticated Department Head identity', () => {
  assert.match(routes, /departmentScope: req\.auth\.departmentCode !== 'UNASSIGNED'[\s\S]*?String\(row\.departmentId \|\| ''\) === String\(req\.auth\.departmentId \|\| ''\)/);
  assert.match(routes, /departmentSummary:[\s\S]*?myDepartment: countScope\(myDepartmentRows\)[\s\S]*?otherDepartments: countScope\(otherDepartmentRows\)/);
  assert.match(routes, /summary:[\s\S]*?\.\.\.countScope\(rows\)/);
});

test('Other Departments remains read-only and own-department actions require server-confirmed scope', () => {
  assert.match(html, /These schedules belong to other departments[\s\S]*?only their respective Department Heads can manage assignments/);
  assert.match(portal, /const canManageRow = showingMyDepartment && row\.departmentScope === 'MY_DEPARTMENT'/);
  assert.match(portal, /const rows = showingMyDepartment \? myRows : otherRows/);
  assert.match(portal, /departmentScope !== 'MY_DEPARTMENT'/);
});

test('School-wide coverage metrics and separate tab counts are rendered without duplicate schedule queries', () => {
  for (const id of ['coverageTotalSchedules','coverageNoTeacher','coverageUncoveredLeave','coverageMissingCheckins','coverageActiveAlerts','coverageMyDepartmentCount','coverageOtherDepartmentsCount']) {
    assert.ok(html.includes(`id="${id}"`), `Missing metric ${id}`);
  }
  assert.match(portal, /setMetric\('coverageTotalSchedules', teacherCoverage\.length\)/);
  assert.match(portal, /myRows\.length \} classes · \$\{myAlerts\} alerts/);
  assert.match(portal, /otherRows\.length \} classes · \$\{otherAlerts\} alerts/);
  assert.match(portal, /api\('\/api\/admin\/teacher-coverage'\)/);
});

test('Coverage cards show useful class information and preserve grace-period status wording', () => {
  for (const field of ['gradeLevel','section','subjectName','periodName','startTime','endTime','effectiveTeacherName']) {
    assert.match(portal, new RegExp(`row\\.${field}`));
  }
  assert.match(portal, /function coverageDisplayLabel\(row\)/);
  assert.match(portal, /Teacher Present/);
  assert.match(portal, /coverageNeedsAction\(row\)/);
  assert.match(routes, /p\.start_time \+ make_interval\(mins => p\.grace_minutes\)/);
});

test('Coverage cards and tabs have responsive styling for mobile screens', () => {
  assert.match(css, /\.teacher-coverage-card \.coverage-class-card/);
  assert.match(css, /\.teacher-coverage-card \.coverage-tabs/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.teacher-coverage-card \.coverage-class-details/);
});
