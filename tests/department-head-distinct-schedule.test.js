'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('Department Head only manages assignments and temporary adjustments',()=>{
 const ui=read('public/schedule-workspace-ui.js'),p=read('public/portal.js'),s=read('server.js');
 assert.match(ui,/assignment\.textContent='Assign teachers'/);
 assert.match(p,/const deleteAction = user\.role === 'SCHOOL_ADMIN'/);
 assert.match(p,/Only School Admin can create official class schedules/);
 for(const m of ['post','patch','delete'])assert.match(s,new RegExp("app\\."+m+"\\('/api/periods"+(m==='post'?"":"\\/:periodId")+"', authenticateSchoolClient, requireSchoolRoles\\('SCHOOL_ADMIN'\\)"));
});
test('cache shell references the exact versioned JS and CSS used by the portal',()=>{
 const html=read('public/portal.html'),sw=read('public/sw.js');
 const js=html.match(/src="(\/portal\.js\?v=[^"]+)"/)[1];
 const css=html.match(/href="(\/schedule-form-layout\.css\?v=[^"]+)"/)[1];
 assert.ok(sw.includes('"'+js+'"'),js);
 assert.ok(sw.includes('"'+css+'"'),css);
});
