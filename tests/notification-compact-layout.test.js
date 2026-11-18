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
   assert.ok(read(html).includes('/universal-notifications.js?v=4'), html + ': compact JS');
   assert.ok(read(html).includes('/universal-notifications.css?v=3'), html + ': compact CSS');
 }
 assert.ok(sw.includes('"/universal-notifications.js?v=4"'));
 assert.ok(sw.includes('"/universal-notifications.css?v=3"'));
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
 assert.match(script, /item\.category !== 'SYSTEM'/);
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
 assert.match(css, /\.universal-panel-actions button\{[^}]*min-height:36px/);
 assert.ok(!script.includes('localStorage.setItem('), 'No notification content written to persistent browser storage');
});
