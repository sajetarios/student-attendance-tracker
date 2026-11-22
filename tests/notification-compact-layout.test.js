'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.resolve(__dirname, '..', name), 'utf8');

test('All roles use the compact shared notification layout with versioned PWA assets', () => {
 const script = read('public/universal-notifications.js');
 const css = read('public/universal-notifications.css');
 const sw = read('public/sw.js');
 for (const html of ['public/portal.html', 'public/student-portal.html', 'public/parent-portal.html']) {
   assert.ok(read(html).includes('/universal-notifications.js?v='+(html==='public/portal.html'?'7':'5')), html + ': compact JS');
   assert.ok(read(html).includes('/universal-notifications.css?v=4'), html + ': compact CSS');
 }
 assert.ok(sw.includes('"/universal-notifications.js?v=7"'));
 assert.ok(sw.includes('"/universal-notifications.css?v=4"'));
 assert.match(script, /role === 'SUPER_ADMIN' \? '\/api\/platform\/notifications' : '\/api\/notifications'/);
 assert.match(css, /\.universal-panel\{display:flex;flex-direction:column;overflow:hidden/);
 assert.match(css, /\.universal-preview\{[^}]*overflow-y:auto/);
 assert.match(css, /\.universal-center-list\{[^}]*overscroll-behavior:contain/);
 assert.match(css, /@media\(max-width:700px\)/);
 assert.match(css, /@media\(max-width:380px\)/);
});

test('List shows concise two-line previews with full message retained in detail view', () => {
 const script=read('public/universal-notifications.js');
 const css=read('public/universal-notifications.css');
 assert.match(script, /text\('small', 'universal-notice-excerpt', item\.body\)/);
 assert.match(script, /text\('strong', 'universal-notice-title', item\.title\)/);
 assert.match(script, /const fmtShort = iso =>/);
 assert.match(script, /meta\.append\(stamp\)/);
 assert.match(script, /String\(item\.category \|\| ''\)\.toUpperCase\(\) !== 'SYSTEM'/);
 assert.match(script, /button\.setAttribute\('aria-label', 'View notification: ' \+ item\.title\)/);
 assert.match(script, /const message = text\('p', null, item\.body\)/);
 assert.match(script, /'Request reference: ' \+ item\.requestId/);
 assert.match(script, /fillList\(preview, data\.slice\(0, 6\)/);
 assert.match(css, /\.universal-notice-content \.universal-notice-excerpt\{[^}]*-webkit-line-clamp:2/);
 assert.match(css, /\.universal-notice-content \.universal-notice-title\{[^}]*-webkit-line-clamp:2/);
});

test('Read, delete, and full-detail navigation remain available, accessible and separate',()=>{
 const script=read('public/universal-notifications.js');
 const css=read('public/universal-notifications.css');
 assert.match(script, /universal-read-all/);
 assert.match(script, /universal-delete-read/);
 assert.match(script, /universal-view-all/);
 assert.match(script, /universal-delete-read-center/);
 assert.match(script, /removeButton\.addEventListener\('click', \(\) => deleteOne\(item, removeButton\)\)/);
 assert.match(script, /button\.addEventListener\('click', \(\) => openItem\(item\)\)/);
 assert.match(script, /closeButton\.focus\(\)/);
 assert.match(script, /document\.addEventListener\('keydown'/);
 assert.match(css, /\.universal-notice-row \.universal-delete\{[^}]*min-height:40px/);
 assert.match(css, /\.universal-panel-actions button\{min-height:34px/);
 assert.ok(!script.includes('localStorage.setItem('), 'No notification content written to persistent browser storage');
});

test('System status and full timestamp use lightweight compact presentation', () => {
 const script = read('public/universal-notifications.js');
 const css = read('public/universal-notifications.css');
 assert.match(script, /String\(item\.category \|\| ''\)\.toUpperCase\(\) !== 'SYSTEM'/);
 assert.match(script, /day \+ ' · ' \+ time/);
 assert.match(script, /'universal-detail-status'/);
 assert.match(script, /'universal-detail-when'/);
 assert.match(css, /universal-notice-title\{font-size:12\.5px;[^}]*font-weight:600/);
 assert.match(css, /universal-notice-excerpt\{font-size:11\.5px;[^}]*font-weight:400/);
 assert.match(css, /universal-notice-time\{display:inline;margin:0;font-size:10\.5px;font-weight:400/);
 assert.match(css, /\.universal-detail-card p\.universal-detail-status\{[^}]*font-size:11px;[^}]*font-weight:450/);
 assert.match(css, /\.universal-detail-card \.universal-detail-when\{[^}]*font-size:11px;[^}]*font-weight:400/);
});

test('Online notification assets bypass stale cache but preserve offline fallback', () => {
 const sw = read('public/sw.js');
 assert.match(sw, /universal-notifications\.js/);
 assert.match(sw, /universal-notifications\.css/);
 assert.match(sw, /\['\/universal-notifications\.js','\/universal-notifications\.css','\/portal\.js'/);
 assert.match(sw, /fetch\(request, \{ cache: 'no-store' \}\)/);
 assert.match(sw, /caches\.match\(request\)/);
 for (const portal of ['public/portal.html','public/student-portal.html','public/parent-portal.html']) {
   assert.ok(read(portal).includes('/universal-notifications.js?v='+(portal==='public/portal.html'?'7':'5')));
   assert.ok(read(portal).includes('/universal-notifications.css?v=4'));
 }
});
