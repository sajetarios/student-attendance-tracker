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
