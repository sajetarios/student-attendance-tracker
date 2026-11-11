'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { destinationForRole } = require('../login-routing');

test('Class Adviser and Subject Teacher accounts enter the Management Portal', () => {
  assert.equal(destinationForRole('TEACHER'), '/portal.html');
});

test('school management roles enter the Management Portal', () => {
  for (const role of ['SCHOOL_ADMIN', 'DEPARTMENT_HEAD', 'GATE_KEEPER', 'SUPER_ADMIN']) {
    assert.equal(destinationForRole(role), '/portal.html', `${role} should enter the Management Portal`);
  }
});

test('Parent accounts enter the Parent Portal', () => {
  assert.equal(destinationForRole('PARENT'), '/parent-portal.html');
});

test('Student accounts enter the separate Student Portal', () => {
  assert.equal(destinationForRole('STUDENT'), '/student-portal.html');
});

test('unknown or missing roles are not routed', () => {
  assert.equal(destinationForRole(''), null);
  assert.equal(destinationForRole(undefined), null);
  assert.equal(destinationForRole('CLASS_ADVISER'), null);
});
