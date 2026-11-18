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
  assert.match(routes, /buildPersonalCopyWorkbook\(req, month, gradeLevel, section, data\)/);
  assert.match(routes, /Content-Length/);
  assert.match(client, /Preparing Excel/);
  assert.match(client, /spreadsheetml\.sheet/);
  assert.match(client, /Check your browser downloads/);
});

test('photo column explains missing stored photo and retains upload controls for authorized roles', () => {
  const portal = read('public/portal.js');
  assert.match(portal, /photoDataUrl\(student\.photoUrl\)/);
  assert.match(portal, /No photo uploaded/);
  assert.ok(portal.includes('teacherRosterInitials(student.fullName)'));
  assert.match(portal, /canUploadPhoto = admin \|\| \(teacher && designations\.includes\('CLASS_ADVISER'\)\)/);
});

test('current portal assets are pre-cached under a new service-worker cache', () => {
  const theme = read('public/portal.css');
  assert.match(theme, /--brand:#0ea5e9/);
  assert.match(theme, /--sidebar:#20232d/);
  assert.match(theme, /:focus/);
  const portalHtml = read('public/portal.html');
  const serviceWorker = read('public/sw.js');
  const shell = serviceWorker.split('const SHELL = [')[1]?.split('];')[0] || '';
  for (const asset of [
    'portal.css', 'portal.js', 'planner.css', 'planner.js', 'dashboard-icons.js', 'schedule-workspace-ui.js',
    'schedule-form-layout.css', 'offline-attendance.js', 'academic-admin.css',
    'academic-admin.js',
  ]) {
    const url = [...portalHtml.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map(match => match[1])
      .find(url => url.startsWith(`/${asset}?v=`));
    assert.ok(url, `Expected a versioned dashboard URL for ${asset}`);
    assert.ok(shell.includes(JSON.stringify(url)), `Expected ${url} in the offline shell`);
  }
});


test('root URL and legacy index open the login page without serving a stale cached Attendance Desk', () => {
  const server = read('server.js');
  const serviceWorker = read('public/sw.js');
  const loginScript = read('public/portal-login.js');
  const index = read('public/index.html');
  const shell = serviceWorker.split('const SHELL = [')[1]?.split('];')[0] || '';

  assert.ok(server.includes('function canonicalLoginUrl(req)'));
  assert.ok(server.includes("app.get('/', (req, res) => {"));
  assert.ok(server.includes("app.get('/index.html', (req, res) => {"));
  assert.ok(server.includes('res.redirect(302, canonicalLoginUrl(req));'));
  assert.ok(index.includes('/portal-login.html'));
  assert.ok(serviceWorker.includes('if (request.mode === "navigate")'));
  assert.equal(shell.includes('"/"'), false);
  assert.equal(shell.includes('"/index.html"'), false);
  assert.ok(loginScript.includes("navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })"));
});
