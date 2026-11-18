'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
const read = name => fs.readFileSync(path.join(publicDir, name), 'utf8');
const themeName = 'attendigo-workspace-density-theme.css?v=1';
const theme = read('attendigo-workspace-density-theme.css');

test('all authenticated dashboards load the same density and dark-mode theme last', () => {
  for (const page of ['portal.html', 'student-portal.html', 'parent-portal.html']) {
    const html = read(page);
    assert.match(html, /dashboard-appearance\.js\?v=3/, page + ' must support a user theme toggle');
    assert.equal(html.split(themeName).length - 1, 1, page + ' must load the theme once');
    assert.ok(html.indexOf(themeName) > html.indexOf('attendigo-dark-unified.css'), page + ' should apply the shared overrides after older rules');
    assert.ok(html.indexOf(themeName) < html.indexOf('</head>'), page + ' should load CSS before content');
  }
});

test('desktop density preserves readable typography and expanded role-based navigation', () => {
  assert.match(theme, /min-width:861px/);
  assert.match(theme, /portal-layout:not\(\.sidebar-collapsed\)/);
  assert.match(theme, /grid-template-columns:236px minmax\(0,1fr\)/);
  assert.match(theme, /\.topbar[\s\S]*?min-height:62px/);
  assert.match(theme, /\.content-wrap[\s\S]*?padding:16px 20px 26px/);
  assert.doesNotMatch(theme, /zoom\s*:/);
  assert.doesNotMatch(theme, /font-size\s*:\s*(?:1[012]|\.[5-7])px/);
  assert.doesNotMatch(theme, /\[hidden\]\s*\{\s*display/);
});

test('dark mode covers every core surface and keeps school custom colors intact', () => {
  assert.match(theme, /html\[data-ui-theme="dark"\]/);
  for (const target of ['.student-page', '.parent-page', '.school-heading', '.student-card', '.parent-card', '.table-scroll', '.account-dropdown', '.ui-appearance-panel', 'dialog[open]']) {
    assert.ok(theme.includes(target), 'missing dark surface: ' + target);
  }
  assert.match(theme, /focus-visible/);
  assert.match(theme, /color-scheme:dark/);
  assert.doesNotMatch(theme, /--(?:brand|sidebar)\s*:/);
  assert.doesNotMatch(theme, /#schoolEmblem\s*img/);
});

test('service worker precaches the shared stylesheet for offline portal consistency', () => {
  const sw = read('sw.js');
  assert.ok(sw.includes('/' + themeName));
  const version = Number(sw.match(/const CACHE = "attendigo-v(\d+)-[a-z0-9-]+"/)?.[1]);
  assert.ok(version >= 216, 'cache must refresh when sign-in CSS changes');
  assert.ok(sw.includes('/attendigo-login-refinement.css?v=5'));
});
