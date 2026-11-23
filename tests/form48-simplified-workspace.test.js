'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('public/portal.html','utf8');
const css=fs.readFileSync('public/form48-report.css','utf8');
const js=fs.readFileSync('public/form48-report.js','utf8');
const sw=fs.readFileSync('public/sw.js','utf8');
test('Form 48 keeps a report-first mobile flow with reachable review and settings',()=>{
 assert.match(html,/<h3>Form 48 DTR<\/h3>/);
 for(const id of ['form48FilterForm','form48Employee','form48Month','form48Print','form48SummaryStrip','form48ReviewOpen','form48AdvancedSettings','form48DailyInsights','form48SchoolSignatories','form48PrintArea']){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
 assert.match(css,/#form48ReportCard>#form48FilterForm\{order:1\}/);
 assert.match(css,/#form48ReportCard>#form48PrintArea\{order:6\}/);
 assert.match(css,/#form48ReportCard>#form48SchoolSignatories\{order:12/);
 assert.match(css,/@media screen and \(max-width:580px\)/);
 assert.match(js,/advancedReview\.open=true/);
 assert.match(js,/advancedReview\.scrollIntoView/);
});
test('Simplified Form 48 preserves print and DTR source and invalidates old cache',()=>{
 assert.match(js,/function printDtrFromIsolatedPage\(output,status\)/);
 assert.match(js,/@page\{size:A4 portrait;margin:5mm\}/);
 assert.match(js,/api\('\/api\/staff-attendance\/admin\/form48\/analysis\?/);
 assert.match(html,/form48-report\.css\?v=16/);
 assert.match(html,/form48-report\.js\?v=17/);
 assert.match(sw,/attendigo-v315-form48-report-first/);
 assert.match(sw,/form48-report\.css\?v=16/);
 assert.match(sw,/form48-report\.js\?v=17/);
});
