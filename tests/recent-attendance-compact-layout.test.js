'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('public/portal.html','utf8');
const css = fs.readFileSync('public/recent-class-attendance.css','utf8');
const js = fs.readFileSync('public/portal.js','utf8');
const sw = fs.readFileSync('public/sw.js','utf8');
const compact = css.slice(css.indexOf('/* Compact teacher dashboard activity feed'));

test('recent attendance panel scrolls independently on tablet and narrow cards',()=>{
 assert.ok(compact.length>3000,'compact styles are loaded after legacy responsive overrides');
 assert.match(compact,/max-height:min\(440px,55dvh\)!important/);
 assert.match(compact,/overflow-x:hidden!important;overflow-y:auto!important/);
 assert.match(compact,/overscroll-behavior:contain/);
 assert.match(compact,/scrollbar-width:thin/);
 assert.match(compact,/@container \(max-width:710px\)/);
 assert.match(compact,/max-height:min\(390px,55dvh\)!important/);
 assert.match(html,/class="table-scroll" role="region" aria-label="Latest verified manual and QR class attendance" tabindex="0"/);
 assert.match(compact,/#recentActivityCard \.table-scroll:focus-visible/);
});

test('teacher dashboard uses available width and keeps shortcuts aligned',()=>{
 assert.match(compact,/grid-template-columns:minmax\(0,1\.45fr\) minmax\(275px,1fr\)/);
 assert.match(compact,/html\.attendigo-teacher-v2 #dashboardView>/);
 assert.match(compact,/#quickActionsCard\{align-self:start;min-width:0\}/);
 assert.match(compact,/@media\(max-width:1120px\)/);
 assert.match(compact,/grid-template-columns:minmax\(0,1fr\)/);
});

test('compact list retains all six reconciled display fields',()=>{
 assert.match(js,/class="recent-unified-row"/);
 for(const field of ['Learner','Class','Date','Status','Source','Recorded time'])
  assert.ok(js.includes('data-label="'+field+'"'),field);
 for(const n of [1,2,3,4,5,6])
  assert.ok(compact.includes('tr.recent-unified-row td:nth-child('+n+')'),'field '+n);
 assert.match(js,/const conflictNote = row\.needsReview/);
 assert.match(js,/const source = row\.source === 'MANUAL'/);
});

test('versioned styles are aligned between portal and PWA cache',()=>{
 assert.ok(html.includes('/recent-class-attendance.css?v=2'));
 assert.ok(sw.includes('/recent-class-attendance.css?v=2'));
});
