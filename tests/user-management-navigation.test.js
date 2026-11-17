'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('public/portal.html','utf8');
const js = fs.readFileSync('public/portal.js','utf8');
const directory = fs.readFileSync('public/account-directory.js','utf8');
const notifications = fs.readFileSync('public/admin-request-notifications.js','utf8');
const guardian = fs.readFileSync('public/guardian-ui.js','utf8');
const css = fs.readFileSync('public/user-nav-reorg.css','utf8');
const worker = fs.readFileSync('public/sw.js','utf8');

test('school admin has a unified account menu while student records remain separate', () => {
  const start = html.indexOf('id="staffNavWrapper"');
  const end = html.indexOf('id="guardianApprovalsNav"',start);
  assert.ok(start > 0 && end > start,'account navigation and compatible hidden legacy control exist');
  const menu = html.slice(start,end);
  for (const id of ['staffNavToggle','staffNavChildren','adminStudentAccountsNav','parentsNav','requestsApprovalsNav'])
    assert.ok(menu.includes('id="'+id+'"'),id);
  for (const name of ['User Management','All User Accounts','Teachers &amp; Staff','Student Accounts','Parents & Guardians','Requests &amp; Approvals'])
    assert.ok(menu.includes(name),name);
  assert.ok(html.includes('id="studentsNav"'));
  assert.ok(html.indexOf('id="studentsNav"') < start);
  assert.ok(html.includes('id="studentAccountsNav"'), 'teacher keeps own authorized student account shortcut');
  assert.match(html,/data-nav-group="users"/);
  assert.match(html,/data-submenu="users"/);
});

test('new directory searches three existing protected account sources without new write routes', () => {
  for (const id of ['accountDirectoryHub','allAccountsSearch','allAccountsType','allAccountsStatus','allAccountsResults','allAccountsRefresh'])
    assert.ok(html.includes('id="'+id+'"'),id);
  for (const path of ['/api/admin/security/accounts','/api/student-portal/accounts','/api/parents'])
    assert.ok(directory.includes(path),path);
  assert.ok(directory.includes("item.type === 'student' && !item.hasAccount"));
  assert.ok(directory.includes("document.createElement('article')"));
  assert.ok(directory.includes("document.addEventListener('attendigo:user-directory-open'"));
  assert.ok(!directory.includes("method: 'POST'"));
  assert.ok(!directory.includes("innerHTML ="));
  assert.ok(js.includes("if (activeTab === 'directory') document.dispatchEvent"));
});

test('staff account permissions stay admin-only, teachers retain scoped student accounts', () => {
  assert.ok(js.includes("if ($('studentAccountsNav')) $('studentAccountsNav').hidden = !(teacher && (subjectTeacher || classAdviser));"));
  assert.ok(js.includes("if ($('adminStudentAccountsNav')) $('adminStudentAccountsNav').hidden = !admin;"));
  assert.ok(js.includes("if ($('requestsApprovalsNav')) $('requestsApprovalsNav').hidden = !admin;"));
  assert.ok(js.includes("if ($('staffNavWrapper')) $('staffNavWrapper').hidden = !admin;"));
  assert.ok(notifications.includes("$('adminStudentAccountsNav')||$('studentAccountsNav')"));
  assert.ok(notifications.includes('adminRequestsNavBadge'));
  assert.ok(guardian.includes('Keep the legacy guardian trigger hidden'));
  assert.ok(js.includes("$('adminNotificationBell')?.click()"));
});

test('dark/mobile directory assets are version-aligned with current service-worker shell', () => {
  assert.ok(css.includes('html[data-ui-theme="dark"]'));
  assert.ok(css.includes('@media(max-width:640px)'));
  for (const name of ['account-directory.js','user-nav-reorg.css','portal.js','dashboard-icons.js','admin-request-notifications.js','guardian-ui.js']) {
    const route = html.match(new RegExp('(?:src|href)="(\\/' + name.replaceAll('.', '\\.') + '\\?v=[^"]+)"'))?.[1];
    assert.ok(route, name+' must be referenced by the portal');
    assert.ok(worker.includes(JSON.stringify(route)), route+' must match the refreshed shell version');
  }
  assert.match(worker,/const CACHE = "attendigo-v[0-9]+-/);
});
