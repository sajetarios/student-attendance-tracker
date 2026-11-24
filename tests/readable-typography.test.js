'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..','public',name),'utf8');
test('screen typography uses 16px reading text without changing print defaults',()=>{
 const css=read('typography.css');
 const screen=css.match(/@media screen \{\s*:root\s*\{([^}]+)\}/)[1];
 for(const name of ['body','name','table','control','secondary']) assert.match(screen,new RegExp('--type-'+name+': 1rem;'));
 assert.match(screen,/--type-count: \.875rem;/);
 assert.match(css,/--type-title: 1\.625rem;/);
 assert.match(css,/--type-section: 1\.1875rem;/);
 assert.match(css,/--type-secondary: \.8125rem;/);
 assert.match(css,/#smartAttendanceOverview/);
 assert.match(css,/\.missing-scan-dialog/);
 assert.match(css,/#studentRosterTable/);
});
test('all key portals share typography and offline assets are cached',()=>{
 for(const page of ['portal.html','principal.html','student-portal.html','parent-portal.html','portal-login.html','gate-offline.html','offline-sheet.html','student-qr-offline.html']) assert.match(read(page),/href="\/typography\.css\?v=1"/);
 const sw=read('sw.js');
 assert.match(sw,/attendigo-v373-readable-typography/);
 assert.ok(sw.includes("'/typography.css'"));
 assert.ok(sw.split('const SHELL')[0].includes('"/typography.css?v=1"'));
});
