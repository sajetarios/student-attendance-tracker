'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('Department Head has a visibly distinct compact assignment layout',()=>{
 const css=read('public/schedule-form-layout.css'),js=read('public/portal.js'),html=read('public/portal.html');
 assert.match(css,/schedule-side-drawer\[data-schedule-role="DEPARTMENT_HEAD"\]:not\(\[hidden\]\)/);
 assert.match(css,/\.schedule-details-section \{\s*order:2;grid-column:1/);
 assert.match(css,/\.schedule-setup-section \{\s*order:3;grid-column:2/);
 assert.match(css,/@media\(max-width:1050px\)/);
 assert.match(js,/heading\.textContent = departmentHead \? 'Create department schedule' : 'Class schedule'/);
 assert.match(js,/intro\.hidden = departmentHead/);
 assert.match(html,/schedule-form-layout\.css\?v=\d+/);
});
test('School Admin retains grace configuration and Department Head cannot set it',()=>{
 const js=read('public/portal.js'),server=read('server.js'),html=read('public/portal.html');
 assert.match(js,/scheduleGraceGroup'\)\.hidden = departmentHead/);
 assert.match(js,/user\.role === 'SCHOOL_ADMIN' \? \{ graceMinutes:/);
 assert.match(server,/const graceMinutes = isDepartmentHead \? 5 :/);
 const form=html.split('<form id="scheduleForm"')[1].split('</form>')[0];
 for(const id of ['scheduleTemplate','scheduleTemplatePeriod','periodTeacher','periodSubject','periodGrade','periodSection','scheduleWeekdayChoices','periodClassroom','graceMinutes'])
   assert.equal((form.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
});
test('cache shell references the exact versioned JS and CSS used by the portal',()=>{
 const html=read('public/portal.html'),sw=read('public/sw.js');
 const js=html.match(/src="(\/portal\.js\?v=[^"]+)"/)[1];
 const css=html.match(/href="(\/schedule-form-layout\.css\?v=[^"]+)"/)[1];
 assert.ok(sw.includes('"'+js+'"'),js);
 assert.ok(sw.includes('"'+css+'"'),css);
});
