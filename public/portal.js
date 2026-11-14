(() => {
  const tokenKey = 'schoolAttendance.accessToken';
  const userKey = 'schoolAttendance.user';
  const token = sessionStorage.getItem(tokenKey);
  let user = null;
  let dashboardData = null;
  let students = [];
  let periods = [];
  let teachers = [];
  let schoolUsers = [];
  let adviserAssignments = [];
  let studentAccountMode = 'CREATE';
  let sf2Options = [];
  let sf2Submissions = [];
  let toastTimer;
  const studentQrCache = new Map();
  const selectedStudentIds = new Set();
  const selectedPeriodIds = new Set();
  const selectedStaffIds = new Set();
  let pendingStudentImport = null;
  let pendingStudentImportPreview = null;
  let studentQrScanner = null;
  let scannedStudent = null;
  let scannedTeacher = null;
  let gateScanType = 'BOTH';
  let gateKeeperMonitoring = [];
  let teacherGateAttendance = [];
  let departments = [];
  let teacherCoverage = [];
  let coverageAlertKeys = new Set();
  let coverageMonitorInitialized = false;
  let activeScanScope = 'SCHOOL';
  let activeScanPeriodId = null;


  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);


  // Format PostgreSQL DATE values or ISO timestamps using the school's timezone.
  // This prevents a date such as 2026-11-17 from appearing as the previous day.
  function formatSchoolDate(value) {
    if (!value) return 'Not set';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric'
    }).format(date);
  }

  function formatLeaveType(value) {
    const label = String(value || 'Leave').replaceAll('_', ' ').toLowerCase();
    return label.replace(/\b\w/g, letter => letter.toUpperCase());
  }

  function previousSchoolDate(value) {
    const clean = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
    const [year, month, day] = clean.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
  }

  if (!token) {
    window.location.replace('/portal-login.html');
    return;
  }

  async function api(url, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(url, { ...options, headers, cache: 'no-store' });
    if (response.status === 401) {
      clearSession();
      window.location.replace('/portal-login.html');
      throw new Error('Your session has expired. Please sign in again.');
    }
    const data = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `Request failed (${response.status}).`);
    return data;
  }

  async function photoDataUrl(photoUrl) {
    if (!photoUrl) return '';
    try {
      const response = await fetch(photoUrl, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      if (!response.ok) return '';
      const blob = await response.blob();
      return await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => resolve('');
        reader.readAsDataURL(blob);
      });
    } catch { return ''; }
  }

  async function uploadStudentPhoto(studentId, file) {
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Choose a JPG, PNG, or WebP photo up to 5 MB.');
    const response = await fetch(`/api/students/${encodeURIComponent(studentId)}/photo`, {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': file.type }, body: file, cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Photo upload failed.');
  }

  function clearSession() {
    sessionStorage.removeItem(tokenKey);
    sessionStorage.removeItem(userKey);
    sessionStorage.removeItem('schoolAttendance.expiresAt');
  }

  function showToast(message, isError = false) {
    const toast = $('toast');
    toast.textContent = message;
    toast.style.background = isError ? '#9f2940' : '#1f2937';
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  function teacherHas(designation) {
    return user?.role === 'TEACHER' && Array.isArray(user.teacherDesignations) && user.teacherDesignations.includes(designation);
  }

  function allowedViewsForUser() {
    const role = user?.role;
    if (role === 'SCHOOL_ADMIN') return ['dashboard', 'students', 'teachers', 'schedules', 'sf2', 'cloudSync'];
    if (role === 'DEPARTMENT_HEAD') return ['dashboard', 'students', 'teachers', 'schedules', 'sf2'];
    if (role === 'TEACHER') {
      const views = ['dashboard'];
      if (teacherHas('SUBJECT_TEACHER') || teacherHas('CLASS_ADVISER')) {
        views.push('students', 'classAttendance');
      }
      if (teacherHas('SUBJECT_TEACHER') || teacherHas('CLASS_ADVISER')) views.push('schedules');
      if (teacherHas('SUBJECT_TEACHER') || teacherHas('CLASS_ADVISER')) views.push('sf2');
      return views;
    }
    if (role === 'GATE_KEEPER') return ['students']; // scanner-only workspace; roster panel is hidden.
    return [];
  }

  function setView(view) {
    const academicPanel = $('academicAdminWorkspace');
    if (academicPanel) academicPanel.hidden = true;
    const isPlatform = user?.role === 'SUPER_ADMIN';
    if (isPlatform) {
      $('platformWorkspace').hidden = false;
      $('schoolWorkspace').hidden = true;
      $('breadcrumbCurrent').textContent = 'Platform overview';
      return;
    }
    const allowedViews = allowedViewsForUser();
    const departmentHead = user?.role === 'DEPARTMENT_HEAD';
    // Department Heads may view the school-wide roster; write access remains restricted.
    if (!allowedViews.includes(view)) view = allowedViews.includes('dashboard') ? 'dashboard' : (allowedViews[0] || 'dashboard');
    $('platformWorkspace').hidden = true;
    $('schoolWorkspace').hidden = false;
    ['dashboard', 'students', 'schedules', 'teachers', 'sf2', 'classAttendance', 'cloudSync'].forEach(name => {
      const panel = $(`${name}View`);
      if (panel) panel.hidden = name !== view;
    });
    document.querySelectorAll('.nav-item').forEach(button => {
      button.classList.toggle('active', button.dataset.view === view);
    });

    const role = user?.role;
    const gateKeeper = role === 'GATE_KEEPER';
    const subjectTeacher = teacherHas('SUBJECT_TEACHER');
    const classAdviser = teacherHas('CLASS_ADVISER');
    let titles;
    if (departmentHead) {
      titles = {
        dashboard: ['Department Head Dashboard', 'Monitor learner attendance, teacher availability, class coverage, schedules, and section report progress.'],
        students: ['Student roster · View only', 'View learners across the school. Student master-record changes remain with the School Administrator and authorized Class Advisers.'],
        teachers: ['Teacher monitoring', 'Review teacher designations, assigned grade levels and sections, leave, schedules, and temporary substitute coverage.'],
        schedules: ['Department schedule management', 'View every department’s timetable and create or assign class schedules only within your own department.'],
        sf2: ['SF2 monitoring', 'Preview official section reports. Department Heads cannot edit, submit, or collect SF2 reports.']
      };
    } else if (gateKeeper) {
      titles = { students: ['Learner and teacher gate attendance', 'Scan a learner QR card or teacher badge, verify the registered photograph, then record school-gate time-in or time-out.'] };
    } else if (role === 'TEACHER') {
      const dashboardName = subjectTeacher && classAdviser ? 'Teacher Dashboard' : classAdviser ? 'Class Adviser Dashboard' : 'Subject Teacher Dashboard';
      titles = {
        dashboard: [dashboardName, classAdviser && subjectTeacher ? 'Your assigned subjects and advisory section at a glance.' : classAdviser ? 'Monitor your assigned section and official SF2 responsibilities.' : 'Monitor your assigned subject classes and record period attendance.'],
        students: [classAdviser && !subjectTeacher ? 'My advisory section' : 'My assigned learners', 'View only the learners in your assigned sections and subject schedules.'],
        schedules: ['My subject schedules', 'View only your permanent and active substitute class assignments.'],
        sf2: [classAdviser && subjectTeacher ? 'My SF2 reports' : classAdviser ? 'Official section SF2' : 'Personal SF2 copy', classAdviser ? 'Generate the official consolidated section SF2 only for sections assigned to you as Class Adviser.' : 'Generate a personal attendance copy from your own subject-period records.'],
        classAttendance: ['Class attendance', classAdviser && subjectTeacher ? 'Review your advisory section and the other sections covered by your assigned subject schedules.' : classAdviser ? 'Review attendance for your assigned advisory section.' : 'Review attendance in the sections covered by your assigned subject schedules.']
      };
    } else {
      titles = {
        dashboard: ['School Administrator Dashboard', 'Manage school attendance operations, users, learner records, devices, schedules, and reporting.'],
        students: ['Student management', 'Register learners, maintain student details and photos, create student portal accounts, and manage QR cards.'],
        schedules: ['Class schedules', 'Create and manage subject periods and permanent teacher assignments.'],
        teachers: ['Teacher and staff management', 'Create school accounts, manage teacher designations, leave, schedules, substitutions, and class adviser assignments.'],
        sf2: ['SF2 Report Generator', 'Generate the monthly TUVERA SF2 and collect official reports submitted by Class Advisers.'],
        cloudSync: ['Cloud Sync', 'Configure the destination for the future secure local-to-cloud attendance synchronization.']
      };
    }
    const title = titles[view] || ['Dashboard', 'Attendance overview.'];
    $('viewTitle').textContent = title[0];
    $('viewDescription').textContent = title[1];
    $('breadcrumbCurrent').textContent = title[0];
    if (view === 'classAttendance' && role === 'TEACHER') {
      loadTeacherClassAttendance().catch(error => {
        if ($('teacherAttendanceFeedback')) {
          $('teacherAttendanceFeedback').textContent = error.message;
          $('teacherAttendanceFeedback').className = 'inline-feedback error';
        }
      });
    }
    if ($('teacherMonitorTitle')) $('teacherMonitorTitle').textContent = departmentHead ? 'Teacher status and class coverage' : 'Teacher accounts';
    if ($('teacherMonitorDescription')) $('teacherMonitorDescription').textContent = departmentHead
      ? 'Review teacher status, assigned grade levels and sections, leave, schedules, and temporary substitute coverage.'
      : 'Manage teacher accounts, designations, schedules, leave, and class adviser assignments.';
    if ($('teacherActionHeader')) $('teacherActionHeader').textContent = departmentHead ? 'Coverage action' : 'Account action';
    if ($('sf2ViewTitle')) $('sf2ViewTitle').textContent = departmentHead ? 'SF2 Monitoring' : 'SF2 Report Generator';
    if ($('sf2ViewDescription')) $('sf2ViewDescription').textContent = departmentHead
      ? 'Preview official section attendance reports. This role has read-only access and cannot submit or collect reports.'
      : 'Generate a personal subject copy or the official consolidated section SF2 according to your teacher designations.';
    if (gateKeeper) {
      $('studentScopeText').textContent = 'Gate Keeper access: use QR lookup only. The full learner roster is not available to this account.';
      if ($('studentRosterPanel')) $('studentRosterPanel').hidden = true;
    }
    $('sidebar').classList.remove('open');
  }

  function applyRoleNavigation() {
    const role = user?.role;
    const admin = role === 'SCHOOL_ADMIN';
    const teacher = role === 'TEACHER';
    if ($('cloudSyncNav')) $('cloudSyncNav').hidden = !admin;
    if ($('exportTeachersButton')) $('exportTeachersButton').hidden = !(admin || role === 'DEPARTMENT_HEAD');
    if ($('bulkImportStudentsButton')) $('bulkImportStudentsButton').hidden = !(admin || teacherHas('CLASS_ADVISER'));
    if ($('studentStatusFilterWrap')) $('studentStatusFilterWrap').hidden = !admin;
    if ($('downloadStudentTemplate')) $('downloadStudentTemplate').hidden = !(admin || (teacher && teacherHas('CLASS_ADVISER')));
    if ($('exportStudentsButton')) $('exportStudentsButton').hidden = !['SCHOOL_ADMIN', 'DEPARTMENT_HEAD', 'TEACHER'].includes(role);
    if ($('academicAdminNav')) $('academicAdminNav').hidden = !admin;
    if ($('staffBulkDepartmentToolbar')) $('staffBulkDepartmentToolbar').hidden = !admin;
    const departmentHead = role === 'DEPARTMENT_HEAD';
    const gateKeeper = role === 'GATE_KEEPER';
    if ($('studentDepartmentScopeNote')) $('studentDepartmentScopeNote').hidden = !departmentHead;
    if ($('printBulkQr')) $('printBulkQr').hidden = departmentHead;
    if ($('applyStudentBatch')) $('applyStudentBatch').hidden = !(admin || departmentHead || (role === 'TEACHER' && teacherHas('CLASS_ADVISER')));
    const subjectTeacher = teacherHas('SUBJECT_TEACHER');
    const classAdviser = teacherHas('CLASS_ADVISER');
    const mayScan = gateKeeper || (teacher && (subjectTeacher || classAdviser));

    if ($('classAttendanceNav')) {
      $('classAttendanceNav').hidden = !(teacher && (subjectTeacher || classAdviser));
      $('classAttendanceNav').querySelector('.nav-label').textContent =
        classAdviser && subjectTeacher ? 'Class attendance' : classAdviser ? 'My advisory attendance' : 'My class attendance';
    }
    const attendanceViewSelect = $('teacherAttendanceViewSelect');
    if (attendanceViewSelect) {
      const allOption = attendanceViewSelect.querySelector('option[value="ALL"]');
      const advisoryOption = attendanceViewSelect.querySelector('option[value="ADVISORY"]');
      const subjectOption = attendanceViewSelect.querySelector('option[value="SUBJECT"]');
      if (allOption) allOption.hidden = !(classAdviser && subjectTeacher);
      if (advisoryOption) advisoryOption.hidden = !classAdviser;
      if (subjectOption) subjectOption.hidden = !subjectTeacher;
      attendanceViewSelect.value = classAdviser && subjectTeacher
        ? 'ALL' : classAdviser ? 'ADVISORY' : subjectTeacher ? 'SUBJECT' : 'ALL';
    }
    if ($('studentScannerToggle')) $('studentScannerToggle').hidden = !mayScan;
    if ($('studentScannerCard')) $('studentScannerCard').hidden = !mayScan;
    const mayAddStudent = admin || (teacher && classAdviser);
    if ($('dashboardOpenScanner')) $('dashboardOpenScanner').hidden = !mayScan;
    if ($('dashboardAddStudent')) $('dashboardAddStudent').hidden = !mayAddStudent;
    if ($('dashboardScanCta')) $('dashboardScanCta').hidden = !(mayScan || mayAddStudent);
    if ($('departmentHeadOverview')) $('departmentHeadOverview').hidden = !departmentHead;
    if ($('adminGatekeeperMonitoringCard')) $('adminGatekeeperMonitoringCard').hidden = !admin;
    if ($('teacherGateAttendanceCard')) $('teacherGateAttendanceCard').hidden = !(admin || departmentHead);
    if ($('gateScanHelp')) $('gateScanHelp').hidden = !gateKeeper;
    if ($('gateScanTypeWrap')) $('gateScanTypeWrap').hidden = !gateKeeper;
    if (gateKeeper) {
      if ($('gateScannerHeading')) $('gateScannerHeading').textContent = 'Learner and teacher gate attendance';
      if ($('gateScannerDescription')) $('gateScannerDescription').textContent = 'Scan a learner QR card or teacher QR badge. The system detects the person, displays the registered photo, and records gate time-in or time-out after verification.';
    } else if (teacher && mayScan) {
      if ($('gateScannerHeading')) $('gateScannerHeading').textContent =
        classAdviser && subjectTeacher ? 'Subject and advisory attendance scanner' : classAdviser ? 'My advisory attendance scanner' : 'Subject-class attendance scanner';
      if ($('gateScannerDescription')) $('gateScannerDescription').textContent =
        classAdviser && subjectTeacher ? 'Scan learner QR cards for your assigned subject periods or your own advisory section.' : classAdviser ? 'Scan learner QR cards for your assigned advisory section and record homeroom attendance.' : 'Scan learner QR cards for the subject periods assigned to your teacher account.';
    }
    if (admin && !mayScan) {
      const title = $('dashboardScanCta')?.querySelector('h2');
      const copy = $('dashboardScanCta')?.querySelector('p');
      if (title) title.textContent = 'Manage school records';
      if (copy) copy.textContent = 'Register learners and manage school accounts. Gate attendance is recorded by Gate Keepers.';
    } else if (mayAddStudent && !mayScan) {
      const title = $('dashboardScanCta')?.querySelector('h2');
      const copy = $('dashboardScanCta')?.querySelector('p');
      if (title) title.textContent = 'Manage your advisory section';
      if (copy) copy.textContent = 'Register a learner or open your assigned students.';
    } else if ($('dashboardScanCta')) {
      const title = $('dashboardScanCta').querySelector('h2');
      const copy = $('dashboardScanCta').querySelector('p');
      if (title) title.textContent = gateKeeper ? 'Record learner or teacher gate attendance' : teacher && classAdviser && subjectTeacher ? 'Ready for subject or advisory attendance?' : classAdviser ? 'Ready for advisory attendance?' : 'Ready for subject-class attendance?';
      if (copy) copy.textContent = gateKeeper ? 'Scan a learner QR card or teacher badge, compare the photo, and record gate time-in or time-out.' : teacher ? 'Open the QR scanner and choose an assigned subject class or advisory section.' : 'Open the QR scanner to identify a learner and record attendance.';
    }

    if ($('dashboardNav')) $('dashboardNav').hidden = gateKeeper;
    if ($('studentsNav')) {
      $('studentsNav').hidden = !admin && !departmentHead && !teacher && !gateKeeper;
      if ($('showStudentForm')) $('showStudentForm').hidden = departmentHead || gateKeeper;
      $('studentsNav').querySelector('.nav-label').textContent = gateKeeper ? 'Gate scanner' : teacher ? (classAdviser && !subjectTeacher ? 'My advisory section' : 'My learners') : 'Students';
      $('studentsNav').title = gateKeeper ? 'Gate scanner' : 'Students';
    }
    if ($('studentRosterPanel')) $('studentRosterPanel').hidden = gateKeeper;
    if ($('studentManagementHeader')) $('studentManagementHeader').hidden = gateKeeper;
    if ($('studentRosterPanel')) $('studentRosterPanel').hidden = gateKeeper;
    if ($('studentForm')) $('studentForm').hidden = gateKeeper || departmentHead || $('studentForm').hidden;
    if ($('parentInviteModal')) $('parentInviteModal').hidden = true;
    if ($('schedulesNav')) $('schedulesNav').hidden = gateKeeper || (teacher && !subjectTeacher);
    if ($('sf2Nav')) $('sf2Nav').hidden = gateKeeper || (!admin && !departmentHead && !teacher);
    if ($('teachersNav')) {
      $('teachersNav').hidden = !(admin || departmentHead);
      if (departmentHead) $('teachersNav').querySelector('.nav-label').textContent = 'Teacher monitoring';
      else $('teachersNav').querySelector('.nav-label').textContent = 'Teachers';
    }
    if ($('parentsNav')) $('parentsNav').hidden = !admin;
    if ($('showStudentForm')) $('showStudentForm').hidden = !(admin || (teacher && classAdviser));
    if ($('showScheduleForm')) $('showScheduleForm').hidden = !(admin || (teacher && subjectTeacher));
    if ($('dashboardAddStudent')) $('dashboardAddStudent').hidden = !(admin || (teacher && classAdviser));
    if ($('showTeacherForm')) $('showTeacherForm').hidden = !admin;
    if ($('staffUserRows')) $('staffUserRows').closest('.staff-accounts-card').hidden = !admin;
    if ($('adviserAssignmentForm')) $('adviserAssignmentForm').hidden = !admin;
    if ($('adviserAssignmentForm')) $('adviserAssignmentForm').closest('.adviser-assignments-card').hidden = !admin;
    if ($('sf2SubmissionsCard')) $('sf2SubmissionsCard').hidden = !(admin || departmentHead);
    if ($('sardoCard')) $('sardoCard').hidden = !(admin || departmentHead);
    if ($('learnerSummaryCard')) $('learnerSummaryCard').hidden = gateKeeper;
    if ($('recentActivityCard')) $('recentActivityCard').hidden = gateKeeper;
    if ($('quickActionsCard')) $('quickActionsCard').hidden = gateKeeper;
    document.querySelectorAll('.quick-action[data-go]').forEach(button => {
      const target = button.dataset.go;
      const allowed = allowedViewsForUser();
      button.hidden = !allowed.includes(target);
      const label = button.querySelector('strong');
      const detail = button.querySelector('small');
      if (target === 'students' && label) {
        if (teacher) { label.textContent = classAdviser && !subjectTeacher ? 'My advisory section' : 'My assigned learners'; if (detail) detail.textContent = 'Open learners assigned to your classes'; }
        else if (admin) { label.textContent = 'Manage student records'; if (detail) detail.textContent = 'Register learners, update records, and manage student logins'; }
      }
      if (target === 'teachers' && label) {
        if (departmentHead) { label.textContent = 'Monitor teachers'; if (detail) detail.textContent = 'Review availability, grade levels, sections, and class coverage'; }
        else if (admin) { label.textContent = 'Manage staff accounts'; if (detail) detail.textContent = 'Create staff accounts and assign teacher designations'; }
      }
      if (target === 'schedules' && label) {
        if (teacher) { label.textContent = 'My subject schedules'; if (detail) detail.textContent = 'View only your assigned periods'; }
        else if (departmentHead) { label.textContent = 'Monitor class schedules'; if (detail) detail.textContent = 'Review school periods and coverage'; }
        else if (admin) { label.textContent = 'Manage class schedules'; if (detail) detail.textContent = 'Create periods and assign permanent teachers'; }
      }
      if (target === 'sf2' && label) {
        if (departmentHead) { label.textContent = 'Monitor SF2 reports'; if (detail) detail.textContent = 'Preview official section reports; no collection actions'; }
        else if (teacher && classAdviser) { label.textContent = 'My section SF2'; if (detail) detail.textContent = 'Submit official reports for your assigned advisory sections'; }
        else if (teacher) { label.textContent = 'My personal SF2 copy'; if (detail) detail.textContent = 'Generate a non-official copy from your subject records'; }
        else if (admin) { label.textContent = 'SF2 submissions'; if (detail) detail.textContent = 'Review and collect official Class Adviser submissions'; }
      }
      if (departmentHead && target === 'students') button.hidden = false;
      if (teacher && target === 'students' && !classAdviser && !subjectTeacher) button.hidden = true;
    });

    const peopleGroup = document.querySelector('[data-nav-group="people"]')?.closest('.nav-group');
    const academicsGroup = document.querySelector('[data-nav-group="academics"]')?.closest('.nav-group');
    if ($('quickActionsCard')) {
      const heading = $('quickActionsCard').querySelector('.card-heading h3');
      const copy = $('quickActionsCard').querySelector('.card-heading p');
      if (heading && copy) {
        if (departmentHead) { heading.textContent = 'Monitoring shortcuts'; copy.textContent = 'Review staff coverage, schedules, and official report progress.'; }
        else if (teacher) { heading.textContent = 'My teaching shortcuts'; copy.textContent = 'Open your assigned learners, schedules, and SF2 tasks.'; }
        else { heading.textContent = 'School administration shortcuts'; copy.textContent = 'Open common attendance and staff administration tasks.'; }
      }
    }
    if (peopleGroup) peopleGroup.hidden = Boolean($('studentsNav')?.hidden && $('teachersNav')?.hidden && $('parentsNav')?.hidden);
    if (academicsGroup) academicsGroup.hidden = Boolean($('sf2Nav')?.hidden && $('schedulesNav')?.hidden);
    if (departmentHead) {
      if ($('peopleGroupLabel')) $('peopleGroupLabel').textContent = 'Staff monitoring';
      if ($('academicsGroupLabel')) $('academicsGroupLabel').textContent = 'Reports & schedules';
    } else {
      if ($('peopleGroupLabel')) $('peopleGroupLabel').textContent = 'People management';
      if ($('academicsGroupLabel')) $('academicsGroupLabel').textContent = 'Academics';
    }
    if (gateKeeper) {
      if ($('scanSetupScope')) { $('scanSetupScope').value = 'SCHOOL'; $('scanSetupScope').disabled = true; }
      if ($('scanSetupPeriodWrap')) $('scanSetupPeriodWrap').hidden = true;
      if ($('scanSetupTitle')) $('scanSetupTitle').textContent = 'Gate attendance scanner';
      const desc = document.querySelector('.scan-setup-description');
      if (desc) desc.textContent = 'Scan a learner QR card or teacher badge, verify the registered photo, then record gate time-in or time-out.';
    } else if (teacher) {
      if ($('scanSetupTitle')) $('scanSetupTitle').textContent = 'Prepare class attendance scanner';
      const desc = document.querySelector('.scan-setup-description');
      if (desc) desc.textContent = 'Choose an assigned subject class or advisory section. Only learners within your authorized assignments can be recorded.';
    }
    const currentAdminTab = $('adminManagementTabs')?.querySelector('.is-active')?.dataset.adminManagementTab || 'accounts';
    setAdminManagementTab(currentAdminTab);
  }

  function setAdminManagementTab(tabName = 'accounts') {
    const isAdmin = user?.role === 'SCHOOL_ADMIN';
    const tabs = $('adminManagementTabs');
    if (tabs) tabs.hidden = !isAdmin;
    const teacherCard = $('teacherRows')?.closest('.surface-card');
    const staffCard = $('staffAccountsTable')?.closest('.surface-card');
    const adviserCard = $('adviserAssignmentForm')?.closest('.surface-card');
    const departmentCard = $('departmentManagementCard');
    const note = document.querySelector('.teacher-management-note');
    if (!isAdmin) return;
    const activeTab = ['accounts','permissions','departments'].includes(tabName) ? tabName : 'accounts';
    if (teacherCard) teacherCard.hidden = activeTab !== 'accounts';
    if (staffCard) staffCard.hidden = activeTab !== 'accounts';
    if (adviserCard) adviserCard.hidden = activeTab !== 'permissions';
    if (departmentCard) departmentCard.hidden = activeTab !== 'departments';
    if (note) note.hidden = activeTab !== 'accounts';
    tabs?.querySelectorAll('[data-admin-management-tab]').forEach(button => {
      const selected = button.dataset.adminManagementTab === activeTab;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.tabIndex = selected ? 0 : -1;
    });
  }

  $('adminManagementTabs')?.addEventListener('click', event => {
    const button = event.target.closest('[data-admin-management-tab]');
    if (button) setAdminManagementTab(button.dataset.adminManagementTab);
  });

  function renderStats(data) {
    const role = user?.role;
    const isTeacher = role === 'TEACHER';
    const learner = data.learnerAttendance || {};
    const statLabels = [...document.querySelectorAll('.stat-card .stat-top span:first-child')];
    const statNotes = [...document.querySelectorAll('.stat-card small')];

    $('statStudents').textContent = data.students?.active ?? 0;
    $('statClasses').textContent = data.today?.class_checkins ?? 0;
    if (isTeacher) {
      $('statArrivals').textContent = learner.confirmedPresentToday ?? 0;
      $('statLate').textContent = learner.pendingConfirmationToday ?? 0;
      ['Assigned learners', 'Present today', 'Pending confirmation', 'My subject check-ins'].forEach((label, i) => { if (statLabels[i]) statLabels[i].textContent = label; });
      ['Learners in your assigned classes', 'At least one accepted subject check-in', 'Not confirmed; this is not an absence count', 'Accepted time-ins in your assigned periods'].forEach((label, i) => { if (statNotes[i]) statNotes[i].textContent = label; });
    } else if (role === 'DEPARTMENT_HEAD') {
      $('statArrivals').textContent = data.today?.school_arrivals ?? 0;
      $('statLate').textContent = data.today?.late_arrivals ?? 0;
      ['Active learners', 'Gate arrivals', 'Late gate arrivals', 'Subject check-ins'].forEach((label, i) => { if (statLabels[i]) statLabels[i].textContent = label; });
      ['Active learner records', 'Accepted school gate time-ins today', 'Arrivals after the gate grace period', 'Accepted subject time-ins today'].forEach((label, i) => { if (statNotes[i]) statNotes[i].textContent = label; });
    } else {
      $('statArrivals').textContent = data.today?.school_arrivals ?? 0;
      $('statLate').textContent = data.today?.late_arrivals ?? 0;
      ['Active students', 'School arrivals', 'Late arrivals', 'Class check-ins'].forEach((label, i) => { if (statLabels[i]) statLabels[i].textContent = label; });
      ['Active learner profiles', 'Accepted school time-ins today', 'Arrivals after the grace period', 'Accepted subject time-ins today'].forEach((label, i) => { if (statNotes[i]) statNotes[i].textContent = label; });
    }

    if ($('learnerTotal')) $('learnerTotal').textContent = learner.activeLearners ?? '—';
    if ($('learnerPresent')) $('learnerPresent').textContent = learner.confirmedPresentToday ?? '—';
    if ($('learnerPending')) $('learnerPending').textContent = learner.pendingConfirmationToday ?? '—';
    if ($('learnerMonthDays')) $('learnerMonthDays').textContent = learner.confirmedLearnerDaysMonth ?? '—';
    if ($('learnerSummaryNote')) {
      $('learnerSummaryNote').textContent = learner.absenceFinalizationAvailable
        ? 'Daily attendance is based on finalized subject records.'
        : 'Pending confirmation is not an absence count. A learner is counted Present after at least one accepted subject check-in; unconfirmed learners are not marked Absent.';
    }
    if ($('sardoStatus')) $('sardoStatus').textContent = data.sardo?.monitoringEnabled ? 'Monitoring active' : 'Setup required';
    if ($('sardoMessage')) $('sardoMessage').textContent = data.sardo?.message || 'SARDO monitoring is awaiting finalized attendance and excused/unexcused absence classification.';
    const rows = data.recent || [];
    $('recentRows').innerHTML = rows.length ? rows.map(row => {
      const date = new Date(row.occurredAt);
      const time = Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit' });
      const label = `${row.scope === 'CLASS' ? 'Class' : 'Gate'} ${String(row.eventType || '').replace('_', ' ').toLowerCase()}`;
      const status = row.syncStatus || 'ACCEPTED';
      const statusClass = row.late ? 'status-tag late' : (status === 'ACCEPTED' ? 'status-tag' : 'status-tag neutral');
      return `<tr><td>${esc(row.fullName || row.studentId)}</td><td>${esc(label)}</td><td>${esc(time)}</td><td><span class="${statusClass}">${esc(row.late ? 'LATE' : status)}</span></td></tr>`;
    }).join('') : '<tr><td colspan="4" class="empty-cell">No attendance activity is available for this account yet.</td></tr>';
  }

  function renderDepartmentHeadOverview() {
    if (user?.role !== 'DEPARTMENT_HEAD' || !$('departmentHeadOverview')) return;
    const statusOf = teacher => String(teacher.teacherStatus ?? teacher.teacher_status ?? '').trim().toUpperCase();
    const onLeave = teachers.filter(teacher => statusOf(teacher) === 'ON_LEAVE' || (!teacher.active && Boolean(teacher.leaveType)));
    const active = teachers.filter(teacher => teacher.active && statusOf(teacher) !== 'ON_LEAVE');
    const coverIds = new Set();
    teachers.forEach(teacher => (teacher.substitutionAssignments || []).forEach(item => {
      if (item.relationship === 'SUBSTITUTE' && item.substitutionId) coverIds.add(String(item.substitutionId));
    }));
    $('dhTeacherTotal').textContent = String(teachers.length);
    $('dhTeacherActive').textContent = String(active.length);
    $('dhTeacherLeave').textContent = String(onLeave.length);
    $('dhTeacherCovers').textContent = String(coverIds.size);
    if ($('dhUncoveredClasses')) $('dhUncoveredClasses').textContent = String(teacherCoverage.filter(item => ['NO_TEACHER','ON_LEAVE_UNCOVERED'].includes(item.coverageStatus)).length);
    if ($('dhCoverageAlerts')) $('dhCoverageAlerts').textContent = String(teacherCoverage.filter(item => ['CHECK_IN_NOT_RECORDED','COVERAGE_CHECK_IN_NOT_RECORDED'].includes(item.coverageStatus)).length);
  }

  function renderDepartments() {
    const usableDepartments = departments.filter(item => item.active && item.code !== 'UNASSIGNED');
    const options = '<option value="">Select department</option>' + usableDepartments.map(item =>
      `<option value="${esc(item.departmentId)}">${esc(item.name)}</option>`
    ).join('');
    const accountSelect = $('newTeacherDepartment');
    if (accountSelect) {
      const previous = accountSelect.value;
      accountSelect.innerHTML = options;
      accountSelect.value = usableDepartments.some(item => String(item.departmentId) === String(previous))
        ? previous : '';
    }
    const bulkDepartmentSelect = $('bulkStaffDepartment');
    if (bulkDepartmentSelect) {
      const previous = bulkDepartmentSelect.value;
      bulkDepartmentSelect.innerHTML = '<option value="">Choose department</option>' + usableDepartments.map(item =>
        '<option value="' + esc(item.departmentId) + '">' + esc(item.name) + '</option>'
      ).join('');
      if (usableDepartments.some(item => String(item.departmentId) === String(previous))) bulkDepartmentSelect.value = previous;
      updateStaffBulkUi();
    }
    const list = $('departmentList');
    if (list) list.innerHTML = departments.length
      ? departments.map(item => `<tr>
          <td><strong>${esc(item.code)}</strong></td>
          <td>${esc(item.name)}</td>
          <td>${esc(item.description || '—')}</td>
          <td><span class="account-status ${item.active ? 'active' : 'inactive'}">${item.active ? 'Active' : 'Inactive'}</span></td>
          <td>${item.code === 'UNASSIGNED' ? '<span class="muted-inline">System department</span>' : `<button type="button" class="outline-button small-btn" data-edit-department="${esc(item.departmentId)}">Edit</button>`}</td>
        </tr>`).join('')
      : '<tr><td colspan="5" class="empty-cell">No departments created yet.</td></tr>';
    if ($('departmentManagementCard')) $('departmentManagementCard').hidden = user.role !== 'SCHOOL_ADMIN';
    if ($('newTeacherDepartmentGroup')) $('newTeacherDepartmentGroup').hidden = user.role !== 'SCHOOL_ADMIN';
  }

function coverageStatusLabel(status) {
    const labels = {
      NO_TEACHER: 'No teacher assigned',
      ON_LEAVE_UNCOVERED: 'On leave · no cover',
      CHECK_IN_NOT_RECORDED: 'Check-in not recorded',
      COVERAGE_CHECK_IN_NOT_RECORDED: 'Cover check-in not recorded',
      TEACHER_INACTIVE: 'Teacher inactive',
      WAITING_FOR_START: 'Waiting for class',
      SCHEDULED: 'Scheduled',
      COVERED: 'Covered',
      ASSIGNED: 'Assigned'
    };
    return labels[status] || status;
  }

  function coverageStatusClass(status) {
    if (['NO_TEACHER','ON_LEAVE_UNCOVERED','CHECK_IN_NOT_RECORDED','COVERAGE_CHECK_IN_NOT_RECORDED','TEACHER_INACTIVE'].includes(status)) return 'coverage-alert';
    if (status === 'COVERED') return 'coverage-covered';
    return 'coverage-normal';
  }

  function coverageNeedsAction(row) {
    return ['NO_TEACHER','ON_LEAVE_UNCOVERED','CHECK_IN_NOT_RECORDED','COVERAGE_CHECK_IN_NOT_RECORDED','TEACHER_INACTIVE'].includes(row.coverageStatus);
  }

  function renderTeacherCoverage() {
    const host = $('teacherCoverageRows');
    if (!host) return;
    const alertRows = teacherCoverage.filter(row => coverageNeedsAction(row));
    const count = $('coverageAlertCount');
    if (count) count.textContent = `${alertRows.length} ${alertRows.length === 1 ? 'alert' : 'alerts'}`;
    const summary = $('coverageAlertSummary');
    if (summary) {
      const unassigned = teacherCoverage.filter(row => row.coverageStatus === 'NO_TEACHER').length;
      const leave = teacherCoverage.filter(row => row.coverageStatus === 'ON_LEAVE_UNCOVERED').length;
      const missed = teacherCoverage.filter(row => ['CHECK_IN_NOT_RECORDED','COVERAGE_CHECK_IN_NOT_RECORDED'].includes(row.coverageStatus)).length;
      summary.textContent = `${teacherCoverage.length} scheduled classes · ${unassigned} without a teacher · ${leave} uncovered leave periods · ${missed} missing time-in records.`;
    }
    if (!teacherCoverage.length) {
      host.innerHTML = '<tr><td colspan="6" class="empty-cell">No active class schedules were found. Add department schedules to begin monitoring coverage.</td></tr>';
      return;
    }
    host.innerHTML = teacherCoverage.map(row => {
      const canManageRow = user.role === 'SCHOOL_ADMIN' ||
        (user.role === 'DEPARTMENT_HEAD' && user.departmentCode !== 'UNASSIGNED' &&
         String(row.departmentId) === String(user.departmentId));
      const options = canManageRow ? teachers.filter(teacher => {
        const alreadyBooked = (teacher.assignedPeriods || []).some(period =>
          String(period.periodId) !== String(row.periodId) &&
          String(period.startTime || '') < String(row.endTime || '') &&
          String(row.startTime || '') < String(period.endTime || '')
        );
        return teacher.active && String(teacher.departmentId) === String(row.departmentId) &&
          (teacher.teacherDesignations || []).includes('SUBJECT_TEACHER') &&
          String(teacher.userId) !== String(row.teacherUserId) && !alreadyBooked;
      }) : [];
      const action = !canManageRow
        ? '<span class="muted-inline">Managed by its department</span>'
        : row.coverageStatus === 'COVERAGE_CHECK_IN_NOT_RECORDED'
          ? '<span class="muted-inline">Follow up with substitute</span>'
          : coverageNeedsAction(row) && options.length
            ? `<div class="coverage-action-controls">
                 <select aria-label="Choose teacher for ${esc(row.periodName)}" data-coverage-teacher-select="${esc(row.periodId)}">
                   <option value="">Choose teacher</option>
                   ${options.map(teacher => `<option value="${esc(teacher.userId)}">${esc(teacher.displayName)}</option>`).join('')}
                 </select>
                 <button type="button" class="outline-button compact-button" data-coverage-action="${esc(row.periodId)}">${row.coverageStatus === 'NO_TEACHER' ? 'Assign teacher' : 'Provide cover'}</button>
               </div>`
            : coverageNeedsAction(row) ? '<span class="muted-inline">No eligible teacher available</span>' : '<span class="muted-inline">—</span>';
      const assigned = row.effectiveTeacherName || row.teacherName || 'No permanent teacher';
      const teacherName = row.substituteTeacherName
        ? `<strong>${esc(row.substituteTeacherName)}</strong><small class="table-subtext">Covering ${esc(row.teacherName || 'original teacher')}</small>`
        : esc(assigned);
      const className = `${row.gradeLevel || ''} · ${row.section || 'All sections'}${row.classroom ? ' · ' + row.classroom : ''}`;
      return `<tr>
        <td>${esc(row.departmentName || 'Unassigned')}</td>
        <td><strong>${esc(className)}</strong></td>
        <td><strong>${esc(row.subjectName || row.periodName)}</strong><small class="table-subtext">${esc(row.periodName)} · ${esc(row.startTime)}–${esc(row.endTime)}</small></td>
        <td>${teacherName}</td>
        <td><span class="coverage-status-pill ${coverageStatusClass(row.coverageStatus)}">${esc(coverageStatusLabel(row.coverageStatus))}</span></td>
        <td>${row.coverageStatus === 'COVERAGE_CHECK_IN_NOT_RECORDED' ? '<span class="muted-inline">Follow up with substitute</span>' : action}</td>
      </tr>`;
    }).join('');
  }

  async function loadTeacherCoverage(notifyNew = false) {
    if (!['SCHOOL_ADMIN','DEPARTMENT_HEAD'].includes(user?.role)) return;
    const data = await api('/api/admin/teacher-coverage');
    const nextRows = data.coverage || [];
    const nextAlerts = new Set(nextRows.filter(coverageNeedsAction).map(row => `${data.schoolDate}:${row.periodId}:${row.coverageStatus}`));
    const newAlerts = coverageMonitorInitialized && notifyNew
      ? nextRows.filter(row => coverageNeedsAction(row) && !coverageAlertKeys.has(`${data.schoolDate}:${row.periodId}:${row.coverageStatus}`))
      : [];
    teacherCoverage = nextRows;
    coverageAlertKeys = nextAlerts;
    coverageMonitorInitialized = true;
    renderTeacherCoverage();
    renderDepartmentHeadOverview();
    if (newAlerts.length) {
      const first = newAlerts[0];
      const message = `${newAlerts.length} new class coverage alert(s). ${first.gradeLevel} ${first.section || ''} · ${first.periodName}: ${coverageStatusLabel(first.coverageStatus)}.`;
      if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification('Teacher coverage alert', { body: message }); } catch { showToast(message, true); }
      } else {
        showToast(message, true);
      }
    }
  }

  async function handleCoverageAction(periodId, button) {
    const row = teacherCoverage.find(item => String(item.periodId) === String(periodId));
    const select = document.querySelector(`[data-coverage-teacher-select="${CSS.escape(String(periodId))}"]`);
    const teacherUserId = select?.value;
    if (!row || !teacherUserId) { showToast('Choose an eligible teacher first.', true); return; }
    button.disabled = true;
    try {
      if (row.coverageStatus === 'NO_TEACHER') {
        await api(`/api/periods/${encodeURIComponent(row.periodId)}/assignments`, {
          method: 'POST', body: JSON.stringify({ teacherUserId })
        });
        showToast('Teacher assigned to the class schedule.');
      } else {
        let startDate = row.leaveStartDate && row.teacherStatus === 'ON_LEAVE' ? row.leaveStartDate : dataSchoolDate();
        let endDate = row.expectedReturnDate && row.teacherStatus === 'ON_LEAVE' ? row.expectedReturnDate : dataSchoolDate();
        if (row.leaveAutoReactivate && row.expectedReturnDate) {
          const previous = new Date(`${row.expectedReturnDate}T00:00:00Z`);
          previous.setUTCDate(previous.getUTCDate() - 1);
          endDate = previous.toISOString().slice(0,10);
        }
        await api(`/api/teachers/${encodeURIComponent(row.teacherUserId)}/substitutions`, {
          method: 'POST', body: JSON.stringify({ periodId: row.periodId, substituteTeacherUserId: teacherUserId, startDate, endDate })
        });
        showToast('Temporary teacher cover assigned.');
      }
      await loadSchoolData();
    } catch (error) {
      showToast(error.message, true);
      button.disabled = false;
    }
  }

  function dataSchoolDate() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  }

  async function getStudentQr(studentId) {
    const data = await api(`/api/students/${encodeURIComponent(studentId)}/qr`);
    if (!data?.qrDataUrl) throw new Error(`Could not generate QR for ${studentId}.`);
    return data.qrDataUrl;
  }

  function refreshBulkQrSections() {
    const grade = $('bulkQrGrade').value;
    const sectionSelect = $('bulkQrSection');
    const previous = sectionSelect.value;
    const sections = [...new Set(students
      .filter(student => grade === 'ALL' || student.gradeLevel === grade)
      .map(student => String(student.section || '').trim())
      .filter(Boolean))].sort((a, b) => a.localeCompare(b));
    sectionSelect.innerHTML = '<option value="ALL">All sections</option>' + sections.map(section => `<option value="${esc(section)}">${esc(section)}</option>`).join('');
    if (sections.includes(previous)) sectionSelect.value = previous;
  }

  function makeQrCard(student, qrDataUrl, photoDataUrl) {
    return `<article class="bulk-qr-card"><header>STUDENT IDENTIFICATION<br><small>SCHOOL ATTENDANCE</small></header><div class="bulk-qr-body">${photoDataUrl ? `<img class="bulk-qr-photo" src="${photoDataUrl}" alt="Student photo">` : '<div class="bulk-qr-photo bulk-qr-no-photo">PHOTO</div>'}<div class="bulk-qr-details"><strong>${esc(student.fullName || '')}</strong><span>Student ID: ${esc(student.studentId)}</span><span>${esc(student.gradeLevel)} · ${esc(student.section)}</span></div><img class="bulk-qr-code" src="${qrDataUrl}" alt="Student QR code"></div><footer>Present this QR code at the attendance station.</footer></article>`;
  }

  async function generateBulkQrCards() {
    const feedback = $('bulkQrFeedback');
    const grade = $('bulkQrGrade').value;
    const section = $('bulkQrSection').value;
    const search = ($('studentRosterSearch')?.value || '').trim().toLocaleLowerCase();
    const selected = students.filter(student => selectedStudentIds.has(student.studentId) &&
      (grade === 'ALL' || student.gradeLevel === grade) &&
      (section === 'ALL' || student.section === section) &&
      (!search || [student.fullName, student.studentId, student.lrn].some(value => String(value || '').toLocaleLowerCase().includes(search)))
    );
    if (!selected.length) { feedback.textContent = 'Select at least one student from the roster.'; return; }
    const button = $('printBulkQr'); button.disabled = true; feedback.textContent = `Preparing ${selected.length} card(s)…`;
    try {
      const cards = [];
      for (const student of selected) {
        let qr = studentQrCache.get(student.studentId);
        if (!qr) { qr = await getStudentQr(student.studentId); studentQrCache.set(student.studentId, qr); }
        const photo = await photoDataUrl(student.photoUrl);
        cards.push(makeStudentCardMarkup(student, qr, photo));
      }
      const printWindow = window.open('', '_blank');
      if (!printWindow) throw new Error('Allow pop-ups for this site to print ID cards.');
      printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Student QR ID Cards</title><style>${studentCardPrintCss()}body{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7mm}.bulk-qr-card{break-inside:avoid}@page{size:A4;margin:10mm}@media print{body{margin:0;gap:6mm}}</style></head><body>${cards.join('')}<script>window.onload=()=>setTimeout(()=>window.print(),450)<\/script></body></html>`);
      printWindow.document.close(); feedback.textContent = `${selected.length} selected card(s) ready.`;
    } catch (error) { feedback.textContent = error.message; showToast(error.message, true); }
    finally { button.disabled = false; }
  }

  function openStudentAccountModal(student, exists) {
    studentAccountMode = exists ? 'RESET' : 'CREATE';
    $('studentAccountStudentId').value = student.studentId;
    $('studentAccountTitle').textContent = exists ? 'Reset student portal password' : 'Create student portal account';
    $('studentAccountDescription').textContent = exists
      ? 'Set a new initial password. The student will be asked to change it after signing in.'
      : 'Username defaults to the Student ID. The student must change the initial password after first sign-in.';
    $('studentAccountUsername').value = student.studentAccountUsername || student.studentId;
    $('studentAccountUsername').readOnly = exists;
    $('studentAccountPassword').value = '';
    $('studentAccountConfirm').value = '';
    $('studentAccountFeedback').textContent = '';
    $('studentAccountFeedback').className = 'inline-feedback';
    $('saveStudentAccount').textContent = exists ? 'Reset password' : 'Create login';
    $('studentAccountModal').hidden = false;
    $('studentAccountPassword').focus();
  }

  function exportCsv(filename, headers, rows) {
    const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const csv = [headers, ...rows].map(row => row.map(quote).join(',')).join(String.fromCharCode(13, 10));
    const blob = new Blob([String.fromCharCode(0xfeff), csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    URL.revokeObjectURL(url);
  }

  async function renderStudents() {
    const host = $('studentRows');
    const grade = $('bulkQrGrade').value;
    const section = $('bulkQrSection').value;
    const search = ($('studentRosterSearch')?.value || '').trim().toLocaleLowerCase();
    const admin = user.role === 'SCHOOL_ADMIN';
    const departmentHead = user.role === 'DEPARTMENT_HEAD';
    const teacher = user.role === 'TEACHER';
    const gateKeeper = user.role === 'GATE_KEEPER';
    const designations = Array.isArray(user.teacherDesignations) ? user.teacherDesignations : [];
    const canManage = admin || departmentHead || (teacher && (designations.includes('CLASS_ADVISER') || designations.includes('SUBJECT_TEACHER')));
    const canUploadPhoto = admin || (teacher && designations.includes('CLASS_ADVISER'));
    const canViewQr = admin || (teacher && (
  designations.includes('CLASS_ADVISER') ||
  designations.includes('SUBJECT_TEACHER')
));
    const statusFilter = $('studentStatusFilter')?.value || 'ACTIVE';
    const visible = students.filter(student =>
      (grade === 'ALL' || student.gradeLevel === grade) &&
      (section === 'ALL' || student.section === section) &&
      (user.role !== 'SCHOOL_ADMIN' || statusFilter === 'ALL' ||
        (statusFilter === 'ACTIVE' && student.active !== false && !student.archivedAt) ||
        (statusFilter === 'INACTIVE' && student.active === false && !student.archivedAt) ||
        (statusFilter === 'ARCHIVED' && Boolean(student.archivedAt))) &&
      (!search || [student.fullName, student.studentId, student.lrn].some(value => String(value || '').toLocaleLowerCase().includes(search)))
    );
    for (const id of [...selectedStudentIds]) if (!visible.some(student => student.studentId === id)) selectedStudentIds.delete(id);
    if (!visible.length) {
      host.innerHTML = '<tr><td colspan="11" class="empty-cell">No students are available for this filter.</td></tr>';
    } else {
      const rows = await Promise.all(visible.map(async student => {
        const photo = await photoDataUrl(student.photoUrl);
        const avatar = photo ? `<img class="student-photo-thumb" src="${photo}" alt="Student photo for ${esc(student.fullName)}" loading="lazy">` : `<span class="student-photo-placeholder no-photo" aria-label="${student.hasPhoto ? 'Photo file missing' : 'No photo uploaded'}" title="${student.hasPhoto ? 'The database has a photo path but the file is missing from storage. Restore the storage/student-photos folder or upload the photo again.' : 'No photo has been uploaded yet. An administrator or Class Adviser can upload the photo.'}">${student.hasPhoto ? 'Missing' : 'No photo'}</span>`;
        let qr = '';
        if (canViewQr) {
          qr = studentQrCache.get(student.studentId) || '';
          if (!qr) {
            try { qr = await getStudentQr(student.studentId); studentQrCache.set(student.studentId, qr); }
            catch { qr = ''; }
          }
        }
        const qrCell = canViewQr
          ? (qr ? `<button type="button" class="student-qr-preview" data-view-qr="${esc(student.studentId)}" title="View or print QR"><img src="${qr}" alt="QR code for ${esc(student.studentId)}"></button>` : '<span class="qr-unavailable">QR unavailable</span>')
          : (gateKeeper ? '<span class="muted-inline">Gate scan only</span>' : '<span class="muted-inline">Not available</span>');
        const selection = (admin || departmentHead || (teacher && designations.includes('CLASS_ADVISER'))) ? `<input type="checkbox" class="student-select-box" data-select-student="${esc(student.studentId)}" ${selectedStudentIds.has(student.studentId) ? 'checked' : ''} aria-label="Select ${esc(student.fullName)}">` : '';
        const editable = canManage && student.active !== false && !student.archivedAt;
        const actions = editable
          ? `<div class="student-row-actions"><button type="button" class="outline-button" data-edit-student="${esc(student.studentId)}">Edit</button>${canUploadPhoto ? `<label class="student-photo-upload">${student.hasPhoto ? 'Replace photo' : 'Upload photo'}<input type="file" accept="image/jpeg,image/png,image/webp" data-student-photo="${esc(student.studentId)}" hidden></label>` : ''}</div>`
          : '<span class="muted-inline">' + (student.archivedAt ? 'Archived' : student.active === false ? 'Inactive' : 'View only') + '</span>';
        const accountExists = Boolean(student.studentAccountUsername);
        const accountCell = admin
          ? `<div class="student-row-actions"><span class="muted-inline">${accountExists ? `Active login · ${esc(student.studentAccountUsername)}` : 'No student login'}</span><button type="button" class="outline-button" data-student-account="${esc(student.studentId)}" data-account-exists="${accountExists ? '1' : '0'}">${accountExists ? 'Reset login' : 'Create login'}</button></div>`
          : '<span class="muted-inline">School admin only</span>';
        return `<tr><td data-label="Select">${selection}</td><td data-label="Photo">${avatar}</td><td data-label="Student ID">${esc(student.studentId)}</td><td data-label="Full name">${esc(student.fullName)}</td><td data-label="Sex">${esc(student.sex || 'Not set')}</td><td data-label="Grade">${esc(student.gradeLevel)}</td><td data-label="Section">${esc(student.section)}</td><td data-label="Status">${student.archivedAt ? 'Archived' : student.active === false ? 'Inactive' : 'Active'}</td><td data-label="QR code">${qrCell}</td><td data-label="Actions">${actions}</td><td data-label="Student account">${accountCell}</td></tr>`;
      }));
      host.innerHTML = rows.join('');
      host.querySelectorAll('input[data-student-photo]').forEach(input => input.addEventListener('change', async () => {
        const file = input.files?.[0]; if (!file) return;
        input.disabled = true;
        try { await uploadStudentPhoto(input.dataset.studentPhoto, file); await loadSchoolData(); showToast('Student photo uploaded successfully.'); }
        catch (error) { showToast(error.message, true); input.disabled = false; }
      }));
      host.querySelectorAll('[data-select-student]').forEach(box => box.addEventListener('change', () => {
        if (box.checked) selectedStudentIds.add(box.dataset.selectStudent); else selectedStudentIds.delete(box.dataset.selectStudent);
        updateStudentSelectionUi();
      }));
      host.querySelectorAll('[data-edit-student]').forEach(button => button.addEventListener('click', () => openStudentEdit(button.dataset.editStudent)));
      host.querySelectorAll('[data-view-qr]').forEach(button => button.addEventListener('click', () => {
        const student = students.find(item => item.studentId === button.dataset.viewQr);
        if (student) openStudentQrPreview(student);
      }));
      host.querySelectorAll('[data-student-account]').forEach(button => button.addEventListener('click', () => {
        const student = students.find(item => item.studentId === button.dataset.studentAccount);
        if (student) openStudentAccountModal(student, button.dataset.accountExists === '1');
      }));
    }
    $('studentScopeText').textContent = gateKeeper
      ? 'Gate Keeper access: view learner names and photos for entrance identity verification. Attendance can only be recorded at the school gate.'
      : canManage
        ? 'You may manage learner details only within your authorized class scope. Gate scans do not determine subject attendance or SF2.'
        : teacher
          ? 'View and correct learner names in your assigned subject classes. Class Advisers can also correct placement in their assigned section.'
          : user.role === 'DEPARTMENT_HEAD'
            ? 'Department-scoped learner management. You may edit names and sex or update current-year placement inside your department.'
            : 'Students registered under this school. Manage student information, photos, and QR cards.';
    const canBatchManage = admin || departmentHead || (teacher && designations.includes('CLASS_ADVISER'));
    document.querySelectorAll('.student-filter-row label, .student-bulk-actions').forEach(element => {
      if (gateKeeper) element.hidden = element.classList.contains('student-bulk-actions');
      else if (!canBatchManage) element.hidden = element.classList.contains('student-bulk-actions');
    });
    if (admin) refreshBulkQrSections();
    updateStudentSelectionUi();
  }

  function updateStudentSelectionUi() {
    const search = ($('studentRosterSearch')?.value || '').trim().toLocaleLowerCase();
    const statusFilter = $('studentStatusFilter')?.value || 'ACTIVE';
    const visible = students.filter(s =>
      ($('bulkQrGrade').value === 'ALL' || s.gradeLevel === $('bulkQrGrade').value) &&
      ($('bulkQrSection').value === 'ALL' || s.section === $('bulkQrSection').value) &&
      (user.role !== 'SCHOOL_ADMIN' || statusFilter === 'ALL' ||
        (statusFilter === 'ACTIVE' && s.active !== false && !s.archivedAt) ||
        (statusFilter === 'INACTIVE' && s.active === false && !s.archivedAt) ||
        (statusFilter === 'ARCHIVED' && Boolean(s.archivedAt))) &&
      (!search || [s.fullName, s.studentId, s.lrn].some(value => String(value || '').toLocaleLowerCase().includes(search)))
    );
    $('selectedStudentCount').textContent = `${selectedStudentIds.size} selected`;
    const isAdviser = user.role === 'TEACHER' && teacherHas('CLASS_ADVISER');
    const isDepartmentHead = user.role === 'DEPARTMENT_HEAD' && Boolean(user.departmentId) && user.departmentCode !== 'UNASSIGNED';
    if ($('applyStudentBatch')) $('applyStudentBatch').disabled = selectedStudentIds.size === 0 || !(user.role === 'SCHOOL_ADMIN' || isAdviser || isDepartmentHead);
    if ($('studentBatchAction')) [...$('studentBatchAction').options].forEach(option => {
      if (option.value) option.hidden = (isAdviser || isDepartmentHead) && !['UPDATE','ASSIGN'].includes(option.value);
    });
    $('selectAllStudents').checked = visible.length > 0 && visible.every(s => selectedStudentIds.has(s.studentId));
    $('selectAllStudents').indeterminate = visible.some(s => selectedStudentIds.has(s.studentId)) && !$('selectAllStudents').checked;
  }

  async function openStudentQrPreview(student) {
    try {
      const qr = studentQrCache.get(student.studentId) || await getStudentQr(student.studentId);
      studentQrCache.set(student.studentId, qr);
      const photo = await photoDataUrl(student.photoUrl);
      $('studentQrPreviewName').textContent = student.fullName || '';
      $('studentQrPreviewMeta').textContent = `${student.studentId} · ${student.gradeLevel} · ${student.section}`;
      $('studentQrPreviewImage').src = qr;
      $('studentQrPreviewPhoto').src = photo || '';
      $('studentQrPreviewPhoto').hidden = !photo;
      $('studentQrPreviewModal').hidden = false;
      $('studentQrPreviewPrint').onclick = () => printOneStudentCard(student);
    } catch (error) { showToast(error.message, true); }
  }

  async function printOneStudentCard(student) {
    try {
      const qr = studentQrCache.get(student.studentId) || await getStudentQr(student.studentId);
      studentQrCache.set(student.studentId, qr);
      const photo = await photoDataUrl(student.photoUrl);
      const card = makeStudentCardMarkup(student, qr, photo);
      const w = window.open('', '_blank');
      if (!w) throw new Error('Allow pop-ups for this site to print student ID cards.');
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Student ID</title><style>${studentCardPrintCss()}</style></head><body>${card}<script>window.onload=()=>setTimeout(()=>window.print(),350)<\/script></body></html>`);
      w.document.close();
    } catch (error) { showToast(error.message, true); }
  }

  function makeStudentCardMarkup(student, qr, photo) {
    return `<article class="bulk-qr-card"><header>STUDENT IDENTIFICATION<br><small>SCHOOL ATTENDANCE</small></header><div class="bulk-qr-body">${photo ? `<img class="bulk-qr-photo" src="${photo}" alt="Student photo">` : '<div class="bulk-qr-photo bulk-qr-no-photo">PHOTO</div>'}<div class="bulk-qr-details"><strong>${esc(student.fullName || '')}</strong><span>Student ID: ${esc(student.studentId)}</span><span>${esc(student.gradeLevel)} · ${esc(student.section)}</span></div><img class="bulk-qr-code" src="${qr}" alt="Student QR code"></div><footer>Present this QR code at the attendance station.</footer></article>`;
  }

  function studentCardPrintCss() {
    return '*{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:10mm}.bulk-qr-card{border:1.3px solid #23476b;border-radius:9px;overflow:hidden;min-height:49mm;max-width:180mm}.bulk-qr-card header{background:#12345a;color:white;padding:8px 10px;font-size:11px;font-weight:700}.bulk-qr-card header small{font-size:8px;font-weight:400}.bulk-qr-body{display:flex;align-items:center;gap:8px;padding:9px}.bulk-qr-photo{width:23mm;height:25mm;object-fit:cover;border-radius:5px;border:1px solid #d8e1e9}.bulk-qr-no-photo{display:grid;place-items:center;background:#eef3f7;color:#8294a4;font-size:9px}.bulk-qr-details{display:flex;flex:1;min-width:0;flex-direction:column;gap:5px;font-size:9px;overflow-wrap:anywhere}.bulk-qr-details strong{font-size:12px}.bulk-qr-code{width:25mm;height:25mm;object-fit:contain}.bulk-qr-card footer{border-top:1px solid #e1e7ed;padding:5px 9px;font-size:7px;color:#607387}@media print{body{margin:0}}';
  }

  function openStudentEdit(studentId) {
    const student = students.find(s => s.studentId === studentId);
    if (!student) return;
    $('editStudentId').value = student.studentId;
    $('editStudentIdDisplay').value = student.studentId;
    $('editLrn').value = student.lrn || '';
    $('editFullName').value = student.fullName || '';
    $('editSex').value = String(student.sex || '').toUpperCase();
    $('editGrade').value = student.gradeLevel || 'Grade 7';
    $('editSection').value = student.section || '';
    $('editParentName').value = student.parentName || '';
    $('editParentMobile').value = student.parentMobile || '';
    const isTeacher = user.role === 'TEACHER';
    const isDepartmentHead = user.role === 'DEPARTMENT_HEAD';
    const adviserCanEditPlacement = isTeacher && teacherHas('CLASS_ADVISER') &&
      adviserAssignments.some(item => String(item.gradeLevel) === String(student.gradeLevel) && String(item.section) === String(student.section));
    const restrictedStudentEditor = isTeacher || isDepartmentHead;
    ['editLrnGroup','editParentNameGroup','editParentMobileGroup'].forEach(id => { $(id).hidden = restrictedStudentEditor; });
    $('editParentName').required = !restrictedStudentEditor;
    $('editParentMobile').required = !restrictedStudentEditor;
    $('editSexGroup').hidden = isTeacher && !adviserCanEditPlacement;
    $('editSex').required = !isTeacher || adviserCanEditPlacement || isDepartmentHead;
    $('editGradeGroup').hidden = restrictedStudentEditor;
    $('editSectionGroup').hidden = restrictedStudentEditor;
    $('studentEditFeedback').textContent = isDepartmentHead
      ? 'As Department Head, you may correct learner name and sex in your department. Grade and section changes use the department-scoped batch assignment action.'
      : isTeacher
      ? adviserCanEditPlacement
        ? 'As Class Adviser, you may correct the learner name and placement within your assigned section. Student ID and QR code remain unchanged.'
        : 'As Subject Teacher, you may correct the learner name only. Grade, section, LRN, and guardian details remain protected.'
      : '';
    $('studentEditOverlay').hidden = false;
  }

  async function startStudentScanner() {
    if (!window.Html5Qrcode) throw new Error('QR scanner library did not load. Refresh the page and try again.');
    $('studentScannerPanel').hidden = false;
    if (!studentQrScanner) studentQrScanner = new Html5Qrcode('studentQrReader', { verbose: false, formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE] });
    const cameras = await Html5Qrcode.getCameras();
    if (!cameras.length) throw new Error('No camera was found on this device.');
    const preferred = cameras.find(c => /back|rear|environment/i.test(c.label)) || cameras[cameras.length - 1];
    await studentQrScanner.start(preferred.id, { fps: 10, qrbox: { width: 230, height: 230 }, aspectRatio: 1 }, onStudentQrDecoded);
    $('studentScannerToggle').textContent = 'Scanner open';
    const selectedSchedule = periods.find(p => String(p.periodId) === String(activeScanPeriodId));
    $('scanModeSummary').textContent = user.role === 'GATE_KEEPER'
      ? `Gate attendance · ${gateScanType === 'BOTH' ? 'Learners and teachers' : gateScanType === 'TEACHER' ? 'Teachers only' : 'Learners only'}.`
      : activeScanScope === 'CLASS'
        ? `Class / subject attendance · ${selectedSchedule ? selectedSchedule.periodName : 'Schedule selected'}`
        : activeScanScope === 'ADVISORY'
          ? `Advisory attendance · ${(adviserAssignments || []).map(a => `${a.gradeLevel} ${a.section}`).join(', ') || 'Assigned section'}`
          : 'School attendance · Gate time-in / time-out';
    $('studentScanFeedback').textContent = 'Camera active. Hold a learner QR card or teacher badge inside the frame.';
    $('studentScannerToggle').textContent = 'Scanner open';
  }

  async function stopStudentScanner() {
    if (studentQrScanner) { try { if (studentQrScanner.isScanning) await studentQrScanner.stop(); } catch {} try { await studentQrScanner.clear(); } catch {} studentQrScanner = null; }
    $('studentScannerToggle').textContent = 'Open scanner';
    $('studentScanFeedback').textContent = 'Scanner stopped. Choose attendance settings to scan again.';
    $('studentScannerPanel').hidden = true;
    $('studentScanSetupModal').hidden = false;
  }

  async function onStudentQrDecoded(decodedText) {
    if (scannedStudent || scannedTeacher) return;
    const raw = String(decodedText || '').trim();
    const teacherMatch = raw.match(/^TCH:([0-9a-f-]{36})$/i);
    const studentMatch = raw.match(/^JHS:([0-9a-f-]{36})$/i);
    const isGateKeeper = user.role === 'GATE_KEEPER';
    if (isGateKeeper && gateScanType === 'STUDENT' && teacherMatch) {
      $('studentScanFeedback').textContent = 'Teacher QR detected. Change the attendance type to Teacher attendance to record this staff member.';
      $('studentScanFeedback').className = 'scanner-feedback is-error';
      return;
    }
    if (isGateKeeper && gateScanType === 'TEACHER' && studentMatch) {
      $('studentScanFeedback').textContent = 'Learner QR detected. Change the attendance type to Learner attendance to record this student.';
      $('studentScanFeedback').className = 'scanner-feedback is-error';
      return;
    }
    if (teacherMatch && isGateKeeper) {
      try {
        const lookup = await api('/api/gate/teacher-lookup', { method: 'POST', body: JSON.stringify({ qrToken: teacherMatch[1] }) });
        await showGatePersonResult(lookup.teacher, 'TEACHER');
      } catch (error) {
        $('studentScanFeedback').textContent = error.message;
        $('studentScanFeedback').className = 'scanner-feedback is-error';
      }
      return;
    }
    if (!studentMatch) {
      $('studentScanFeedback').textContent = 'This is not a recognized learner or teacher gate QR code.';
      return;
    }
    let student = null;
    try {
      if (isGateKeeper) {
        const lookup = await api('/api/gate/lookup', { method: 'POST', body: JSON.stringify({ qrToken: studentMatch[1] }) });
        student = lookup.student;
      } else {
        student = students.find(s => String(s.qrToken || '').toLowerCase() === studentMatch[1].toLowerCase()) || null;
      }
      if (!student) throw new Error('Student not found in your authorized classes. Refresh the roster while online.');
    } catch (error) {
      $('studentScanFeedback').textContent = error.message;
      $('studentScanFeedback').className = 'scanner-feedback is-error';
      return;
    }
    scannedStudent = student;
    await showGatePersonResult(student, 'STUDENT');
  }

  async function showGatePersonResult(person, personType) {
    const isTeacherPerson = personType === 'TEACHER';
    const fullName = person.fullName || person.displayName || 'Unknown';
    const meta = isTeacherPerson
      ? `Teacher · ${(person.teacherDesignations || []).map(value => value === 'CLASS_ADVISER' ? 'Class Adviser' : 'Subject Teacher').join(' + ') || 'Staff'}`
      : `${person.studentId} · ${person.gradeLevel} · ${person.section}`;
    const photo = await photoDataUrl(person.photoUrl);
    const photoMarkup = photo
      ? `<img class="student-scan-verified-photo photo-flash" src="${photo}" alt="Registered ${isTeacherPerson ? 'teacher' : 'student'} photo for identity verification">`
      : '<div class="student-scan-verified-photo student-scan-no-photo">No registered photo</div>';
    const verificationMarkup = user.role === 'GATE_KEEPER'
      ? (photo
          ? `<label class="gate-photo-verification"><input type="checkbox" id="studentPhotoVerified"> I confirm the displayed photo matches the ${isTeacherPerson ? 'teacher' : 'learner'}.</label>`
          : `<p class="gate-photo-warning">No registered photo is available. Ask the School Administrator to upload a photo before recording attendance.</p>`)
      : '';
    const initiallyDisabled = user.role === 'GATE_KEEPER' ? 'disabled' : '';
    $('studentScanResult').hidden = false;
    const subjectLabel = isTeacherPerson ? 'teacher' : 'learner';
    $('studentScanResult').innerHTML = `${photoMarkup}<strong>${esc(fullName)}</strong><span>${esc(meta)}</span>${verificationMarkup}<div class="student-scan-buttons"><button type="button" class="primary-button" id="studentTimeIn" ${initiallyDisabled}>Record ${subjectLabel} time-in</button><button type="button" class="outline-button" id="studentTimeOut" ${initiallyDisabled}>Record ${subjectLabel} time-out</button><button type="button" class="outline-button" id="studentScanClear">Scan another</button></div>`;
    $('studentScanFeedback').textContent = user.role === 'GATE_KEEPER'
      ? `QR recognized. Compare the displayed photo with the ${isTeacherPerson ? 'teacher' : 'learner'} before recording gate attendance.`
      : 'QR scanned successfully. Choose an attendance action.';
    $('studentScanFeedback').className = 'scanner-feedback is-success';
    $('studentScanNoticeTitle').textContent = isTeacherPerson ? 'Teacher identity found' : 'Learner identity found';
    $('studentScanNoticeName').textContent = fullName;
    $('studentScanNoticeMeta').textContent = meta;
    const noticeCopy = document.querySelector('.student-scan-notice-copy');
    if (noticeCopy) noticeCopy.textContent = `Compare the displayed registered ${isTeacherPerson ? 'teacher' : 'learner'} photo before recording gate attendance.`;
    const noticePhoto = $('studentScanNoticePhoto');
    if (noticePhoto) {
      noticePhoto.src = photo || '';
      noticePhoto.hidden = !photo;
      noticePhoto.classList.remove('photo-flash');
      if (photo) { void noticePhoto.offsetWidth; noticePhoto.classList.add('photo-flash'); }
    }
    $('studentScanNotice').hidden = false;
    showToast(user.role === 'GATE_KEEPER' ? `Verify photo: ${fullName}` : `QR scanned: ${fullName}`);
    $('studentTimeIn').addEventListener('click', () => isTeacherPerson ? recordTeacherGatePunch('TIME_IN') : recordStudentPunch('TIME_IN'));
    $('studentTimeOut').addEventListener('click', () => isTeacherPerson ? recordTeacherGatePunch('TIME_OUT') : recordStudentPunch('TIME_OUT'));
    $('studentPhotoVerified')?.addEventListener('change', event => {
      const verified = Boolean(event.target.checked);
      $('studentTimeIn').disabled = !verified;
      $('studentTimeOut').disabled = !verified;
    });
    $('studentScanClear').addEventListener('click', () => {
      scannedStudent = null; scannedTeacher = null;
      $('studentScanNotice').hidden = true; $('studentScanResult').hidden = true;
      $('studentScanFeedback').className = 'scanner-feedback'; $('studentScanFeedback').textContent = 'Ready for the next QR code.';
    });
    if (isTeacherPerson) scannedTeacher = person;
  }

  async function recordTeacherGatePunch(eventType) {
    if (!scannedTeacher) return;
    if (!$('studentPhotoVerified')?.checked) {
      showToast('Confirm that the registered photo matches the teacher before recording attendance.', true);
      return;
    }
    try {
      const result = await api('/api/gate/teacher-events', {
        method: 'POST',
        body: JSON.stringify({ teacherUserId: scannedTeacher.userId, eventType, occurredAt: new Date().toISOString(), schoolDate: schoolDateManila(), photoVerified: true })
      });
      const savedName = scannedTeacher.fullName;
      const label = eventType === 'TIME_IN' ? 'time-in' : 'time-out';
      $('studentScanFeedback').textContent = `${savedName}: teacher ${label} recorded successfully.`;
      $('studentScanFeedback').className = 'scanner-feedback is-success';
      showToast(`TEACHER ATTENDANCE SAVED — ${savedName} ${label}.`);
      scannedTeacher = null;
      $('studentScanNotice').hidden = true;
      $('studentScanResult').hidden = true;
    } catch (error) {
      showToast(error.message, true);
      $('studentScanFeedback').textContent = error.message;
      $('studentScanFeedback').className = 'scanner-feedback is-error';
    }
  }

  function schoolDateManila(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }

  async function recordStudentPunch(eventType) {
    if (!scannedStudent) return;
    if (user.role === 'GATE_KEEPER' && !$('studentPhotoVerified')?.checked) {
      showToast('Confirm that the registered photo matches the learner before recording attendance.', true);
      return;
    }
    if (!['TEACHER', 'GATE_KEEPER'].includes(user.role)) {
      showToast('Only a Gate Keeper or a designated teacher may record attendance from this scanner.', true);
      return;
    }
    const scope = user.role === 'TEACHER' ? activeScanScope : 'SCHOOL';
    const periodId = scope === 'CLASS' ? activeScanPeriodId : null;
    if (scope === 'CLASS' && !periodId) {
      showToast('Select the assigned class or subject before scanning.', true);
      $('studentScanSetupModal').hidden = false;
      return;
    }
    const event = { eventId: crypto.randomUUID(), studentId: scannedStudent.studentId, eventType, occurredAt: new Date().toISOString(), schoolDate: schoolDateManila(), attendanceScope: scope, periodId, deviceId: `PORTAL-${user.userId || user.username || 'USER'}`, metadata: { source: 'management-portal-student-scanner', ...(user.role === 'GATE_KEEPER' ? { photoVerified: true } : {}) } };
    try {
      const result = await api('/api/sync/events', { method: 'POST', body: JSON.stringify({ events: [event] }) });
      const status = result.results?.[0]?.status;
      if (status !== 'ACCEPTED' && status !== 'ALREADY_SYNCED') throw new Error(result.results?.[0]?.reason || `Attendance was not accepted (${status || 'unknown'}).`);
      const savedName = scannedStudent.fullName;
      const savedMessage = `${savedName}: ${eventType.replace('_', ' ')} recorded${result.results[0].late ? ' (LATE)' : ''}.`;
      $('studentScanFeedback').textContent = savedMessage;
      $('studentScanFeedback').className = 'scanner-feedback is-success';
      showToast(`ATTENDANCE SAVED — ${savedMessage}`);
      scannedStudent = null; scannedTeacher = null;
      $('studentScanNotice').hidden = true;
      $('studentScanResult').hidden = true;
    } catch (error) { showToast(error.message, true); $('studentScanFeedback').textContent = error.message; }
  }

  function renderPeriods() {
    const canBulkAssign = user.role === 'SCHOOL_ADMIN' || user.role === 'DEPARTMENT_HEAD';
    const isTeacher = user.role === 'TEACHER';
    const isSchoolManager = user.role === 'SCHOOL_ADMIN' || user.role === 'DEPARTMENT_HEAD';
    if ($('periodBulkToolbar')) $('periodBulkToolbar').hidden = !canBulkAssign;
    if ($('periodSelectHeader')) $('periodSelectHeader').hidden = !canBulkAssign;

    const eligibleTeachers = teachers.filter(t => t.active && (t.teacherDesignations || []).includes('SUBJECT_TEACHER') &&
      (user.role !== 'DEPARTMENT_HEAD' || String(t.departmentId) === String(user.departmentId)));
    const teacherOptions = '<option value="">Choose Subject Teacher</option>' +
      eligibleTeachers.map(t => '<option value="' + esc(t.userId) + '">' + esc(t.displayName) + '</option>').join('');
    if ($('bulkScheduleTeacher')) $('bulkScheduleTeacher').innerHTML = teacherOptions;
    if ($('periodTeacher')) {
      const previousTeacher = $('periodTeacher').value;
      $('periodTeacher').innerHTML = teacherOptions;
      if (eligibleTeachers.some(t => String(t.userId) === String(previousTeacher))) $('periodTeacher').value = previousTeacher;
    }
    if ($('periodTeacherGroup')) $('periodTeacherGroup').hidden = isTeacher;
    if ($('periodTeacherSelfGroup')) $('periodTeacherSelfGroup').hidden = !isTeacher;
    if ($('periodTeacherSelfName')) $('periodTeacherSelfName').textContent =
      user.displayName || user.username || 'Signed-in teacher';
    if ($('periodTeacherHint')) $('periodTeacherHint').textContent =
      'Department and available subjects are determined automatically from the teacher profile.';
    if ($('addScheduleSubject')) $('addScheduleSubject').hidden = !isSchoolManager;

    $('scheduleRows').innerHTML = periods.length ? periods.map(period => {
      const canSelectPeriod = (user.role === 'SCHOOL_ADMIN' || String(period.departmentId) === String(user.departmentId)) && !period.assignedTeacherName;
      const selection = canBulkAssign
        ? '<td>' + (canSelectPeriod
          ? '<input type="checkbox" data-select-period="' + esc(period.periodId) + '" ' +
            (selectedPeriodIds.has(String(period.periodId)) ? 'checked' : '') + ' aria-label="Select ' + esc(period.periodName) + '">'
          : '—') + '</td>'
        : '';
      return `<tr>
        ${selection}<td><strong>${esc(period.periodName)}</strong></td>
        <td>${esc(period.subjectName || '—')}</td>
        <td>${esc(period.departmentName || 'Unassigned')}</td>
        <td>${esc(period.gradeLevel)}</td>
        <td>${esc(period.section || 'All sections')}</td>
        <td>${esc(period.classroom || '—')}</td>
        <td>${esc(period.startTime)}–${esc(period.endTime)}</td>
        <td>${esc(period.assignedTeacherName || 'Unassigned')}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="' + (canBulkAssign ? 9 : 8) + '" class="empty-cell">No class schedules are available yet.</td></tr>';

    document.querySelectorAll('[data-select-period]').forEach(box => box.addEventListener('change', () => {
      if (box.checked) selectedPeriodIds.add(String(box.dataset.selectPeriod)); else selectedPeriodIds.delete(String(box.dataset.selectPeriod));
      updatePeriodBatchUi();
    }));
    $('scheduleScopeText').textContent = isTeacher
      ? (teacherHas('CLASS_ADVISER') && !teacherHas('SUBJECT_TEACHER')
        ? 'View every subject schedule assigned to your advisory section, including the assigned teacher, department, room, and class time.'
        : teacherHas('CLASS_ADVISER')
          ? 'View your assigned subject periods and every subject schedule assigned to your advisory section.'
          : 'View your assigned subject schedules and create a schedule for your own teacher account.')
      : user.role === 'DEPARTMENT_HEAD'
        ? 'View schedules across the school. Create schedules and assign teachers only within your department.'
        : 'Create schedules by choosing a Subject Teacher. Department and subject options follow that teacher’s department.';

    const teacherCreatingOwn = isTeacher && teacherHas('SUBJECT_TEACHER') && Boolean(user.departmentId) && user.departmentCode !== 'UNASSIGNED';
    const departmentHeadCanCreate = user.role === 'DEPARTMENT_HEAD' && Boolean(user.departmentId) && user.departmentCode !== 'UNASSIGNED';
    $('showScheduleForm').hidden = !(user.role === 'SCHOOL_ADMIN' || teacherCreatingOwn || departmentHeadCanCreate);
    if (user.role === 'DEPARTMENT_HEAD' && !departmentHeadCanCreate) {
      $('scheduleScopeText').textContent = 'Your account is awaiting department assignment. You can monitor schedules until the School Administrator assigns your department.';
    }
    $('showScheduleForm').textContent = teacherCreatingOwn ? '＋ Add my schedule' : '＋ Create class schedule';
    if (isTeacher && teacherHas('SUBJECT_TEACHER') && !teacherCreatingOwn) {
      $('scheduleScopeText').textContent = 'Your account is awaiting department assignment. Ask the School Administrator to assign your department before creating schedules.';
    }
  }

let teacherActionMenuListenersInstalled = false;

  function closeTeacherActionMenus() {
    document.querySelectorAll('details.teacher-action-menu[open]').forEach(menu => {
      menu.open = false;
    });
  }

  function ensureTeacherActionMenuStyles() {
    if (!document.getElementById('teacherActionMenuStyles')) {
      const style = document.createElement('style');
      style.id = 'teacherActionMenuStyles';
      style.textContent = `
        details.teacher-action-menu { display:inline-block; position:relative; }
        details.teacher-action-menu > summary { list-style:none; cursor:pointer; user-select:none; }
        details.teacher-action-menu > summary::-webkit-details-marker { display:none; }
        details.teacher-action-menu > summary::marker { content:""; }
        .teacher-actions-trigger { display:inline-flex; align-items:center; justify-content:center; gap:10px; min-width:116px; }
        .teacher-actions-trigger .teacher-actions-chevron { font-size:12px; opacity:.72; transition:transform .15s ease; }
        details.teacher-action-menu[open] .teacher-actions-chevron { transform:rotate(180deg); }
        .teacher-action-menu-panel { position:fixed; z-index:12000; min-width:218px; max-width:calc(100vw - 24px); max-height:70vh; overflow-y:auto; padding:6px; background:#fff; border:1px solid #dce5ed; border-radius:10px; box-shadow:0 12px 32px rgba(24,39,56,.18); }
        .teacher-action-menu-panel[hidden] { display:none !important; }
        .teacher-action-menu-label { padding:7px 10px 5px; color:#8593a3; font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; }
        .teacher-action-item { display:block; width:100%; padding:10px 11px; border:0; border-radius:7px; background:transparent; color:#344b60; text-align:left; font:inherit; font-size:14px; line-height:1.35; cursor:pointer; }
        .teacher-action-item:hover { background:#f1f6fa; }
        .teacher-action-item:focus-visible, .teacher-actions-trigger:focus-visible { outline:2px solid #0ea5e9; outline-offset:2px; }
        .teacher-action-item.danger { color:#b4233c; }
        .teacher-action-item.danger:hover { background:#fff1f2; }
        .teacher-action-item:disabled { opacity:.48; cursor:not-allowed; background:transparent; }
        .teacher-action-menu-divider { height:1px; margin:5px 3px; background:#edf1f5; }
        .account-status { display:inline-flex; align-items:center; padding:5px 9px; border-radius:999px; font-size:12px; line-height:1.2; font-weight:750; white-space:nowrap; }
        .account-status.active { background:#e7f7ef; color:#147a50; }
        .account-status.on-leave { background:#fff4dc; color:#9a6500; }
        .account-status.inactive { background:#eef1f4; color:#596775; }
        .assignment-chip { display:flex; flex-direction:column; gap:5px; min-width:0; max-width:100%; padding:8px 10px; margin:3px 0; border:1px solid #e5edf3; border-radius:8px; background:#f8fbfd; white-space:normal; }
        .assignment-chip-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; }
        .assignment-chip-heading strong { min-width:0; }
        .assignment-kind { display:inline-flex; align-items:center; width:max-content; padding:3px 7px; border-radius:999px; font-size:10px; font-weight:800; letter-spacing:.035em; white-space:nowrap; }
        .assignment-kind.permanent { background:#e8f2ff; color:#245c9b; }
        .assignment-kind.temporary { background:#f1eaff; color:#7042a4; }
        .substitute-assignment { border-color:#e6d9fb; background:#fbf8ff; }
        .permanent-assignment small, .substitute-assignment small { white-space:normal; overflow-wrap:anywhere; }
        .assignment-manager-list { display:flex; flex-direction:column; gap:9px; margin:10px 0 16px; }
        .assignment-manager-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:11px 12px; border:1px solid #e6edf3; border-radius:9px; background:#fbfdff; }
        .assignment-manager-row strong, .assignment-manager-row small { display:block; }
        .assignment-manager-row strong { color:#344b60; font-size:14px; }
        .assignment-manager-row small { margin-top:4px; color:#8392a1; font-size:12px; }
        .assignment-manager-row .assignment-manager-info { min-width:0; }
        .assignment-manager-empty { padding:13px; border:1px dashed #dbe5ed; border-radius:9px; color:#7f8e9c; font-size:13px; }
        .assignment-manager-help { margin:5px 0 13px; color:#718294; font-size:13px; line-height:1.5; }
        @media (max-width:700px) { .teacher-action-menu-panel { min-width:200px; } .assignment-manager-row { align-items:flex-start; } }
      `;
      document.head.appendChild(style);
    }

    if (!teacherActionMenuListenersInstalled) {
      document.addEventListener('click', event => {
        if (!event.target.closest('.teacher-action-menu')) closeTeacherActionMenus();
      });
      window.addEventListener('resize', closeTeacherActionMenus);
      window.addEventListener('scroll', closeTeacherActionMenus, true);
      teacherActionMenuListenersInstalled = true;
    }
  }

  function positionTeacherActionMenu(details) {
    const trigger = details.querySelector('summary');
    const panel = details.querySelector('.teacher-action-menu-panel');
    if (!trigger || !panel || !details.open) return;
    panel.hidden = false;
    panel.style.left = '12px';
    panel.style.top = '12px';
    requestAnimationFrame(() => {
      if (!details.open) return;
      const rect = trigger.getBoundingClientRect();
      const menuRect = panel.getBoundingClientRect();
      const left = Math.max(12, Math.min(rect.right - menuRect.width, window.innerWidth - menuRect.width - 12));
      let top = rect.bottom + 6;
      if (top + menuRect.height > window.innerHeight - 12) top = Math.max(12, rect.top - menuRect.height - 6);
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    });
  }

  async function uploadTeacherPhoto(userId, file) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Choose a JPG, PNG, or WebP photo up to 5 MB.');
    const response = await fetch(`/api/teachers/${encodeURIComponent(userId)}/photo`, {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': file.type }, body: file, cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Teacher photo upload failed.');
  }

  async function printTeacherGateQr(userId) {
    const data = await api(`/api/teachers/${encodeURIComponent(userId)}/qr`);
    const teacher = data.teacher;
    const printWindow = window.open('', '_blank');
    if (!printWindow) throw new Error('Allow pop-ups for this site to print the teacher QR badge.');
    const photoWarning = teacher.hasTeacherPhoto ? '' : '<p class="warning">No registered teacher photo yet. Upload the photo before using this QR at the gate.</p>';
    printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Teacher Gate QR</title><style>body{font-family:Arial,sans-serif;margin:18mm;color:#24343a}.badge{width:90mm;margin:auto;border:1px solid #d5e0df;border-radius:16px;padding:18px;text-align:center}.qr{width:58mm;height:58mm;object-fit:contain}.name{font-size:20px;font-weight:700;margin:12px}.meta{color:#64777a}.warning{color:#a45623;background:#fff5e9;padding:10px;border-radius:8px}@media print{body{margin:0}}</style></head><body><article class="badge"><h2>TEACHER GATE ID</h2><div class="name">${esc(teacher.displayName)}</div><div class="meta">${esc(teacher.username)}</div><img class="qr" src="${data.qrCode}" alt="Teacher gate QR"><div class="meta">Present this QR to the Gate Keeper for photo verification.</div>${photoWarning}</article><script>window.onload=()=>setTimeout(()=>window.print(),400)<\\/script></body></html>`);
    printWindow.document.close();
  }

  function renderTeachers() {
    ensureTeacherActionMenuStyles();
    const rows = teachers.length ? teachers.map(teacher => {
      const assigned = Array.isArray(teacher.assignedPeriods) ? teacher.assignedPeriods : [];
      const rawStatus = teacher.teacherStatus ?? teacher.teacher_status ?? '';
      const normalizedStatus = String(rawStatus).trim().toUpperCase();
      const leaveType = teacher.leaveType ?? teacher.leave_type ?? null;
      const expectedReturnDate = teacher.expectedReturnDate ?? teacher.expected_return_date ?? null;
      const onLeave = normalizedStatus === 'ON_LEAVE' ||
        (!teacher.active && Boolean(leaveType) && Boolean(expectedReturnDate));
      const active = !onLeave && normalizedStatus === 'ACTIVE' && Boolean(teacher.active);
      const statusLabel = onLeave ? 'On Leave' : (active ? 'Active' : 'Inactive');
      const statusClass = onLeave ? 'on-leave' : (active ? 'active' : 'inactive');
      const leaveDetails = onLeave
        ? `<small class="table-subtext" style="display:block;margin-top:4px">${esc(formatLeaveType(leaveType))} · Return: ${esc(formatSchoolDate(expectedReturnDate))}</small>`
        : '';

      const substitutionAssignments = Array.isArray(teacher.substitutionAssignments) ? teacher.substitutionAssignments : [];
      const classScopeMap = new Map();
      const addClassScope = (gradeLevel, section) => {
        const grade = String(gradeLevel ?? '').trim();
        const sectionName = String(section ?? '').trim() || 'All sections';
        if (!grade && sectionName === 'All sections') return;
        const key = `${grade.toLocaleLowerCase()}|${sectionName.toLocaleLowerCase()}`;
        if (!classScopeMap.has(key)) classScopeMap.set(key, { gradeLevel: grade || 'Not specified', section: sectionName });
      };
      (teacher.adviserSections || []).forEach(item => addClassScope(item.gradeLevel, item.section));
      assigned.forEach(item => addClassScope(item.gradeLevel, item.section));
      substitutionAssignments.forEach(item => addClassScope(item.gradeLevel, item.section));
      const classScopes = [...classScopeMap.values()].sort((a, b) =>
        a.gradeLevel.localeCompare(b.gradeLevel, undefined, { numeric: true }) || a.section.localeCompare(b.section)
      );
      const gradeLevelsHtml = classScopes.length
        ? `<div class="teacher-scope-list">${classScopes.map(item => `<span class="teacher-scope-item">${esc(item.gradeLevel)}</span>`).join('')}</div>`
        : '<span class="muted-inline">Not assigned</span>';
      const sectionsHtml = classScopes.length
        ? `<div class="teacher-scope-list">${classScopes.map(item => `<span class="teacher-scope-item">${esc(item.section)}</span>`).join('')}</div>`
        : '<span class="muted-inline">Not assigned</span>';

      // Keep the monitoring table compact. Detailed periods remain available in
      // the assignment manager and Class Schedules view, rather than stretching
      // each teacher row vertically with a stack of schedule cards.
      const permanentAssignmentCount = assigned.length;
      const temporaryCoverageCount = substitutionAssignments.length;
      const assignmentsHtml = permanentAssignmentCount || temporaryCoverageCount
        ? `<div class="teacher-assignment-summary" title="${permanentAssignmentCount} permanent schedules; ${temporaryCoverageCount} temporary coverage records">
             <span class="teacher-assignment-count">${permanentAssignmentCount} permanent ${permanentAssignmentCount === 1 ? 'schedule' : 'schedules'}</span>
             ${temporaryCoverageCount
               ? `<span class="teacher-assignment-count temporary">${temporaryCoverageCount} temporary ${temporaryCoverageCount === 1 ? 'coverage' : 'coverage records'}</span>`
               : ''}
           </div>`
        : '<span class="muted-inline">No schedules assigned</span>';

      const cancelCoverActions = substitutionAssignments
        .filter(item => item.relationship !== 'SUBSTITUTE')
        .map(item => `<button type="button" class="teacher-action-item danger" data-cancel-substitution="${esc(item.substitutionId)}">End cover · ${esc(item.periodName)}</button>`)
        .join('');

      const isSchoolAdmin = user.role === 'SCHOOL_ADMIN';
      const accountActions = !isSchoolAdmin ? '<span class="muted-inline">View only</span>' : (active
        ? `<div class="teacher-action-menu-label">Account &amp; permissions</div>
           <button type="button" class="teacher-action-item" data-edit-teacher-profile="${esc(teacher.userId)}">Edit account profile</button>
           <button type="button" class="teacher-action-item" data-edit-designations="${esc(teacher.userId)}">Edit teacher permissions</button><button type="button" class="teacher-action-item" data-teacher-qr="${esc(teacher.userId)}">Print gate QR badge</button>
           <label class="teacher-action-item teacher-photo-upload-menu">${teacher.hasTeacherPhoto ? 'Replace teacher photo' : 'Upload teacher photo'}<input type="file" accept="image/jpeg,image/png,image/webp" data-teacher-photo="${esc(teacher.userId)}" hidden></label>
           <div class="teacher-action-menu-divider"></div>
           <div class="teacher-action-menu-label">Account</div>
           <button type="button" class="teacher-action-item" data-place-leave="${esc(teacher.userId)}">Set on leave</button>
           <button type="button" class="teacher-action-item danger" data-deactivate-teacher="${esc(teacher.userId)}">Deactivate account</button>`
        : onLeave
          ? `<div class="teacher-action-menu-label">Leave management</div>
             <button type="button" class="teacher-action-item" data-assign-substitute="${esc(teacher.userId)}" ${assigned.length ? '' : 'disabled'}>Assign temporary substitute</button>
             <button type="button" class="teacher-action-item" data-return-teacher="${esc(teacher.userId)}">Mark returned</button>`
          : `<div class="teacher-action-menu-label">Account</div>
             <button type="button" class="teacher-action-item" data-return-teacher="${esc(teacher.userId)}">Reactivate account</button>`);

      const designationLabels = (teacher.teacherDesignations || []).map(value => value === 'CLASS_ADVISER' ? 'Class Adviser' : 'Subject Teacher').join(' + ') || 'No designation';
      const canManageDepartment = user.role === 'DEPARTMENT_HEAD' && String(teacher.departmentId) === String(user.departmentId);
      const canAssignSubstitute = canManageDepartment && onLeave && assigned.length > 0;
      const departmentHeadCoverageActions = [
        ...(canManageDepartment && active ? [`<button type="button" class="teacher-action-item" data-manage-permanent="${esc(teacher.userId)}">Manage department assignments</button>`] : []),
        ...(canAssignSubstitute ? [`<button type="button" class="teacher-action-item" data-assign-substitute="${esc(teacher.userId)}">Assign temporary substitute</button>`] : []),
        ...(canManageDepartment && cancelCoverActions ? [cancelCoverActions] : [])
      ].join('');
      const actionMenu = isSchoolAdmin ? `<details class="teacher-action-menu">
        <summary class="outline-button compact-button teacher-actions-trigger" aria-label="Actions for ${esc(teacher.displayName)}">Actions <span class="teacher-actions-chevron" aria-hidden="true">▾</span></summary>
        <div class="teacher-action-menu-panel" hidden>${accountActions}${cancelCoverActions ? '<div class="teacher-action-menu-divider"></div><div class="teacher-action-menu-label">Temporary coverage</div>' + cancelCoverActions : ''}</div>
      </details>` : (user.role === 'DEPARTMENT_HEAD' && departmentHeadCoverageActions
        ? `<div class="teacher-coverage-actions">${departmentHeadCoverageActions}</div>`
        : '<span class="muted-inline">Read only</span>');

      const departmentCell = user.role === 'SCHOOL_ADMIN'
        ? `<select class="teacher-department-select" data-change-teacher-department="${esc(teacher.userId)}" aria-label="Department for ${esc(teacher.displayName)}">
            ${departments.map(item => `<option value="${esc(item.departmentId)}" ${String(item.departmentId) === String(teacher.departmentId) ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}
          </select>`
        : esc(teacher.departmentName || 'Unassigned');
      return `<tr>
        <td data-label="Teacher">${user.role === 'SCHOOL_ADMIN' ? '<input type="checkbox" data-select-staff="' + esc(teacher.userId) + '" ' + (selectedStaffIds.has(String(teacher.userId)) ? 'checked' : '') + ' aria-label="Select ' + esc(teacher.displayName) + '">' : ''} <strong>${esc(teacher.displayName)}</strong><small class="table-subtext">${esc(teacher.username)}</small><small class="table-subtext">${esc(designationLabels)}</small></td>
        <td data-label="Department">${departmentCell}</td>
        <td data-label="Status"><span class="account-status ${statusClass}">${statusLabel}</span>${leaveDetails}</td>
        <td data-label="Grade level">${gradeLevelsHtml}</td>
        <td data-label="Section">${sectionsHtml}</td>
        <td data-label="Assigned schedules">${assignmentsHtml}</td>
        <td data-label="Account action"><div class="action-row">${actionMenu}</div></td>
      </tr>`;
    }).join('') : '<tr><td colspan="7" class="empty-cell">No teacher accounts have been created for this school yet.</td></tr>';

    $('teacherRows').innerHTML = rows;
    $('teacherRows').querySelectorAll('[data-select-staff]').forEach(box => box.addEventListener('change', () => {
      if (box.checked) selectedStaffIds.add(String(box.dataset.selectStaff)); else selectedStaffIds.delete(String(box.dataset.selectStaff));
      updateStaffBulkUi();
    }));
    $('teacherRows').querySelectorAll('input[data-teacher-photo]').forEach(input => input.addEventListener('change', async () => {
      const file = input.files?.[0]; if (!file) return;
      input.disabled = true;
      try { await uploadTeacherPhoto(input.dataset.teacherPhoto, file); await loadSchoolData(); showToast('Teacher photo uploaded. Teacher gate QR can now be used for identity verification.'); }
      catch (error) { showToast(error.message, true); input.disabled = false; }
    }));
    $('teacherRows').querySelectorAll('details.teacher-action-menu').forEach(details => {
      details.addEventListener('toggle', () => {
        const panel = details.querySelector('.teacher-action-menu-panel');
        if (panel) panel.hidden = !details.open;
        if (details.open) {
          closeTeacherActionMenusExcept(details);
          positionTeacherActionMenu(details);
        }
      });
    });
  }

  function closeTeacherActionMenusExcept(exception) {
    document.querySelectorAll('details.teacher-action-menu[open]').forEach(menu => {
      if (menu !== exception) menu.open = false;
    });
  }

  function openPermanentAssignmentDialog(teacher, triggerButton) {
    document.getElementById('teacherAssignmentsDialog')?.remove();
    const assigned = Array.isArray(teacher.assignedPeriods) ? teacher.assignedPeriods : [];
    const assignedIds = new Set(assigned.map(item => String(item.periodId)));
    const assignedByOthers = new Set();
    teachers.forEach(other => {
      if (String(other.userId) === String(teacher.userId)) return;
      (Array.isArray(other.assignedPeriods) ? other.assignedPeriods : [])
        .forEach(item => assignedByOthers.add(String(item.periodId)));
    });
    const hasActiveCover = new Set((teacher.substitutionAssignments || [])
      .filter(item => item.relationship !== 'SUBSTITUTE')
      .map(item => String(item.periodId)));
    const timeConflicts = periods.filter(period => assigned.some(existing =>
      String(existing.periodId) !== String(period.periodId) &&
      String(existing.startTime || '') < String(period.endTime || '') &&
      String(period.startTime || '') < String(existing.endTime || '')
    )).map(item => String(item.periodId));
    const available = periods.filter(period =>
      String(period.departmentId) === String(teacher.departmentId) &&
      !assignedIds.has(String(period.periodId)) &&
      !assignedByOthers.has(String(period.periodId)) &&
      !timeConflicts.includes(String(period.periodId))
    );

    const listHtml = assigned.length ? assigned.map(period => {
      const covered = hasActiveCover.has(String(period.periodId));
      return `<div class="assignment-manager-row">
        <div class="assignment-manager-info">
          <strong>${esc(period.periodName)} <span class="assignment-kind permanent">PERMANENT</span></strong>
          <small>${esc(period.subjectName || 'No subject')} · ${esc(period.gradeLevel)} · ${esc(period.section || 'All sections')} · ${esc(period.startTime || '')}–${esc(period.endTime || '')}</small>
          ${covered ? '<small>Temporary cover is active. End the cover before removing this permanent assignment.</small>' : ''}
        </div>
        <button type="button" class="outline-button compact-button" data-remove-permanent="${esc(period.periodId)}" ${covered ? 'disabled title="End temporary cover first"' : ''}>Remove</button>
      </div>`;
    }).join('') : '<div class="assignment-manager-empty">No permanent class schedules assigned to this teacher.</div>';

    const overlay = document.createElement('div');
    overlay.id = 'teacherAssignmentsDialog';
    overlay.className = 'leave-dialog-backdrop';
    overlay.innerHTML = `
      <section class="leave-dialog" role="dialog" aria-modal="true" aria-labelledby="permanentAssignmentTitle">
        <div class="leave-dialog-header">
          <div><h3 id="permanentAssignmentTitle">Manage permanent assignments</h3><p>${esc(teacher.displayName)}</p></div>
          <button type="button" class="leave-dialog-close" data-assignment-close aria-label="Close">×</button>
        </div>
        <div class="leave-dialog-body">
          <div class="assignment-manager-list">${listHtml}</div>
          <div class="field-group">
            <label for="permanentPeriodInput">Add a permanent class schedule</label>
            <select id="permanentPeriodInput" ${available.length ? '' : 'disabled'}>
              <option value="">${available.length ? 'Select an unassigned class schedule…' : 'No unassigned schedules available'}</option>
              ${available.map(period => `<option value="${esc(period.periodId)}">${esc(period.periodName)} · ${esc(period.gradeLevel)} ${esc(period.section || '')} · ${esc(period.startTime)}–${esc(period.endTime)}</option>`).join('')}
            </select>
          </div>
          <p class="assignment-manager-help">Permanent assignments are ongoing. They are different from temporary substitute coverage, which is assigned only from a teacher's On Leave row.</p>
          <p class="leave-dialog-feedback" id="permanentAssignmentFeedback" role="alert"></p>
        </div>
        <div class="leave-dialog-actions">
          <button type="button" class="outline-button" data-assignment-close>Close</button>
          <button type="button" class="primary-button" id="addPermanentAssignmentButton" ${available.length ? '' : 'disabled'}>Assign permanently</button>
        </div>
      </section>`;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelectorAll('[data-assignment-close]').forEach(button => button.addEventListener('click', close));
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    const feedback = overlay.querySelector('#permanentAssignmentFeedback');
    const addButton = overlay.querySelector('#addPermanentAssignmentButton');
    const periodSelect = overlay.querySelector('#permanentPeriodInput');

    addButton.addEventListener('click', async () => {
      const periodId = periodSelect.value;
      if (!periodId) {
        feedback.textContent = 'Select an unassigned class schedule first.';
        return;
      }
      addButton.disabled = true;
      feedback.textContent = 'Saving permanent assignment…';
      try {
        await api(`/api/periods/${encodeURIComponent(periodId)}/assignments`, {
          method: 'POST', body: JSON.stringify({ teacherUserId: teacher.userId })
        });
        await loadSchoolData();
        const refreshedTeacher = teachers.find(item => String(item.userId) === String(teacher.userId));
        close();
        if (refreshedTeacher) openPermanentAssignmentDialog(refreshedTeacher, triggerButton);
        showToast('Permanent class assignment added.');
      } catch (error) {
        feedback.textContent = error.message;
        addButton.disabled = false;
      }
    });

    overlay.querySelectorAll('[data-remove-permanent]').forEach(button => {
      button.addEventListener('click', async () => {
        const periodId = button.dataset.removePermanent;
        const period = assigned.find(item => String(item.periodId) === String(periodId));
        if (hasActiveCover.has(String(periodId))) {
          feedback.textContent = 'End temporary cover before removing this permanent assignment.';
          return;
        }
        if (!await AppDialog.confirm(`Remove the permanent assignment for ${period?.periodName || 'this schedule'} from ${teacher.displayName}? This does not delete attendance history.`, { title: 'Remove permanent assignment', confirmText: 'Remove assignment', variant: 'danger' })) return;
        button.disabled = true;
        feedback.textContent = 'Removing permanent assignment…';
        try {
          await api(`/api/periods/${encodeURIComponent(periodId)}/assignments/${encodeURIComponent(teacher.userId)}`, { method: 'DELETE' });
          await loadSchoolData();
          const refreshedTeacher = teachers.find(item => String(item.userId) === String(teacher.userId));
          close();
          if (refreshedTeacher) openPermanentAssignmentDialog(refreshedTeacher, triggerButton);
          showToast('Permanent assignment removed. Attendance history was preserved.');
        } catch (error) {
          feedback.textContent = error.message;
          button.disabled = false;
        }
      });
    });
    periodSelect.focus();
  }

  function openTeacherLeaveDialog(teacherId, teacherName, triggerButton) {
    document.getElementById('teacherLeaveDialog')?.remove();

    const today = new Date();
    const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const overlay = document.createElement('div');
    overlay.id = 'teacherLeaveDialog';
    overlay.className = 'leave-dialog-backdrop';
    overlay.innerHTML = `
      <section class="leave-dialog" role="dialog" aria-modal="true" aria-labelledby="leaveDialogTitle">
        <div class="leave-dialog-header">
          <div><h3 id="leaveDialogTitle">Place teacher on leave</h3><p>${esc(teacherName)}</p></div>
          <button type="button" class="leave-dialog-close" data-leave-cancel aria-label="Close">×</button>
        </div>
        <form id="teacherLeaveForm">
          <div class="leave-dialog-body">
            <div class="field-group">
              <label for="leaveTypeInput">Leave type</label>
              <select id="leaveTypeInput" required>
                <option value="MATERNITY">Maternity</option>
                <option value="SICK">Sick</option>
                <option value="VACATION">Vacation</option>
                <option value="PERSONAL">Personal</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div class="leave-date-grid">
              <div class="field-group">
                <label for="leaveStartInput">Leave start date</label>
                <input id="leaveStartInput" type="date" value="${localToday}" required>
              </div>
              <div class="field-group">
                <label for="leaveReturnInput">Expected return date</label>
                <input id="leaveReturnInput" type="date" min="${localToday}" required>
              </div>
            </div>
            <label class="leave-auto-option" for="leaveAutoReactivate">
              <input id="leaveAutoReactivate" type="checkbox" checked>
              <span><strong>Automatically reactivate on expected return date</strong><small>Leave unchecked if an administrator will manually mark the teacher as returned.</small></span>
            </label>
            <p class="leave-dialog-feedback" id="leaveDialogFeedback" role="alert"></p>
          </div>
          <div class="leave-dialog-actions">
            <button type="button" class="outline-button" data-leave-cancel>Cancel</button>
            <button type="submit" class="primary-button" id="saveTeacherLeaveButton">Confirm leave</button>
          </div>
        </form>
      </section>`;
    document.body.appendChild(overlay);

    const form = overlay.querySelector('#teacherLeaveForm');
    const startInput = overlay.querySelector('#leaveStartInput');
    const returnInput = overlay.querySelector('#leaveReturnInput');
    const feedback = overlay.querySelector('#leaveDialogFeedback');
    const saveButton = overlay.querySelector('#saveTeacherLeaveButton');

    const close = () => overlay.remove();
    overlay.querySelectorAll('[data-leave-cancel]').forEach(button => button.addEventListener('click', close));
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    startInput.addEventListener('change', () => { returnInput.min = startInput.value || localToday; });

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const leaveType = overlay.querySelector('#leaveTypeInput').value;
      const startDate = startInput.value;
      const expectedReturnDate = returnInput.value;
      const autoReactivate = overlay.querySelector('#leaveAutoReactivate').checked;

      if (!startDate || !expectedReturnDate) {
        feedback.textContent = 'Please select both leave dates.';
        return;
      }
      if (expectedReturnDate < startDate) {
        feedback.textContent = 'Expected return date cannot be earlier than the leave start date.';
        return;
      }

      saveButton.disabled = true;
      feedback.textContent = 'Saving leave details…';
      triggerButton.disabled = true;
      try {
        await api(`/api/teachers/${encodeURIComponent(teacherId)}/leave`, {
          method: 'POST',
          body: JSON.stringify({ leaveType, startDate, expectedReturnDate, autoReactivate })
        });
        close();
        await loadSchoolData();
        showToast('Teacher placed on leave. Existing class assignments were preserved.');
      } catch (error) {
        feedback.textContent = error.message;
        saveButton.disabled = false;
        triggerButton.disabled = false;
      }
    });

    overlay.querySelector('#leaveTypeInput').focus();
  }

  function openSubstituteDialog(originalTeacher, triggerButton) {
    document.getElementById('teacherSubstituteDialog')?.remove();
    const today = new Date();
    const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const assigned = Array.isArray(originalTeacher.assignedPeriods) ? originalTeacher.assignedPeriods : [];
    const eligible = teachers.filter(item => item.active && item.teacherStatus === 'ACTIVE' && String(item.userId) !== String(originalTeacher.userId));
    const startDefault = String(originalTeacher.leaveStartDate || localToday).slice(0, 10);
    const expectedReturn = String(originalTeacher.expectedReturnDate || startDefault).slice(0, 10);
    // When auto-reactivation is enabled, the teacher returns at the start of the expected return date.
    // Therefore substitute coverage ends the previous day.
    const endDefault = originalTeacher.leaveAutoReactivate
      ? previousSchoolDate(expectedReturn)
      : expectedReturn;
    const overlay = document.createElement('div');
    overlay.id = 'teacherSubstituteDialog';
    overlay.className = 'leave-dialog-backdrop';
    overlay.innerHTML = `
      <section class="leave-dialog" role="dialog" aria-modal="true" aria-labelledby="substituteDialogTitle">
        <div class="leave-dialog-header">
          <div><h3 id="substituteDialogTitle">Assign temporary substitute</h3><p>${esc(originalTeacher.displayName)} · ${esc(formatLeaveType(originalTeacher.leaveType))}</p></div>
          <button type="button" class="leave-dialog-close" data-sub-cancel aria-label="Close">×</button>
        </div>
        <form id="teacherSubstituteForm">
          <div class="leave-dialog-body">
            <div class="field-group">
              <label for="substitutePeriodInput">Class schedule</label>
              <select id="substitutePeriodInput" required>
                <option value="">Select the class to cover…</option>
                ${assigned.map(period => `<option value="${esc(period.periodId)}">${esc(period.periodName)} · ${esc(period.gradeLevel)} ${esc(period.section || '')}</option>`).join('')}
              </select>
            </div>
            <div class="field-group">
              <label for="substituteTeacherInput">Substitute teacher</label>
              <select id="substituteTeacherInput" required>
                <option value="">Select a class schedule first…</option>
              </select>
              <small class="table-subtext" id="substituteCandidateHelp">Only active teachers without a permanent time conflict are listed.</small>
            </div>
            <div class="leave-date-grid">
              <div class="field-group"><label for="substituteStartInput">Coverage starts</label><input id="substituteStartInput" type="date" min="${esc(startDefault)}" max="${esc(endDefault)}" value="${esc(startDefault)}" required></div>
              <div class="field-group"><label for="substituteEndInput">Coverage ends</label><input id="substituteEndInput" type="date" min="${esc(startDefault)}" max="${esc(endDefault)}" value="${esc(endDefault)}" required></div>
            </div>
            <p class="form-help">The original teacher keeps the permanent assignment. The substitute gets access only to this class and only during these dates.</p>
            <p class="leave-dialog-feedback" id="substituteDialogFeedback" role="alert"></p>
          </div>
          <div class="leave-dialog-actions">
            <button type="button" class="outline-button" data-sub-cancel>Cancel</button>
            <button type="submit" class="primary-button" id="saveSubstituteButton" disabled>Save substitute</button>
          </div>
        </form>
      </section>`;
    document.body.appendChild(overlay);
    const form = overlay.querySelector('#teacherSubstituteForm');
    const feedback = overlay.querySelector('#substituteDialogFeedback');
    const saveButton = overlay.querySelector('#saveSubstituteButton');
    const startInput = overlay.querySelector('#substituteStartInput');
    const endInput = overlay.querySelector('#substituteEndInput');
    const periodInput = overlay.querySelector('#substitutePeriodInput');
    const teacherInput = overlay.querySelector('#substituteTeacherInput');
    const candidateHelp = overlay.querySelector('#substituteCandidateHelp');
    const refreshSubstituteCandidates = () => {
      const selectedPeriod = assigned.find(item => String(item.periodId) === String(periodInput.value));
      const candidates = selectedPeriod ? eligible.filter(candidate => {
        const permanent = Array.isArray(candidate.assignedPeriods) ? candidate.assignedPeriods : [];
        return !permanent.some(item =>
          String(item.periodId) === String(selectedPeriod.periodId) ||
          (String(item.startTime || '') < String(selectedPeriod.endTime || '') &&
           String(selectedPeriod.startTime || '') < String(item.endTime || ''))
        );
      }) : [];
      teacherInput.innerHTML = `<option value="">${selectedPeriod ? 'Select an available teacher…' : 'Select a class schedule first…'}</option>` +
        candidates.map(item => `<option value="${esc(item.userId)}">${esc(item.displayName)} (${esc(item.username)})</option>`).join('');
      candidateHelp.textContent = selectedPeriod
        ? (candidates.length
          ? 'Only active teachers without a permanent schedule conflict are listed.'
          : 'No active substitute is available for this schedule. Add an active teacher account without an overlapping permanent schedule.')
        : 'Choose a class schedule to see eligible active substitute teachers.';
      saveButton.disabled = !selectedPeriod || !candidates.length;
    };
    periodInput.addEventListener('change', refreshSubstituteCandidates);
    refreshSubstituteCandidates();
    const close = () => overlay.remove();
    overlay.querySelectorAll('[data-sub-cancel]').forEach(button => button.addEventListener('click', close));
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const periodId = overlay.querySelector('#substitutePeriodInput').value;
      const substituteTeacherUserId = overlay.querySelector('#substituteTeacherInput').value;
      const startDate = startInput.value;
      const endDate = endInput.value;
      if (!periodId || !substituteTeacherUserId || !startDate || !endDate || endDate < startDate) {
        feedback.textContent = 'Select a schedule, an active substitute, and a valid date range.';
        return;
      }
      saveButton.disabled = true;
      feedback.textContent = 'Saving temporary coverage…';
      triggerButton.disabled = true;
      try {
        await api(`/api/teachers/${encodeURIComponent(originalTeacher.userId)}/substitutions`, {
          method: 'POST',
          body: JSON.stringify({ periodId, substituteTeacherUserId, startDate, endDate })
        });
        close();
        await loadSchoolData();
        showToast('Temporary substitute assigned. The original teacher’s permanent schedule was preserved.');
      } catch (error) {
        feedback.textContent = error.message;
        saveButton.disabled = false;
        triggerButton.disabled = false;
      }
    });
    overlay.querySelector('#substitutePeriodInput').focus();
  }

  function updateStaffBulkUi() {
    const eligible = [...teachers.filter(t => t.active).map(t => String(t.userId)),
      ...schoolUsers.filter(u => u.role === 'DEPARTMENT_HEAD').map(u => String(u.userId))];
    if ($('selectedStaffCount')) $('selectedStaffCount').textContent = selectedStaffIds.size + ' selected';
    if ($('selectAllStaff')) {
      $('selectAllStaff').checked = eligible.length > 0 && eligible.every(id => selectedStaffIds.has(id));
      $('selectAllStaff').indeterminate = eligible.some(id => selectedStaffIds.has(id)) && !$('selectAllStaff').checked;
    }
    if ($('applyBulkStaffDepartment')) $('applyBulkStaffDepartment').disabled = !selectedStaffIds.size || !$('bulkStaffDepartment').value;
  }
  $('selectAllStaff')?.addEventListener('change', () => {
    const eligible = [...teachers.filter(t => t.active).map(t => String(t.userId)),
      ...schoolUsers.filter(u => u.role === 'DEPARTMENT_HEAD').map(u => String(u.userId))];
    eligible.forEach(id => $('selectAllStaff').checked ? selectedStaffIds.add(id) : selectedStaffIds.delete(id));
    renderTeachers(); renderStaffUsers(); updateStaffBulkUi();
  });
  $('bulkStaffDepartment')?.addEventListener('change', updateStaffBulkUi);
  $('applyBulkStaffDepartment')?.addEventListener('click', async () => {
    const departmentId = $('bulkStaffDepartment').value;
    if (!departmentId || !selectedStaffIds.size) return;
    if (!await AppDialog.confirm('Assign ' + selectedStaffIds.size + ' selected teachers/Department Heads to this department?', { title: 'Assign staff to department', confirmText: 'Assign staff' })) return;
    $('applyBulkStaffDepartment').disabled = true; $('staffBulkDepartmentFeedback').textContent = 'Checking existing schedule assignments…';
    try {
      const result = await api('/api/school-users/bulk-department', { method:'POST', body:JSON.stringify({userIds:[...selectedStaffIds],departmentId}) });
      selectedStaffIds.clear(); $('staffBulkDepartmentFeedback').textContent = result.updated + ' staff accounts assigned.';
      await loadSchoolData(); showToast(result.updated + ' staff accounts assigned.');
    } catch (error) { $('staffBulkDepartmentFeedback').textContent = error.message; showToast(error.message,true); }
    finally { updateStaffBulkUi(); }
  });

  function renderStaffUsers() {
    const host = $('staffUserRows');
    if (!host) return;
    host.innerHTML = schoolUsers.length ? schoolUsers.map(account => {
      const staffSelection = account.role === 'DEPARTMENT_HEAD' && user.role === 'SCHOOL_ADMIN'
        ? '<input type="checkbox" data-select-staff="' + esc(account.userId) + '" ' + (selectedStaffIds.has(String(account.userId)) ? 'checked' : '') + ' aria-label="Select ' + esc(account.displayName || account.username) + '">'
        : '';
      const departmentCell = account.role === 'DEPARTMENT_HEAD'
        ? `<select class="staff-department-select" data-change-staff-department="${esc(account.userId)}" aria-label="Department for ${esc(account.displayName || account.username)}">
            ${departments.map(item => `<option value="${esc(item.departmentId)}" ${String(item.departmentId) === String(account.departmentId) ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}
          </select>`
        : '<span class="muted-inline">—</span>';
      return `<tr>
        <td data-label="Account">${staffSelection} <strong>${esc(account.displayName || account.username)}</strong><small class="table-subtext">${esc(account.username)}</small></td>
        <td data-label="Role">${esc(String(account.role || '').replaceAll('_', ' '))}</td>
        <td data-label="Department">${departmentCell}</td>
        <td data-label="Status"><span class="account-status ${account.active ? 'active' : 'inactive'}">${account.active ? 'Active' : 'Inactive'}</span></td>
        <td data-label="Account action"><button type="button" class="outline-button compact-button" data-edit-staff-profile="${esc(account.userId)}">Edit account</button></td>
      </tr>`;
    }).join('') : '<tr><td colspan="5" class="empty-cell">No additional staff accounts have been created.</td></tr>';
    host.querySelectorAll('[data-select-staff]').forEach(box => box.addEventListener('change', () => {
      if (box.checked) selectedStaffIds.add(String(box.dataset.selectStaff)); else selectedStaffIds.delete(String(box.dataset.selectStaff));
      updateStaffBulkUi();
    }));
  }

  function renderAdviserAssignments() {
    const host = $('adviserAssignmentRows');
    if (!host) return;
    const advisers = teachers.filter(item => Array.isArray(item.teacherDesignations) && item.teacherDesignations.includes('CLASS_ADVISER') && item.active);
    const select = $('adviserTeacherSelect');
    if (select) {
      const previous = select.value;
      select.innerHTML = '<option value="">Select teacher</option>' + advisers.map(item => `<option value="${esc(item.userId)}">${esc(item.displayName)}</option>`).join('');
      if (advisers.some(item => String(item.userId) === previous)) select.value = previous;
    }
    host.innerHTML = adviserAssignments.length ? adviserAssignments.map(item => `
      <tr><td>${esc(item.gradeLevel)}</td><td>${esc(item.section)}</td><td>${esc(item.adviserName || item.adviserUserId)}</td>
      <td>${user.role === 'SCHOOL_ADMIN'
        ? '<div class="action-row"><button type="button" class="outline-button compact-button" data-edit-adviser="' + esc(item.assignmentId) + '">Edit</button><button type="button" class="outline-button compact-button danger-button" data-remove-adviser="' + esc(item.assignmentId) + '">Remove</button></div>'
        : '<span class="muted-inline">Read only</span>'}</td></tr>`).join('')
      : '<tr><td colspan="4" class="empty-cell">No class adviser assignments have been made.</td></tr>';
  }

  async function loadSf2Options() {
    const data = await api('/api/sf2/options');
    sf2Options = data.sections || [];
    const gradeSelect = $('sf2Grade');
    const sectionSelect = $('sf2Section');
    if (!gradeSelect || !sectionSelect) return;
    const oldGrade = gradeSelect.value;
    const grades = [...new Set(sf2Options.map(item => item.gradeLevel))].sort((a,b) => String(a).localeCompare(String(b)));
    gradeSelect.innerHTML = '<option value="">Select grade</option>' + grades.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join('');
    gradeSelect.value = grades.includes(oldGrade) ? oldGrade : (grades.length === 1 ? grades[0] : '');
    updateSf2SectionOptions();
    const modeWrap = $('sf2ModeWrap');
    if (modeWrap) modeWrap.hidden = user.role !== 'TEACHER';
  }

  function updateSf2SectionOptions() {
    const grade = $('sf2Grade')?.value || '';
    const sectionSelect = $('sf2Section');
    if (!sectionSelect) return;
    const matching = sf2Options.filter(item => String(item.gradeLevel) === String(grade));
    const previous = sectionSelect.value;
    sectionSelect.innerHTML = '<option value="">Select section</option>' + matching.map(item => `<option value="${esc(item.section)}">${esc(item.section)}</option>`).join('');
    sectionSelect.disabled = !matching.length;
    sectionSelect.value = matching.some(item => String(item.section) === previous) ? previous : (matching.length === 1 ? matching[0].section : '');
    updateSf2ModeOptions();
  }

  function updateSf2ModeOptions() {
    const grade = $('sf2Grade')?.value || '';
    const section = $('sf2Section')?.value || '';
    const item = sf2Options.find(row => String(row.gradeLevel) === String(grade) && String(row.section) === String(section));
    const modeSelect = $('sf2Mode');
    if (!modeSelect) return;
    const modes = item?.modes || [item?.mode || 'OFFICIAL'];
    const labels = { OFFICIAL: 'Official Class Adviser SF2', PERSONAL: 'Subject Teacher personal copy' };
    const previous = modeSelect.value;
    modeSelect.innerHTML = modes.map(mode => `<option value="${mode}">${labels[mode] || mode}</option>`).join('');
    modeSelect.value = modes.includes(previous) ? previous : (modes[0] || 'OFFICIAL');
  }

  async function loadSf2Submissions() {
    const data = await api('/api/sf2/submissions');
    sf2Submissions = data.submissions || [];
    renderSf2Submissions();
  }

  function renderSf2Submissions() {
    const host = $('sf2SubmissionRows');
    if (!host) return;
    host.innerHTML = sf2Submissions.length ? sf2Submissions.map(item => `
      <tr><td>${esc(String(item.month || '').slice(0,10).slice(0,7))}</td><td>${esc(item.gradeLevel)} · ${esc(item.section)}</td>
      <td>${esc(item.submittedBy || '')}</td><td>${esc(item.revision)}</td><td><span class="status-tag ${item.status === 'COLLECTED' ? '' : 'neutral'}">${esc(item.status)}</span></td>
      <td><div class="action-row"><button type="button" class="outline-button compact-button" data-download-sf2="${esc(item.submissionId)}">Download</button>
      ${item.status === 'SUBMITTED' && user?.role === 'SCHOOL_ADMIN' ? `<button type="button" class="primary-button compact-button" data-collect-sf2="${esc(item.submissionId)}">Mark collected</button>` : ''}</div></td></tr>`).join('')
      : '<tr><td colspan="6" class="empty-cell">No official SF2 submissions have been received yet.</td></tr>';
  }

  function renderGateKeeperMonitoring() {
    const host = $('gateKeeperMonitorRows');
    if (!host) return;
    host.innerHTML = gateKeeperMonitoring.length ? gateKeeperMonitoring.map(item => `
      <tr><td><strong>${esc(item.displayName || item.username)}</strong><small class="table-subtext">${esc(item.username)}</small></td>
      <td><span class="account-status ${item.active ? 'active' : 'inactive'}">${item.active ? 'Active' : 'Inactive'}</span></td>
      <td>${Number(item.studentScansToday || 0)}</td><td>${Number(item.teacherPunchesToday || 0)}</td>
      <td>${item.lastActivityAt ? esc(new Date(item.lastActivityAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })) : 'No scans yet'}</td></tr>`).join('')
      : '<tr><td colspan="5" class="empty-cell">No Gate Keeper accounts have been created yet.</td></tr>';
  }

  function renderTeacherGateAttendance() {
    const host = $('teacherGateAttendanceRows');
    if (!host) return;
    host.innerHTML = teacherGateAttendance.length ? teacherGateAttendance.map(item => `
      <tr><td><strong>${esc(item.teacherName)}</strong><small class="table-subtext">${esc(item.username)}</small></td>
      <td><span class="status-tag ${item.eventType === 'TIME_IN' ? '' : 'neutral'}">${item.eventType === 'TIME_IN' ? 'Time-in' : 'Time-out'}</span></td>
      <td>${esc(new Date(item.occurredAt).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }))}</td>
      <td>${esc(item.recordedBy || '')}</td><td>${item.photoVerified ? 'Photo verified' : 'Not verified'}</td></tr>`).join('')
      : '<tr><td colspan="5" class="empty-cell">No teacher gate attendance has been recorded for this date.</td></tr>';
  }

  async function loadGateMonitoring() {
    if ($('teacherGateDate') && !$('teacherGateDate').value) $('teacherGateDate').value = schoolDateManila();
    if (user.role === 'SCHOOL_ADMIN') {
      const data = await api('/api/admin/gatekeeper-monitoring');
      gateKeeperMonitoring = data.gateKeepers || [];
      renderGateKeeperMonitoring();
    }
    if (['SCHOOL_ADMIN', 'DEPARTMENT_HEAD'].includes(user.role)) {
      const date = $('teacherGateDate')?.value || schoolDateManila();
      const data = await api(`/api/admin/teacher-gate-attendance?date=${encodeURIComponent(date)}`);
      teacherGateAttendance = data.events || [];
      renderTeacherGateAttendance();
    }
  }

  async function loadSchoolData() {
    const role = user.role;
    if (role === 'GATE_KEEPER') {
      // Gate accounts receive a one-student QR lookup only; no full roster is downloaded.
      students = [];
      periods = [];
      dashboardData = null;
      if ($('scanSetupScope')) { $('scanSetupScope').value = 'SCHOOL'; $('scanSetupScope').disabled = true; }
      if ($('scanSetupPeriodWrap')) $('scanSetupPeriodWrap').hidden = true;
      if ($('studentRosterPanel')) $('studentRosterPanel').hidden = true;
      return;
    }

    const isDepartmentHead = role === 'DEPARTMENT_HEAD';
    const isSchoolManager = ['SCHOOL_ADMIN', 'DEPARTMENT_HEAD'].includes(role);
    $('teacherCoverageCard').hidden = !isSchoolManager;
    if ($('departmentHeadOverview')) $('departmentHeadOverview').hidden = !isDepartmentHead;
    const base = await Promise.all([
      api('/api/admin/dashboard'),
      api(role === 'SCHOOL_ADMIN' ? '/api/students?includeInactive=true' : '/api/students'),
      role === 'TEACHER' && !(teacherHas('SUBJECT_TEACHER') || teacherHas('CLASS_ADVISER')) ? Promise.resolve({ periods: [] }) : api('/api/periods'),
      isSchoolManager ? api('/api/departments') : Promise.resolve({ departments: [] })
    ]);
    dashboardData = base[0];
    students = base[1].students || [];
    periods = base[2].periods || [];
    departments = base[3].departments || [];
    renderDepartments();
    const scopeSelect = $('scanSetupScope');
    const hasSubjectRole = role === 'TEACHER' && teacherHas('SUBJECT_TEACHER');
    const hasAdviserRole = role === 'TEACHER' && teacherHas('CLASS_ADVISER');
    scopeSelect.querySelector('option[value="SCHOOL"]').hidden = role !== 'GATE_KEEPER';
    scopeSelect.querySelector('option[value="CLASS"]').hidden = role === 'TEACHER' && !hasSubjectRole;
    const advisoryOption = scopeSelect.querySelector('option[value="ADVISORY"]');
    if (advisoryOption) advisoryOption.hidden = !hasAdviserRole;
    if (role === 'TEACHER') {
      scopeSelect.disabled = !(hasSubjectRole && hasAdviserRole);
      scopeSelect.value = hasAdviserRole && !hasSubjectRole ? 'ADVISORY' : 'CLASS';
    }
    $('scanSetupPeriod').innerHTML = '<option value="">Select assigned schedule</option>' + periods.map(p => `<option value="${esc(p.periodId)}">${esc(p.periodName)} · ${esc(p.gradeLevel)} · ${esc(p.section || 'All sections')}</option>`).join('');
    $('scanSetupPeriodWrap').hidden = scopeSelect.value !== 'CLASS';
    $('scanSetupPeriod').value = periods.length === 1 ? String(periods[0].periodId) : '';

    teachers = [];
    schoolUsers = [];
    adviserAssignments = [];
    if (['SCHOOL_ADMIN', 'DEPARTMENT_HEAD'].includes(role)) {
      const teacherData = await api('/api/teachers');
      teachers = teacherData.teachers || [];
    }
    if (role === 'SCHOOL_ADMIN') {
      const [staffData, adviserData] = await Promise.all([api('/api/school-users'), api('/api/class-adviser-assignments')]);
      schoolUsers = (staffData.users || []).filter(account => ['DEPARTMENT_HEAD', 'GATE_KEEPER'].includes(account.role));
      adviserAssignments = adviserData.assignments || [];
      renderStaffUsers();
      renderAdviserAssignments();
    } else if (role === 'TEACHER' && (user.teacherDesignations || []).includes('CLASS_ADVISER')) {
      const adviserData = await api('/api/class-adviser-assignments');
      adviserAssignments = adviserData.assignments || [];
    }

    renderStats(dashboardData);
    renderStudents();
    renderPeriods();
    if (isSchoolManager) renderTeachers();
    if (isDepartmentHead) renderDepartmentHeadOverview();
    if (isSchoolManager) {
      await loadTeacherCoverage(false);
      await loadGateMonitoring();
    }
    if (['SCHOOL_ADMIN', 'DEPARTMENT_HEAD', 'TEACHER'].includes(role)) {
      await loadSf2Options();
      if (['SCHOOL_ADMIN', 'DEPARTMENT_HEAD'].includes(role)) {
        $('sf2SubmissionsCard').hidden = false;
        await loadSf2Submissions();
      }
    }
    if (role === 'TEACHER' && (user.teacherDesignations || []).includes('CLASS_ADVISER')) {
      renderAdviserAssignments();
    }
  }

  function renderTeacherClassAttendance(records) {
    const host = $('teacherAttendanceRows');
    if (!host) return;
    $('teacherAttendanceCount').textContent = String(records.length);
    host.innerHTML = records.length ? records.map(item => {
      const time = item.occurredAt
        ? new Date(item.occurredAt).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' })
        : '—';
      const date = formatSchoolDate(item.schoolDate);
      const className = item.scope === 'ADVISORY'
        ? 'Advisory / homeroom'
        : [item.periodName, item.subjectName].filter(Boolean).join(' · ') || 'Assigned subject class';
      const eventLabel = item.eventType === 'TIME_IN' ? 'Time-in' : 'Time-out';
      return `<tr>
        <td>${esc(date)}</td><td>${esc(time)}</td>
        <td><strong>${esc(item.fullName)}</strong><small class="table-subtext">${esc(item.studentId)}</small></td>
        <td>${esc(item.gradeLevel)} · ${esc(item.section)}</td>
        <td>${esc(className)}</td>
        <td><span class="status-tag ${item.eventType === 'TIME_IN' ? '' : 'neutral'}">${eventLabel}</span></td>
        <td>${item.late ? '<span class="status-tag late">Late</span>' : '<span class="status-tag neutral">On time / not late</span>'}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="7" class="empty-cell">No class attendance records match this date range and your assignments.</td></tr>';
  }

  async function loadTeacherClassAttendance() {
    if (user?.role !== 'TEACHER') return;
    const fromInput = $('teacherAttendanceFrom');
    const toInput = $('teacherAttendanceTo');
    const select = $('teacherAttendanceViewSelect');
    if (!fromInput || !toInput || !select) return;
    const today = schoolDateManila();
    if (!toInput.value) toInput.value = today;
    if (!fromInput.value) {
      const start = new Date(`${today}T00:00:00+08:00`);
      start.setDate(start.getDate() - 6);
      fromInput.value = schoolDateManila(start);
    }
    const from = fromInput.value;
    const to = toInput.value;
    if (!from || !to || from > to) {
      $('teacherAttendanceFeedback').textContent = 'Choose a valid date range. The start date must not be after the end date.';
      $('teacherAttendanceFeedback').className = 'inline-feedback error';
      return;
    }
    const view = select.value || 'ALL';
    $('teacherAttendanceFeedback').textContent = 'Loading assigned class attendance…';
    $('teacherAttendanceFeedback').className = 'inline-feedback';
    $('teacherAttendanceApply').disabled = true;
    $('teacherAttendanceRefresh').disabled = true;
    try {
      const query = new URLSearchParams({ view, from, to });
      const data = await api(`/api/teacher/class-attendance?${query.toString()}`);
      renderTeacherClassAttendance(data.records || []);
      $('teacherAttendanceFeedback').textContent = data.records?.length
        ? `Showing ${data.records.length} accepted record(s) from ${formatSchoolDate(from)} to ${formatSchoolDate(to)}.`
        : 'No accepted attendance records were found for this date range and your assigned classes.';
      $('teacherAttendanceFeedback').className = 'inline-feedback';
    } catch (error) {
      $('teacherAttendanceCount').textContent = '—';
      $('teacherAttendanceRows').innerHTML = '<tr><td colspan="7" class="empty-cell">Attendance records could not be loaded.</td></tr>';
      $('teacherAttendanceFeedback').textContent = error.message;
      $('teacherAttendanceFeedback').className = 'inline-feedback error';
    } finally {
      $('teacherAttendanceApply').disabled = false;
      $('teacherAttendanceRefresh').disabled = false;
    }
  }

  async function refresh() {
    const button = $('refreshButton');
    button.disabled = true;
    button.textContent = 'Refreshing…';
    try {
      await loadSchoolData();
      showToast('Dashboard and school records refreshed.');
    } catch (error) {
      showToast(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = '↻ Refresh';
    }
  }


  let sf2PreviewData = null;
  async function loadSf2Preview() {
    const month = $('sf2Month').value;
    const gradeLevel = $('sf2Grade').value;
    const section = $('sf2Section').value;
    const mode = $('sf2Mode')?.value || '';
    if (!month || !gradeLevel || !section) { $('sf2Feedback').textContent = 'Select month, grade level, and section.'; return; }
    $('sf2Feedback').textContent = 'Loading attendance preview…';
    $('sf2ExportButton').disabled = true;
    $('sf2SubmitButton').hidden = true;
    try {
      const query = new URLSearchParams({ month, gradeLevel, section });
      if (mode) query.set('mode', mode);
      const data = await api(`/api/sf2/preview?${query}`);
      sf2PreviewData = data;
      $('sf2Summary').hidden = false;
      $('sf2TableWrap').hidden = false;
      const metrics = [
        ['Present learner-days', data.summary.present],
        ['Confirmed absent', data.summary.absent],
        [data.mode === 'PERSONAL' ? 'No record (this teacher)' : 'Pending review', data.mode === 'PERSONAL' ? data.summary.noRecord : data.summary.pending],
        ['Missing sex', data.summary.missingSex]
      ];
      $('sf2Summary').innerHTML = metrics.map(([label, value]) => `<article class="learner-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`).join('');
      $('sf2ModeNote').hidden = false;
      $('sf2ModeNote').textContent = `${data.note} ${data.calendarNote || ''}`;
      $('sf2Rows').innerHTML = data.students.map(student => {
        const sexControl = esc(student.sex || 'Not set');
        const attendance = student.days.map((status, index) => {
          const date = data.dates[index];
          if (status === 'PENDING' && data.canConfirmAbsence) return `<button type="button" class="secondary-button" data-sf2-absent="${esc(student.id)}" data-date="${date}">Review ${date}</button>`;
          if (status === 'ABSENT' && data.canConfirmAbsence) return `<button type="button" class="status-tag late" data-sf2-remove-absent="${esc(student.id)}" data-date="${date}">${date} · X</button>`;
          const label = status === 'PRESENT' ? 'P' : status === 'NO_RECORD' ? 'NR' : status;
          return `<span class="status-tag ${status === 'ABSENT' ? 'late' : status === 'PENDING' ? 'neutral' : ''}">${date} · ${label}</span>`;
        }).join(' ');
        return `<tr><td><strong>${esc(student.name)}</strong><small>${esc(student.gradeLevel)} · ${esc(student.section)}</small></td><td>${sexControl}</td><td>${attendance || 'No weekdays'}</td></tr>`;
      }).join('') || '<tr><td colspan="3" class="empty-cell">No learners are enrolled in this section.</td></tr>';
      const personal = data.mode === 'PERSONAL';
      const canExport = personal || (data.summary.pending === 0 && data.summary.missingSex === 0);
      const canDownload = !data.readOnly || personal;
      $('sf2ExportButton').hidden = !canDownload;
      $('sf2ExportButton').textContent = personal ? 'Generate personal copy' : 'Generate official SF2 Excel';
      $('sf2ExportButton').disabled = !canExport || !canDownload;
      $('sf2SubmitButton').hidden = !data.canSubmit || personal;
      $('sf2SubmitButton').disabled = !canExport || personal;
      $('sf2Feedback').textContent = personal
        ? 'Personal copy ready. NR means no accepted subject time-in by this teacher; it does not mean absent.'
        : data.summary.pending
          ? `${data.summary.pending} learner-day(s) need review. Only the assigned Class Adviser may confirm full-day absences after checking all scheduled subjects.`
          : data.summary.missingSex
            ? `${data.summary.missingSex} learner(s) need Male/Female set in Student Management before official generation.`
            : data.canSubmit ? 'Official preview ready. The assigned Class Adviser may submit the consolidated monthly SF2.' : 'Read-only or administrative preview ready.';
    } catch (error) {
      $('sf2Feedback').textContent = error.message;
      $('sf2Summary').hidden = true;
      $('sf2TableWrap').hidden = true;
    }
  }

  async function downloadSf2Workbook() {
    if (!sf2PreviewData) return;
    const button = $('sf2ExportButton');
    const previousLabel = button.textContent;
    const wasDisabled = button.disabled;
    const query = new URLSearchParams({
      month: $('sf2Month').value, gradeLevel: $('sf2Grade').value,
      section: $('sf2Section').value, mode: $('sf2Mode')?.value || ''
    });
    button.disabled = true;
    button.textContent = 'Preparing Excel…';
    $('sf2Feedback').textContent = 'Generating your workbook. Please keep this page open.';
    let objectUrl = null;
    try {
      const response = await fetch(`/api/sf2/export?${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `SF2 export failed (${response.status}).`);
      }
      const contentType = response.headers.get('Content-Type') || '';
      if (!contentType.includes('spreadsheetml.sheet') && !contentType.includes('application/octet-stream')) {
        throw new Error('The server did not return an Excel workbook. Refresh the preview and try again.');
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error('The generated SF2 workbook is empty. Please preview the attendance again.');
      objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const disposition = response.headers.get('Content-Disposition') || '';
      const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const basicMatch = disposition.match(/filename="?([^";]+)"?/i);
      let serverFilename = utf8Match?.[1] || basicMatch?.[1] || '';
      try { serverFilename = decodeURIComponent(serverFilename.replace(/^"|"$/g, '')); } catch {}
      anchor.href = objectUrl;
      anchor.download = serverFilename || `SF2-${query.get('gradeLevel')}-${query.get('section')}-${query.get('month')}${query.get('mode') === 'PERSONAL' ? '-Personal-Copy' : ''}.xlsx`;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, 10000);
      $('sf2Feedback').textContent = 'Your Excel workbook download has started.';
      showToast('SF2 Excel workbook generated. Check your browser downloads.');
    } catch (error) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      $('sf2Feedback').textContent = error.message || 'SF2 export failed.';
      showToast($('sf2Feedback').textContent, true);
    } finally {
      button.textContent = previousLabel;
      button.disabled = wasDisabled;
    }
  }

  async function submitOfficialSf2() {
    if (!sf2PreviewData?.canSubmit) return;
    const payload = { month: $('sf2Month').value, gradeLevel: $('sf2Grade').value, section: $('sf2Section').value };
    if (!await AppDialog.confirm(`Submit the official monthly SF2 for ${payload.gradeLevel} – ${payload.section}, ${payload.month}?`, { title: 'Submit official SF2', confirmText: 'Submit SF2' })) return;
    $('sf2SubmitButton').disabled = true;
    try {
      const response = await api('/api/sf2/submissions', { method: 'POST', body: JSON.stringify(payload) });
      $('sf2Feedback').textContent = `Official SF2 submitted successfully (revision ${response.submission.revision}).`;
      showToast('Official SF2 submitted to the School Administrator.');
    } catch (error) {
      $('sf2Feedback').textContent = error.message;
      $('sf2SubmitButton').disabled = false;
    }
  }

  if ($('sf2Month')) {
    $('sf2Month').value = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }).slice(0, 7);
    $('sf2PreviewButton').addEventListener('click', loadSf2Preview);
    $('sf2Grade').addEventListener('change', updateSf2SectionOptions);
    $('sf2Section').addEventListener('change', updateSf2ModeOptions);
    $('sf2Mode')?.addEventListener('change', () => { sf2PreviewData = null; $('sf2Summary').hidden = true; $('sf2TableWrap').hidden = true; });
    $('sf2Rows').addEventListener('click', async event => {
      const absent = event.target.closest('[data-sf2-absent]');
      const remove = event.target.closest('[data-sf2-remove-absent]');
      try {
        if (absent) {
          const type = await AppDialog.prompt('Classify this confirmed full-day absence.', 'UNEXCUSED', { title: 'Confirm absence type', label: 'Absence classification', helpText: 'Choose EXCUSED or UNEXCUSED.', placeholder: 'EXCUSED or UNEXCUSED', required: true, validate: value => ['EXCUSED', 'UNEXCUSED'].includes(String(value).trim().toUpperCase()) ? true : 'Enter EXCUSED or UNEXCUSED.' });
          if (!type) return;
          await api('/api/sf2/absence', { method: 'PUT', body: JSON.stringify({ studentId: absent.dataset.sf2Absent, date: absent.dataset.date, absenceType: type.toUpperCase() }) });
          await loadSf2Preview();
        } else if (remove) {
          if (!await AppDialog.confirm('Remove this absence confirmation?', { title: 'Remove absence confirmation', confirmText: 'Remove', variant: 'danger' })) return;
          await api('/api/sf2/absence', { method: 'DELETE', body: JSON.stringify({ studentId: remove.dataset.sf2RemoveAbsent, date: remove.dataset.date }) });
          await loadSf2Preview();
        }
      } catch (error) { showToast(error.message, true); }
    });
    $('sf2ExportButton').addEventListener('click', downloadSf2Workbook);
    $('sf2SubmitButton').addEventListener('click', submitOfficialSf2);
    $('refreshSf2Submissions')?.addEventListener('click', async () => { try { await loadSf2Submissions(); } catch (error) { showToast(error.message, true); } });
    $('sf2SubmissionRows')?.addEventListener('click', async event => {
      const download = event.target.closest('[data-download-sf2]');
      const collect = event.target.closest('[data-collect-sf2]');
      if (download) {
        try {
          const response = await fetch(`/api/sf2/submissions/${encodeURIComponent(download.dataset.downloadSf2)}/download`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
          if (!response.ok) { const d = await response.json().catch(() => ({})); throw new Error(d.error || 'Download failed.'); }
          const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = document.createElement('a');
          anchor.href = url; anchor.download = 'Submitted-SF2.xlsx'; anchor.click(); URL.revokeObjectURL(url);
        } catch (error) { showToast(error.message, true); }
      } else if (collect) {
        if (!await AppDialog.confirm('Mark this submitted SF2 as collected?', { title: 'Confirm SF2 collection', confirmText: 'Mark as collected' })) return;
        collect.disabled = true;
        try { await api(`/api/sf2/submissions/${encodeURIComponent(collect.dataset.collectSf2)}/collect`, { method: 'PATCH' }); await loadSf2Submissions(); showToast('SF2 marked as collected.'); }
        catch (error) { showToast(error.message, true); collect.disabled = false; }
      }
    });
  }

  async function init() {
    let me;
    try {
      me = await api('/api/auth/me');
    } catch (error) {
      showToast(error.message, true);
      return;
    }
    user = me.user;
    sessionStorage.setItem(userKey, JSON.stringify(user));
    $('userDisplay').textContent = user.displayName || user.username;
    if ($('userRole')) $('userRole').textContent = user.role.replaceAll('_', ' ');
    $('accountMenuName').textContent = user.displayName || user.username;
    $('accountMenuRole').textContent = user.role.replaceAll('_', ' ');
    $('userAvatar').textContent = (user.displayName || user.username || 'U').trim().charAt(0).toUpperCase();
    $('rolePill').textContent = user.role.replaceAll('_', ' ');
    $('dateLabel').textContent = new Date().toLocaleDateString('en-PH', {
      timeZone: 'Asia/Manila', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    if (user.role === 'PARENT') {
      window.location.replace('/parent-portal.html');
      return;
    }
    if (user.role === 'STUDENT') {
      window.location.replace('/student-portal.html');
      return;
    }

    if (user.role === 'SUPER_ADMIN') {
      $('schoolTitle').textContent = 'Platform workspace';
      $('schoolCodeLabel').textContent = 'PLATFORM ADMINISTRATION';
      $('schoolEmblem').textContent = 'P';
      document.querySelector('.side-nav').innerHTML = '<button class="nav-item active" data-view="platform"><span class="nav-icon">▦</span><span class="nav-label">Platform overview</span></button>';
      $('refreshButton').hidden = true;
      setView('platform');
    } else {
      $('schoolTitle').textContent = user.schoolName || 'School workspace';
      $('schoolCodeLabel').textContent = user.schoolCode || 'SCHOOL WORKSPACE';
      $('schoolEmblem').textContent = (user.schoolName || 'S').trim().charAt(0).toUpperCase();
      applyRoleNavigation();
      const gateKeeper = user.role === 'GATE_KEEPER';
      if (gateKeeper) {
        if ($('studentsNav')) $('studentsNav').hidden = false;
        if ($('studentsNav')) $('studentsNav').querySelector('.nav-label').textContent = 'Gate scanner';
        document.querySelectorAll('.quick-action[data-go]').forEach(button => button.hidden = true);
        setView('students');
      } else {
        document.querySelectorAll('.quick-action[data-go]').forEach(button => {
          button.addEventListener('click', () => setView(button.dataset.go));
        });
        setView('dashboard');
      }
      await loadSchoolData();
      await loadCloudSyncStatus();
      if (user.role === 'SCHOOL_ADMIN') await loadCloudSyncSettings();
    }
  }

  async function loadCloudSyncStatus() {
    const chip = $('connectionStatus');
    if (!chip) return;
    const label = chip.querySelector('span');
    chip.title = 'Checking the cloud replication configuration.';
    try {
      const data = await api('/api/cloud-sync/status');
      const connected = data.connectionStatus === 'CONNECTED' && data.enabled;
      chip.classList.toggle('sync-connected', connected);
      chip.classList.toggle('sync-disconnected', !connected);
      label.textContent = connected ? 'Cloud sync connected' :
        data.configured ? 'Cloud destination saved · Not connected' : 'Cloud sync not configured';
      chip.title = data.message || 'Cloud replication status checked.';
    } catch (error) {
      chip.classList.remove('sync-connected');
      chip.classList.add('sync-disconnected');
      label.textContent = 'Cloud sync status unavailable';
      chip.title = error.message || 'Could not verify cloud replication status.';
    }
  }

  async function loadCloudSyncSettings() {
    const input = $('cloudBaseUrl');
    if (!input) return;
    try {
      const data = await api('/api/cloud-sync/settings');
      input.value = data.cloudBaseUrl || '';
      $('cloudSyncStatus').textContent = data.configured ? 'Saved · Not connected' : 'Not configured';
      $('cloudSyncFeedback').textContent = data.message || 'Cloud destination settings loaded.';
    } catch (error) {
      $('cloudSyncFeedback').textContent = error.message;
      $('cloudSyncFeedback').className = 'inline-feedback error';
    }
  }

  $('cloudSyncForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('saveCloudDestination');
    button.disabled = true;
    $('cloudSyncFeedback').className = 'inline-feedback';
    $('cloudSyncFeedback').textContent = 'Saving destination…';
    try {
      const data = await api('/api/cloud-sync/settings', {
        method: 'PUT', body: JSON.stringify({ cloudBaseUrl: $('cloudBaseUrl').value.trim() })
      });
      $('cloudSyncStatus').textContent = data.configured ? 'Saved · Not connected' : 'Not configured';
      $('cloudSyncFeedback').textContent = data.message;
      await loadCloudSyncStatus();
      showToast('Cloud destination settings saved.');
    } catch (error) {
      $('cloudSyncFeedback').className = 'inline-feedback error';
      $('cloudSyncFeedback').textContent = error.message;
    } finally { button.disabled = false; }
  });
  $('refreshCloudDestination')?.addEventListener('click', loadCloudSyncSettings);

  document.querySelectorAll('.nav-item[data-view]').forEach(button => {
    button.addEventListener('click', () => setView(button.dataset.view));
  });
  $('refreshButton').addEventListener('click', refresh);
  $('refreshGateMonitoring')?.addEventListener('click', async () => {
    const button = $('refreshGateMonitoring');
    button.disabled = true;
    try { await loadGateMonitoring(); showToast('Gate monitoring refreshed.'); }
    catch (error) { showToast(error.message, true); }
    finally { button.disabled = false; }
  });
  $('dashboardOpenScanner')?.addEventListener('click', () => {
    setView('students');
    $('studentScanSetupModal').hidden = false;
  });
  $('dashboardAddStudent')?.addEventListener('click', () => {
    setView('students');
    $('studentForm').hidden = false;
    $('studentForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('newStudentId').focus({ preventScroll: true });
  });

  if ($('parentsNav')) $('parentsNav').addEventListener('click', () => window.location.assign('/parent-admin.html'));
  document.querySelectorAll('[data-nav-group]').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.navGroup;
      const submenu = document.querySelector(`[data-submenu="${key}"]`);
      const opening = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(opening));
      if (submenu) submenu.hidden = !opening;
      const layout = document.querySelector('.portal-layout');
      if (layout.classList.contains('sidebar-collapsed') && !window.matchMedia('(max-width: 700px)').matches) {
        layout.classList.remove('sidebar-collapsed');
      }
    });
  });

  document.querySelectorAll('.nav-group-toggle[data-nav-group]').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      const submenu = document.querySelector('[data-submenu="' + toggle.dataset.navGroup + '"]');
      if (submenu) submenu.hidden = expanded;
    });
  });

  $('sidebarToggle').addEventListener('click', () => {
    const sidebar = $('sidebar');
    const layout = document.querySelector('.portal-layout');
    if (window.matchMedia('(max-width: 700px)').matches) {
      sidebar.classList.toggle('open');
      const isOpen = sidebar.classList.contains('open');
      $('sidebarToggle').setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
      $('sidebarToggle').title = isOpen ? 'Close navigation' : 'Open navigation';
      $('sidebarToggle').textContent = isOpen ? '×' : '☰';
      $('sidebarToggle').setAttribute('aria-expanded', String(isOpen));
      return;
    }
    layout.classList.toggle('sidebar-collapsed');
    const collapsed = layout.classList.contains('sidebar-collapsed');
    $('sidebarToggle').setAttribute('aria-label', collapsed ? 'Expand navigation' : 'Collapse navigation');
    $('sidebarToggle').title = collapsed ? 'Expand navigation' : 'Collapse navigation';
    $('sidebarToggle').textContent = collapsed ? '»' : '«';
  });
  $('accountMenuButton').addEventListener('click', () => {
    const menu = $('accountDropdown');
    const opening = menu.hidden;
    menu.hidden = !opening;
    $('accountMenuButton').setAttribute('aria-expanded', String(opening));
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.account-menu-wrap')) {
      $('accountDropdown').hidden = true;
      $('accountMenuButton').setAttribute('aria-expanded', 'false');
    }
  });
  $('profileMenuButton').addEventListener('click', () => showToast('Profile editing will be added in the next account-management update.'));
  $('settingsMenuButton').addEventListener('click', () => showToast('Account settings will be added in the next account-management update.'));
  $('logoutButton').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* clear local session regardless */ }
    clearSession();
    window.location.replace('/portal-login.html');
  });

  $('downloadStudentTemplate')?.addEventListener('click', () => {
    const template = 'Student ID,Full Name,Sex,Grade Level,Section,LRN,Parent Name,Parent Mobile\\r\\n';
    const blob = new Blob([String.fromCharCode(0xfeff), template], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'student-import-template.csv'; a.click(); URL.revokeObjectURL(url);
  });
  $('exportStudentsButton')?.addEventListener('click', () => {
    exportCsv('student-roster.csv', ['Student ID','LRN','Full name','Sex','Grade level','Section','Status'],
      students.map(s => [s.studentId,s.lrn,s.fullName,s.sex,s.gradeLevel,s.section,s.active === false ? 'Inactive' : 'Active']));
  });
  $('exportTeachersButton')?.addEventListener('click', () => {
    exportCsv('teacher-list.csv', ['Username','Teacher name','Department','Status','Designations','Assigned classes'],
      teachers.map(t => [t.username,t.displayName,t.departmentName,t.teacherStatus,(t.teacherDesignations || []).join('; '),
        [...(t.adviserSections || []), ...(t.assignedPeriods || [])].map(x => String(x.gradeLevel || '') + ' ' + String(x.section || '')).join('; ')]));
  });

  function prepareStudentImportAdvisoryScope() {
    const group = $('studentImportAdvisoryGroup');
    const select = $('studentImportAdvisoryAssignment');
    const isAdviser = user.role === 'TEACHER' && teacherHas('CLASS_ADVISER');
    if (!group || !select) return;
    group.hidden = !isAdviser;
    if (!isAdviser) return;
    const previous = select.value;
    select.innerHTML = '<option value="">Use grade and section from file</option>' + adviserAssignments.map(item =>
      '<option value="' + esc(item.assignmentId) + '">' + esc(item.gradeLevel) + ' · ' + esc(item.section) + '</option>'
    ).join('');
    select.value = adviserAssignments.some(item => String(item.assignmentId) === String(previous))
      ? previous : adviserAssignments.length === 1 ? String(adviserAssignments[0].assignmentId) : '';
  }

  function studentImportRequestPayload() {
    const payload = { ...(pendingStudentImport || {}) };
    const select = $('studentImportAdvisoryAssignment');
    if (user.role === 'TEACHER' && teacherHas('CLASS_ADVISER') && select?.value) {
      payload.advisoryAssignmentId = select.value;
    }
    return payload;
  }

  function resetStudentImport() {
    pendingStudentImport = null; pendingStudentImportPreview = null;
    $('studentImportFile').value = ''; $('studentImportSummary').textContent = '';
    $('studentImportPreviewRows').innerHTML = '<tr><td colspan="7" class="empty-cell">Choose a file to preview.</td></tr>';
    $('confirmStudentImport').disabled = true;
  }

  async function previewStudentImport() {
    if (!pendingStudentImport) return;
    $('studentImportSummary').textContent = 'Validating the file and assigned destination…';
    $('confirmStudentImport').disabled = true;
    try {
      const preview = await api('/api/students/import/preview', { method:'POST', body:JSON.stringify(studentImportRequestPayload()) });
      pendingStudentImportPreview = preview;
      $('studentImportSummary').textContent = preview.total + ' rows · ' + preview.summary.create + ' new · ' + preview.summary.update + ' updates · ' + preview.summary.error + ' errors';
      $('studentImportPreviewRows').innerHTML = preview.rows.map(r =>
        '<tr><td>' + r.rowNumber + '</td><td>' + esc(r.studentId) + '</td><td>' + esc(r.fullName) + '</td><td>' +
        esc(r.gradeLevel) + '</td><td>' + esc(r.section) + '</td><td>' + esc(r.action) + '</td><td>' +
        esc((r.errors || []).join(' ')) + '</td></tr>'
      ).join('') || '<tr><td colspan="7" class="empty-cell">No student rows were found.</td></tr>';
      $('confirmStudentImport').disabled = preview.summary.error > 0 || preview.total === 0;
    } catch (error) {
      pendingStudentImportPreview = null;
      $('studentImportSummary').textContent = error.message;
      $('studentImportPreviewRows').innerHTML = '<tr><td colspan="7" class="empty-cell">File could not be validated.</td></tr>';
    }
  }

  $('bulkImportStudentsButton')?.addEventListener('click', () => {
    resetStudentImport();
    prepareStudentImportAdvisoryScope();
    $('studentImportModal').hidden = false;
  });
  $('closeStudentImport')?.addEventListener('click', () => { $('studentImportModal').hidden = true; });
  $('cancelStudentImport')?.addEventListener('click', () => { $('studentImportModal').hidden = true; resetStudentImport(); });
  $('studentImportAdvisoryAssignment')?.addEventListener('change', () => { previewStudentImport().catch(error => showToast(error.message, true)); });
  $('studentImportFile')?.addEventListener('change', async () => {
    const file = $('studentImportFile').files?.[0]; if (!file) return;
    pendingStudentImport = null; pendingStudentImportPreview = null;
    if (file.size > 5 * 1024 * 1024) { showToast('Choose a file no larger than 5 MB.', true); return; }
    const ext = file.name.toLowerCase().split('.').pop();
    if (!['csv','xlsx'].includes(ext)) { showToast('Only CSV and Excel .xlsx files are supported.', true); return; }
    $('studentImportSummary').textContent = 'Reading and validating file…'; $('confirmStudentImport').disabled = true;
    try {
      if (ext === 'csv') pendingStudentImport = { csvText: await file.text() };
      else pendingStudentImport = { fileBase64: await new Promise((resolve,reject) => {
        const reader = new FileReader(); reader.onerror = () => reject(new Error('Could not read the Excel file.'));
        reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.readAsDataURL(file);
      }) };
      await previewStudentImport();
    } catch (error) {
      $('studentImportSummary').textContent = error.message;
      $('studentImportPreviewRows').innerHTML = '<tr><td colspan="7" class="empty-cell">File could not be validated.</td></tr>';
    }
  });
  $('confirmStudentImport')?.addEventListener('click', async () => {
    if (!pendingStudentImport || !pendingStudentImportPreview || pendingStudentImportPreview.summary.error) return;
    if (!await AppDialog.confirm('Import ' + pendingStudentImportPreview.total + ' student records? Existing Student IDs will be updated, not duplicated.', { title: 'Import student records', confirmText: 'Import students' })) return;
    $('confirmStudentImport').disabled = true; $('studentImportSummary').textContent = 'Saving records…';
    try {
      const result = await api('/api/students/import/commit', { method:'POST', body:JSON.stringify(studentImportRequestPayload()) });
      const summary = 'Completed: ' + result.created + ' created and ' + result.updated + ' updated.';
      resetStudentImport(); $('studentImportModal').hidden = true; selectedStudentIds.clear(); await loadSchoolData();
      showToast(summary);
    } catch (error) { $('studentImportSummary').textContent = error.message; $('confirmStudentImport').disabled = false; }
  });
  function openStudentBatch() {
    const action = $('studentBatchAction').value;
    if (!action || !selectedStudentIds.size) return;
    ['batchNameGroup','batchSexGroup','batchLrnGroup','batchParentNameGroup','batchParentMobileGroup'].forEach(id => $(id).hidden = action !== 'UPDATE');
    $('batchGradeGroup').hidden = action !== 'ASSIGN'; $('batchSectionGroup').hidden = action !== 'ASSIGN';
    $('batchLrnGroup').hidden = action !== 'UPDATE' || user.role !== 'SCHOOL_ADMIN';
    $('batchParentNameGroup').hidden = action !== 'UPDATE' || user.role !== 'SCHOOL_ADMIN';
    $('batchParentMobileGroup').hidden = action !== 'UPDATE' || user.role !== 'SCHOOL_ADMIN';
    $('studentBatchTitle').textContent = action + ' ' + selectedStudentIds.size + ' students';
    $('studentBatchDescription').textContent = action === 'ASSIGN' ? 'This changes the active school-year enrollment, not the permanent student identity.' : 'Only the fields you complete will be changed.';
    $('studentBatchModal').hidden = false;
  }
  $('applyStudentBatch')?.addEventListener('click', openStudentBatch);
  $('studentBatchAction')?.addEventListener('change', () => { $('applyStudentBatch').disabled = !selectedStudentIds.size || !$('studentBatchAction').value; });
  $('closeStudentBatch')?.addEventListener('click', () => { $('studentBatchModal').hidden = true; });
  $('studentBatchForm')?.addEventListener('submit', async event => {
    event.preventDefault(); const action = $('studentBatchAction').value;
    if (!action || !selectedStudentIds.size) return;
    if (!await AppDialog.confirm(action + ' ' + selectedStudentIds.size + ' selected student records?', { title: 'Confirm bulk student action', confirmText: 'Apply changes', variant: ['DEACTIVATE', 'ARCHIVE'].includes(action) ? 'danger' : 'primary' })) return;
    const body = { action, studentIds:[...selectedStudentIds] };
    if (action === 'UPDATE') {
      if ($('batchFullName').value.trim()) body.fullName = $('batchFullName').value.trim();
      if ($('batchSex').value) body.sex = $('batchSex').value;
      if ($('batchLrn').value.trim()) body.lrn = $('batchLrn').value.trim();
      if (user.role === 'SCHOOL_ADMIN') {
        if ($('batchParentName').value.trim()) body.parentName = $('batchParentName').value.trim();
        if ($('batchParentMobile').value.trim()) body.parentMobile = $('batchParentMobile').value.trim();
      }
      if (!body.fullName && !body.sex && !body.lrn && !body.parentName && !body.parentMobile) { $('studentBatchFeedback').textContent = 'Enter at least one field to update.'; return; }
    }
    if (action === 'ASSIGN') { body.gradeLevel = $('batchGrade').value; body.section = $('batchSection').value.trim(); if (!body.section) { $('studentBatchFeedback').textContent = 'Enter a section.'; return; } }
    $('confirmStudentBatch').disabled = true; $('studentBatchFeedback').textContent = 'Applying changes…';
    try {
      const result = await api('/api/students/batch', { method:'POST', body:JSON.stringify(body) });
      $('studentBatchModal').hidden = true; $('studentBatchFeedback').textContent = '';
      selectedStudentIds.clear(); $('studentBatchAction').value = ''; await loadSchoolData(); showToast(result.updated + ' student records updated.');
    } catch (error) { $('studentBatchFeedback').textContent = error.message; }
    finally { $('confirmStudentBatch').disabled = false; updateStudentSelectionUi(); }
  });

  $('studentRosterSearch').addEventListener('input', () => { renderStudents(); updateStudentSelectionUi(); });
  $('studentStatusFilter')?.addEventListener('change', () => { selectedStudentIds.clear(); renderStudents(); updateStudentSelectionUi(); });
  $('closeStudentQrPreview').addEventListener('click', () => { $('studentQrPreviewModal').hidden = true; });
  $('closeStudentQrPreviewBottom').addEventListener('click', () => { $('studentQrPreviewModal').hidden = true; });
  $('studentQrPreviewModal').addEventListener('click', event => {
    if (event.target === $('studentQrPreviewModal')) $('studentQrPreviewModal').hidden = true;
  });
  $('bulkQrGrade').addEventListener('change', () => refreshBulkQrSections());
  $('printBulkQr').addEventListener('click', generateBulkQrCards);
  $('bulkQrSection').addEventListener('change', () => renderStudents());
  $('bulkQrGrade').addEventListener('change', () => { refreshBulkQrSections(); renderStudents(); });
  $('selectAllStudents').addEventListener('change', () => {
    const visible = students.filter(s => ($('bulkQrGrade').value === 'ALL' || s.gradeLevel === $('bulkQrGrade').value) && ($('bulkQrSection').value === 'ALL' || s.section === $('bulkQrSection').value) && (user.role !== 'SCHOOL_ADMIN' || $('studentStatusFilter').value === 'ALL' || ($('studentStatusFilter').value === 'ACTIVE' && s.active !== false && !s.archivedAt) || ($('studentStatusFilter').value === 'INACTIVE' && s.active === false && !s.archivedAt) || ($('studentStatusFilter').value === 'ARCHIVED' && Boolean(s.archivedAt))));
    visible.forEach(s => $('selectAllStudents').checked ? selectedStudentIds.add(s.studentId) : selectedStudentIds.delete(s.studentId));
    renderStudents();
  });
  $('studentScannerToggle').addEventListener('click', () => {
    if (studentQrScanner?.isScanning) { stopStudentScanner(); return; }
    $('studentScanSetupModal').hidden = false;
  });
  $('gateScanType')?.addEventListener('change', event => {
    gateScanType = ['BOTH', 'STUDENT', 'TEACHER'].includes(event.target.value) ? event.target.value : 'BOTH';
    const label = gateScanType === 'BOTH' ? 'Learners and teachers' : gateScanType === 'TEACHER' ? 'Teachers only' : 'Learners only';
    if ($('scanModeSummary')) $('scanModeSummary').textContent = `Gate attendance · ${label}.`;
    if ($('studentScanFeedback')) {
      $('studentScanFeedback').textContent = `Ready to scan: ${label.toLowerCase()}.`;
      $('studentScanFeedback').className = 'scanner-feedback';
    }
  });
  $('scanSetupScope').addEventListener('change', () => {
    $('scanSetupPeriodWrap').hidden = $('scanSetupScope').value !== 'CLASS';
    $('scanSetupPeriod').value = '';
  });
  $('teacherAttendanceApply')?.addEventListener('click', loadTeacherClassAttendance);
  $('teacherAttendanceRefresh')?.addEventListener('click', loadTeacherClassAttendance);
  $('teacherAttendanceViewSelect')?.addEventListener('change', loadTeacherClassAttendance);
  $('scanSetupCancel').addEventListener('click', () => { $('studentScanSetupModal').hidden = true; });
  $('studentScanSetupModal').addEventListener('click', event => {
    if (event.target === $('studentScanSetupModal')) $('studentScanSetupModal').hidden = true;
  });
  $('scanSetupStart').addEventListener('click', async () => {
    if (user.role === 'SCHOOL_ADMIN') {
      showToast('School Administrator accounts do not operate attendance scanners. Use an assigned Gate Keeper or teacher account.', true);
      return;
    }
    activeScanScope = user.role === 'TEACHER' ? $('scanSetupScope').value : 'SCHOOL';
    activeScanPeriodId = activeScanScope === 'CLASS' ? $('scanSetupPeriod').value : null;
    if (activeScanScope === 'CLASS' && !activeScanPeriodId) {
      $('scanSetupPeriodWrap').classList.add('field-missing');
      $('scanSetupPeriodHint').textContent = 'Please select an assigned class or subject schedule.';
      $('scanSetupPeriod').focus();
      return;
    }
    $('scanSetupPeriodWrap').classList.remove('field-missing');
    $('studentScanSetupModal').hidden = true;
    $('studentScannerPanel').hidden = false;
    $('studentScanFeedback').className = 'scanner-feedback';
    $('studentScanFeedback').textContent = 'Starting camera…';
    try { await startStudentScanner(); }
    catch (error) {
      $('studentScanFeedback').textContent = error.message;
      showToast(error.message, true);
      $('studentScannerPanel').hidden = true;
      $('studentScanSetupModal').hidden = false;
    }
  });
  $('scanSetupPeriod').addEventListener('change', () => {
    $('scanSetupPeriodWrap').classList.remove('field-missing');
    $('scanSetupPeriodHint').textContent = 'Choose the assigned schedule for this attendance session.';
  });
  $('studentScannerStop').addEventListener('click', stopStudentScanner);
  $('studentScanNoticeContinue').addEventListener('click', () => { $('studentScanNotice').hidden = true; $('studentTimeIn')?.focus(); });
  $('studentScanNotice').addEventListener('click', event => { if (event.target === $('studentScanNotice')) $('studentScanNotice').hidden = true; });
  $('closeStudentEdit').addEventListener('click', () => { $('studentEditOverlay').hidden = true; });
  $('studentEditOverlay').addEventListener('click', event => { if (event.target === $('studentEditOverlay')) $('studentEditOverlay').hidden = true; });
  $('studentEditForm').addEventListener('submit', async event => {
    event.preventDefault();
    const id = $('editStudentId').value;
    const feedback = $('studentEditFeedback');
    feedback.textContent = 'Saving changes…'; feedback.className = 'inline-feedback';
    const restrictedEditor = ['TEACHER','DEPARTMENT_HEAD'].includes(user.role);
    const placementEditable = !restrictedEditor;
    const payload = { fullName: $('editFullName').value.trim() };
    const sexEditable = !restrictedEditor || (user.role === 'TEACHER' && !$('editSexGroup').hidden);
    if (sexEditable) payload.sex = $('editSex').value;
    if (placementEditable) Object.assign(payload, { gradeLevel: $('editGrade').value, section: $('editSection').value.trim() });
    if (!restrictedEditor) Object.assign(payload, { lrn: $('editLrn').value.trim() || null, parentName: $('editParentName').value.trim() || null, parentMobile: $('editParentMobile').value.trim() });
    try {
      await api(`/api/students/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      $('studentEditOverlay').hidden = true; await loadSchoolData(); showToast('Student information updated. Existing QR code was preserved.');
    }
    catch (error) { feedback.textContent = error.message; feedback.className = 'inline-feedback error'; }
  });


  let sectionLoadSequence = 0;
  async function loadSectionsForGrade(gradeLevel, preferredSection = '') {
    const select = $('newSection');
    const hint = $('newSectionHint');
    const sequence = ++sectionLoadSequence;
    select.disabled = true;
    select.innerHTML = '<option value="">Loading sections…</option>';
    hint.textContent = 'Loading available sections for ' + gradeLevel + '…';
    try {
      const result = await api('/api/sections?gradeLevel=' + encodeURIComponent(gradeLevel));
      if (sequence !== sectionLoadSequence) return;
      const sections = result.sections || [];
      select.innerHTML = '<option value="">Select section</option>' +
        sections.map(section => `<option value="${esc(section)}">${esc(section)}</option>`).join('');
      if (preferredSection && sections.includes(preferredSection)) select.value = preferredSection;
      select.disabled = sections.length === 0;
      hint.textContent = sections.length
        ? `${sections.length} available section${sections.length === 1 ? '' : 's'} for ${gradeLevel}.`
        : `No active sections found for ${gradeLevel}. Ask the school administrator to configure a class schedule for this grade.`;
    } catch (error) {
      if (sequence !== sectionLoadSequence) return;
      select.innerHTML = '<option value="">Could not load sections</option>';
      select.disabled = true;
      hint.textContent = error.message || 'Could not load sections. Check your connection and try again.';
    }
  }

  function openParentInvite(student) {
    const schoolCode = user.schoolCode || '';
    const registerUrl = `${window.location.origin}/parent-register.html`;
    const parentName = $('newParentName').value.trim();
    const mobile = $('newParentMobile').value.trim();
    const message = [
      `Hello${parentName ? ' ' + parentName : ''}!`,
      `Your child ${student.fullName} (${student.studentId}) has been registered in the school attendance system.`,
      'To create your parent account, open this registration page:',
      registerUrl,
      `School code: ${schoolCode}`,
      `Child student ID: ${student.studentId}`,
      'Complete the registration form using your name, mobile number, relationship, username, and password.',
      'Your account will remain pending until the school administrator verifies and approves the parent-child relationship.',
      'Please do not share your password with anyone.'
    ].join('\n');
    $('parentInviteStudent').textContent = student.fullName;
    $('parentInviteStudentId').textContent = `Student ID: ${student.studentId} · ${student.gradeLevel} · ${student.section}`;
    $('parentInviteMobile').textContent = `Guardian mobile: ${mobile || 'Not provided'}`;
    $('parentInviteMessage').value = message;
    $('parentInviteModal').hidden = false;
  }

  $('showStudentForm').addEventListener('click', () => {
    $('studentForm').hidden = !$('studentForm').hidden;
    if (!$('studentForm').hidden && $('newGrade').value) loadSectionsForGrade($('newGrade').value);
  });
  $('cancelStudentForm').addEventListener('click', () => {
    $('studentForm').reset();
    $('newSection').innerHTML = '<option value="">Select grade level first</option>';
    $('newSection').disabled = true;
    $('newSectionHint').textContent = 'Choose a grade to load its available sections.';
    $('studentForm').hidden = true;
    $('studentFormFeedback').textContent = '';
  });
  $('newGrade').addEventListener('change', () => loadSectionsForGrade($('newGrade').value));
  $('parentInviteClose').addEventListener('click', () => { $('parentInviteModal').hidden = true; });
  $('parentInviteModal').addEventListener('click', event => { if (event.target === $('parentInviteModal')) $('parentInviteModal').hidden = true; });
  $('parentInviteCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('parentInviteMessage').value); showToast('Parent registration instructions copied.'); }
    catch { $('parentInviteMessage').focus(); $('parentInviteMessage').select(); showToast('Select and copy the instructions manually.', true); }
  });
  $('parentInviteShare').addEventListener('click', async () => {
    if (navigator.share) {
      try { await navigator.share({ title: 'Parent portal registration', text: $('parentInviteMessage').value }); }
      catch (error) { if (error.name !== 'AbortError') showToast('Could not open the share menu.', true); }
    } else {
      try { await navigator.clipboard.writeText($('parentInviteMessage').value); showToast('Sharing is unavailable here. Instructions copied instead.'); }
      catch { showToast('Use Copy instructions to share manually.', true); }
    }
  });
  $('studentForm').addEventListener('submit', async event => {
    event.preventDefault();
    const feedback = $('studentFormFeedback');
    feedback.className = 'inline-feedback';
    feedback.textContent = 'Saving…';
    const payload = {
      studentId: $('newStudentId').value.trim(),
      lrn: $('newLrn').value.trim() || null,
      sex: $('newSex').value,
      fullName: $('newFullName').value.trim(),
      gradeLevel: $('newGrade').value,
      section: $('newSection').value.trim(),
      parentName: $('newParentName').value.trim(),
      parentMobile: $('newParentMobile').value.trim()
    };
    try {
      const created = await api('/api/students', { method: 'POST', body: JSON.stringify(payload) });
      const photoFile = $('newStudentPhoto').files?.[0];
      if (photoFile) await uploadStudentPhoto(created.student.studentId, photoFile);
      const inviteStudent = { fullName: payload.fullName, studentId: created.student.studentId, gradeLevel: payload.gradeLevel, section: payload.section };
      $('studentForm').reset();
      $('newSection').innerHTML = '<option value="">Select grade level first</option>';
      $('newSection').disabled = true;
      $('newSectionHint').textContent = 'Choose a grade to load its available sections.';
      $('studentForm').hidden = true;
      await loadSchoolData();
      showToast('Student registered successfully.');
      if (payload.parentName || payload.parentMobile) openParentInvite(inviteStudent);
    } catch (error) {
      feedback.className = 'inline-feedback error';
      feedback.textContent = error.message;
    }
  });

  function updatePeriodBatchUi() {
    const visibleIds = periods.filter(p => user.role !== 'DEPARTMENT_HEAD' || String(p.departmentId) === String(user.departmentId)).map(p => String(p.periodId));
    $('selectedPeriodCount').textContent = selectedPeriodIds.size + ' selected';
    $('selectAllPeriods').checked = visibleIds.length > 0 && visibleIds.every(id => selectedPeriodIds.has(id));
    $('selectAllPeriods').indeterminate = visibleIds.some(id => selectedPeriodIds.has(id)) && !$('selectAllPeriods').checked;
    $('applyBulkScheduleAssignment').disabled = !selectedPeriodIds.size || !$('bulkScheduleTeacher').value;
  }
  $('selectAllPeriods')?.addEventListener('change', () => {
    const visible = periods.filter(p => user.role !== 'DEPARTMENT_HEAD' || String(p.departmentId) === String(user.departmentId));
    visible.forEach(p => $('selectAllPeriods').checked ? selectedPeriodIds.add(String(p.periodId)) : selectedPeriodIds.delete(String(p.periodId)));
    renderPeriods(); updatePeriodBatchUi();
  });
  $('bulkScheduleTeacher')?.addEventListener('change', updatePeriodBatchUi);
  $('applyBulkScheduleAssignment')?.addEventListener('click', async () => {
    if (!selectedPeriodIds.size || !$('bulkScheduleTeacher').value) return;
    if (!await AppDialog.confirm('Assign the selected ' + selectedPeriodIds.size + ' schedules to this teacher?', { title: 'Assign class schedules', confirmText: 'Assign schedules' })) return;
    $('applyBulkScheduleAssignment').disabled = true; $('bulkScheduleFeedback').textContent = 'Checking department access and timetable conflicts…';
    try {
      const result = await api('/api/periods/bulk-assignments', { method:'POST', body:JSON.stringify({
        periodIds:[...selectedPeriodIds], teacherUserId:$('bulkScheduleTeacher').value
      }) });
      selectedPeriodIds.clear(); $('bulkScheduleFeedback').textContent = result.assigned + ' schedules assigned to ' + result.teacher + '.';
      await loadSchoolData(); showToast(result.assigned + ' schedules assigned.');
    } catch (error) { $('bulkScheduleFeedback').textContent = error.message; showToast(error.message,true); }
    finally { updatePeriodBatchUi(); }
  });

    function selectedScheduleTeacher() {
    if (user.role === 'TEACHER') {
      return {
        userId: user.userId,
        displayName: user.displayName || user.username,
        departmentId: user.departmentId,
        departmentName: user.departmentName || user.departmentCode || 'Department not assigned'
      };
    }
    return teachers.find(item => String(item.userId) === String($('periodTeacher')?.value)) || null;
  }

  async function loadScheduleSubjects(preferredSubjectId = '') {
    const teacher = selectedScheduleTeacher();
    const select = $('periodSubject');
    const hint = $('periodSubjectHint');
    if (!select) return;
    select.disabled = true;
    select.innerHTML = '<option value="">Loading department subjects…</option>';
    if (!teacher?.departmentId) {
      select.innerHTML = '<option value="">Choose an assigned teacher first</option>';
      if (hint) hint.textContent = 'The selected teacher needs an active department assignment before a subject can be selected.';
      return;
    }
    try {
      const query = user.role === 'SCHOOL_ADMIN'
        ? '?departmentId=' + encodeURIComponent(teacher.departmentId)
        : '';
      const result = await api('/api/subjects' + query);
      const subjects = result.subjects || [];
      select.innerHTML = '<option value="">Select subject</option>' +
        subjects.map(item => '<option value="' + esc(item.subjectId) + '">' + esc(item.subjectName) + '</option>').join('');
      if (preferredSubjectId && subjects.some(item => String(item.subjectId) === String(preferredSubjectId))) {
        select.value = preferredSubjectId;
      }
      select.disabled = subjects.length === 0;
      if (hint) hint.textContent = subjects.length
        ? subjects.length + ' subjects available for the selected teacher.'
        : (user.role === 'TEACHER'
          ? 'No subjects have been added to your department. Ask the School Administrator or Department Head to add one.'
          : 'No subjects are listed in this department yet. Use Add subject to create the department catalogue.');
    } catch (error) {
      select.innerHTML = '<option value="">Could not load subjects</option>';
      select.disabled = true;
      if (hint) hint.textContent = error.message;
    }
  }

  async function loadScheduleSections(gradeLevel, preferredSection = '') {
    const select = $('periodSection');
    const hint = $('periodSectionHint');
    if (!select) return;
    select.disabled = true;
    select.innerHTML = '<option value="">Loading sections…</option>';
    try {
      const result = await api('/api/sections?gradeLevel=' + encodeURIComponent(gradeLevel));
      const sections = result.sections || [];
      select.innerHTML = '<option value="">Select section</option>' +
        sections.map(item => '<option value="' + esc(item) + '">' + esc(item) + '</option>').join('');
      if (preferredSection && sections.includes(preferredSection)) select.value = preferredSection;
      select.disabled = sections.length === 0;
      if (hint) hint.textContent = sections.length
        ? sections.length + ' existing section' + (sections.length === 1 ? '' : 's') + ' found for ' + gradeLevel + '.'
        : 'No sections found for this grade. Add or enroll learners, or create an approved section first.';
    } catch (error) {
      select.innerHTML = '<option value="">Could not load sections</option>';
      select.disabled = true;
      if (hint) hint.textContent = error.message;
    }
  }

  $('periodTeacher')?.addEventListener('change', () => {
    $('periodTeacherHint').textContent = 'Loading this teacher’s subject catalogue…';
    loadScheduleSubjects();
  });
  $('periodGrade')?.addEventListener('change', () => loadScheduleSections($('periodGrade').value));
  $('addScheduleSubject')?.addEventListener('click', async () => {
    const teacher = selectedScheduleTeacher();
    if (!teacher?.departmentId) { showToast('Choose an assigned Subject Teacher first.', true); return; }
    const subjectName = await AppDialog.prompt('Add a subject to the selected teacher’s department. Existing subjects are reused; duplicate names are not allowed.', '', {
      title: 'Add department subject', label: 'Subject name', placeholder: 'e.g. Mathematics', required: true, maxLength: 120
    });
    if (subjectName === null) return;
    const button = $('addScheduleSubject');
    button.disabled = true;
    try {
      const result = await api('/api/subjects', {
        method: 'POST',
        body: JSON.stringify({ departmentId: teacher.departmentId, subjectName: subjectName.trim() })
      });
      await loadScheduleSubjects(result.subject.subjectId);
      showToast(result.subject.subjectName + ' added to ' + (teacher.departmentName || 'the department') + '.');
    } catch (error) {
      showToast(error.message, true);
      if (/already exists/i.test(error.message)) await loadScheduleSubjects();
    } finally {
      button.disabled = false;
    }
  });

  $('showScheduleForm').addEventListener('click', async () => {
    const opening = $('scheduleForm').hidden;
    $('scheduleForm').hidden = !opening;
    if (!opening) return;
    $('scheduleFormFeedback').textContent = '';
    if (user.role !== 'TEACHER') {
      const eligible = teachers.filter(item => item.active && (item.teacherDesignations || []).includes('SUBJECT_TEACHER') &&
        (user.role !== 'DEPARTMENT_HEAD' || String(item.departmentId) === String(user.departmentId)));
      $('periodTeacher').innerHTML = '<option value="">Choose active Subject Teacher</option>' +
        eligible.map(item => '<option value="' + esc(item.userId) + '">' + esc(item.displayName) + '</option>').join('');
      $('periodTeacher').value = eligible.length === 1 ? String(eligible[0].userId) : '';
    }
    await loadScheduleSubjects();
    await loadScheduleSections($('periodGrade').value);
  });
  $('cancelScheduleForm').addEventListener('click', () => {
    $('scheduleForm').reset();
    $('scheduleForm').hidden = true;
    $('scheduleFormFeedback').textContent = '';
    if ($('periodSubject')) { $('periodSubject').innerHTML = '<option value="">Choose teacher first</option>'; $('periodSubject').disabled = true; }
    if ($('periodSection')) { $('periodSection').innerHTML = '<option value="">Select grade first</option>'; $('periodSection').disabled = true; }
    $('periodTeacherHint').textContent = 'Department and available subjects are determined automatically from the teacher profile.';
  });
  $('scheduleForm').addEventListener('submit', async event => {
    event.preventDefault();
    const feedback = $('scheduleFormFeedback');
    feedback.className = 'inline-feedback';
    feedback.textContent = 'Checking the class, teacher, and room timetable…';
    const teacher = selectedScheduleTeacher();
    const payload = {
      teacherUserId: teacher?.userId || '',
      subjectId: $('periodSubject').value,
      periodName: $('periodName').value.trim(),
      gradeLevel: $('periodGrade').value,
      section: $('periodSection').value.trim(),
      classroom: $('periodClassroom').value.trim() || null,
      startTime: $('startTime').value,
      endTime: $('endTime').value,
      graceMinutes: Number($('graceMinutes').value || 0)
    };
    try {
      const saved = await api('/api/periods', { method: 'POST', body: JSON.stringify(payload) });
      $('scheduleForm').reset();
      $('scheduleForm').hidden = true;
      if ($('periodSubject')) { $('periodSubject').innerHTML = '<option value="">Choose teacher first</option>'; $('periodSubject').disabled = true; }
      if ($('periodSection')) { $('periodSection').innerHTML = '<option value="">Select grade first</option>'; $('periodSection').disabled = true; }
      await loadSchoolData();
      showToast('Schedule saved and assigned to ' + (saved.teacher || teacher?.displayName || 'the selected teacher') + '.');
    } catch (error) {
      feedback.className = 'inline-feedback error';
      feedback.textContent = error.message;
    }
  });



  $('teacherGateDate')?.addEventListener('change', async () => {
    try { await loadGateMonitoring(); } catch (error) { showToast(error.message, true); }
  });

  if ($('newAccountRole')) {
    const refreshDesignationFields = () => {
      $('teacherDesignationFields').hidden = $('newAccountRole').value !== 'TEACHER';
    };
    $('newAccountRole').addEventListener('change', refreshDesignationFields);
    refreshDesignationFields();
  }

  if ($('adviserAssignmentForm')) {
    $('adviserAssignmentForm').addEventListener('submit', async event => {
      event.preventDefault();
      const feedback = $('adviserAssignmentFeedback');
      feedback.className = 'inline-feedback';
      feedback.textContent = 'Saving assignment…';
      const payload = { adviserUserId: $('adviserTeacherSelect').value, gradeLevel: $('adviserGradeInput').value, section: $('adviserSectionInput').value.trim() };
      try {
        await api('/api/class-adviser-assignments', { method: 'POST', body: JSON.stringify(payload) });
        $('adviserAssignmentForm').reset();
        await loadSchoolData();
        feedback.textContent = 'Class Adviser assignment saved.';
      } catch (error) { feedback.className = 'inline-feedback error'; feedback.textContent = error.message; }
    });
    $('adviserAssignmentRows').addEventListener('click', async event => {
      const editButton = event.target.closest('[data-edit-adviser]');
      if (editButton) {
        const assignment = adviserAssignments.find(item => String(item.assignmentId) === String(editButton.dataset.editAdviser));
        if (!assignment) return;
        const activeAdvisers = teachers.filter(item => item.active && Array.isArray(item.teacherDesignations) && item.teacherDesignations.includes('CLASS_ADVISER'));
        const values = await AppDialog.form(
          'Update the adviser, grade level, or section. One Class Adviser may be assigned to each grade-and-section combination.',
          [
            { name: 'adviserUserId', label: 'Class Adviser', required: true, defaultValue: String(assignment.adviserUserId),
              selectOptions: activeAdvisers.map(item => ({ value: String(item.userId), label: item.displayName })) },
            { name: 'gradeLevel', label: 'Grade level', required: true, defaultValue: assignment.gradeLevel, maxLength: 40,
              validate: value => String(value).trim().length <= 40 || 'Grade level must be 40 characters or fewer.' },
            { name: 'section', label: 'Section', required: true, defaultValue: assignment.section, maxLength: 100,
              validate: value => String(value).trim().length <= 100 || 'Section must be 100 characters or fewer.' }
          ],
          { title: 'Edit Class Adviser assignment', confirmText: 'Save changes' }
        );
        if (values === null) return;
        editButton.disabled = true;
        try {
          await api('/api/class-adviser-assignments/' + encodeURIComponent(assignment.assignmentId), {
            method: 'PATCH',
            body: JSON.stringify({ adviserUserId: values.adviserUserId, gradeLevel: values.gradeLevel.trim(), section: values.section.trim() })
          });
          await loadSchoolData();
          showToast('Class Adviser assignment updated.');
        } catch (error) {
          showToast(error.message, true);
          editButton.disabled = false;
        }
        return;
      }
      const button = event.target.closest('[data-remove-adviser]');
      if (!button) return;
      if (!await AppDialog.confirm('Remove this Class Adviser assignment? The teacher account and attendance history will remain unchanged.', {
        title: 'Remove Class Adviser assignment', confirmText: 'Remove assignment', variant: 'danger'
      })) return;
      button.disabled = true;
      try {
        await api('/api/class-adviser-assignments/' + encodeURIComponent(button.dataset.removeAdviser), { method: 'DELETE' });
        await loadSchoolData();
        showToast('Class Adviser assignment removed.');
      } catch (error) {
        showToast(error.message, true);
        button.disabled = false;
      }
    });
  }

  if ($('showTeacherForm')) {
    const updateDesignationVisibility = () => {
      const selectedRole = $('newAccountRole')?.value || '';
      const isTeacherAccount = selectedRole === 'TEACHER';
      const needsDepartment = ['TEACHER', 'DEPARTMENT_HEAD'].includes(selectedRole);
      $('teacherDesignationFields').hidden = !isTeacherAccount;
      $('newTeacherDepartmentGroup').hidden = !needsDepartment;
      $('newTeacherDepartment').required = needsDepartment;
      if (!isTeacherAccount) {
        $('designationSubjectTeacher').checked = false;
        $('designationClassAdviser').checked = false;
      } else if (!$('designationSubjectTeacher').checked && !$('designationClassAdviser').checked) {
        $('designationSubjectTeacher').checked = true;
      }
    };
    $('newAccountRole').addEventListener('change', updateDesignationVisibility);
    updateDesignationVisibility();
    $('showTeacherForm').addEventListener('click', () => {
      $('teacherForm').hidden = !$('teacherForm').hidden;
    });
    $('cancelTeacherForm').addEventListener('click', () => {
      $('teacherForm').reset();
      updateDesignationVisibility();
      $('teacherForm').hidden = true;
      $('teacherFormFeedback').textContent = '';
      $('teacherFormFeedback').className = 'inline-feedback';
    });
    $('teacherForm').addEventListener('submit', async event => {
      event.preventDefault();
      const feedback = $('teacherFormFeedback');
      feedback.className = 'inline-feedback';
      const username = $('newTeacherUsername').value.trim();
      const displayName = $('newTeacherName').value.trim();
      const password = $('newTeacherPassword').value;
      const confirm = $('confirmTeacherPassword').value;
      if (password !== confirm) {
        feedback.className = 'inline-feedback error';
        feedback.textContent = 'Passwords do not match.';
        return;
      }
      if (password.length < 12) {
        feedback.className = 'inline-feedback error';
        feedback.textContent = 'Password must be at least 12 characters.';
        return;
      }
      $('saveTeacherButton').disabled = true;
      feedback.textContent = 'Creating account…';
      try {
        const role = $('newAccountRole').value;
        const teacherDesignations = role === 'TEACHER'
          ? [
              $('designationSubjectTeacher').checked ? 'SUBJECT_TEACHER' : null,
              $('designationClassAdviser').checked ? 'CLASS_ADVISER' : null
            ].filter(Boolean)
          : [];
        if (role === 'TEACHER' && !teacherDesignations.length) throw new Error('Select Subject Teacher, Class Adviser, or both.');
        const departmentId = $('newTeacherDepartment').value || null;
        if (['TEACHER', 'DEPARTMENT_HEAD'].includes(role) && !departmentId) throw new Error('Select a department for this account.');
        await api('/api/school-users', {
          method: 'POST',
          body: JSON.stringify({ username, displayName, password, role, teacherDesignations, departmentId })
        });
        $('teacherForm').reset();
        updateDesignationVisibility();
        $('teacherForm').hidden = true;
        await loadSchoolData();
        showToast(`${role.replaceAll('_', ' ')} account created. Save the username and give the initial password securely.`);
      } catch (error) {
        feedback.className = 'inline-feedback error';
        feedback.textContent = error.message;
      } finally {
        $('saveTeacherButton').disabled = false;
      }
    });

    $('teacherRows').addEventListener('click', async event => {
      const selectedMenuAction = event.target.closest('.teacher-action-item');
      if (selectedMenuAction) selectedMenuAction.closest('details.teacher-action-menu')?.removeAttribute('open');
      const designationButton = event.target.closest('[data-edit-designations]');
      const manageAssignmentsButton = event.target.closest('[data-manage-permanent]');
      const leaveButton = event.target.closest('[data-place-leave]');
      const profileButton = event.target.closest('[data-edit-teacher-profile]');
      if (profileButton) {
        const teacher = teachers.find(item => String(item.userId) === String(profileButton.dataset.editTeacherProfile));
        if (!teacher) return;
        const values = await AppDialog.form('Update the teacher display name. Department and teacher permissions can be managed separately without replacing the account or QR identity.',
          [{ name: 'displayName', label: 'Display name', defaultValue: teacher.displayName || '', required: true, maxLength: 160 }],
          { title: 'Edit teacher account', confirmText: 'Save account' });
        if (values === null) return;
        profileButton.disabled = true;
        try {
          await api('/api/teachers/' + encodeURIComponent(teacher.userId), { method: 'PATCH', body: JSON.stringify({ displayName: values.displayName.trim() }) });
          await loadSchoolData();
          showToast('Teacher account updated. Existing teacher QR identity and schedules were preserved.');
        } catch (error) { showToast(error.message, true); profileButton.disabled = false; }
        return;
      }
      const teacherQrButton = event.target.closest('[data-teacher-qr]');
      if (teacherQrButton) {
        try { await printTeacherGateQr(teacherQrButton.dataset.teacherQr); }
        catch (error) { showToast(error.message, true); }
        return;
      }
      if (designationButton) {
        const teacher = teachers.find(item => String(item.userId) === String(designationButton.dataset.editDesignations));
        if (!teacher) return;
        const currentValues = teacher.teacherDesignations || [];
        const current = currentValues.includes('SUBJECT_TEACHER') && currentValues.includes('CLASS_ADVISER')
          ? 'BOTH' : currentValues[0] || '';
        const answer = await AppDialog.prompt('Choose the designation for this teacher account.', current, {
          title: 'Edit teacher designations',
          label: 'Teacher designation',
          helpText: 'Choose Subject Teacher, Class Adviser, or both. Existing subject schedule assignments are preserved.',
          placeholder: 'Choose a designation',
          required: true,
          selectOptions: [
            { value: 'SUBJECT_TEACHER', label: 'Subject Teacher — handles assigned subject schedules' },
            { value: 'CLASS_ADVISER', label: 'Class Adviser — handles an assigned section and SF2' },
            { value: 'BOTH', label: 'Both — Subject Teacher and Class Adviser' }
          ]
        });
        if (answer === null) return;
        const designations = answer === 'BOTH' ? ['SUBJECT_TEACHER', 'CLASS_ADVISER'] : [answer];
        try {
          await api(`/api/teachers/${encodeURIComponent(teacher.userId)}/designations`, { method: 'PATCH', body: JSON.stringify({ teacherDesignations: designations }) });
          await loadSchoolData();
          showToast('Teacher designations updated. Existing subject assignments remain unchanged.');
        } catch (error) { showToast(error.message, true); }
        return;
      }
      const returnButton = event.target.closest('[data-return-teacher]');
      const deactivateButton = event.target.closest('[data-deactivate-teacher]');
      const substituteButton = event.target.closest('[data-assign-substitute]');
      const cancelSubstitutionButton = event.target.closest('[data-cancel-substitution]');
      if (manageAssignmentsButton) {
        const teacherId = manageAssignmentsButton.dataset.managePermanent;
        const teacher = teachers.find(item => String(item.userId) === String(teacherId));
        if (teacher) openPermanentAssignmentDialog(teacher, manageAssignmentsButton);
      } else if (substituteButton) {
        const teacherId = substituteButton.dataset.assignSubstitute;
        const teacher = teachers.find(item => String(item.userId) === String(teacherId));
        if (teacher) openSubstituteDialog(teacher, substituteButton);
      } else if (cancelSubstitutionButton) {
        const substitutionId = cancelSubstitutionButton.dataset.cancelSubstitution;
        if (!await AppDialog.confirm('Cancel this temporary substitute assignment? The original teacher’s permanent schedule will remain unchanged.', { title: 'Cancel substitute assignment', confirmText: 'Cancel assignment', variant: 'danger' })) return;
        cancelSubstitutionButton.disabled = true;
        try {
          await api(`/api/teacher-substitutions/${encodeURIComponent(substitutionId)}`, { method: 'DELETE' });
          await loadSchoolData();
          showToast('Temporary substitute assignment cancelled.');
        } catch (error) {
          showToast(error.message, true);
          cancelSubstitutionButton.disabled = false;
        }
      } else if (leaveButton) {
        const teacherId = leaveButton.dataset.placeLeave;
        const teacher = teachers.find(item => String(item.userId) === String(teacherId));
        openTeacherLeaveDialog(teacherId, teacher?.displayName || 'Teacher', leaveButton);
      } else if (returnButton) {
        const teacherId = returnButton.dataset.returnTeacher;
        if (!await AppDialog.confirm('Mark this teacher as returned and restore login access? Previous class assignments will be preserved.', { title: 'Return teacher to active status', confirmText: 'Restore access' })) return;
        returnButton.disabled = true;
        try {
          await api(`/api/teachers/${encodeURIComponent(teacherId)}/return`, { method: 'POST' });
          await loadSchoolData();
          showToast('Teacher account reactivated. Previous class assignments are available again.');
        } catch (error) {
          showToast(error.message, true);
          returnButton.disabled = false;
        }
      } else if (deactivateButton) {
        const teacherId = deactivateButton.dataset.deactivateTeacher;
        if (!await AppDialog.confirm('Deactivate this teacher account permanently? Login will be disabled, but historical attendance and schedule assignments will be preserved.', { title: 'Deactivate teacher account', confirmText: 'Deactivate account', variant: 'danger' })) return;
        const button = deactivateButton;
        button.disabled = true;
        try {
          await api(`/api/teachers/${encodeURIComponent(teacherId)}`, {
            method: 'PATCH', body: JSON.stringify({ active: false })
          });
          await loadSchoolData();
          showToast('Teacher account deactivated.');
        } catch (error) {
          showToast(error.message, true);
          button.disabled = false;
        }
      }
    });
  }

  if ($('studentAccountForm')) {
    const closeStudentAccount = () => { $('studentAccountModal').hidden = true; $('studentAccountForm').reset(); };
    $('closeStudentAccount').addEventListener('click', closeStudentAccount);
    $('studentAccountModal').addEventListener('click', event => { if (event.target === $('studentAccountModal')) closeStudentAccount(); });
    $('studentAccountForm').addEventListener('submit', async event => {
      event.preventDefault();
      const feedback = $('studentAccountFeedback');
      const studentId = $('studentAccountStudentId').value;
      const username = $('studentAccountUsername').value.trim();
      const password = $('studentAccountPassword').value;
      const confirmation = $('studentAccountConfirm').value;
      feedback.className = 'inline-feedback';
      if (password.length < 12) { feedback.className = 'inline-feedback error'; feedback.textContent = 'Use at least 12 characters for the password.'; return; }
      if (password !== confirmation) { feedback.className = 'inline-feedback error'; feedback.textContent = 'The passwords do not match.'; return; }
      $('saveStudentAccount').disabled = true;
      feedback.textContent = studentAccountMode === 'CREATE' ? 'Creating student login…' : 'Resetting student password…';
      try {
        if (studentAccountMode === 'CREATE') {
          await api(`/api/students/${encodeURIComponent(studentId)}/account`, { method: 'POST', body: JSON.stringify({ username, password }) });
          showToast('Student portal account created. Give the initial credentials to the student securely.');
        } else {
          await api(`/api/students/${encodeURIComponent(studentId)}/account/password`, { method: 'PUT', body: JSON.stringify({ password }) });
          showToast('Student password reset. The student must change it after sign-in.');
        }
        closeStudentAccount();
        await loadSchoolData();
      } catch (error) {
        feedback.className = 'inline-feedback error';
        feedback.textContent = error.message;
      } finally { $('saveStudentAccount').disabled = false; }
    });
  }


  $('departmentForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const feedback = $('departmentFormFeedback');
    feedback.className = 'inline-feedback';
    feedback.textContent = 'Saving department…';
    const payload = {
      code: $('departmentCode').value.trim(),
      name: $('departmentName').value.trim(),
      description: $('departmentDescription').value.trim() || null
    };
    try {
      await api('/api/departments', { method: 'POST', body: JSON.stringify(payload) });
      $('departmentForm').reset();
      await loadSchoolData();
      feedback.textContent = 'Department created. You can now assign teachers and schedules.';
      showToast('Department added.');
    } catch (error) {
      feedback.className = 'inline-feedback error';
      feedback.textContent = error.message;
    }
  });

  $('departmentList')?.addEventListener('click', async event => {
    const button = event.target.closest('[data-edit-department]');
    if (!button) return;
    const department = departments.find(item => String(item.departmentId) === String(button.dataset.editDepartment));
    if (!department || department.code === 'UNASSIGNED') return;
    const values = await AppDialog.form(
      'Update the department code, name, description, and status. Department codes must remain unique. A department with active staff or schedules cannot be deactivated.',
      [
        { name: 'code', label: 'Department code', defaultValue: department.code, required: true, maxLength: 20,
          helpText: '2–20 characters: letters, numbers, underscores, or hyphens.',
          validate: value => /^[A-Za-z0-9_-]{2,20}$/.test(String(value).trim()) || 'Use 2–20 letters, numbers, underscores, or hyphens.' },
        { name: 'name', label: 'Department name', defaultValue: department.name, required: true, maxLength: 100 },
        { name: 'description', label: 'Description', inputType: 'textarea', rows: 3, defaultValue: department.description || '', maxLength: 500,
          helpText: 'Optional. Up to 500 characters.' },
        { name: 'active', label: 'Status', selectOptions: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }],
          defaultValue: department.active ? 'true' : 'false', required: true }
      ],
      { title: 'Edit department', confirmText: 'Save department' }
    );
    if (values === null) return;
    button.disabled = true;
    try {
      await api('/api/departments/' + encodeURIComponent(department.departmentId), {
        method: 'PATCH',
        body: JSON.stringify({ code: values.code.trim(), name: values.name.trim(), description: values.description.trim(), active: values.active === 'true' })
      });
      await loadSchoolData();
      showToast('Department details updated.');
    } catch (error) {
      showToast(error.message, true);
      button.disabled = false;
    }
  });

  $('teacherRows')?.addEventListener('change', async event => {
    const select = event.target.closest('[data-change-teacher-department]');
    if (!select) return;
    const teacherId = select.dataset.changeTeacherDepartment;
    const previousDepartment = teachers.find(item => String(item.userId) === String(teacherId))?.departmentId;
    select.disabled = true;
    try {
      await api(`/api/school-users/${encodeURIComponent(teacherId)}/department`, {
        method: 'PATCH', body: JSON.stringify({ departmentId: select.value })
      });
      await loadSchoolData();
      showToast('Teacher department updated.');
    } catch (error) {
      showToast(error.message, true);
      select.value = previousDepartment || '';
      select.disabled = false;
    }
  });

  $('staffUserRows')?.addEventListener('click', async event => {
    const button = event.target.closest('[data-edit-staff-profile]');
    if (!button) return;
    const account = schoolUsers.find(item => String(item.userId) === String(button.dataset.editStaffProfile));
    if (!account) return;
    const values = await AppDialog.form(
      'Update the display name or disable/restore sign-in access. Account role and department remain separately controlled.',
      [
        { name: 'displayName', label: 'Display name', defaultValue: account.displayName || '', required: true, maxLength: 160 },
        { name: 'active', label: 'Account access', defaultValue: account.active ? 'true' : 'false', required: true,
          selectOptions: [{ value: 'true', label: 'Active — sign-in allowed' }, { value: 'false', label: 'Inactive — sign-in disabled' }] }
      ],
      { title: 'Edit staff account', confirmText: 'Save account' }
    );
    if (values === null) return;
    button.disabled = true;
    try {
      await api('/api/school-users/' + encodeURIComponent(account.userId) + '/profile', { method: 'PATCH', body: JSON.stringify({ displayName: values.displayName.trim(), active: values.active === 'true' }) });
      await loadSchoolData();
      showToast('Staff account updated.');
    } catch (error) {
      showToast(error.message, true);
      button.disabled = false;
    }
  });
  $('staffUserRows')?.addEventListener('change', async event => {
    const select = event.target.closest('[data-change-staff-department]');
    if (!select) return;
    const userId = select.dataset.changeStaffDepartment;
    const previousDepartment = schoolUsers.find(item => String(item.userId) === String(userId))?.departmentId;
    select.disabled = true;
    try {
      await api(`/api/school-users/${encodeURIComponent(userId)}/department`, {
        method: 'PATCH', body: JSON.stringify({ departmentId: select.value })
      });
      await loadSchoolData();
      showToast('Department Head department updated.');
    } catch (error) {
      showToast(error.message, true);
      select.value = previousDepartment || '';
      select.disabled = false;
    }
  });

  

$('teacherCoverageRows')?.addEventListener('click', async event => {
    const button = event.target.closest('[data-coverage-action]');
    if (!button) return;
    await handleCoverageAction(button.dataset.coverageAction, button);
  });

  $('refreshTeacherCoverage')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await loadTeacherCoverage(false);
      showToast('Teacher coverage refreshed.');
    } catch (error) {
      showToast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  $('enableCoverageNotifications')?.addEventListener('click', async () => {
    if (!('Notification' in window)) {
      showToast('This browser does not support desktop notifications. The in-page alert list will still work.', true);
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        showToast('Teacher coverage browser notifications are enabled.');
        await loadTeacherCoverage(false);
      } else {
        showToast('Browser notifications were not enabled. Keep the portal open to see in-page coverage alerts.', true);
      }
    } catch {
      showToast('Could not enable browser notifications. Check your browser site settings.', true);
    }
  });

  init().then(() => {
    if ($('studentForm') && !$('studentForm').hidden) loadSectionsForGrade($('newGrade').value);
    if (['SCHOOL_ADMIN','DEPARTMENT_HEAD'].includes(user?.role)) {
      window.setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        loadTeacherCoverage(true).catch(error => console.warn('Teacher coverage refresh failed:', error.message));
      }, 60000);
    }
  }).catch(error => showToast(error.message || 'Portal initialization failed.', true));
})();
