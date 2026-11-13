'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('portal keeps all school views inside the school workspace', () => {
  const html = read('public/portal.html');
  assert.match(html, /id="schoolWorkspace"/);
  for (const view of ['dashboardView', 'sf2View', 'studentsView', 'schedulesView', 'teachersView']) {
    assert.match(html, new RegExp(`id="${view}"`));
  }
  assert.doesNotMatch(html, /The scanner detects the QR type automatically/);
  assert.match(html, /id="showStudentForm"[^>]*>＋ Add student/);
  assert.match(html, /id="studentRows"/);
  assert.match(html, /id="teacherRows"/);
});

test('Class Advisers and Subject Teachers can render QR previews only for assigned learners', () => {
  const portal = read('public/portal.js');
  const server = read('server.js');

  assert.match(portal, /const canViewQr = admin \|\| \(teacher && \(/);
  assert.match(portal, /designations\.includes\('CLASS_ADVISER'\)/);
  assert.match(portal, /designations\.includes\('SUBJECT_TEACHER'\)/);

  assert.match(server, /app\.get\('\/api\/students\/:studentId\/qr', authenticateSchoolClient, requireSchoolAdminOrTeacher/);
  assert.match(server, /Only authorized teachers may view QR codes/);
  assert.match(server, /teacherScope = ` AND \${TEACHER_STUDENT_SCOPE\.replace\(\/\\\$2\/g, '\$3'\)}`/);
});

test('SF2 personal copies are exportable while Department Head remains read-only', () => {
  const routes = read('sf2-routes.js');
  const client = read('public/portal.js');
  assert.match(routes, /req\.auth\.role === 'DEPARTMENT_HEAD' \|\| \(access\.readOnly && access\.mode !== 'PERSONAL'\)/);
  assert.match(routes, /buildPersonalCopyWorkbook\(month, gradeLevel, section, data\)/);
  assert.match(routes, /Content-Length/);
  assert.match(client, /Preparing Excel/);
  assert.match(client, /spreadsheetml\.sheet/);
  assert.match(client, /Check your browser downloads/);
});

test('photo column explains missing stored photo and retains upload controls for authorized roles', () => {
  const portal = read('public/portal.js');
  assert.match(portal, /photoDataUrl\(student\.photoUrl\)/);
  assert.match(portal, /The database has a photo path but the file is missing from storage/);
  assert.match(portal, /canUploadPhoto = admin \|\| \(teacher && designations\.includes\('CLASS_ADVISER'\)\)/);
});

test('new theme is cool neutral blue and all relevant pages use v0.8.2 cache-busting', () => {
  const theme = read('public/comfort-ui.css');
  assert.match(theme, /--brand: #2463a5/);
  assert.match(theme, /--sidebar: #1c2d45/);
  assert.doesNotMatch(theme, /#477f78|#293b3a/);
  const html = ['portal.html','index.html','portal-login.html','parent-portal.html','student-portal.html']
    .map(name => read(`public/${name}`)).join('\n');
  assert.match(html, /comfort-ui\.css\?v=0\.8\.2/);
  assert.match(read('public/sw.js'), /school-attendance-shell-v14-login-landing/);
});


test('root URL and legacy index open the login page without serving a stale cached Attendance Desk', () => {
  const server = read('server.js');
  const serviceWorker = read('public/sw.js');
  const loginScript = read('public/portal-login.js');
  const index = read('public/index.html');

  assert.match(server, /res\\.sendFile\\(path\\.join\\(__dirname, 'public', 'portal-login\\.html'\\)\\)/);
  assert.match(server, /app\\.get\\('\\/index\\.html'[\\s\\S]*?res\\.redirect\\('\\/'\\)/);
  assert.match(index, /portal-login\\.html/);
  assert.match(serviceWorker, /request\\.mode === "navigate"/);
  assert.match(serviceWorker, /school-attendance-shell-v14-login-landing/);
  assert.doesNotMatch(serviceWorker, /^\\s*"\\/",?\\s*$/m);
  assert.match(loginScript, /navigator\\.serviceWorker\\.register\\('\\/sw\\.js', \\{ updateViaCache: 'none' \\}\\)/);
});
