'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('Department Head can create and edit within approved timetable boundaries',()=>{
 const js=read('public/portal.js'),server=read('server.js');
 assert.match(js,/New department class/);
 assert.match(js,/editApprovedTemplate/);
 assert.match(server,/if \(isDepartmentHead && !timetableTemplateId\)/);
 assert.match(server,/req\.auth\.role==='DEPARTMENT_HEAD'/);
 assert.match(js,/canEditPeriod/);
});
test('cache shell references the exact versioned JS and CSS used by the portal',()=>{
 const html=read('public/portal.html'),sw=read('public/sw.js');
 const js=html.match(/src="(\/portal\.js\?v=[^"]+)"/)[1];
 const css=html.match(/href="(\/schedule-form-layout\.css\?v=[^"]+)"/)[1];
 assert.ok(sw.includes('"'+js+'"'),js);
 assert.ok(sw.includes('"'+css+'"'),css);
});

test('Department Head form hides editable clock inputs and admin grace, but keeps live time preview',()=>{
 const html=read('public/portal.html'),css=read('public/schedule-form-layout.css'),js=read('public/portal.js');
 assert.match(css,/#scheduleForm\[data-schedule-role="DEPARTMENT_HEAD"\] \.schedule-setup-section \.schedule-time-inputs/);
 assert.match(css,/#scheduleForm\[data-schedule-role="DEPARTMENT_HEAD"\] \.schedule-location-section #scheduleGraceGroup/);
 assert.match(html,/id="scheduleTimePreview"/);
 assert.match(js,/startTime'\)\.readOnly=Boolean\(template\)\|\|user\.role==='DEPARTMENT_HEAD'/);
});
test('Only approved operating days appear in Department Head form, with quick reset',()=>{
 const html=read('public/portal.html'),js=read('public/portal.js');
 assert.match(html,/id="scheduleDaysTools"/);
 assert.match(html,/id="scheduleApplySchoolDays"/);
 assert.match(js,/input\.parentElement\.hidden=user\.role==='DEPARTMENT_HEAD'&&!isOperatingDay/);
 assert.match(js,/scheduleApplySchoolDays'\)\?\.addEventListener\('click'/);
});
test('Department Head has progressive disclosure and five-step interactive review',()=>{
 const html=read('public/portal.html'),js=read('public/portal.js');
 assert.match(html,/id="scheduleMoreOptionsToggle" aria-expanded="false"/);
 assert.match(html,/id="scheduleActivityTypeGroup"/);
 assert.match(html,/id="scheduleReadinessBar"/);
 assert.match(js,/scheduleMoreOptionsToggle'\)\?\.addEventListener\('click'/);
 assert.match(js,/scheduleReadinessFill'\)\.style\.width=/);
 assert.match(js,/complete===5\?'Ready to save'/);
 assert.match(js,/departmentHead \? '1\. Class & teacher'/);
});
