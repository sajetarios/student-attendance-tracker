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
    "id": "class-attendance",
    "title": "Record class attendance",
    "roles": [
      "TEACHER"
    ],
    "nav": "classAttendanceNav",
    "keywords": [
      "class attendance",
      "take attendance",
      "record attendance",
      "attendance qr",
      "mag attendance",
      "attendance ng klase",
      "scan student",
      "student qr",
      "mark learners",
      "present absent"
    ],
    "steps": [
      "Open Class Attendance under Teaching & Classes. Only teachers assigned as Subject Teacher or Class Adviser have this menu.",
      "Select the correct assigned class or advisory section and its scheduled period; scan the student QR or use the authorized attendance control.",
      "Verify the learner and recorded result. Check existing entries before a repeat scan.",
      "If the class is missing, ask the School Admin to review your teaching designation or schedule."
    ],
    "note": "Student class attendance is separate from staff gate scans."
  },
  {
    "id": "gate-scan",
    "title": "Review your staff gate scans",
    "roles": [
      "TEACHER",
      "DEPARTMENT_HEAD",
      "SCHOOL_ADMIN"
    ],
    "nav": "myGateAttendanceNav",
    "keywords": [
      "staff gate",
      "gate attendance",
      "teacher qr",
      "qr badge",
      "gate time in",
      "gate time out",
      "my gate",
      "my qr",
      "teacher badge",
      "staff qr"
    ],
    "steps": [
      "Open My Attendance → Gate Attendance & DTR (Department Head: My Attendance / DTR; School Admin: own staff attendance under Attendance Management).",
      "Present your staff QR badge to the authorized Gatekeeper. The Gatekeeper must verify the identity and event before saving.",
      "Check the confirmed scan in your personal gate record and DTR. Logging in to Attendigo does not mark you present.",
      "Report disputed punches for authorized review instead of rescanning without checking."
    ],
    "note": "Gate verification and official DTR punches are subject to their own rules."
  },
  {
    "id": "gatekeeper-scan",
    "title": "Use the Gatekeeper QR scanner",
    "roles": [
      "GATE_KEEPER"
    ],
    "nav": "studentsNav",
    "keywords": [
      "scan a teacher qr",
      "teacher qr",
      "student qr",
      "qr card",
      "scan a teacher",
      "scan qr",
      "scan a student",
      "gate scanner",
      "gatekeeper",
      "gate scan",
      "scan teacher",
      "student qr",
      "scan student",
      "qr verify",
      "time in",
      "time out",
      "gate qr"
    ],
    "steps": [
      "Open Gate scanner from your sidebar; Gatekeeper access does not use the full student roster.",
      "Scan a student QR card or staff badge, and compare identity and photograph before recording.",
      "Verify the predicted attendance event and check the confirmation shown on screen.",
      "If the outcome is uncertain, check the existing record before another scan and report discrepancies."
    ],
    "note": "Gatekeeper scans cannot approve leave/OB or alter official DTR reviews."
  },
  {
    "id": "dtr",
    "title": "Review Daily Time Record (Form 48)",
    "roles": [
      "TEACHER",
      "DEPARTMENT_HEAD",
      "SCHOOL_ADMIN"
    ],
    "nav": "myGateAttendanceNav",
    "keywords": [
      "dtr",
      "form 48",
      "daily time record",
      "my time record",
      "time record",
      "dtr print",
      "print dtr",
      "attendance remarks",
      "late",
      "undertime",
      "absent"
    ],
    "steps": [
      "Open My Attendance → Gate Attendance & DTR (Department Heads may see My Attendance / DTR). School Admins open their personal DTR from Attendance Management.",
      "Select the reporting month and review verified staff punches, gate evidence and remarks.",
      "Check approved OB/leave dates alongside the DTR; a missing punch alone is not proof of absence.",
      "Ask for an authorized correction if an entry is missing or incorrect. Do not treat a draft as officially certified."
    ],
    "note": "Staff gate events, DTR review and final Form 48 certification are distinct."
  },
  {
    "id": "form48-admin",
    "title": "Review and print employee Form 48 DTR reports",
    "roles": [
      "SCHOOL_ADMIN"
    ],
    "nav": "form48ReportsNav",
    "keywords": [
      "print employee dtr",
      "review employee dtr",
      "print staff dtr",
      "form 48 staff report",
      "staff dtr",
      "employee dtr",
      "employee form 48",
      "staff form 48",
      "print staff dtr",
      "form48 report",
      "form 48 report",
      "review time records",
      "form 48 reports"
    ],
    "steps": [
      "Open Reports → Form 48 DTR reports (School Admin only), not your personal Gate Attendance & DTR.",
      "Select the employee and reporting month and generate the preview from verified DTR records.",
      "Review official hours, punches, OB/leave remarks, missing evidence and authorized adjustment or certification status.",
      "Use the provided Print / Save PDF control when the review is ready. The print document is formatted as two copies on one A4 portrait page."
    ],
    "note": "The printed employee name is not an electronic signature. School Admin review does not invent or infer missing punches."
  },
  {
    "id": "official-business",
    "title": "Request Official Business (OB)",
    "roles": [
      "TEACHER",
      "DEPARTMENT_HEAD",
      "SCHOOL_ADMIN"
    ],
    "nav": "officialBusinessNav",
    "keywords": [
      "official business",
      "ob",
      "ob request",
      "ob approval",
      "seminar",
      "training",
      "ob time",
      "file ob",
      "mag ob"
    ],
    "steps": [
      "Open Official Business under My Attendance (School Admin: Operations). Department Heads may see Department OB Requests.",
      "Expand Submit My Official Business request and enter Purpose, Destination, Start (Philippine time) and End (Philippine time).",
      "Choose Submit OB request. A Department Head recommends and School Admin makes the final decision; submission is not approval.",
      "Continue the approved gate verification procedure. Returns outside the approved window require review."
    ],
    "note": "Approved OB may affect DTR remarks and staff coverage; the guide cannot approve OB or create punches."
  },
  {
    "id": "leave",
    "title": "Apply for leave (CSC Form No. 6)",
    "roles": [
      "TEACHER",
      "DEPARTMENT_HEAD",
      "SCHOOL_ADMIN"
    ],
    "nav": "staffLeaveNav",
    "keywords": [
      "leave",
      "leave application",
      "vacation leave",
      "sick leave",
      "service credit",
      "csc form 6",
      "form no 6",
      "vsc",
      "mag leave",
      "bakasyon"
    ],
    "steps": [
      "Open Leave Requests in My Attendance (School Admin: Operations), then My applications or Leave applications.",
      "Expand New leave application. Select Type of leave and Proposed credit account, choose Start date and End date, and enter the required Reason.",
      "Add supporting PDF, JPG or PNG documentation when needed. Submit for review; after saving, use Print prefilled CSC Form No. 6 on the request.",
      "Track the application. Department recommendation, school review and verification of an officially signed decision are separate authorized stages."
    ],
    "note": "Teachers can view certified balances but cannot assign themselves credits or approve their own leave."
  },
  {
    "id": "leave-approvals",
    "title": "Review leave approvals",
    "roles": [
      "DEPARTMENT_HEAD",
      "SCHOOL_ADMIN"
    ],
    "nav": "staffLeaveReviewNav",
    "keywords": [
      "leave approvals",
      "leave approval inbox",
      "recommend leave",
      "approve leave",
      "review leave",
      "official decision",
      "pending leave",
      "principal leave"
    ],
    "steps": [
      "Open Leave Approvals under Requests & Approvals / Operations to see requests within your authorized scope.",
      "Department Heads provide a department recommendation. School Admins perform the school review or forwarding stage.",
      "The actual signed decision must be issued by the authorized official and verified before its status is recorded; Attendigo does not digitally grant signing authority.",
      "You cannot approve your own leave."
    ],
    "note": "The approval inbox tracks documentary decisions. A pending request is not approved."
  },
  {
    "id": "leave-credits",
    "title": "View or certify leave credit balances",
    "roles": [
      "TEACHER",
      "DEPARTMENT_HEAD",
      "SCHOOL_ADMIN"
    ],
    "nav": "staffLeaveNav",
    "keywords": [
      "leave credits",
      "my credits",
      "hr credits",
      "service credits",
      "vsc credits",
      "credit balance",
      "leave balance",
      "who sets leave credits"
    ],
    "steps": [
      "Open Leave Requests and choose My credits (School Admin: HR credits).",
      "Teachers and Department Heads see their own certified balance; they do not assign themselves credits.",
      "School Admin / authorized HR personnel manage certified balances through the HR credits interface.",
      "Report an incorrect balance to School Admin/HR for document-backed verification."
    ],
    "note": "Proposed deductions or claims are not certified credit balances."
  },
  {
    "id": "sf1-import",
    "title": "Import learners from LIS SF1",
    "roles": [
      "TEACHER",
      "SCHOOL_ADMIN"
    ],
    "nav": "studentsNav",
    "keywords": [
      "sf1",
      "sf 1",
      "school form 1",
      "import",
      "upload students",
      "upload sf1",
      "learner roster",
      "excel import",
      "pdf import",
      "list of students",
      "mag import"
    ],
    "steps": [
      "Open My Students / My Advisory Students (School Admin: Students) and select Import students or Bulk import.",
      "Teachers need Class Adviser designation, an assigned advisory class and an active school year before uploading SF1.",
      "Choose LIS SF1. Upload the original .xls/.xlsx file or a searchable PDF, then review the detected LRN, learner name, sex, grade and labeled guardian/contact fields.",
      "Resolve flagged records and review existing-record matches before Import / update. New learners start Unassigned; existing identity, section and attendance are preserved."
    ],
    "note": "SF1 limits: 5 MB and 2,000 learners. Scanned image-only PDFs may not be readable."
  },
  {
    "id": "section",
    "title": "Assign learners to a section",
    "roles": [
      "TEACHER",
      "DEPARTMENT_HEAD",
      "SCHOOL_ADMIN"
    ],
    "nav": "studentsNav",
    "keywords": [
      "assign section",
      "batch action",
      "bulk assign",
      "section",
      "grade level",
      "create section",
      "move student",
      "advisory",
      "homeroom"
    ],
    "steps": [
      "Open My Students, Department Students or Students, and filter the learner roster.",
      "Select learners and use the permitted batch action Move grade / section.",
      "Choose an existing authorized section. Class Advisers can create a missing section in the batch dialog when the control is shown; Department Heads have a separate Add class section workflow.",
      "Review the selected learners and confirm; refresh the roster to check the result."
    ],
    "note": "Only assigned Class Advisers, Department Heads or School Admins may use their scoped batch actions."
  },
  {
    "id": "sf2",
    "title": "Preview, generate or monitor SF2",
    "roles": [
      "TEACHER",
      "DEPARTMENT_HEAD"
    ],
    "nav": "sf2Nav",
    "keywords": [
      "sf2",
      "sf 2",
      "school form 2",
      "monthly attendance",
      "attendance report",
      "generate sf2",
      "print sf2"
    ],
    "steps": [
      "Open Reports → SF2 Attendance Report (teacher) or SF2 Monitoring (Department Head). Select Reporting month, Grade level and Section, then Preview attendance.",
      "Only assigned Class Advisers may confirm justified full-day absences and, when unresolved learner-days are cleared, generate or submit the official monthly SF2.",
      "Subject Teachers can Generate personal copy from their subject records. NR is not absence; a personal copy is not an official submission.",
      "Department Heads monitor departmental reports and official submissions with read-only privileges."
    ],
    "note": "SF2 uses class-attendance evidence, not staff gate scans. The current screen says holidays/suspensions are not yet connected to its SF2 calendar."
  },
  {
    "id": "schedule",
    "title": "Find your teaching timetable",
    "roles": [
      "TEACHER",
      "DEPARTMENT_HEAD",
      "SCHOOL_ADMIN"
    ],
    "nav": "schedulesNav",
    "keywords": [
      "timetable",
      "weekly timetable",
      "teaching schedule",
      "class schedule",
      "schedules",
      "lesson period",
      "where is my class",
      "subject schedule",
      "advisory class"
    ],
    "steps": [
      "Open My Timetable (teacher), Department Schedules (Department Head) or Class Schedules (School Admin).",
      "Use Class timetable or the available List view to check assigned classes, subjects, times and weekdays.",
      "Look for advisory vs subject assignments, and confirm the correct school timetable period.",
      "Ask your Department Head or School Admin to correct missing or conflicting assignments."
    ],
    "note": "Teachers view their own assigned schedules; timetable settings require School Admin permission."
  },
  {
    "id": "schedule-create",
    "title": "Create a class schedule",
    "roles": [
      "DEPARTMENT_HEAD",
      "SCHOOL_ADMIN"
    ],
    "nav": "schedulesNav",
    "keywords": [
      "add class",
      "add a class",
      "add a class schedule",
      "create a class schedule",
      "create class",
      "new class",
      "add schedule",
      "create schedule",
      "class period",
      "make schedule",
      "schedule class"
    ],
    "steps": [
      "Open Department Schedules (Department Head) or Class Schedules (School Admin).",
      "Select + New department class or + New class schedule, then configure grade/section, subject, teacher, room and period/weekdays.",
      "Resolve class, teacher and classroom conflict warnings before saving.",
      "Department Heads can use Assign Subject Teachers for unassigned department classes with eligible teachers."
    ],
    "note": "Only School Admins configure school-wide timetable templates, operating days and calendar settings."
  },
  {
    "id": "teacher-assignment",
    "title": "Assign a teacher to a class",
    "roles": [
      "DEPARTMENT_HEAD",
      "SCHOOL_ADMIN"
    ],
    "nav": "schedulesNav",
    "keywords": [
      "assign teacher",
      "unassigned class",
      "class assignment",
      "teacher coverage",
      "manage class",
      "teacher schedule conflict"
    ],
    "steps": [
      "Open Department Schedules and choose Unassigned Classes or the available Assign Subject Teachers control.",
      "Select one or more unassigned classes from your department and an eligible Subject Teacher from that department.",
      "Check the proposed classes and select Assign teacher; the system validates permissions and conflicts.",
      "Recheck the weekly timetable after saving, or ask School Admin to correct missing designations."
    ],
    "note": "Department Heads cannot assign across department boundaries."
  },
  {
    "id": "student-account",
    "title": "Request or manage student portal accounts",
    "roles": [
      "TEACHER",
      "SCHOOL_ADMIN"
    ],
    "nav": "studentsNav",
    "keywords": [
      "student account",
      "learner login",
      "account request",
      "student sign up",
      "student portal",
      "student password",
      "activate student"
    ],
    "steps": [
      "Open My Students (teacher) or Students (School Admin) and select the Portal Accounts tab; the separate Student Accounts sidebar link is hidden.",
      "Teachers can request new logins, password resets or reactivation for their assigned learners, individually or in authorized batches.",
      "School Admins review requests and can create, reactivate, reset or suspend student accounts. A teacher request does not immediately issue credentials.",
      "Use the Portal Accounts request history to track pending and completed decisions."
    ],
    "note": "A learner enrolled in Attendigo does not necessarily have an active student login. Never share temporary passwords with Help Guide."
  },
  {
    "id": "guardian",
    "title": "Review guardian information",
    "roles": [
      "TEACHER",
      "DEPARTMENT_HEAD",
      "SCHOOL_ADMIN"
    ],
    "nav": "studentsNav",
    "keywords": [
      "guardian",
      "parent",
      "mother",
      "father",
      "parent contact",
      "guardian contact",
      "guardian phone",
      "guardian details",
      "family details"
    ],
    "steps": [
      "Open an authorized student roster and find the learner.",
      "Choose Manage guardians on the learner row to view approved Guardian contacts and Request history.",
      "Select Request change, then Add secondary guardian, Change primary guardian or Correct primary contact; provide the requested information and reason.",
      "Submit the request for authorized review before assuming the guardian change is effective."
    ],
    "note": "SF1 family information, student primary contact, approved guardians and parent portal accounts are not interchangeable."
  },
  {
    "id": "password",
    "title": "Sign in and account security",
    "roles": [
      "TEACHER",
      "DEPARTMENT_HEAD",
      "SCHOOL_ADMIN",
      "GATE_KEEPER",
      "SUPER_ADMIN"
    ],
    "nav": null,
    "keywords": [
      "password",
      "login",
      "log in",
      "cannot sign in",
      "account locked",
      "forgot password",
      "change password",
      "profile",
      "security",
      "sign out"
    ],
    "steps": [
      "Check that you are using the correct Attendigo sign-in page and your own account.",
      "To update an active profile or password, open the profile/account menu in the top bar.",
      "For an inaccessible account, follow the available recovery instructions or contact the School Admin.",
      "Never share a password, QR private token or recovery code with the help assistant."
    ],
    "note": "The assistant cannot see or reset passwords or bypass security checks."
  },
  {
    "id": "navigation",
    "title": "Find a feature on the menu",
    "roles": [
      "TEACHER",
      "DEPARTMENT_HEAD",
      "SCHOOL_ADMIN",
      "GATE_KEEPER",
      "SUPER_ADMIN"
    ],
    "nav": "dashboardNav",
    "keywords": [
      "menu",
      "navigation",
      "sidebar",
      "dashboard",
      "where can i find",
      "where is",
      "paano gamitin",
      "paano mag",
      "how do i use",
      "how to use",
      "help"
    ],
    "steps": [
      "Open the sidebar; its groups and labels change with your school role and assignments.",
      "Teachers use Teaching & Classes, My Attendance and Reports; Department Heads and School Admins have additional Requests & Approvals or Operations items.",
      "Only available features are shown. A missing item may mean your designation, class assignment or role is not authorized.",
      "Ask a specific question such as How do I import SF1? or Where are student account requests?"
    ],
    "note": "The assistant only opens currently authorized navigation."
  },
  {
    "id": "technical",
    "title": "Troubleshoot a screen or error",
    "roles": [
      "TEACHER",
      "DEPARTMENT_HEAD",
      "SCHOOL_ADMIN",
      "GATE_KEEPER",
      "SUPER_ADMIN"
    ],
    "nav": null,
    "keywords": [
      "error",
      "blank",
      "not showing",
      "loading",
      "does not work",
      "refresh",
      "internet",
      "offline",
      "sync issue",
      "bug",
      "stuck",
      "failed",
      "hindi gumagana",
      "problema"
    ],
    "steps": [
      "Check the connection status and any warning shown by Attendigo.",
      "Refresh the page once after any pending form submission has been confirmed.",
      "For scanning or attendance, check existing events before scanning again to avoid duplicate attempts.",
      "Record the exact error message and the affected menu, then report it to your School Admin or support."
    ],
    "note": "Do not paste learner records, passwords or private QR tokens into the help chat."
  },
  {
    "id": "school-settings",
    "title": "Manage school configuration",
    "roles": [
      "SCHOOL_ADMIN"
    ],
    "nav": "schedulesNav",
    "keywords": [
      "school timetable settings",
      "timetable settings",
      "school settings",
      "operating days",
      "timetable template",
      "school holiday",
      "period times",
      "school calendar",
      "configure school"
    ],
    "steps": [
      "Sign in as School Admin and open Class Schedules → Timetable settings.",
      "Set Operating days and configure Daily timetable templates and period times.",
      "Review special calendar events, holidays, suspensions or shortened days as available.",
      "Save the settings and check affected class schedules."
    ],
    "note": "Timetable settings are school-admin-only and are not the same as SF2 attendance calculations."
  }
];
  function normalize(input) {
    return String(input == null ? '' : input).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function forRole(role) {
    return topics.filter(topic => topic.roles.includes(String(role || '')));
  }
  // High-risk instructions must never fall through to a similar, lower-
  // privilege topic (e.g. a Teacher asking to approve leave must not get
  // ordinary leave-application instructions).
  function restrictedAnswer(question, role) {
    const q = normalize(question), r = String(role || '');
    if (!['DEPARTMENT_HEAD','SCHOOL_ADMIN'].includes(r) &&
      /(?:approve|approval|recommend|official decision).{0,25}leave|leave approvals|leave approval inbox|review (?:department|staff|other|employee) leave/.test(q))
      return {title:'Leave approvals require an authorized reviewer',
        steps:['Teachers submit their own application in Leave Requests; they cannot approve it.',
          'Department Heads can make authorized recommendations. School Admins handle school review and verified official decisions.',
          'Ask School Admin about the status of your submitted request.'],
        note:'The assistant cannot grant approval authority.'};
    if (r !== 'SCHOOL_ADMIN' &&
      /(?:employee|staff).{0,18}(?:dtr|form 48|time record)|(?:print|review).{0,15}(?:employee|staff).{0,15}(?:dtr|form 48)/.test(q))
      return {title:'Employee Form 48 reports are an administrative function',
        steps:['Use your personal Gate Attendance & DTR to review your own punches.',
          'Only authorized school personnel can review or print other employees’ Form 48 reports.'],
        note:'The guide cannot expose another employee’s attendance.'};
    if (r !== 'GATE_KEEPER' && /gatekeeper|gate scanner/.test(q))
      return {title:'Gate scanner is a Gatekeeper function',
        steps:['Staff should use My Attendance → Gate Attendance & DTR to check their own gate records.',
          'Only an authorized Gatekeeper records student or staff scans at the gate.'],
        note:'Do not try to access restricted scanner routes.'};
    if (!['TEACHER','SCHOOL_ADMIN'].includes(r) && /sf1|import students|import learners/.test(q))
      return {title:'SF1 import is restricted',
        steps:['School Admins or eligible Class Advisers can import official LIS SF1 files.',
          'Ask the School Admin to confirm your authorization and advisory assignment.'],
        note:'A Department Head cannot bypass the import permission with Help Guide.'};
    if (!['TEACHER','SCHOOL_ADMIN'].includes(r) && /student account|student login|learner login|student password|portal account/.test(q))
      return {title:'Student portal accounts need school authorization',
        steps:['Teachers request account access for their assigned learners in My Students → Portal Accounts.',
          'School Admins review account requests and issue credentials.'],
        note:'Other roles cannot provision learner passwords via Help Guide.'};
    if (r !== 'SCHOOL_ADMIN' && /timetable settings|school timetable settings|operating days|school calendar/.test(q))
      return {title:'School timetable settings require School Admin',
        steps:['View your assigned timetable from My Timetable or Department Schedules.',
          'Ask School Admin to change operating days, school-wide templates or calendar settings.'],
        note:'Teaching timetables and school configuration have different permissions.'};
    if (r === 'DEPARTMENT_HEAD' && /submit official sf2|submit sf2/.test(q))
      return {title:'Only Class Advisers submit official SF2',
        steps:['Department Heads use Reports → SF2 Monitoring to review department submission status.',
          'The assigned Class Adviser reviews and submits the official monthly section SF2.'],
        note:'Department monitoring cannot submit an adviser’s official report.'};
    return null;
  }
  function match(question, role) {
    const query = normalize(question);
    if (!query || restrictedAnswer(question,role)) return null;
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
    const restriction = restrictedAnswer(question, role);
    if (restriction) return {topic:null, ...restriction};
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
