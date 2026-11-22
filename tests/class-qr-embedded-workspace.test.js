'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {assertCachedAsset,assertCacheRevisionAtLeast}=require('./support/asset-contract');
const read=path=>fs.readFileSync(path,'utf8');
const html=read('public/portal.html'),controller=read('public/portal.js');
const legacy=read('public/class-qr-monitor.html'),monitor=read('public/class-qr-monitor.js');
const sidebar=read('public/simplified-workspace.js'),shortcut=read('public/class-qr-dashboard-link.js');
const css=read('public/class-qr-monitor-embedded.css'),sw=read('public/sw.js');

test('the administrator QR monitoring view lives in the primary workspace with one correct sidebar link',()=>{
 assert.match(html,/id="classQrAdminMonitorNav" data-view="classQrMonitor" hidden href="\/portal\.html\?view=classQrMonitor"/);
 assert.match(html,/id="attendanceManagementNavChildren"[\s\S]*?id="classQrAdminMonitorNav"[\s\S]*?id="offlineScanReviewsNav"/);
 assert.match(html,/<section id="classQrMonitorView" class="view-panel"[^>]*hidden>/);
 assert.match(html,/id="monitorPage" hidden/);
 for(const field of ['refresh','schoolDate','scheduledCount','sessionCount','activeCount','checkinCount',
   'classRows','overridePanel','overrideForm','overrideConfirm','overrideCancel','overrideReason','message']){
  assert.equal(html.split('id="'+field+'"').length,2,'must have exactly one '+field);
 }
 assert.match(controller,/if \(\$\('classQrAdminMonitorNav'\)\) \$\('classQrAdminMonitorNav'\)\.hidden = !admin/);
 assert.doesNotMatch(shortcut,/href = '\/class-qr-monitor\.html'/);
 assert.match(shortcut,/if \(user\.role !== 'TEACHER'\) return/);
 assert.match(shortcut,/link\.href = '\/class-qr-teacher\.html'/);
});
test('history and dashboard shortcuts use the existing role-guarded view controller',()=>{
 assert.match(controller,/if \(role === 'SCHOOL_ADMIN'\) return \[[^\n]*'classQrMonitor'/);
 assert.match(controller,/\'classAttendance\', 'classQrMonitor\', 'myGateAttendance\'/);
 assert.match(controller,/classQrMonitor: \['Class Attendance Monitoring'/);
 assert.match(controller,/view === 'classQrMonitor'[\s\S]{0,170}setView\('classQrMonitor'\)/);
 assert.match(controller,/view === 'classQrMonitor' && role === 'SCHOOL_ADMIN'/);
 assert.match(controller,/new Event\('attendigo:class-qr-monitor-open'\)/);
 const teacherAllow=controller.match(/if \(role === 'TEACHER'\) \{([\s\S]*?)\n    \}/)?.[1]||'';
 const deptAllow=controller.match(/if \(role === 'DEPARTMENT_HEAD'\) return ([^\n]+)/)?.[1]||'';
 assert.doesNotMatch(teacherAllow,/classQrMonitor/);
 assert.doesNotMatch(deptAllow,/classQrMonitor/);
 assert.doesNotMatch(controller,/window\.location\.assign\('\/class-qr-monitor\.html'\)/);
});
test('the simplified School Admin menu groups monitoring and existing attendance tools in Attendance Management',()=>{
 for(const link of ['offlineScanReviewsNav','myGateAttendanceNav','lunchQrAdminNav','officialBusinessNav'])
  assert.ok(sidebar.includes("move('"+link+"', 'attendanceManagement')"),link+' is lost');
 assert.match(sidebar,/label\('attendanceManagement', 'Attendance Management'\)/);
 assert.match(sidebar,/group\('attendanceManagement'\), group\('operations'\)/);
 assert.doesNotMatch(sidebar,/\.cloneNode\(/);
 assert.match(sidebar,/authorizedChildren\(wrapper\)/);
});
test('all original monitoring and audited emergency session close controls survive without a second API implementation',()=>{
 for(const endpoint of ['/api/class-qr/today','/api/class-qr/monitor','/api/class-qr/admin-override/sessions/'])
  assert.ok(monitor.includes(endpoint));
 assert.match(monitor,/reason\.length < 12 \|\| reason\.length > 500/);
 assert.match(monitor,/session\.checkedIn/);
 assert.match(monitor,/session\.present \+ ' \/ ' \+ session\.late/);
 assert.match(monitor,/document\.addEventListener\('attendigo:class-qr-monitor-open'/);
 assert.match(monitor,/const embedded = Boolean\(\$\('classQrMonitorView'\)\)/);
 assert.match(monitor,/if \(user\?\.role !== 'SCHOOL_ADMIN'\)/);
 assert.match(monitor,/authorized = true/);
 assert.match(monitor,/if \(!\$\('classQrMonitorView'\)\.hidden\) await refresh\(\)/);
 const routes=read('class-qr-routes.js');
 assert.match(routes,/app\.get\('\/api\/class-qr\/monitor',authenticateSchoolClient,admin,/);
 assert.match(routes,/app\.post\('\/api\/class-qr\/admin-override\/sessions\/:id\/close',authenticateSchoolClient,admin,/);
});
test('saved URLs redirect to the embedded view and signed-in roles remain protected',()=>{
 assert.match(legacy,/src="\/class-qr-monitor\.js\?v=2"/);
 assert.match(monitor,/location\.replace\('\/portal\.html\?view=classQrMonitor'\)/);
 assert.match(monitor,/if \(!embedded\) location\.replace\('\/portal\.html'\)/);
 assert.match(monitor,/if \(embedded && authorized && !\$\('classQrMonitorView'\)\.hidden\) refresh\(\)/);
 assert.match(legacy,/data-protected-role="STAFF"/);
 assert.match(sw,/if \(\["\/portal\.html", "\/class-qr-monitor\.html"/);

});
test('embedded CSS is responsive and isolated from printed reports; all assets are fresh',()=>{
 assert.match(css,/#classQrMonitorView \.class-qr-monitor-stats/);
 assert.match(css,/#classQrMonitorView \.class-qr-monitor-table-wrap/);
 assert.match(css,/@media screen and \(max-width:850px\)/);
 assert.match(css,/@media screen and \(max-width:520px\)/);
 assert.doesNotMatch(css,/@page|@media print|#form48PrintArea/);
 for(const [path,version] of [
  ['class-qr-monitor-embedded.css',1],['class-qr-monitor.js',2],
  ['portal.js',225],['class-qr-dashboard-link.js',12],['simplified-workspace.js',2]
 ])assertCachedAsset(html,sw,path,{minimumVersion:version});
 assertCacheRevisionAtLeast(sw,292);
 assert.match(sw,/\/class-qr-monitor-embedded\.css','\/class-qr-dashboard-link\.js'/);
});
