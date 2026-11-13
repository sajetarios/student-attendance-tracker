'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'portal.html'), 'utf8');
const portal = fs.readFileSync(path.join(root, 'public', 'portal.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations', '014_student_sex_and_roster_management.sql'), 'utf8');
const sf2 = fs.readFileSync(path.join(root, 'sf2-routes.js'), 'utf8');

test('student create and edit forms require Male/Female and persist sex on the master record', () => {
  assert.ok(html.includes('id="newSex" required'));
  assert.ok(html.includes('id="editSex" required'));
  assert.ok(html.includes('value="MALE">Male</option>'));
  assert.ok(html.includes('value="FEMALE">Female</option>'));
  assert.ok(portal.includes("sex: $('newSex').value"));
  assert.ok(portal.includes("payload.sex = $('editSex').value"));
  assert.ok(server.includes('sex, parentName, parentMobile'));
  assert.ok(server.includes('sex=EXCLUDED.sex'));
  assert.ok(server.includes('parent_mobile=$8, sex=$9'));
  assert.ok(migration.includes("sex IS NULL OR sex IN ('MALE','FEMALE')"));
});

test('student roster exposes sex and cloud status never claims replication is active', () => {
  assert.ok(server.includes('s.sex'));
  assert.ok(html.includes('Checking cloud sync status…'));
  assert.ok(sf2.includes('COALESCE(en.grade_level,s.grade_level)'));
  assert.ok(sf2.includes('COALESCE(en.section,s.section)'));
  assert.ok(sf2.includes('s.sex'));
  assert.ok(sf2.includes("sy.status='ACTIVE' AND e.enrollment_status='ENROLLED'"));
});
