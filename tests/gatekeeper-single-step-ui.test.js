'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const js=fs.readFileSync('public/portal.js','utf8');
const html=fs.readFileSync('public/portal.html','utf8');
const worker=fs.readFileSync('public/sw.js','utf8');
const {assertCachedAsset}=require('./support/asset-contract');
test('Gatekeeper camera starts directly without exposing teacher class setup',()=>{
 const start=js.indexOf("  $('studentScannerToggle').addEventListener('click', async () => {");
 const end=js.indexOf("  $('gateScanType')?.addEventListener",start);
 assert.ok(start>0&&end>start);
 const action=js.slice(start,end);
 assert.match(action,/if \(user\.role === 'GATE_KEEPER'\)/);
 assert.match(action,/activeScanScope = 'SCHOOL'/);
 assert.match(action,/activeScanPeriodId = null/);
 assert.match(action,/await startStudentScanner\(\)/);
 assert.match(action,/return;\s*}\s*if \(user\.role !== 'TEACHER'/);
 assert.match(action,/configureScannerScopeForRole\(\{reset:true\}\);\s*\$\('studentScanSetupModal'\)\.hidden = false/);
 assert.match(js,/const canUseScope = \(scope === 'CLASS' && teacherHas\('SUBJECT_TEACHER'\)\) \|\|/);
});
test('guard can still choose an optional advanced learner/teacher filter',()=>{
 assert.match(html,/<details class="gate-scan-advanced">/);
 assert.match(html,/<summary>Advanced: scan only learners or teachers<\/summary>/);
 assert.match(html,/id="gateScanType"/);
 assert.match(html,/Automatic — learners and teachers/);
 assert.match(html,/Official time comes from the server/);
 assertCachedAsset(html,worker,'portal.js',{minimumVersion:224});
});
