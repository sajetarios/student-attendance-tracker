'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const runner = fs.readFileSync(path.join(root, 'scripts', 'migrate.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations', '019_demo001_grade8_spj_class_adviser.sql'), 'utf8');

test('SPJ Class Adviser assignment migration is registered after staff security migration', () => {
  assert.match(runner, /'018_staff_account_security\.sql',[\s\S]*?'019_demo001_grade8_spj_class_adviser\.sql'/);
  assert.match(runner, /019_demo001_grade8_spj_class_adviser\.sql/);
});

test('SPJ adviser migration is limited to the confirmed DEMO001 teacher, school, and section', () => {
  assert.match(migration, /school_code='DEMO001'/);
  assert.match(migration, /username='Dowthii'/);
  assert.match(migration, /display_name='Dorothy Mae Sajetarios'/);
  assert.match(migration, /role='TEACHER'/);
  assert.match(migration, /'CLASS_ADVISER'=ANY\(teacher_designations\)/);
  assert.match(migration, /'Grade 8'/);
  assert.match(migration, /'SPJ'/);
  assert.match(migration, /sy\.status='ACTIVE'/);
  assert.match(migration, /en\.enrollment_status='ENROLLED'/);
});

test('SPJ adviser migration does not require a class period and protects existing assignments', () => {
  assert.doesNotMatch(migration, /class_periods/);
  assert.match(migration, /already has a different Class Adviser/);
  assert.match(migration, /INSERT INTO class_adviser_assignments/);
  assert.match(migration, /ON CONFLICT/);
  // No overwrite path is present; the migration stops when a different adviser exists.
});

test('SPJ adviser migration records the confirming School Administrator in the audit log', () => {
  assert.match(migration, /display_name='Demo001 School Administrator'/);
  assert.match(migration, /INSERT INTO audit_logs/);
  assert.match(migration, /'SCHOOL_ADMIN_ASSIGN_CLASS_ADVISER'/);
  assert.match(migration, /'advisoryOnly', TRUE/);
});
