'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ROLE_PERMISSIONS, hasPermission, hasTeacherDesignation } = require('../role-permissions');

test('all attendance-tracker roles are defined', () => {
  for (const role of ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'DEPARTMENT_HEAD', 'TEACHER', 'GATE_KEEPER', 'PARENT', 'STUDENT']) {
    assert.ok(Array.isArray(ROLE_PERMISSIONS[role]), `missing permission list for ${role}`);
  }
});

test('School Administrator can manage official SF2 collection', () => {
  assert.equal(hasPermission('SCHOOL_ADMIN', 'sf2.official.generate'), true);
  assert.equal(hasPermission('SCHOOL_ADMIN', 'sf2.submissions.collect'), true);
  assert.equal(hasPermission('SCHOOL_ADMIN', 'sf2.official.submit'), false);
  assert.equal(hasPermission('SCHOOL_ADMIN', 'schedules.manage'), true);
});

test('Department Head is a monitor, not an SF2 collector', () => {
  assert.equal(hasPermission('DEPARTMENT_HEAD', 'attendance.view.school'), true);
  assert.equal(hasPermission('DEPARTMENT_HEAD', 'teachers.view'), true);
  assert.equal(hasPermission('DEPARTMENT_HEAD', 'sf2.submissions.collect'), false);
  assert.equal(hasPermission('DEPARTMENT_HEAD', 'teachers.manage'), false);
  assert.equal(hasPermission('DEPARTMENT_HEAD', 'students.view.all'), false);
  assert.equal(hasPermission('DEPARTMENT_HEAD', 'students.photo.view'), false);
  assert.equal(hasPermission('DEPARTMENT_HEAD', 'teachers.substitutions.manage'), true);
  assert.equal(hasPermission('DEPARTMENT_HEAD', 'sf2.official.preview'), true);
  assert.equal(hasPermission('DEPARTMENT_HEAD', 'sf2.submissions.view'), true);
  assert.equal(hasPermission('DEPARTMENT_HEAD', 'sardo.view'), false);
});

test('Gate Keeper can perform gate lookup but cannot download the roster or access reporting', () => {
  assert.equal(hasPermission('GATE_KEEPER', 'gate.lookup'), true);
  assert.equal(hasPermission('GATE_KEEPER', 'students.view.all'), false);
  assert.equal(hasPermission('GATE_KEEPER', 'attendance.gate.record'), true);
  assert.equal(hasPermission('GATE_KEEPER', 'sf2.official.generate'), false);
  assert.equal(hasPermission('GATE_KEEPER', 'students.manage'), false);
  assert.equal(hasPermission('GATE_KEEPER', 'schedules.manage'), false);
});

test('Teacher designations can be one or both and do not grant other roles', () => {
  const subjectTeacher = { type: 'SCHOOL_USER', role: 'TEACHER', teacherDesignations: ['SUBJECT_TEACHER'] };
  const classAdviser = { type: 'SCHOOL_USER', role: 'TEACHER', teacherDesignations: ['CLASS_ADVISER'] };
  const both = { type: 'SCHOOL_USER', role: 'TEACHER', teacherDesignations: ['SUBJECT_TEACHER', 'CLASS_ADVISER'] };
  assert.equal(hasTeacherDesignation(subjectTeacher, 'SUBJECT_TEACHER'), true);
  assert.equal(hasTeacherDesignation(subjectTeacher, 'CLASS_ADVISER'), false);
  assert.equal(hasTeacherDesignation(classAdviser, 'CLASS_ADVISER'), true);
  assert.equal(hasTeacherDesignation(both, 'SUBJECT_TEACHER'), true);
  assert.equal(hasTeacherDesignation(both, 'CLASS_ADVISER'), true);
  assert.equal(hasTeacherDesignation({ type: 'SCHOOL_USER', role: 'DEPARTMENT_HEAD', teacherDesignations: ['CLASS_ADVISER'] }, 'CLASS_ADVISER'), false);
  assert.equal(hasPermission('TEACHER', 'schedules.manage'), false);
});


test('Student role has only self-service permissions and no school workspace access', () => {
  assert.equal(hasPermission('STUDENT', 'student.profile.view'), true);
  assert.equal(hasPermission('STUDENT', 'student.attendance.view'), true);
  assert.equal(hasPermission('STUDENT', 'students.view.all'), false);
  assert.equal(hasPermission('STUDENT', 'sf2.official.generate'), false);
  assert.equal(hasPermission('STUDENT', 'teachers.manage'), false);
});
