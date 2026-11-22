'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {assertCachedAsset}=require('./support/asset-contract');

const html=fs.readFileSync('public/portal.html','utf8');
const css=fs.readFileSync('public/form48-report.css','utf8');
const js=fs.readFileSync('public/form48-report.js','utf8');
const sw=fs.readFileSync('public/sw.js','utf8');

test('report-first layout keeps employee, month, verified preview and admin review controls',()=>{
 for(const id of ['form48ReportsView','form48Employee','form48Month','form48Print','form48PrintArea',
  'form48DailyInsights','form48GateIntelligence','form48AdvancedSettings','form48BatchPanel',
  'form48SummaryStrip','form48PreviewToolbar','form48VerifiedDays','form48ToReview','form48Tardy','form48Undertime']){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
 assert.match(css,/#form48ReportCard>#form48PrintArea\{order:7\}/);
 assert.match(css,/#form48ReportCard>#form48DailyInsights\{order:8\}/);
 assert.match(css,/#form48ReportCard>#form48GateIntelligence\{order:9\}/);
 assert.match(css,/#form48ReportCard>#form48AdvancedSettings\{order:10\}/);
 assertCachedAsset(html,sw,'form48-report.css',{minimumVersion:13});
 assertCachedAsset(html,sw,'form48-report.js',{minimumVersion:14});
});

test('screen copy selector is functional but print always uses both official copies',()=>{
 for(const [copy,label] of [['office','Office copy'],['employee','Employee copy'],['both','Both']]){
  assert.match(html,new RegExp('data-form48-copy="'+copy+'"'));
  assert.ok(html.includes(label));
 }
 assert.match(html,/aria-pressed="true"/);
 assert.match(js,/output\.dataset\.copyView=choice\.dataset\.form48Copy/);
 assert.match(js,/querySelectorAll\('button\[data-form48-copy\]'\)/);
 assert.match(css,/@media screen/);
 assert.match(css,/#form48PrintArea\[data-copy-view="office"\]/);
 assert.match(css,/#form48PrintArea\[data-copy-view="employee"\]/);
 assert.match(css,/#form48PrintArea\[data-copy-view="both"\]/);
 assert.match(js,/copy\(data,analysis,"Office's"\)\+copy\(data,analysis,"Employee's"\)/);
 assert.match(js,/function printDtrFromIsolatedPage\(output,status\)/);
 assert.match(js,/@page\{size:A4 portrait;margin:5mm\}/);
});

test('metric cards display API analysis totals without changing attendance or certification data',()=>{
 for(const field of ['daysPresent','partialRecordDays','pendingAbsentDays','tardyMinutes','undertimeMinutes'])
  assert.ok(js.includes('sum.'+field));
 assert.match(js,/summaryStrip\.hidden=false/);
 assert.match(js,/previewToolbar\.hidden=false/);
 assert.match(js,/if\(summaryStrip\)summaryStrip\.hidden=true/);
 assert.match(js,/if\(previewToolbar\)previewToolbar\.hidden=true/);
 assert.match(js,/Only verified punches contribute to time calculations/);
 assert.doesNotMatch(js,/fetch\([^\n]*\/api\/staff-attendance\//);
});
