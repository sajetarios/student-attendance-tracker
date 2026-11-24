'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=file=>fs.readFileSync(file,'utf8');
const routes=read('staff-lunch-routes.js');
const portal=read('public/portal.html');
const ui=read('public/staff-lunch-ui.js');
const departmentLocationUi=read('public/staff-department-location.js');
const preciseLocation=read('public/staff-precise-location.js');
const page=read('public/staff-lunch-checkin.html');
const scan=read('public/staff-lunch-checkin.js');
const sw=read('public/sw.js');
const server=read('server.js');
test('presenter API uses administrator-only assignment and invalidates outgoing QR',()=>{
 assert.match(routes,/requireSchoolRoles\('SCHOOL_ADMIN'\),async\(req,res\)=>\{/);
 assert.match(routes,/app\.delete\('\/api\/staff-attendance\/lunch\/presenter'/);
 assert.match(routes,/app\.get\('\/api\/staff-attendance\/lunch\/presenter'/);
 assert.match(routes,/role='TEACHER' AND active=TRUE/);
 assert.match(routes,/pg_advisory_xact_lock\(hashtext\(\$1\),hashtext\(\$2\)\)/);
 assert.match(routes,/UPDATE staff_attendance_challenges SET revoked_at=NOW\(\)/);
 assert.match(routes,/LUNCH_PRESENTER_ASSIGNED/);
 assert.match(routes,/LUNCH_PRESENTER_REVOKED/);
});
test('presenter issues real QR image with fragment-only bearer token and bounded short-term rotation',()=>{
 assert.match(routes,/QRCode\.toDataURL\(scanUrl/);
 assert.match(routes,/staff-lunch-checkin\.html#/);
 assert.match(routes,/new URLSearchParams\(\{id,token:challenge\.token\}\)/);
 assert.match(routes,/qrImage,slot,schoolDate:date,expiresAt/);
 assert.match(routes,/MIN_ROTATION_MS/);
 assert.doesNotMatch(routes,/console\.log\(.*challenge\.token/);
});
test('admin and teacher interfaces remain isolated to existing role-specific portals',()=>{
 const teachers=portal.indexOf('id="teachersView"');
 const admin=portal.indexOf('id="staffLunchAdminCard"');
 const student=portal.indexOf('id="myGateAttendanceView"');
 const presenter=portal.indexOf('id="staffLunchPresenterCard"');
 assert.ok(teachers>=0 && admin>=0 && student>=0 && presenter>=0);
 assert.match(portal, /<section id="lunchQrAdminView" class="view-panel" hidden>/);
 assert.match(portal, /<section id="myGateAttendanceView" class="view-panel" hidden>/);
 assert.match(ui,/\['SCHOOL_ADMIN','TEACHER'\]\.includes\(user\?\.role\)/);
 assert.match(ui,/window\.attendigoStaffIdentity\?\.then\(init\)/);
 assert.match(ui,/\/api\/staff-attendance\/lunch\/presenter/);
 assert.match(ui,/\/api\/staff-attendance\/lunch\/challenges/);
 assert.match(ui,/setInterval\(/);
 assert.match(ui,/performance\.now\(\)/);
 assert.doesNotMatch(ui,/Date\.now\(\)>expiry/);
 assert.match(ui,/!document\.hidden/);
 assert.match(portal,/staff-lunch-ui\.js\?v=7/);
 assert.match(portal,/staff-lunch\.css\?v=7/);
});
test('My lunch QR is unhidden by the role-aware portal view switch',()=>{
 const portalJs=read('public/portal.js');
 assert.match(portalJs,/['\"]lunchQrAdmin['\"], ['\"]teacherLunchQr['\"], ['\"]form48Reports['\"]/);
 assert.match(portal,/<section id="teacherLunchQrView" class="view-panel" hidden>/);
});
test('QR scan does not log in or record until authenticated staff confirms explicitly',()=>{
 assert.match(page,/name="referrer" content="no-referrer"/);
 assert.match(page,/name="robots" content="noindex,nofollow,noarchive"/);
 assert.match(scan,/new URLSearchParams\(location\.hash\.slice\(1\)\)/);
 assert.match(scan,/history\.replaceState\(null,'',location\.pathname\)/);
 assert.match(scan,/fetch\('\/api\/auth\/me'/);
 assert.match(scan,/\['TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN'\]\.includes\(me\.role\)/);
 assert.match(scan,/addEventListener\('click',async\(\)=>\{/);
 assert.match(scan,/method:'POST',credentials:'same-origin',cache:'no-store'/);
 assert.doesNotMatch(scan,/localStorage|sessionStorage|location\.search|console\.log/);
 assert.match(server,/app\.get\('\/staff-lunch-checkin\.html'/);
 assert.match(server,/res\.set\('Referrer-Policy','no-referrer'\)/);
});
test('service worker preloads safe assets but excludes sensitive scan document from offline cache',()=>{
 assert.match(sw,/staff-lunch-ui\.js\?v=7/);
 assert.match(sw,/staff-lunch\.css\?v=7/);
 assert.match(sw,/staff-lunch-checkin\.js\?v=5/);
 assert.match(sw,/staff-lunch-checkin\.html/);
 const shell=sw.split('const SHELL = [')[1].split('];')[0];
 assert.doesNotMatch(shell,/staff-lunch-checkin\.html/);
 assert.match(sw,/const CACHE = "attendigo-v\d+-/);
});

test('staff lunch sign-in resumes same challenge without QR rescan or token in query',()=>{
 const login=read('public/portal-login.js');
 const loginPage=read('public/portal-login.html');
 assert.match(scan,/loginFragment=new URLSearchParams\(\{lunchId:challengeId,lunchToken:token\}\)/);
 assert.match(scan,/portal-login\.html#/);
 assert.match(scan,/response\.status===401/);
 assert.match(scan,/verification unavailable/);
 assert.match(login,/window\.location\.hash\.slice\(1\)/);
 assert.match(login,/window\.history\.replaceState\(null/);
 assert.match(login,/lunchContinuation && isLunchStaff\(data\.user\.role\)/);
 assert.match(login,/location\.replace\(lunchContinuation\)/);
 assert.match(page,/id="lunchRetry"/);
 assert.match(loginPage,/portal-login\.js\?v=15/);
 assert.match(sw,/staff-lunch-checkin\.js\?v=5/);
 assert.doesNotMatch(scan,/localStorage|sessionStorage|location\.search|console\.log/);
});

test('lunch confirmation hides unavailable controls and restores auth on browser Back',()=>{
 assert.match(page,/\[hidden\]\{display:none!important\}/);
 assert.match(scan,/window\.addEventListener\('pageshow',event=>/);
 assert.match(scan,/event\.persisted \|\| !valid \|\| completed/);
 assert.match(scan,/location\.replace\('\/staff-lunch-checkin\.html#'/);
 assert.match(scan,/let completed=false/);
 assert.match(scan,/completed=true/);
 assert.match(page,/staff-lunch-checkin\.js\?v=5/);
 assert.match(sw,/staff-lunch-checkin\.js\?v=5/);
 assert.doesNotMatch(scan,/localStorage|sessionStorage|console\.log/);
});

test('department check-in requires location evidence before official DTR approval',()=>{
 assert.match(routes,/classifyDepartmentPresence/);
 assert.match(routes,/LUNCH_SCAN_REVIEW_REQUIRED/);
 assert.match(routes,/verification_status='PENDING_VERIFICATION'/);
 assert.match(routes,/staff_form48_approved_leaves/);
 assert.match(routes,/LUNCH_DTR_MANUAL_VERIFIED/);
 assert.match(departmentLocationUi,/staffLunchHeadSubmit/);
 assert.match(departmentLocationUi,/staffLunchApprovePoint/);
 assert.match(ui,/staffLunchPendingList/);
 assert.match(scan,/collectPreciseLocation/);
 assert.match(preciseLocation,/watchPosition/);
 assert.match(preciseLocation,/getCurrentPosition/);
 assert.match(scan,/body.status==='VERIFIED'/);
 assert.match(portal,/staffLunchPointStatus/);
});


test('location capture belongs to Department Head; Admin approves independently',()=>{
 for(const id of ['staffLunchHeadLocationCard','staffLunchHeadSubmit',
     'staffLunchLocationDepartment','staffLunchApprovePoint','staffLunchRejectPoint'])
  assert.ok(portal.includes('id="'+id+'"'),id+' visible in portal');
 assert.ok(!portal.includes('id="staffLunchSetPoint"'),'obsolete admin GPS button removed');
 assert.ok(portal.includes('staff-department-location.js?v=3'));
 assert.ok(sw.includes('staff-department-location.js?v=3'));
 assert.ok(departmentLocationUi.includes("role==='DEPARTMENT_HEAD'"));
 assert.ok(departmentLocationUi.includes("role==='SCHOOL_ADMIN'"));
 assert.ok(departmentLocationUi.includes("'/api/staff-attendance/lunch/location/propose'"));
 assert.ok(departmentLocationUi.includes("'/api/staff-attendance/lunch/location/decision'"));
 assert.ok(!departmentLocationUi.includes("method:'PUT'"));
 for(const action of ['LUNCH_LOCATION_PROPOSED','LUNCH_LOCATION_APPROVED',
     'LUNCH_LOCATION_REJECTED','FOR UPDATE'])
  assert.ok(routes.includes(action),action+' is enforced server-side');
 assert.ok(routes.includes("requireSchoolRoles('DEPARTMENT_HEAD')"));
 assert.ok(routes.includes("requireSchoolRoles('SCHOOL_ADMIN')"));
 const css=read('public/staff-lunch.css');
 assert.ok(css.includes('.staff-lunch-location-decisions'));
});

test('GPS sampling is bounded and routes uncertainty to review without changing DTR logic',()=>{
 assert.ok(portal.includes('staff-precise-location.js?v=1'));
 assert.ok(page.includes('staff-precise-location.js?v=1'));
 assert.ok(sw.includes('staff-precise-location.js?v=1'));
 assert.ok(departmentLocationUi.includes('collectPreciseLocation'));
 assert.ok(scan.includes('collectPreciseLocation'));
 assert.match(preciseLocation,/enableHighAccuracy:true/);
 assert.match(preciseLocation,/maximumAge:0/);
 assert.match(preciseLocation,/MAX_MS=8500/);
 assert.match(preciseLocation,/MAX_SAMPLES=5/);
 assert.doesNotMatch(preciseLocation,/localStorage|sessionStorage/);
 assert.match(routes,/assessLocationEvidence/);
 assert.match(routes,/sampleCount:presence.sampleCount/);
 assert.match(routes,/locationConfidence:presence.confidence/);
 assert.ok(routes.includes("verification=reasons.length?'PENDING_VERIFICATION':'VERIFIED'"));
});


test('location permission popup guides staff without bypassing approval',()=>{
 const css=read('public/staff-lunch.css');
 assert.doesNotMatch(departmentLocationUi,/navigator\.permissions\.query/);
 assert.match(departmentLocationUi,/staffLocationPermissionDialog/);
 assert.match(departmentLocationUi,/dialog\.showModal\(\)/);
 assert.match(departmentLocationUi,/staffLocationPermissionDevice/);
 assert.match(departmentLocationUi,/Chrome \/ Edge \(computer\)/);
 assert.match(departmentLocationUi,/Android \(Chrome\)/);
 assert.match(departmentLocationUi,/iPhone \/ iPad \(Safari\)/);
 assert.match(departmentLocationUi,/button\.addEventListener\('click',\(\)=>\{[\s\S]*?void submitLocation\(\);/);
 assert.match(departmentLocationUi,/dialog\.close\(\);startCapture\(\);/);
 assert.match(departmentLocationUi,/isEmbeddedBrowser/);
 assert.match(departmentLocationUi,/Precise Location/);
 assert.match(departmentLocationUi,/navigator\.onLine===false/);
 assert.match(sw,/'\/staff-department-location\.js','\/staff-lunch-ui\.js'\]\.includes\(url\.pathname\)/);
 assert.match(departmentLocationUi,/if\(error\?\.code===1\)openGuide\('denied'\)/);
 assert.match(departmentLocationUi,/Location access was denied or blocked/);
 assert.match(departmentLocationUi,/startCapture\(\)/);
 assert.match(departmentLocationUi,/\/api\/staff-attendance\/lunch\/location\/propose/);
 assert.match(departmentLocationUi,/!Array\.isArray\(position\.samples\)\|\|position\.samples\.length<2/);
 assert.match(css,/\.staff-location-permission-dialog::backdrop/);
 assert.match(css,/\.staff-location-permission-actions/);
 assert.match(portal,/staff-lunch\.css\?v=7/);
 assert.match(portal,/staff-department-location\.js\?v=3/);
 assert.match(sw,/staff-lunch\.css\?v=7/);
 assert.match(sw,/staff-department-location\.js\?v=3/);
});

test('department location review uses in-app confirmation and persisted server status',()=>{
 assert.doesNotMatch(departmentLocationUi,/window\.prompt\(/);
 assert.match(departmentLocationUi,/await window\.AppDialog\.prompt\(/);
 assert.match(departmentLocationUi,/Confirm approval/);
 assert.match(departmentLocationUi,/Review cancelled\. No decision was submitted/);
 assert.match(departmentLocationUi,/result\.status!==expected/);
 assert.match(departmentLocationUi,/saved\?\.proposalStatus===expected&&\(!isApproval\|\|saved\.configured\)/);
 assert.match(departmentLocationUi,/Approval confirmed/);
 assert.match(departmentLocationUi,/Review not confirmed/);
 assert.match(departmentLocationUi,/showFeedback\(outcome\)/);
 assert.match(departmentLocationUi,/Refresh location status/);
 assert.match(departmentLocationUi,/result\.approvedAt/);
 assert.match(departmentLocationUi,/if\(!departmentId\|\|busy\)return/);
});

test('presenter obtains fresh GPS for each QR issue and automatic rotation',()=>{
 assert.match(ui,/collectPreciseLocation/);
 assert.match(ui,/JSON\.stringify\(\{slot:slot\.value,location:position\}\)/);
 assert.match(ui,/result\.locationVerified!==true/);
 assert.match(ui,/Location verified/);
 assert.match(routes,/classifyDepartmentPresence\(location\?\.point,req\.body\?\.location,now\)/);
 assert.match(routes,/now-evidence\.point\.capturedAt>30000/);
 assert.match(routes,/LUNCH_PRESENTER_LOCATION_BLOCKED/);
});
