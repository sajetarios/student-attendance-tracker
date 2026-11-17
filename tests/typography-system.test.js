const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const pages = [
  'portal.html', 'portal-login.html', 'parent-admin.html',
  'parent-portal.html', 'parent-register.html', 'student-portal.html',
  'force-password-change.html', 'platform-setup.html', 'offline-sheet.html',
  'class-qr-teacher.html', 'class-qr-checkin.html', 'sms.html', 'index.html'
];

test('every production HTML entrypoint loads the self-hosted typography foundation last', () => {
  for (const page of pages) {
    const html = read('public/' + page);
    assert.match(html, /href="\/fonts\/InterVariable\.woff2"/, page + ': preload');
    assert.match(html, /href="\/typography\.css\?v=1"/, page + ': stylesheet');
    const pos = html.indexOf('/typography.css?v=1');
    assert.ok(pos > html.lastIndexOf('rel="stylesheet"', pos - 30), page + ': final typography layer');
  }
});

test('Inter variable fonts are actually bundled with an OFL license', () => {
  const root = path.join(__dirname, '..', 'public', 'fonts');
  for (const filename of ['InterVariable.woff2', 'InterVariable-Italic.woff2']) {
    const font = fs.readFileSync(path.join(root, filename));
    assert.equal(font.subarray(0, 4).toString('ascii'), 'wOF2');
    assert.ok(font.length > 100000);
  }
  assert.match(read('public/fonts/OFL.txt'), /SIL OPEN FONT LICENSE|SIL Open Font License/i);
});

test('Inter font faces and reusable readable typography tokens are defined', () => {
  const css = read('public/typography.css');
  assert.match(css, /font-family:\s*"Inter"/);
  assert.match(css, /font-weight:\s*100 900/);
  assert.equal((css.match(/font-display:\s*swap/g) || []).length, 2);
  for (const token of ['--type-title', '--type-section', '--type-body',
    '--type-name', '--type-table', '--type-control', '--type-secondary', '--type-count']) {
    assert.ok(css.includes(token + ':'), token);
  }
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);
  assert.match(css, /max\(1rem, 1em\) !important/);
  assert.doesNotMatch(css, /fonts\.googleapis\.com|@import\s+url\(https?:/i);
});

test('the offline shell precaches typography and font assets with a fresh version', () => {
  const sw = read('public/sw.js');
  assert.match(sw, /attendigo-v163-adaptive-inter-typography/);
  for (const asset of ['/typography.css?v=1', '/fonts/InterVariable.woff2',
    '/fonts/InterVariable-Italic.woff2']) {
    assert.ok(sw.includes('"' + asset + '"'), asset);
  }
  assert.match(sw, /Authenticated dashboards are never served from the offline shell cache/);
});

test('high-density interface styles use shared readable tokens', () => {
  for (const file of ['teacher-learner-roster.css', 'manual-folio.css',
    'planner.css', 'student-portal-accounts.css', 'universal-notifications.css',
    'attendance-sync-center.css', 'schedule-form-layout.css']) {
    assert.match(read('public/' + file), /var\(--type-(?:table|secondary|name)\)/, file);
  }
  assert.match(read('public/manual-folio.css'), /min-width:760px!important/);
  assert.match(read('public/planner.js'), /matchMedia\('\(max-width:650px\)'\).*'AGENDA' : 'MONTH'/);
});

test('static interface typography assets have balanced CSS rule blocks', () => {
  for (const file of ['typography.css', 'teacher-learner-roster.css', 'manual-folio.css',
    'planner.css', 'portal.css', 'comfort-ui.css', 'dashboard-ui.css',
    'dashboard-polish.css', 'dashboard-night.css', 'student-roster-toolbar.css',
    'student-portal-accounts.css', 'student-portal-refinement.css',
    'attendance-sync-center.css', 'schedule-form-layout.css',
    'admin-request-notifications.css', 'universal-notifications.css',
    'attendigo-login-refinement.css', 'attendigo-login-motion.css',
    'parent-admin.css', 'guardian-ui.css', 'sms.css', 'app-dialog.css',
    'attendigo-sidebar-adaptive.css', 'styles.css', 'form-system.css',
    'platform-setup.css', 'teacher-assignment-modal.css',
    'user-nav-reorg.css', 'photo-editor.css', 'special-program-ui.css',
    'sardo-monitor.css', 'responsive.css']) {
    const css = read('public/' + file).replace(/\/\*[\s\S]*?\*\//g, '');
    const opens = (css.match(/\{/g) || []).length;
    const closes = (css.match(/\}/g) || []).length;
    assert.equal(opens, closes, file + ' braces');
  }
});
