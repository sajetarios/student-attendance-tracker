'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = p => fs.readFileSync(p, 'utf8');
const html = read('public/portal.html');
const css = read('public/attendigo-sidebar-adaptive.css');
const sw = read('public/sw.js');
const symbol = read('public/assets/attendigo-symbol-transparent.svg');
const dark = read('public/assets/attendigo-wordmark-on-dark.svg');
const light = read('public/assets/attendigo-wordmark-on-light.svg');
test('product logo uses its original transparent multicolor symbol and legible Inter text', () => {
  assert.match(html, /class="sidebar-product-wordmark" aria-hidden="true">Attendigo<\/span>/);
  assert.match(css, /img\.attendigo-logo\s*\{[^}]*width:46px!important;[^}]*height:46px!important;[^}]*object-fit:contain!important;[^}]*object-position:center!important/s);
  assert.match(html, /src="\/assets\/attendigo-symbol-transparent\.svg\?v=2"/);
  assert.match(css, /\.sidebar-product-wordmark\s*\{[^}]*font-family:var\(--font-ui,Inter,system-ui,sans-serif\)!important;[^}]*font-weight:620!important/s);
  assert.doesNotMatch(css, /background:var\(--side-logo-back\)!important/);
});
test('school identity cannot be compressed into workspace label, including long 3-line names', () => {
  const rule = css.match(/html body #sidebar\.sidebar \.sidebar-brand\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(rule, /flex:0 0 auto!important/);
  assert.match(rule, /height:auto!important/);
  assert.match(rule, /min-height:76px!important/);
  assert.match(css, /#sidebarSchoolName\s*\{[^}]*-webkit-line-clamp:3!important/s);
  assert.match(css, /\.sidebar-section-label\s*\{[^}]*flex:0 0 auto!important/s);
  assert.match(html, /id="sidebarSchoolMark"/);
});
test('labels remain readable with restrained hierarchy, while keyboard focus stays visible', () => {
  assert.match(css, /\.nav-item,\s*#sidebar\.sidebar \.nav-group-toggle\s*\{[^}]*font-size:var\(--type-table\)!important;[^}]*font-weight:550!important/s);
  assert.match(css, /\.nav-group-toggle \{font-weight:600!important\}/);
  assert.match(css, /\.nav-item\.active,\s*#sidebar\.sidebar \.nav-submenu \.nav-item\.active\s*\{[^}]*font-weight:650!important/s);
  assert.match(css, /:focus-visible\s*\{\s*outline:3px solid var\(--side-focus\)!important/s);
});
test('collapsed and mobile navigation keep brand compact and do not show oversized image', () => {
  assert.match(css, /sidebar-collapsed #sidebar\.sidebar > \.attendigo-brand \.sidebar-product-wordmark/);
  assert.match(css, /max-width:215px!important/);
  assert.match(css, /width:42px!important;[^}]*height:42px!important/s);
});
test('service worker uses fresh version and precaches matching CSS', () => {
  assert.match(html, /attendigo-sidebar-adaptive\.css\?v=14/);
  assert.ok(Number(sw.match(/const CACHE = "attendigo-v(\d+)-/)[1]) >= 168, 'PWA cache version must include removal of sidebar sync shortcut');
  assert.match(sw, /"\/attendigo-sidebar-adaptive\.css\?v=14"/);
  assert.match(html, /\/typography\.css\?v=1/);
});

test('no square is painted behind the Attendigo product mark', () => {
  assert.match(symbol, /id="key-black"/);
  assert.match(symbol, /3 3 3 0 0/);
  assert.doesNotMatch(symbol, /id="key-white"/);
  for (const svg of [dark, light]) {
    assert.match(svg, /id="transparent-black"/);
    assert.ok(svg.includes('clip-path="url(#symbol)" filter="url(#transparent-black)"'));
  }
  assert.ok(sw.includes('\"/assets/attendigo-symbol-transparent.svg?v=2\"'));
});
