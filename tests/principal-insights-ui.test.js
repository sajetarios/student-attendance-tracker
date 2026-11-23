'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');
const portal=read('public/portal.html'),controller=read('public/portal.js'),
  client=read('public/principal-insights.js'),api=read('principal-insights-routes.js');
test('Principal preview is a distinct School Admin-only navigable workspace',()=>{
 assert.match(portal,/id="principalInsightsView"[^>]*hidden/);
 assert.match(portal,/id="principalInsightsNav"[^>]*data-view="principalInsights"[^>]*hidden/);
 assert.match(controller,/if \(role === 'SCHOOL_ADMIN'\) return \['dashboard', 'principalInsights'/);
 assert.match(controller,/\$('principalInsightsNav'\)\) \$('principalInsightsNav'\)\.hidden = !admin/);
 assert.match(controller,/principalInsights: \['Principal View/);
 assert.match(api,/requireSchoolRoles\('SCHOOL_ADMIN'\)/);
 assert.doesNotMatch(api,/app\.(post|put|patch|delete)\('/);
});
test('Principal metrics never use hard-coded demo figures and preserve caveats',()=>{
 for(const id of ['piVerified','piPending','piLearners','piApprovals','piTrend',
   'piDepartments','piCases','piAttention','piDays','piDepartment','piRefresh'])
  assert.ok(portal.includes('id="'+id+'"'),id+' exists');
 assert.match(client,/fetch\('\/api\/principal\/insights\?'/);
 assert.match(client,/No figures are shown until data is available/);
 assert.match(client,/Missing entries are not confirmed absences/);
 assert.match(client,/school-wide even when a department is selected/);
 assert.match(portal,/No separate Principal login or approval authority is enabled/);
 assert.match(api,/Missing scans do not prove absence/);
 assert.match(api,/Read-only executive intelligence/);
});
test('Principal preview responds to keyboard, date changes and department selections',()=>{
 assert.match(client,/addEventListener\('change',\(\)=>\{void load\(\);\}\)/);
 assert.match(client,/addEventListener\('click',\(\)=>focus\(el\.dataset\.piFocus\)\)/);
 assert.match(client,/MutationObserver/);
 assert.match(client,/pi-dept-active/);
 assert.match(client,/createElement\('button'\)/);
 assert.match(client,/new URLSearchParams/);
 assert.doesNotMatch(client,/localStorage|sessionStorage|innerHTML|document\.write/);
});
test('new UI assets are versioned in portal and service-worker shell',()=>{
 const sw=read('public/sw.js');
 for(const url of ['principal-insights.js?v=1','principal-insights.css?v=1']){
  assert.ok(portal.includes(url));
  assert.ok(sw.includes(url));
 }
 assert.ok(portal.includes('portal.js?v=237'));
});
