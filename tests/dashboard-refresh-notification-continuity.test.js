'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
test('location proposal and decision notifications are transaction-bound and school-scoped',()=>{
 const sql=read('migrations/084_department_location_notifications.sql');
 assert.match(sql,/AFTER INSERT OR UPDATE OF setting_value ON school_settings/);
 assert.match(sql,/school_id=p_school AND role='SCHOOL_ADMIN' AND active=TRUE/);
 assert.match(sql,/v_key\|\|':pending'/);
 assert.match(sql,/v_key\|\|':decision'/);
 assert.match(sql,/setting_value->>'status'='PENDING'/);
 assert.doesNotMatch(sql,/latitude|longitude/);
});
test('notification refresh is active without page reload and explicit location routing is role scoped',()=>{
 const src=read('public/universal-notifications.js');
 assert.match(src,/setInterval\([\s\S]*?, 10000\)/);
 assert.match(src,/addEventListener\('online'/);
 assert.match(src,/requestType==='DEPARTMENT_LOCATION'&&user.role==='SCHOOL_ADMIN'/);
 assert.match(src,/go\('lunchQrAdmin'\)/);
 assert.match(src,/AttendigoDepartmentLocation\?\.open\(item.requestId\)/);
 assert.match(src,/This module is unavailable for your current account/);
});
test('dashboard refresh updates existing role widgets without reloading the page',()=>{
 const src=read('public/portal.js');
 assert.match(src,/attendigo:dashboard-refresh/);
 assert.match(src,/Promise.all\(\[loadSchoolData\(\),\.\.\.tasks\]\)/);
 for(const f of ['teacher-teaching-overview.js','department-workspace.js','smart-attendance-overview.js'])assert.match(read('public/'+f),/attendigo:dashboard-refresh/);
 assert.match(read('public/dashboard-icons.js'),/glyphs.slice\(1\)/);
});
