'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('My Students always identifies the import entry point and advisory prerequisites', () => {
  const html = read('public/portal.html');
  const js = read('public/portal.js');
  assert.match(html, /id="bulkImportStudentsButton"/);
  assert.match(html, /id="studentImportAccessNote"/);
  assert.match(js, /\$\('bulkImportStudentsButton'\)\.hidden = !\(admin \|\| teacher\)/);
  assert.match(js, /SF1 imports require a Class Adviser designation/);
  assert.match(js, /Student import access required/);
  assert.match(js, /Assign an advisory class first/);
});

test('Teacher imports default to LIS SF1 Excel/PDF while authorization remains server-side', () => {
  const js = read('public/portal.js');
  const sf1 = read('sf1-import-routes.js');
  assert.match(js, /user\.role === 'TEACHER' \? 'sf1' : 'template'/);
  assert.match(js, /studentImportFormat'\)\.dispatchEvent\(new Event\('change'\)\)/);
  assert.match(js, /\.xls,\.xlsx,\.pdf,application\/vnd\.ms-excel/);
  assert.match(sf1, /requireSchoolRoles\('SCHOOL_ADMIN','TEACHER'\)/);
  assert.match(sf1, /!req\.auth\.teacherDesignations\?\.includes\('CLASS_ADVISER'\)/);
  assert.match(sf1, /FROM class_adviser_assignments WHERE school_id=\$1 AND adviser_user_id=\$2/);
  assert.match(sf1, /Configure an active school year before importing SF1/);
});

test('Offline shell loads the version that includes teacher import guidance', () => {
  const html = read('public/portal.html'), worker=read('public/sw.js');
  assert.match(html, /\/portal\.js\?v=203/);
  assert.match(worker, /"\/portal\.js\?v=203"/);
});
