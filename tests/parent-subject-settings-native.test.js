'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const page=fs.readFileSync('public/portal.html','utf8');
const native=fs.readFileSync('public/parent-dashboard.js','utf8');
const shell=fs.readFileSync('public/sw.js','utf8');
const css=fs.readFileSync('public/parent-admin.css','utf8');
test('native embedded parent management includes subject notification settings',()=>{
 const start=page.indexOf('<section id="parentsView"');
 const end=page.indexOf('<div id="dashboardView"',start);
 assert.ok(start>=0&&end>start);
 const section=page.slice(start,end);
 const settings=section.indexOf('id="parentSubjectNoticeSettings"');
 assert.ok(settings>section.indexOf('class="parent-stats"'));
 assert.ok(settings<section.indexOf('class="parent-tabs"'));
 for(const id of ['parentSubjectNoticeSettings','parentSubjectNoticeEnable','parentSubjectNoticeSave','parentSubjectNoticeFeedback'])
   assert.ok(section.includes('id="'+id+'"'),id+' missing in native view');
});
test('embedded parent dashboard can read and save audited settings',()=>{
 assert.match(native,/loadSubjectNotificationSetting\(\)/);
 assert.match(native,/api\/parent\/subject-notifications\/settings/);
 assert.match(native,/method:'PUT'/);
 assert.match(native,/AppDialog\.confirm\(/);
 assert.match(page,/\/parent-dashboard\.js\?v=4/);
});
test('style versions match the service worker, with mobile layout',()=>{
 assert.match(page,/\/parent-admin\.css\?v=8/);
 assert.match(shell,/\/parent-admin\.css\?v=8/);
 assert.match(css,/\.parent-native \.parent-subject-settings/);
 assert.match(css,/@media\(max-width:760px\)/);
});
