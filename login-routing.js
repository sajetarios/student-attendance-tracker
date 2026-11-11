'use strict';

// Shared role-to-entry-page mapping. TEACHER is the account role for both
// Subject Teachers and Class Advisers; their designation affects permissions,
// not which application workspace they enter.
(function attachLoginRouting(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AttendanceLoginRouting = api;
})(typeof window !== 'undefined' ? window : null, function createLoginRouting() {
  const SCHOOL_ROLES = new Set([
    'SCHOOL_ADMIN',
    'DEPARTMENT_HEAD',
    'TEACHER',
    'GATE_KEEPER',
    'SUPER_ADMIN'
  ]);

  function destinationForRole(role) {
    if (role === 'PARENT') return '/parent-portal.html';
    if (role === 'STUDENT') return '/student-portal.html';
    if (SCHOOL_ROLES.has(role)) return '/portal.html';
    return null;
  }

  return { destinationForRole };
});
