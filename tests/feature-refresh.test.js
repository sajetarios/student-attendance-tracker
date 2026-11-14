'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/portal.html');
const js = read('public/portal.js');
const server = read('server.js');
const css = read('public/comfort-ui.css');
const portalCss = read('public/portal.css');
const permissions = read('role-permissions.js');

test('Administrator dashboard exposes a working Add Student action for administrators and class advisers', () => {
  assert.match(html, /id="dashboardAddStudent"/);
  assert.match(js, /dashboardAddStudent'\)\) \$\('dashboardAddStudent'\)\.hidden = !mayAddStudent/);
  assert.match(js, /dashboardAddStudent'\)\?\.addEventListener\('click'/);
  assert.match(server, /app\.post\('\/api\/students', authenticateSchoolClient, requireSchoolAdminOrTeacher/);
});

test('Teacher roster exposes scoped editing and the edit form has all field wrappers used by the script', () => {
  assert.match(js, /data-edit-student="\$\{esc\(student\.studentId\)\}"/);
  assert.match(js, /adviserCanEditPlacement/);
  for (const id of ['editLrnGroup', 'editGradeGroup', 'editSectionGroup', 'editParentNameGroup', 'editParentMobileGroup']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(server, /Student not found in your assigned subject classes or advisory section/);
  assert.match(server, /You may move learners only within sections assigned to you as Class Adviser/);
});

test('Subject Teachers can create their own section schedule and it is assigned to their account', () => {
  assert.match(js, /teacherCreatingOwn/);
  assert.match(html, /id="periodSection" required/);
  assert.match(js, /section: \$\('periodSection'\)\.value\.trim\(\)/);
  assert.match(html, /id="periodSection" required/);
  assert.match(js, /teacherUserId: teacher\?\.userId/);
  assert.match(server, /subject_id,subject_name,start_time/);
  assert.match(server, /Only a Subject Teacher may create a personal class schedule/);
  assert.match(server, /INSERT INTO teacher_period_assignments\(school_id, teacher_user_id, period_id\)/);
});

test('School Administrator manages accounts and monitors Gate Keeper activity but cannot scan or submit attendance', () => {
  assert.match(html, /id="adminGatekeeperMonitoringCard"/);
  assert.match(html, /id="gateKeeperMonitorRows"/);
  assert.match(js, /const mayScan = gateKeeper \|\| \(teacher && \(subjectTeacher \|\| classAdviser\)\)/);
  assert.match(server, /role === 'SCHOOL_ADMIN'[\s\S]*?accounts do not record attendance/);
  assert.match(server, /app\.get\('\/api\/admin\/gatekeeper-monitoring', authenticateSchoolClient, requireSchoolAdmin/);
  const schoolAdminPermissions = permissions.split('DEPARTMENT_HEAD:')[0];
  assert.doesNotMatch(schoolAdminPermissions, /attendance\.(gate|subject)\.record/);
  assert.match(permissions, /GATE_KEEPER: Object\.freeze\(\['gate\.lookup', 'attendance\.gate\.record'\]\)/);
  assert.match(permissions, /attendance\.subject\.record', 'attendance\.advisory\.record/);
});

test('Gate Keeper scanner explicitly supports both learner and teacher attendance', () => {
  assert.match(html, /Teacher gate attendance/);
  assert.match(html, /TCH QR badge/);
  assert.match(html, /id="gateScanType"/);
  assert.match(js, /gateScanType === 'TEACHER' && studentMatch/);
  assert.match(js, /gateScanType === 'STUDENT' && teacherMatch/);
  assert.ok(js.includes('const teacherMatch = raw.match(/^TCH:'), 'teacher QR payload parser should recognize TCH: badges');
  assert.match(js, /recordTeacherGatePunch\('TIME_IN'\)/);
  assert.match(js, /recordTeacherGatePunch\('TIME_OUT'\)/);
  assert.match(server, /req\.body\?\.photoVerified !== true/);
  assert.match(server, /GATE_KEEPER_RECORD_TEACHER_ATTENDANCE/);
});

test('Photo confirmation has an animated but reduced-motion-safe highlight', () => {
  assert.match(js, /noticePhoto\.classList\.add\('photo-flash'\)/);
  assert.match(css, /@keyframes photoConfirmPulse/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /student-scan-verified-photo/);
});

test('SF2 Excel copy downloads a non-empty workbook through a temporary download link', () => {
  assert.match(js, /const blob = await response\.blob\(\)/);
  assert.match(js, /if \(!blob\.size\)/);
  assert.match(js, /document\.body\.appendChild\(anchor\)/);
  assert.match(js, /anchor\.click\(\)/);
  assert.match(js, /URL\.revokeObjectURL\(url\)/);
});

test('Portal uses the current accessible theme and cache-busted v0.9.13 assets', () => {
  assert.match(html, /portal\.css\?v=0\.9\.13/);
  assert.match(html, /portal\.js\?v=0\.9\.17/);
  assert.match(portalCss, /--brand:#0ea5e9/);
  assert.match(portalCss, /:focus/);
});

test('self-service and parent workspaces share the calm theme and Gate Keeper has an explicit attendance selector', () => {
  for (const file of ['public/parent-admin.html','public/parent-portal.html','public/parent-register.html','public/portal-login.html','public/student-portal.html']) {
    const source = read(file);
    assert.match(source, /comfort-ui\.css\?v=0\.8\.2/);
  }
  const index = read('public/index.html');
  assert.match(index, /window\.location\.replace\('\/portal-login\.html'/);
  assert.match(index, /url=\/portal-login\.html/);
  assert.match(css, /body\.login-page/);
  assert.match(css, /body\.attendance-desk/);
  assert.match(html, /id=\"gateScanType\"/);
});


test('Teacher scanner supports designated subject and advisory attendance with a separate attendance history page', () => {
  assert.match(html, /id="classAttendanceNav"/);
  assert.match(html, /id="classAttendanceView"/);
  assert.match(html, /My advisory attendance/);
  assert.match(html, /Attendance of other sections I handle/);
  assert.match(js, /const mayScan = gateKeeper \|\| \(teacher && \(subjectTeacher \|\| classAdviser\)\)/);
  assert.match(js, /role === 'TEACHER' \? activeScanScope/);
  assert.match(server, /app\.get\('\/api\/teacher\/class-attendance', authenticateSchoolClient, requireSchoolRoles\('TEACHER'\)/);
  assert.match(server, /attendance_scope IN \('CLASS','ADVISORY'\)/);
});

test('School staff account directory does not duplicate teacher accounts', () => {
  assert.match(server, /WHERE su.school_id=\$1 AND su.role IN \('DEPARTMENT_HEAD', 'GATE_KEEPER'\)/);
  assert.match(html, /Department Heads and Gate Keepers/);
  assert.match(js, /filter\(account => \['DEPARTMENT_HEAD', 'GATE_KEEPER'\]\.includes\(account\.role\)\)/);
});

test('staff monitoring uses compact assignment summaries and horizontally wrapped class-scope chips', () => {
  assert.match(js, /teacher-assignment-summary/);
  assert.match(js, /teacher-assignment-count/);
  assert.doesNotMatch(js, /const permanentAssignmentsHtml/);
  assert.match(portalCss, /#teachersView \.teacher-scope-list[\s\S]*?flex-direction:\s*row/);
  assert.match(portalCss, /#teachersView \.department-chip-list/);
});

test('teacher monitoring table keeps all seven columns readable on desktop and scrollable on smaller screens', () => {
  assert.match(html, /class="table-scroll teacher-monitor-scroll"[\s\S]*?<table class="teacher-monitor-table"/);
  assert.match(portalCss, /table\.teacher-monitor-table \{[\s\S]*?min-width:\s*1180px !important/);
  for (let column = 1; column <= 7; column++) {
    assert.match(portalCss, new RegExp('teacher-monitor-table th:nth-child\\(' + column + '\\)[\\s\\S]*?width: [0-9]+% !important'));
  }
  assert.match(portalCss, /teacher-monitor-table td:nth-child\(6\)[\s\S]*?white-space:\s*normal/);
  assert.match(portalCss, /teacher-monitor-table td:nth-child\(7\)[\s\S]*?white-space:\s*normal/);
});
