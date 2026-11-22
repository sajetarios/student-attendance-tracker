'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const html = read('public/portal.html');
const portal = read('public/portal.js');
const workspace = read('public/simplified-workspace.js');
const worker = read('public/sw.js');

test('Every sidebar navigation group starts expanded without changing its authorized visibility', () => {
  const groups = [...html.matchAll(/<button\b(?=[^>]*\bclass="[^"]*\bnav-group-toggle\b)[^>]*>/g)].map(match => match[0]);
  assert.ok(groups.length >= 7, 'covers People, Academics, User Management, Attendance, Reports and Administration');
  for (const group of groups) {
    assert.match(group, /aria-expanded="true"/, group);
    assert.match(group, /data-nav-group="[^"]+"/);
  }
  assert.match(portal, /function expandSidebarGroupsByDefault\(\)/);
  assert.match(portal, /if \(!wrapper \|\| wrapper\.hidden\) return/);
  assert.match(portal, /expandSidebarGroupsByDefault\(\);/);
  assert.doesNotMatch(portal, /other\.setAttribute\('aria-expanded', 'false'\)/);
});

test('Desktop and mobile menus are independent, not a one-at-a-time accordion', () => {
  assert.doesNotMatch(workspace, /collapseOtherGroups/);
  assert.match(workspace, /if \(!toggle && event\.target\.closest\('\.nav-item'\)\)/);
  assert.match(portal, /button\.setAttribute\('aria-expanded', String\(opening\)\)/);
  assert.match(portal, /if \(submenu\) submenu\.hidden = !opening/);
  assert.match(workspace, /before\.set\(toggle, toggle\.getAttribute\('aria-expanded'\) === 'true'\)/);
  assert.match(workspace, /before\.clear\(\)/);
});

test('The new scripts are both versioned in the portal and PWA shell', () => {
  assert.match(html, /src="\/portal\.js\?v=234" defer/);
  assert.match(html, /src="\/simplified-workspace\.js\?v=4" defer/);
  assert.ok(worker.includes('"/portal.js?v=234"'));
  assert.ok(worker.includes('"/simplified-workspace.js?v=4"'));
  assert.match(worker, /attendigo-v311-responsive-login/);
});
