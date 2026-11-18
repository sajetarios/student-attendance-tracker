'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/portal.html');
const ui = read('public/portal.js');
const accounts = read('public/student-portal-accounts.js');
const routes = read('student-portal-account-routes.js');
const management = read('student-management-routes.js');
const directory = read('public/account-directory.js');
const notices = read('public/admin-request-notifications.js');
const css = read('public/student-workspace-tabs.css');
const sw = read('public/sw.js');

test('Students and Portal Accounts are a single reachable workspace with preserved deep links', () => {
  for (const id of ['studentWorkspaceTabs', 'studentRecordsTab', 'studentAccountsTab',
    'studentsView', 'studentAccountsView', 'studentRecordsNavGroup', 'studentsNav']) {
    if (id === 'studentRecordsNavGroup') assert.ok(html.includes('id="studentRecordsNavGroup"'));
    else assert.ok(html.includes('id="' + id + '"'), id);
  }
  assert.match(html, /data-student-tab="students" role="tab"/);
  assert.match(html, /data-student-tab="studentAccounts" role="tab"/);
  assert.match(ui, /const showStudentTabs = \['students', 'studentAccounts'\].includes\(view\)/);
  assert.match(ui, /view === 'studentAccounts' && button.id === 'studentsNav'/);
  assert.match(ui, /sidebarView = view === 'studentAccounts' \? 'students' : view/);
  assert.match(ui, /if \(tab && allowedViewsForUser\(\).includes\(tab.dataset.studentTab\)\)/);
  assert.match(ui, /SCHOOL_ADMIN'\) return \['dashboard', 'students', 'studentAccounts'/);
  assert.match(ui, /views.push\('students', 'studentAccounts', 'classAttendance'\)/);
  assert.match(ui, /DEPARTMENT_HEAD'\) return \['dashboard', 'planner', 'students', 'teachers', 'schedules', 'sf2', 'officialBusiness', 'myGateAttendance'\]/);
});

test('One Students sidebar destination, with role-specific labels and no admin account shortcut', () => {
  assert.match(ui, /\$\('studentAccountsNav'\)\) \$\('studentAccountsNav'\).hidden = true/);
  assert.match(ui, /\$\('adminStudentAccountsNav'\)\) \$\('adminStudentAccountsNav'\).hidden = true/);
  assert.match(ui, /\$\('studentRecordsTab'\).textContent = user\?\.role === 'TEACHER' \? 'My Students' : 'Student Records'/);
  assert.match(ui, /\$\('studentAccountsTab'\).textContent = user\?\.role === 'TEACHER' \? 'Account Requests' : 'Portal Accounts'/);
  assert.match(ui, /\$\('showStudentPortalHelp'\)\) \$\('showStudentPortalHelp'\).hidden = true/);
  assert.ok(directory.includes("item.type === 'student' ? $('studentAccountsTab')"));
  assert.ok(notices.includes("$('studentAccountsTab')?.click()"));
});

test('School Admin roster removes redundant login / large QR columns without deleting QR access', () => {
  const head = ui.match(/const rosterHeader =[\s\S]*?if \(\$\('studentRosterDescription'\)\)/)?.[0] || '';
  assert.ok(head.includes('<th>Actions</th>'));
  assert.ok(!head.includes('<th>QR code</th>'), 'QR column is removed');
  assert.ok(!head.includes('<th>Student portal account</th>'), 'accounts are in second tab');
  assert.ok(ui.includes('const adminQrAction = admin && canViewQr'));
  assert.ok(ui.includes('data-view-qr='));
  assert.ok(ui.includes('async function openStudentQrPreview(student)'));
  assert.ok(!ui.includes('qrCell'));
  assert.ok(!ui.includes('accountCell'));
  assert.ok(ui.includes('data-label="Parent / guardian"'));
  assert.ok(ui.includes("teacher ? (4 + Number(showSelectionColumn))"), 'teacher compact roster remains');
});

test('School Admin keeps server-only credential provisioning and approval', () => {
  assert.match(routes, /const admin = \[authenticateSchoolClient,requireSchoolRoles\('SCHOOL_ADMIN'\)\]/);
  assert.match(routes, /const permitted = \[authenticateSchoolClient,requireSchoolRoles\('SCHOOL_ADMIN','TEACHER'\)\]/);
  for (const endpoint of ['accounts/:studentId/provision', 'accounts/bulk-provision',
    'requests/:requestId/review', 'accounts/:studentId/status']) assert.ok(routes.includes(endpoint), endpoint);
  assert.match(routes, /await logAudit\(db,req\.auth,'SCHOOL_ADMIN_SUSPEND_STUDENT_PORTAL_LOGIN'/);
  assert.match(routes, /UPDATE student_sessions SET revoked_at=NOW/);
  assert.match(accounts, /if \(!isAdmin\(\) \|\| busy\) return/);
});

test('Teacher requests, Department Head batch changes and school scoping are not expanded', () => {
  assert.match(routes, /const teacher = \[authenticateSchoolClient,requireSchoolRoles\('TEACHER'\)\]/);
  assert.match(routes, /if \(teacher\) filters.push\(teacherScope\)/);
  assert.match(routes, /teacher_period_assignments/);
  assert.match(routes, /class_adviser_assignments/);
  assert.match(routes, /teacher_period_substitutions/);
  assert.match(routes, /if\s*\(!students.length\) throw problem\(403/);
  assert.match(routes, /r.requested_by_user_id=\$2/);
  assert.match(management, /isDepartmentHead&&\(!req.auth.departmentId/);
  assert.match(management, /p.department_id=\$3 AND p.active=TRUE/);
  assert.match(management, /\['SET_SEX','ASSIGN'\].includes\(action\)/);
  assert.match(management, /\['ACTIVATE','DEACTIVATE','ARCHIVE','SET_SEX','ASSIGN'\]/);
});

test('Tabs are responsive, theme-aware, keyboard-readable and precached at matching versions', () => {
  assert.match(css, /\[hidden\]\{display:none!important\}/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /max-width:600px/);
  assert.match(css, /data-ui-theme="dark"/);
  assert.ok(html.includes('/student-workspace-tabs.css?v=1'));
  assert.ok(sw.includes('"/student-workspace-tabs.css?v=1"'));
  for (const uri of ['/portal.js?v=197', '/student-portal-accounts.js?v=11']) {
    assert.ok(html.includes(uri), 'HTML must load ' + uri);
    assert.ok(sw.includes(JSON.stringify(uri)), 'Service worker must cache ' + uri);
  }
});
