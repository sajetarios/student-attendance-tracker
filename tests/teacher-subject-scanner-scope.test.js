'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {assertCachedAsset,assertCacheRevisionAtLeast}=require('./support/asset-contract');
const read=name=>fs.readFileSync('public/'+name,'utf8');
const html=read('portal.html'),js=read('portal.js'),sw=read('sw.js');
const scopeSource=js.slice(js.indexOf('  function configureScannerScopeForRole('),js.indexOf('  async function loadSchoolData()'));
assert.match(scopeSource,/function configureScannerScopeForRole/);

function checkScope(role,designations,stale='SCHOOL'){
  const options=['CLASS','ADVISORY','SCHOOL'].map(value=>({value,hidden:false,disabled:false}));
  const scope={options,value:stale,disabled:false};
  const title={textContent:''},description={textContent:''},period={hidden:true};
  const controls={scanSetupScope:scope,scanSetupPeriodWrap:period,scanSetupTitle:title};
  vm.runInNewContext(scopeSource+'\nconfigureScannerScopeForRole({reset:true});',{
    user:{role},teacherHas:name=>designations.includes(name),
    $:name=>controls[name],document:{querySelector:()=>description}
  });
  return {scope,options,period,title:title.textContent,description:description.textContent};
}
test('teacher subject scanner never retains native iPad SCHOOL selection',()=>{
 const result=checkScope('TEACHER',['SUBJECT_TEACHER']);
 assert.equal(result.scope.value,'CLASS');
 assert.equal(result.scope.disabled,true);
 assert.equal(result.period.hidden,false);
 assert.match(result.title,/subject-class attendance scanner/);
 assert.match(result.description,/not school-gate/);
 assert.deepEqual(result.options.filter(o=>!o.disabled).map(o=>o.value),['CLASS']);
 for(const o of result.options.filter(o=>o.value==='SCHOOL')) assert.equal(o.hidden,true);
});
test('subject teacher who also advises defaults to CLASS but can select ADVISORY separately',()=>{
 const result=checkScope('TEACHER',['SUBJECT_TEACHER','CLASS_ADVISER']);
 assert.equal(result.scope.value,'CLASS');
 assert.equal(result.scope.disabled,false);
 assert.deepEqual(result.options.filter(o=>!o.disabled).map(o=>o.value),['CLASS','ADVISORY']);
 assert.equal(result.period.hidden,false);
});
test('advisory-only teachers cannot scan as subject teachers or gatekeepers',()=>{
 const result=checkScope('TEACHER',['CLASS_ADVISER']);
 assert.equal(result.scope.value,'ADVISORY');
 assert.equal(result.period.hidden,true);
 assert.deepEqual(result.options.filter(o=>!o.disabled).map(o=>o.value),['ADVISORY']);
});
test('Gatekeeper alone retains the school gate QR scanning mode',()=>{
 const result=checkScope('GATE_KEEPER',[]);
 assert.equal(result.scope.value,'SCHOOL');
 assert.equal(result.scope.disabled,true);
 assert.deepEqual(result.options.filter(o=>!o.disabled).map(o=>o.value),['SCHOOL']);
 assert.match(result.title,/Gate attendance scanner/);
});
test('scanner defaults safely in markup before asynchronous teacher load',()=>{
 assert.match(html,/<option value="CLASS" selected>Subject-class attendance<\/option>/);
 assert.match(html,/<option value="SCHOOL" hidden disabled>/);
 assert.match(html,/id="scanSetupPeriodWrap"[^>]*>Assigned subject class/);
 assert.match(html,/\.scan-setup-field select:disabled \{ opacity:1/);
 assert.doesNotMatch(html,/<option value="SCHOOL" selected/);
});
test('teacher role guard is enforced when opening, starting and recording scan events',()=>{
 assert.match(js,/configureScannerScopeForRole\(\{reset:true\}\);\s*\$\('studentScanSetupModal'\)\.hidden = false/);
 assert.match(js,/const canUseScope = \(scope === 'CLASS' && teacherHas\('SUBJECT_TEACHER'\)\) \|\|/);
 assert.match(js,/Teachers cannot record school-gate attendance/);
 assert.match(js,/if \(scope === 'ADVISORY' && !adviserAssignments\.length\)/);
 assert.match(js,/!periods\.some\(p => String\(p\.periodId\) === String\(activeScanPeriodId\)\)/);
 assert.match(js,/Teacher QR scans must use an assigned subject class or advisory section/);
 assert.match(js,/activeScanScope = scope/);
 assert.match(js,/activeScanPeriodId = scope === 'CLASS'/);
 const server=fs.readFileSync('server.js','utf8');
 assert.match(server,/req\.auth\.role === 'TEACHER' && !\['CLASS', 'ADVISORY'\]\.includes\(event\.attendanceScope\)/);
 assert.match(server,/req\.auth\.role === 'GATE_KEEPER' && event\.attendanceScope !== 'SCHOOL'/);
});
test('teacher scanner mode is set only after assigned advisers and schedules are loaded',()=>{
 const data=js.slice(js.indexOf('  async function loadSchoolData()'),js.indexOf('  // One read-only daily view'));
 assert.ok(data.indexOf("adviserAssignments = adviserData.assignments || [];") < data.indexOf("configureScannerScopeForRole({reset:true});\n    await loadSchedulingSettings()"));
 assert.match(data,/Select assigned subject class/);
 assert.match(data,/p\.subjectName \|\| p\.periodName/);
});
test('teacher scanner code and PWA cache versions match without altering QR engine',()=>{
 assertCachedAsset(html,sw,'portal.js',{minimumVersion:228});
 assertCacheRevisionAtLeast(sw,296);
 assert.match(js,/Html5Qrcode\.getCameras\(\)/);
 assert.match(js,/window\.AttendigoOffline\.record\(event, api\)/);
 assert.match(js,/attendanceScope: scope, periodId/);
});
