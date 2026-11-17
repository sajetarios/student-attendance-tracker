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
test('Schedule Type is always visible and live review still works',()=>{
 const html=read('public/portal.html'),js=read('public/portal.js');
 assert.doesNotMatch(html,/id="scheduleMoreOptionsToggle"/);
 assert.match(html,/id="scheduleActivityTypeGroup"/);
 assert.match(js,/scheduleActivityTypeGroup'\)\)\$\('scheduleActivityTypeGroup'\)\.hidden=false/);
 assert.match(js,/scheduleReadinessFill'\)\.style\.width=/);
 assert.match(html,/id="scheduleReadinessBar"/);
});
test('Class Adviser lookup is read-only across the school, including other departments',()=>{
 const server=read('server.js'),js=read('public/portal.js'),html=read('public/portal.html');
 const a=server.indexOf("app.get('/api/scheduling/section-adviser'"),b=server.indexOf("app.post('/api/class-adviser-assignments'",a);
 assert.ok(a>0&&b>a);
 const read=server.slice(a,b);
 assert.match(read,/FROM class_adviser_assignments ca/);
 assert.match(read,/ca\.school_id=\$1/);
 assert.doesNotMatch(read,/req\.auth\.departmentId/);
 assert.doesNotMatch(read,/INSERT INTO|UPDATE class_adviser_assignments|DELETE FROM/);
 assert.match(js,/function refreshScheduleSectionAdviser\(\)/);
 assert.match(html,/id="scheduleClassAdviserName"/);
});
test('Classroom is in Class Details and saving subject schedule does not change adviser assignments',()=>{
 const server=read('server.js'),html=read('public/portal.html'),js=read('public/portal.js');
 const form=html.split('<form id="scheduleForm"')[1].split('</form>')[0];
 assert.equal((form.match(/id="periodClassroom"/g)||[]).length,1);
 assert.ok(form.indexOf('id="periodClassroom"')<form.indexOf('schedule-location-section'));
 assert.match(html,/Advisory \/ Homeroom is a schedule type/);
 assert.match(js,/Class Adviser: '\+\(\$\('scheduleClassAdviserName'\)/);
 const a=server.indexOf("app.post('/api/periods'"),b=server.indexOf('// Teacher attendance history',a);
 assert.doesNotMatch(server.slice(a,b),/INSERT INTO class_adviser_assignments/);
});
