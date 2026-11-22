/* Attendigo Help knowledge. Guidance is intentionally read-only and role-scoped. */
(function (root, factory) {
  const guide = factory();
  if (typeof module === 'object' && module.exports) module.exports = guide;
  if (root) root.AttendigoHelpTopics = guide;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const STAFF = ['TEACHER', 'DEPARTMENT_HEAD', 'SCHOOL_ADMIN'];
  const ALL = [...STAFF, 'GATE_KEEPER', 'SUPER_ADMIN'];
  const topics = [
    {
      id: 'class-attendance', title: 'Record class attendance', roles: STAFF,
      nav: 'classAttendanceNav',
      keywords: ['class attendance', 'take attendance', 'record attendance', 'attendance qr', 'mag attendance', 'attendance ng klase', 'scan student', 'student qr', 'mark learners', 'present absent'],
      steps: ['Open Class attendance from your Academics menu if it is available to your account.', 'Select the correct assigned class and schedule before scanning or recording.', 'Verify the learner and the result on screen; check the class record before attempting a second scan.', 'If you cannot access a class, ask the School Admin to verify your assignment.'],
      note: 'A missing scan does not by itself establish an absence. Only use an attendance action that your account is authorized to perform.'
    },
    {
      id: 'gate-scan', title: 'Gate QR scanning', roles: ALL,
      nav: 'myGateAttendanceNav',
      keywords: ['gate', 'gatekeeper', 'gate scan', 'teacher qr', 'qr verification', 'time in', 'time out', 'scan badge', 'school gate', 'mag scan', 'qr code'],
      steps: ['Teachers can open Gate Attendance & DTR to view their own gate record and badge.', 'At the gate, let an authorized Gatekeeper verify the QR and the predicted event before it is recorded.', 'Check the confirmation message. If it is unclear whether a scan succeeded, review the record before repeating it.', 'For incorrect punches, contact the responsible administrator rather than editing gate logs directly.'],
      note: 'The Gatekeeper workflow is separate from class attendance and follows official event validation.'
    },
    {
      id: 'dtr', title: 'View your DTR (Form 48)', roles: STAFF,
      nav: 'myGateAttendanceNav',
      keywords: ['dtr', 'form 48', 'daily time record', 'my time record', 'time record', 'dtr print', 'print dtr', 'attendance remarks', 'late', 'undertime', 'absent'],
      steps: ['Open Gate Attendance & DTR in My Attendance (or Academics) to check your own verified punches.', 'Choose the relevant month and review each date, time-in/time-out and remarks before printing.', 'If your DTR looks incomplete, compare it with the confirmed gate scans and any approved OB or leave.', 'Report discrepancies to the School Admin for authorized review.'],
      note: 'A missing punch is not automatically proof of absence. The official DTR depends on verified records and approved adjustments.'
    },
    {
      id: 'official-business', title: 'Request Official Business (OB)', roles: STAFF,
      nav: 'officialBusinessNav',
      keywords: ['official business', 'ob', 'ob request', 'ob approval', 'seminar', 'training', 'ob time', 'file ob', 'mag ob'],
      steps: ['Open Official Business from the available attendance menu.', 'Submit the correct date, time window, destination and reason using the fields shown.', 'Wait for the authorized approval; submitting a request does not mean it is approved.', 'Continue following Gatekeeper scanning instructions. Approved OB information is considered when DTR remarks are prepared.', 'If you return later than approved, report the actual situation for review.'],
      note: 'The assistant cannot approve OB, assume overtime, or change recorded times.'
    },
    {
      id: 'leave', title: 'Apply for leave (CSC Form No. 6)', roles: STAFF,
      nav: 'staffLeaveNav',
      keywords: ['leave', 'leave application', 'vacation leave', 'sick leave', 'service credit', 'csc form 6', 'form no 6', 'vsc', 'mag leave', 'bakasyon'],
      steps: ['Choose Leave Management from your attendance menu.', 'Open Leave requests, then New leave application.', 'Choose the leave type, proposed credit account, dates and reason. Add documents if required.', 'Submit for review; approval and certified service credit balances remain subject to authorized review.', 'Check the application status, and verify any DTR remarks for approved dates.'],
      note: 'Submission is not approval. Do not treat projected leave credits or remarks as final unless certified by the authorized approver.'
    },
    {
      id: 'sf1-import', title: 'Import learners from SF1', roles: STAFF,
      nav: 'studentsNav',
      keywords: ['sf1', 'sf 1', 'school form 1', 'import', 'upload students', 'upload sf1', 'learner roster', 'excel import', 'pdf import', 'list of students', 'mag import'],
      steps: ['Go to Students and locate the SF1 import/upload action available to your role.', 'Upload the accepted SF1 file and review the extracted learner names, LRNs, grade levels and guardian fields.', 'Fix validation warnings before confirming; check existing-record matches carefully to prevent duplicates.', 'After importing, filter the roster by grade and assign sections using authorized batch actions.'],
      note: 'An adviser can work only in their authorized section scope. The assistant does not import or change records.'
    },
    {
      id: 'section', title: 'Assign learners to a section', roles: STAFF,
      nav: 'studentsNav',
      keywords: ['assign section', 'batch action', 'bulk assign', 'section', 'grade level', 'create section', 'move student', 'advisory', 'homeroom'],
      steps: ['Open Students, then use the grade and section filters to narrow the list.', 'Select the intended learners and choose the available batch assignment action.', 'Select the correct section. Authorized advisers can create a missing section where the screen offers that permission.', 'Review the selected learners before saving, then refresh the roster to confirm the change.'],
      note: 'Section management permissions depend on your school role and assignments.'
    },
    {
      id: 'sf2', title: 'Generate SF2', roles: STAFF,
      nav: 'sf2Nav',
      keywords: ['sf2', 'sf 2', 'school form 2', 'monthly attendance', 'attendance report', 'generate sf2', 'print sf2'],
      steps: ['Open SF2 Report Generator from the available navigation.', 'Select the correct school year, month and permitted class or section.', 'Check the daily attendance entries and summary computation before generating the file.', 'Preview the output and escalate missing or incorrect records before submitting an official report.'],
      note: 'Only verified or authorized class data should be treated as official.'
    },
    {
      id: 'schedule', title: 'Find your teaching timetable', roles: STAFF,
      nav: 'schedulesNav',
      keywords: ['timetable', 'weekly timetable', 'teaching schedule', 'class schedule', 'schedules', 'lesson period', 'where is my class', 'subject schedule', 'advisory class'],
      steps: ['Open Class Schedules or the Weekly Timetable on your dashboard.', 'Use the weekly grid or List view to see assigned subjects, times and weekdays.', 'Check the separate advisory designation when applicable.', 'If a schedule is missing or incorrect, ask your Department Head or School Admin to review the assignment.'],
      note: 'Only authorized scheduling roles can create or edit the underlying class schedules.'
    },
    {
      id: 'schedule-create', title: 'Create a class schedule', roles: ['DEPARTMENT_HEAD','SCHOOL_ADMIN'],
      nav: 'schedulesNav',
      keywords: ['add class', 'add a class', 'add a class schedule', 'create a class schedule', 'create class', 'new class', 'add schedule', 'create schedule', 'class period', 'make schedule', 'schedule class'],
      steps: ['Open Class Schedules from the Academics menu.', 'Choose the option to add or create a schedule, then select the class, subject, teacher, classroom and timetable template.', 'Check the scheduled weekdays and period times.', 'Save only after checking any teacher, room or class conflict warning.'],
      note: 'Department Heads can create schedules in their own department. School-wide timetable settings remain with the School Admin.'
    },
    {
      id: 'teacher-assignment', title: 'Assign a teacher to a class', roles: ['DEPARTMENT_HEAD', 'SCHOOL_ADMIN'],
      nav: 'schedulesNav',
      keywords: ['assign teacher', 'unassigned class', 'class assignment', 'teacher coverage', 'manage class', 'teacher schedule conflict'],
      steps: ['Open Class Schedules or your department’s coverage tools.', 'Find the class that requires a teacher and review its department and schedule.', 'Use the available assignment control and choose an eligible teacher.', 'Check any conflict warnings before saving, then verify the updated timetable.'],
      note: 'Department Heads are limited to their own departments. Conflict checks should never be bypassed.'
    },
    {
      id: 'student-account', title: 'Student accounts and requests', roles: STAFF,
      nav: 'studentAccountsNav',
      keywords: ['student account', 'learner login', 'account request', 'student sign up', 'student portal', 'student password', 'activate student'],
      steps: ['Open Student Accounts if your role has that menu.', 'Review the visible account requests for learners assigned to your permitted scope.', 'Follow the approval or creation flow shown on screen; do not share a learner password in chat.', 'If no action is available, ask the School Admin to check the school’s account permissions.'],
      note: 'Having a student record does not necessarily mean the student has a portal account.'
    },
    {
      id: 'guardian', title: 'Review guardian information', roles: STAFF,
      nav: 'studentsNav',
      keywords: ['guardian', 'parent', 'mother', 'father', 'parent contact', 'guardian contact', 'guardian phone', 'guardian details', 'family details'],
      steps: ['Open Students and select the learner within your authorized class or roster.', 'Review the parent/guardian fields imported from the official SF1.', 'Use the approved edit or request flow if a correction is needed.', 'Parent Portal accounts are separate from guardian information on a student record.'],
      note: 'Do not include student names, LRNs, phone numbers or private family data in help questions.'
    },
    {
      id: 'password', title: 'Sign in and account security', roles: ALL,
      nav: null,
      keywords: ['password', 'login', 'log in', 'cannot sign in', 'account locked', 'forgot password', 'change password', 'profile', 'security', 'sign out'],
      steps: ['Check that you are using the correct Attendigo sign-in page and your own account.', 'To update an active profile or password, open the profile/account menu in the top bar.', 'For an inaccessible account, follow the available recovery instructions or contact the School Admin.', 'Never share a password, QR private token or recovery code with the help assistant.'],
      note: 'The assistant cannot see or reset passwords or bypass security checks.'
    },
    {
      id: 'navigation', title: 'Find a feature on the menu', roles: ALL,
      nav: 'dashboardNav',
      keywords: ['menu', 'navigation', 'sidebar', 'dashboard', 'where can i find', 'where is', 'paano gamitin', 'paano mag', 'how do i use', 'how to use', 'help'],
      steps: ['Open the sidebar from the menu icon on a narrow screen.', 'Menus are expanded by default; select the relevant feature under Student Records, Academics or My Attendance.', 'Only features available to your account should appear.', 'Ask a specific question, such as “How do I import SF1?” or “Where is my DTR?”, for guided steps.'],
      note: 'The assistant explains features; it does not unlock restricted navigation.'
    },
    {
      id: 'technical', title: 'Troubleshoot a screen or error', roles: ALL,
      nav: null,
      keywords: ['error', 'blank', 'not showing', 'loading', 'does not work', 'refresh', 'internet', 'offline', 'sync issue', 'bug', 'stuck', 'failed', 'hindi gumagana', 'problema'],
      steps: ['Check the connection status and any warning shown by Attendigo.', 'Refresh the page once after any pending form submission has been confirmed.', 'For scanning or attendance, check existing events before scanning again to avoid duplicate attempts.', 'Record the exact error message and the affected menu, then report it to your School Admin or support.'],
      note: 'Do not paste learner records, passwords or private QR tokens into the help chat.'
    },
    {
      id: 'school-settings', title: 'Manage school configuration', roles: ['SCHOOL_ADMIN'],
      nav: 'settingsNavGroup',
      keywords: ['school settings', 'operating days', 'timetable template', 'school holiday', 'period times', 'school calendar', 'configure school'],
      steps: ['Open School Settings from the sidebar.', 'Review the operating days, reusable timetable templates and period definitions.', 'Use school calendar events for holidays, suspensions or shortened days.', 'Check affected schedules and permissions before saving school-wide changes.'],
      note: 'Only School Admins can manage school-wide timetable settings.'
    }
  ];
  function normalize(input) {
    return String(input == null ? '' : input).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function forRole(role) {
    return topics.filter(topic => topic.roles.includes(String(role || '')));
  }
  function match(question, role) {
    const query = normalize(question);
    if (!query) return null;
    let best = null;
    const tokens = new Set(query.split(' '));
    for (const topic of forRole(role)) {
      let score = 0;
      for (const phrase of topic.keywords) {
        const term = normalize(phrase);
        if (query === term) score += 12;
        else if (query.includes(term) && term.length >= 3) score += 5 + Math.min(3, term.split(' ').length);
        else if (term.includes(' ') && term.split(' ').every(word => word.length < 3 || tokens.has(word))) score += 2;
      }
      // Generic navigation words must not outrank a named feature such as DTR.
      if (topic.id === 'navigation') score = Math.min(score, 5);
      if (score > (best?.score || 0)) best = { topic, score };
    }
    return best && best.score >= 5 ? best.topic : null;
  }
  function answer(question, role) {
    const topic = match(question, role);
    if (!topic) return {
      topic: null,
      title: 'I can help you find the right steps',
      steps: ['Try asking about SF1 import, class attendance, QR scanning, DTR, leave, OB or schedules.', 'For an issue with a particular page, mention the menu name and what you were trying to do.'],
      note: 'I only use the known Attendigo guide. I will not guess an answer or change your records.'
    };
    return {topic, title: topic.title, steps: topic.steps.slice(), note: topic.note};
  }
  return Object.freeze({ topics, forRole, match, answer, normalize });
});
