'use strict';

// Server-side permission catalog. UI visibility never replaces API enforcement.
const ROLE_PERMISSIONS = Object.freeze({
  SUPER_ADMIN: Object.freeze(['platform.overview.view']),
  SCHOOL_ADMIN: Object.freeze([
    'dashboard.view.school', 'students.view.all', 'students.manage', 'students.accounts.manage',
    'schedules.view.all', 'schedules.manage', 'teachers.view', 'teachers.manage',
    'class_advisers.manage', 'sf2.official.generate', 'sf2.submissions.collect',
    'parents.manage', 'attendance.corrections.manage', 'devices.manage'
  ]),
  DEPARTMENT_HEAD: Object.freeze([
    'dashboard.view.school', 'students.view.all', 'students.manage.department', 'schedules.view.all', 'schedules.manage.department',
    'teachers.view', 'teachers.assign.department', 'teachers.substitutions.manage',
    'teacher.coverage.view.school', 'attendance.view.school',
    'reports.attendance.view', 'sf2.official.preview', 'sf2.submissions.view'
  ]),
  TEACHER: Object.freeze([
    'dashboard.view.assigned', 'students.view.assigned', 'students.update.assigned',
    'schedules.view.assigned', 'schedules.create.own',
    'attendance.subject.record', 'attendance.advisory.record', 'sf2.personal.generate'
  ]),
  GATE_KEEPER: Object.freeze(['gate.lookup', 'attendance.gate.record']),
  PARENT: Object.freeze(['parent.children.view', 'parent.attendance.view']),
  STUDENT: Object.freeze(['student.profile.view', 'student.attendance.view', 'student.password.change'])
});

function hasPermission(role, permission) {
  return Boolean(ROLE_PERMISSIONS[role]?.includes(permission));
}

function hasTeacherDesignation(auth, designation) {
  return auth?.type === 'SCHOOL_USER' && auth.role === 'TEACHER' &&
    Array.isArray(auth.teacherDesignations) && auth.teacherDesignations.includes(designation);
}

module.exports = { ROLE_PERMISSIONS, hasPermission, hasTeacherDesignation };
