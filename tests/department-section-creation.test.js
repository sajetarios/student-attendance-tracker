'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/portal.html'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'public/portal.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/portal.css'), 'utf8');

test('School sections require authenticated school admin or assigned department head', () => {
  assert.match(server,/app\.post\('\/api\/sections', authenticateSchoolClient, requireSchoolRoles\('SCHOOL_ADMIN','DEPARTMENT_HEAD'\)/);
  assert.match(server,/head&&\(!req\.auth\.departmentId\|\|req\.auth\.departmentCode==='UNASSIGNED'\)/);
  assert.match(server,/req\.auth\.schoolId,gradeLevel,section/);
  assert.doesNotMatch(server,/req\.body\?\.schoolId/);
});

test('Department head creation never edits existing sections, reports duplicates, and writes audit in transaction', () => {
  assert.match(server,/ON CONFLICT \(school_id,grade_level,section_name\) DO NOTHING RETURNING/);
  assert.match(server,/409\)\.json\(\{error:'This class section already exists/);
  assert.match(server,/DEPARTMENT_HEAD_CREATE_SECTION/);
  assert.match(server,/await client\.query\('BEGIN'\)/);
  assert.match(server,/await client\.query\('COMMIT'\)/);
  assert.match(server,/await client\.query\('ROLLBACK'\)/);
  assert.match(server,/requireSchoolRoles\('SCHOOL_ADMIN'\), async\(req,res\)=>\{/);
});

test('Department head can add new section from adviser assignment and choose newly created section', () => {
  for (const id of ['showAdviserNewSection','adviserNewSectionPanel','adviserNewSectionGrade','adviserNewSectionName','createAdviserNewSection','adviserNewSectionFeedback']) {
    assert.ok(html.includes('id="'+id+'"'));
    assert.ok(ui.includes("'"+id+"'"));
  }
  assert.match(ui,/await api\('\/api\/sections',\{method:'POST'/);
  assert.match(ui,/await loadAdviserEligibleSections\(\)/);
  assert.match(ui,/select\.value=section/);
  assert.match(css,/#adviserAssignmentForm \.adviser-new-section-panel/);
});
