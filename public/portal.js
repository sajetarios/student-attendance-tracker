(() => {
  const tokenKey = 'schoolAttendance.accessToken';
  const userKey = 'schoolAttendance.user';
  const token = sessionStorage.getItem(tokenKey);
  let user = null;
  let schoolEntitlements = null;
  let dashboardData = null;
  let students = [];
  let periods = [];
  let activeScheduleDisplay = 'weekly';
  let timetableTemplates = [];
  let calendarExceptionItems = [];
  let scheduleAdjustments = [];
  let schoolOperatingDays = [];
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
  let teacherCoverageSummary = null;
  let activeCoverageTab = 'MY_DEPARTMENT';
  let coverageAlertKeys = new Set();
  let coverageMonitorInitialized = false;
  let activeScanScope = 'SCHOOL';
  let activeScanPeriodId = null;
  let schoolBranding = null;
  let brandingLogoObjectUrl = null;


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

  async function uploadStudentPhoto(studentId, file, preparedPhoto = null) {
    const photo = preparedPhoto || (file && await window.ProfilePhotos.edit(file));
    if (!photo) return false;
    await window.ProfilePhotos.post(`/api/photos/official/student/${encodeURIComponent(studentId)}`, token, photo);
    return true;
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

  function showScanErrorModal(message, title = 'Attendance not recorded') {
    let modal = $('studentScanErrorModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'studentScanErrorModal';
      modal.className = 'student-scan-error-overlay';
      modal.setAttribute('role', 'alertdialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'studentScanErrorTitle');
      modal.innerHTML = `
        <section class="student-scan-error-dialog">
          <div class="student-scan-error-icon" aria-hidden="true">!</div>
          <p class="student-scan-error-kicker">SCAN ERROR</p>
          <h3 id="studentScanErrorTitle">Attendance not recorded</h3>
          <p class="student-scan-error-message"></p>
          <div class="student-scan-error-actions">
            <button type="button" class="outline-button" data-scan-error-close>Close</button>
            <button type="button" class="primary-button" data-scan-error-next>Scan another student</button>
          </div>
        </section>`;
      document.body.append(modal);
      modal.querySelector('[data-scan-error-close]').addEventListener('click', () => { modal.hidden = true; });
      modal.querySelector('[data-scan-error-next]').addEventListener('click', () => {
        scannedStudent = null;
        scannedTeacher = null;
        if ($('studentScanNotice')) $('studentScanNotice').hidden = true;
        if ($('studentScanResult')) $('studentScanResult').hidden = true;
        if ($('studentScanFeedback')) {
          $('studentScanFeedback').textContent = 'Ready for the next QR code.';
          $('studentScanFeedback').className = 'scanner-feedback';
        }
        modal.hidden = true;
      });
      modal.addEventListener('click', event => { if (event.target === modal) modal.hidden = true; });
    }
    modal.querySelector('#studentScanErrorTitle').textContent = title;
    modal.querySelector('.student-scan-error-message').textContent = String(message || 'The scan could not be completed. Please try again.');
    modal.hidden = false;
    modal.querySelector('[data-scan-error-close]')?.focus();
  }

  function teacherHas(designation) {
    return user?.role === 'TEACHER' && Array.isArray(user.teacherDesignations) && user.teacherDesignations.includes(designation);
  }

  function allowedViewsForUser() {
    const role = user?.role;
    if (role === 'SCHOOL_ADMIN') return ['dashboard', 'students', 'studentAccounts', 'teachers', 'schedules', 'cloudSync', 'schoolBranding'];
    if (role === 'DEPARTMENT_HEAD') return ['dashboard', 'planner', 'students', 'teachers', 'schedules', 'sf2'];
    if (role === 'TEACHER') {
      const views = ['dashboard', 'planner'];
      if (teacherHas('SUBJECT_TEACHER') || teacherHas('CLASS_ADVISER')) {
        views.push('students', 'studentAccounts', 'classAttendance');
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
      const pages = {
        platform: ['overview', 'Platform overview', 'Platform administration and performance'],
        platformSchools: ['schoolDirectory', 'Schools', 'Manage registered schools and their status'],
        platformOnboard: ['schools', 'Onboard school', 'Create a school and its administrator'],
        platformPlans: ['plans', 'Plans & feature access', 'Subscription plans, quotas and audit history'],
        platformSecurity: ['security', 'Account security', 'School Admin recovery center']
      };
      if (!pages[view]) view = 'platform';
      const [panel, heading, description] = pages[view];
      document.querySelectorAll('#platformWorkspace .platform-tab-panel').forEach(item => {
        item.hidden = item.dataset.platformTab !== panel;
      });
      document.querySelectorAll('.side-nav .nav-item[data-view]').forEach(item => {
        const active = item.dataset.view === view;
        item.classList.toggle('active', active);
        if (active) item.setAttribute('aria-current', 'page');
        else item.removeAttribute('aria-current');
      });
      $('breadcrumbCurrent').textContent = heading;
      if ($('pageTitle')) $('pageTitle').textContent = heading;
      if ($('pageSubtitle')) $('pageSubtitle').textContent = description;
      document.querySelector('.sidebar')?.classList.remove('mobile-open');
      return;
    }
    const allowedViews = allowedViewsForUser().filter(name => (name !== 'planner' || schoolEntitlements?.features?.planner !== false) && (name !== 'schoolBranding' || schoolEntitlements?.features?.custom_branding !== false));
    const departmentHead = user?.role === 'DEPARTMENT_HEAD';
    // Department Heads may view the school-wide roster; write access remains restricted.
    if (!allowedViews.includes(view)) view = allowedViews.includes('dashboard') ? 'dashboard' : (allowedViews[0] || 'dashboard');
    $('platformWorkspace').hidden = true;
    $('schoolWorkspace').hidden = false;
    ['dashboard', 'students', 'studentAccounts', 'schedules', 'teachers', 'sf2', 'classAttendance', 'cloudSync', 'schoolBranding', 'planner'].forEach(name => {
      const panel = $(`${name}View`);
      if (panel) panel.hidden = name !== view;
    });
    document.querySelectorAll('.nav-item').forEach(button => {
      button.classList.toggle('active', button.dataset.view === view);
    });
    const activeNav = document.querySelector('.nav-item[data-view="' + view + '"]');
    const activeGroup = activeNav?.closest('.nav-group');
    if (activeGroup) {
      const groupToggle = activeGroup.querySelector('.nav-group-toggle[data-nav-group]');
      const submenu = activeGroup.querySelector('.nav-submenu');
      if (groupToggle) groupToggle.setAttribute('aria-expanded', 'true');
      if (submenu) submenu.hidden = false;
    }

    const role = user?.role;
    const gateKeeper = role === 'GATE_KEEPER';
    const subjectTeacher = teacherHas('SUBJECT_TEACHER');
    const classAdviser = teacherHas('CLASS_ADVISER');
    let titles;
    if (departmentHead) {
      titles = {
        dashboard: ['Department Head Dashboard', 'Monitor learner attendance, teacher availability, class coverage, schedules, and section report progress.'],
        students: ['Student roster · Department scope', 'View learners school-wide and manage approved bulk changes only within your own scheduled sections. Individual identity details remain editable by authorized staff.'],
        teachers: ['Teachers & Staff', 'Review department teachers and staff, their designations, assigned sections, leave, schedules, and temporary coverage.'],
        planner: ['Planner', 'Organize departmental meetings, shared deadlines, and your own tasks without changing the official timetable.'],
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
        studentAccounts: ['Student portal account requests', 'Request logins and password recovery for your authorized learners. School Admin approval is required.'],
        planner: ['My Planner', 'Plan lessons, tasks, personal meetings and reminders around assigned class schedules.'],
        schedules: ['My teaching and advisory schedules', 'View your assigned teaching periods, active substitute assignments, and advisory class timetable.'],
        sf2: [classAdviser && subjectTeacher ? 'My SF2 reports' : classAdviser ? 'Official section SF2' : 'Personal SF2 copy', classAdviser ? 'Generate the official consolidated section SF2 only for sections assigned to you as Class Adviser.' : 'Generate a personal attendance copy from your own subject-period records.'],
        classAttendance: ['Class attendance', classAdviser && subjectTeacher ? 'Review your advisory section and the other sections covered by your assigned subject schedules.' : classAdviser ? 'Review attendance for your assigned advisory section.' : 'Review attendance in the sections covered by your assigned subject schedules.']
      };
    } else {
      titles = {
        dashboard: ['School Administrator Dashboard', 'Manage school attendance operations, users, learner records, devices, schedules, and reporting.'],
        students: ['Student management', 'Register learners, maintain student details and photos, create student portal accounts, and manage QR cards.'],
        studentAccounts: ['Student Portal Accounts', 'Issue secure learner logins, review teacher requests, and manage portal access.'],
        schedules: ['School-wide timetable and class schedules', 'Configure school timetable templates, manage class schedules, and assign teachers across departments.'],
        teachers: ['User management', 'Create and update school accounts, assign role-based access, manage departments, and disable or restore account access.'],
        sf2: ['SF2 Report Generator', 'Generate the monthly TUVERA SF2 and collect official reports submitted by Class Advisers.'],
        cloudSync: ['Cloud Sync', 'Forward accepted attendance records to your authenticated cloud server.'],
        schoolBranding: ['School identity', 'Manage the name, logo, and interface accent color for your school workspace.']
      };
    }
    const title = titles[view] || ['Dashboard', 'Attendance overview.'];
    $('viewTitle').textContent = title[0];
    $('viewDescription').textContent = title[1];
    $('breadcrumbCurrent').textContent = title[0];
    if (view === 'planner') $('plannerView')?.dispatchEvent(new Event('planner:open'));
    if (view === 'dashboard' && ['TEACHER','DEPARTMENT_HEAD'].includes(role)) $('plannerView')?.dispatchEvent(new Event('planner:dashboard'));
    if (view === 'classAttendance' && role === 'TEACHER') {
      loadTeacherClassAttendance().catch(error => {
        if ($('teacherAttendanceFeedback')) {
          $('teacherAttendanceFeedback').textContent = error.message;
          $('teacherAttendanceFeedback').className = 'inline-feedback error';
        }
      });
    }
    if ($('teacherMonitorTitle')) $('teacherMonitorTitle').textContent = departmentHead ? 'Teachers & Staff in Your Department' : 'Teacher accounts';
    if ($('teacherMonitorDescription')) $('teacherMonitorDescription').textContent = departmentHead
      ? 'Review staff designations, teacher assignments, schedules, and availability. Available actions depend on your department permissions.'
      : 'Manage teacher account profiles and access. Academic assignments are managed in the Department Head workspace.';
    if ($('teacherActionHeader')) $('teacherActionHeader').textContent = departmentHead ? 'Manage' : 'Account action';
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

  // Re-read effective permissions when returning to the portal after a Super Admin plan change.
  async function refreshSchoolEntitlements() {
    if (!token || !user || user.role === 'SUPER_ADMIN') return;
    try {
      const latest = await api('/api/school/entitlements');
      schoolEntitlements = latest;
      applyRoleNavigation();
    } catch (error) {
      console.warn('Unable to refresh school feature access:', error.message);
    }
  }
  window.addEventListener('pageshow', () => { if (user && user.role !== 'SUPER_ADMIN') refreshSchoolEntitlements(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && user && user.role !== 'SUPER_ADMIN') refreshSchoolEntitlements();
  });

  function updateSmsAccessNotice() {
    if (user?.role !== 'SCHOOL_ADMIN') return;
    let notice = $('schoolSmsAccessNotice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'schoolSmsAccessNotice';
      notice.setAttribute('role', 'status');
      notice.style.cssText = 'margin:10px 12px;padding:10px 12px;border:1px solid var(--border-color,#94a3b8);border-radius:10px;font-size:12px;line-height:1.5;';
      const nav = $('smsNav');
      if (nav?.parentElement) nav.parentElement.insertBefore(notice, nav);
    }
    const allowed = schoolEntitlements?.features?.sms_notifications === true || schoolEntitlements?.configured === false;
    const denied = schoolEntitlements?.features?.sms_notifications === false;
    if (!allowed && !denied) {
      notice.textContent = 'SMS access could not be verified. Reopen the dashboard or contact Super Admin.';
      notice.hidden = false;
    } else if (denied) {
      notice.textContent = 'SMS restricted by the school subscription' + (schoolEntitlements?.expired ? ' (expired)' : '') + '.';
      notice.hidden = false;
    } else {
      notice.hidden = true;
    }
  }

  function applyRoleNavigation() {
    const role = user?.role;
    const admin = role === 'SCHOOL_ADMIN';
    const teacher = role === 'TEACHER';
    if ($('cloudSyncNav')) $('cloudSyncNav').hidden = !admin;
    if ($('schoolBrandingNav')) $('schoolBrandingNav').hidden = !admin || schoolEntitlements?.features?.custom_branding === false;
    if ($('plannerNav')) $('plannerNav').hidden = !['TEACHER', 'DEPARTMENT_HEAD'].includes(role) || schoolEntitlements?.features?.planner === false;
    if ($('plannerDashboardWidget')) $('plannerDashboardWidget').hidden = !['TEACHER', 'DEPARTMENT_HEAD'].includes(role) || schoolEntitlements?.features?.planner === false;
    if ($('smsNav')) {
      const enabled = admin && (schoolEntitlements?.features?.sms_notifications === true || schoolEntitlements?.configured === false);
      $('smsNav').hidden = !enabled;
      $('smsNav').setAttribute('aria-hidden', String(!enabled));
    }
    if (admin) updateSmsAccessNotice();
    // A group hidden while SMS was restricted must become visible again when re-enabled.
    for (const group of ['operations', 'settings']) {
      const container = $(group + 'NavGroup');
      const submenu = document.querySelector('[data-submenu="' + group + '"]');
      if (container && submenu) container.hidden = !Array.from(submenu.children).some(item => !item.hidden);
    }
    if ($('exportTeachersButton')) $('exportTeachersButton').hidden = !(admin || role === 'DEPARTMENT_HEAD');
    if ($('bulkImportStudentsButton')) $('bulkImportStudentsButton').hidden = !(admin || teacherHas('CLASS_ADVISER'));
    if ($('studentStatusFilterWrap')) $('studentStatusFilterWrap').hidden = !admin;
    if ($('downloadStudentTemplate')) $('downloadStudentTemplate').hidden = !(admin || (teacher && teacherHas('CLASS_ADVISER')));
    if ($('exportStudentsButton')) $('exportStudentsButton').hidden = !['SCHOOL_ADMIN', 'DEPARTMENT_HEAD', 'TEACHER'].includes(role);
    if ($('academicAdminNav')) $('academicAdminNav').hidden = true;
    if ($('staffBulkDepartmentToolbar')) $('staffBulkDepartmentToolbar').hidden = !admin;
    const departmentHead = role === 'DEPARTMENT_HEAD';
    const gateKeeper = role === 'GATE_KEEPER';
    if ($('studentDepartmentScopeNote')) $('studentDepartmentScopeNote').hidden = !departmentHead;
    if ($('printBulkQr')) $('printBulkQr').hidden = departmentHead;
    if ($('applyStudentBatch')) $('applyStudentBatch').hidden = !(admin || departmentHead || (teacher && teacherHas('CLASS_ADVISER')));
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
    if ($('adminGatekeeperMonitoringCard')) $('adminGatekeeperMonitoringCard').hidden = true;
    if ($('teacherGateAttendanceCard')) $('teacherGateAttendanceCard').hidden = true;
    if ($('adminDashboardCard')) $('adminDashboardCard').hidden = !admin;
    if ($('statsGrid')) $('statsGrid').hidden = admin;
    if ($('dashboardScanCta')) $('dashboardScanCta').hidden = admin;
    if ($('statsGrid')) $('statsGrid').hidden = admin;
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
      if (title) title.textContent = 'Account administration';
      if (copy) copy.textContent = 'Manage employee accounts and sign-in permissions.';
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
    if ($('studentAccountsNav')) $('studentAccountsNav').hidden = !(admin || (teacher && (subjectTeacher || classAdviser)));
    if ($('studentsNav')) {
      $('studentsNav').hidden = !(admin || departmentHead || teacher || gateKeeper);
      if ($('showStudentForm')) $('showStudentForm').hidden = departmentHead || gateKeeper;
      $('studentsNav').querySelector('.nav-label').textContent = gateKeeper ? 'Gate scanner' : teacher ? (classAdviser && !subjectTeacher ? 'My advisory section' : 'My learners') : 'Students';
      $('studentsNav').title = gateKeeper ? 'Gate scanner' : 'Students';
    }
    if ($('studentRosterPanel')) $('studentRosterPanel').hidden = gateKeeper;
    if ($('studentManagementHeader')) $('studentManagementHeader').hidden = gateKeeper;
    if ($('studentRosterPanel')) $('studentRosterPanel').hidden = gateKeeper;
    if ($('studentForm')) $('studentForm').hidden = gateKeeper || departmentHead || $('studentForm').hidden;
    if ($('parentInviteModal')) $('parentInviteModal').hidden = true;
    if ($('schedulesNav')) $('schedulesNav').hidden = gateKeeper || (teacher && !(subjectTeacher || classAdviser));
    if ($('sf2Nav')) $('sf2Nav').hidden = admin || gateKeeper || (!departmentHead && !teacher);
    if ($('teachersNav')) {
      $('teachersNav').hidden = !(admin || departmentHead);
      if (departmentHead) $('teachersNav').querySelector('.nav-label').textContent = 'Teachers & Staff';
      else $('teachersNav').querySelector('.nav-label').textContent = 'User Management';
    }
    if ($('parentsNav')) $('parentsNav').hidden = !admin;
    if ($('manageParentsFromStudents')) { $('manageParentsFromStudents').hidden = !admin; $('manageParentsFromStudents').style.display = admin ? 'inline-flex' : 'none'; }
    if ($('showStudentPortalHelp')) $('showStudentPortalHelp').hidden = !admin;
    if ($('showStudentForm')) $('showStudentForm').hidden = !(admin || (teacher && classAdviser));
    if ($('showScheduleForm')) $('showScheduleForm').hidden = !(admin || departmentHead);
    if ($('dashboardAddStudent')) $('dashboardAddStudent').hidden = !(admin || (teacher && classAdviser));
    if ($('showTeacherForm')) $('showTeacherForm').hidden = !admin;
    if ($('addSchoolStaffAccount')) $('addSchoolStaffAccount').hidden = !admin;
    if ($('demoStudentLoginCard')) $('demoStudentLoginCard').hidden = !(admin && user?.schoolCode === 'DEMO001');
    
    if ($('staffUserRows')) $('staffUserRows').closest('.staff-accounts-card').hidden = !admin;
    if ($('adviserAssignmentForm') && !(admin || departmentHead)) $('adviserAssignmentForm').hidden = true;
    if ($('adviserAssignmentForm')) $('adviserAssignmentForm').closest('.adviser-assignments-card').hidden = !(admin || departmentHead);
    if ($('sf2SubmissionsCard')) $('sf2SubmissionsCard').hidden = admin || !departmentHead;
    if ($('sardoCard')) $('sardoCard').hidden = admin || !departmentHead;
    if ($('learnerSummaryCard')) $('learnerSummaryCard').hidden = gateKeeper || admin;
    if ($('recentActivityCard')) $('recentActivityCard').hidden = gateKeeper || admin;
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
        if (departmentHead) { label.textContent = 'Teachers & Staff'; if (detail) detail.textContent = 'Set teacher designations, advisory sections, and class schedules'; }
        else if (admin) { label.textContent = 'Manage staff accounts'; if (detail) detail.textContent = 'Create staff accounts and assign teacher designations'; }
      }
      if (target === 'schedules' && label) {
        if (teacher) { label.textContent = 'My Schedule'; if (detail) detail.textContent = 'View your teaching assignments and advisory class timetable'; }
        else if (departmentHead) { label.textContent = 'Manage class schedules'; if (detail) detail.textContent = 'Create schedules and assign teachers in your department'; }
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
    if (academicsGroup) academicsGroup.hidden = Boolean($('sf2Nav')?.hidden && $('schedulesNav')?.hidden && $('cloudSyncNav')?.hidden && $('schoolBrandingNav')?.hidden);
    // Use role-specific navigation names without changing existing routes or access rules.
    if ($('peopleGroupLabel')) $('peopleGroupLabel').textContent =
      departmentHead ? 'My Department' : teacher ? 'My Classes' : 'People & Accounts';
    if ($('academicsGroupLabel')) $('academicsGroupLabel').textContent =
      departmentHead ? 'Schedules & Monitoring' : teacher ? 'Attendance & Planning' : 'Academics';
    if (departmentHead) {
      if ($('studentsNav')) $('studentsNav').querySelector('.nav-label').textContent = 'Department Students';
      if ($('teachersNav')) $('teachersNav').querySelector('.nav-label').textContent = 'Department Teachers';
      if ($('schedulesNav')) $('schedulesNav').querySelector('.nav-label').textContent = 'Department Schedules';
      if ($('sf2Nav')) $('sf2Nav').querySelector('.nav-label').textContent = 'SF2 Monitoring';
    } else if (teacher) {
      if ($('studentsNav')) $('studentsNav').querySelector('.nav-label').textContent =
        classAdviser && !subjectTeacher ? 'My Advisory Students' : 'My Students';
      if ($('schedulesNav')) $('schedulesNav').querySelector('.nav-label').textContent = 'My Timetable';
      if ($('sf2Nav')) $('sf2Nav').querySelector('.nav-label').textContent = 'SF2 Attendance Report';
      if ($('classAttendanceNav') && !$('classAttendanceNav').hidden)
        $('classAttendanceNav').querySelector('.nav-label').textContent = 'Class Attendance';
    } else if ($('teachersNav')) {
      $('teachersNav').querySelector('.nav-label').textContent = 'Staff & Users';
    }
    // Put the most-used teaching and scheduling actions before reporting.
    const academicsSubmenu = document.querySelector('[data-submenu="academics"]');
    if (academicsSubmenu && (teacher || departmentHead)) {
      const order = teacher
        ? ['classAttendanceNav', 'schedulesNav', 'plannerNav', 'sf2Nav']
        : ['schedulesNav', 'plannerNav', 'sf2Nav'];
      order.forEach(id => { const node = $(id); if (node && node.parentElement === academicsSubmenu) academicsSubmenu.appendChild(node); });
    }
    // Move existing navigation links without changing routes or permissions.
    const relocate = (id, group) => {
      const item = $(id);
      const submenu = document.querySelector('[data-submenu="' + group + '"]');
      if (item && submenu) submenu.appendChild(item);
    };
    if (admin) {
      relocate('cloudSyncNav', 'operations');
      relocate('smsNav', 'operations');
      relocate('schoolBrandingNav', 'settings');
    } else if (teacher || departmentHead) {
      relocate('sf2Nav', 'reports');
    }
    ['operations', 'reports', 'settings'].forEach(group => {
      const container = document.getElementById(group + 'NavGroup');
      const submenu = document.querySelector('[data-submenu="' + group + '"]');
      if (container && submenu) container.hidden = !Array.from(submenu.children).some(item => !item.hidden);
    });
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
    const accountAccessPanel = $('accountAccessPanel');
    const departmentCard = $('departmentManagementCard');
    const note = document.querySelector('.teacher-management-note');
    const isDepartmentHead = user?.role === 'DEPARTMENT_HEAD';
    if (isDepartmentHead) {
      if (teacherCard) teacherCard.hidden = false;
      if (staffCard) staffCard.hidden = true;
      if (adviserCard) adviserCard.hidden = false;
      if (departmentCard) departmentCard.hidden = true;
      if (note) note.hidden = false;
      return;
    }
    if (!isAdmin) return;
    const activeTab = ['accounts','permissions','departments'].includes(tabName) ? tabName : 'accounts';
    if (teacherCard) teacherCard.hidden = activeTab !== 'accounts';
    if (staffCard) staffCard.hidden = activeTab !== 'accounts';
    if (adviserCard) adviserCard.hidden = true;
    if (accountAccessPanel) accountAccessPanel.hidden = activeTab !== 'permissions';
    if (activeTab === 'permissions') { loadSecurityAudit(); loadSecurityAccounts(); }
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
  let securityAccounts = [];
  let securityAccountsLoaded = false;
  async function loadSecurityAccounts(force = false) {
    const host = $('securityAccountsRows');
    if (!host || (securityAccountsLoaded && !force)) return;
    host.innerHTML = '<tr><td colspan="7" class="empty-cell">Loading staff security status…</td></tr>';
    try {
      const result = await api('/api/admin/security/accounts');
      securityAccounts = result.accounts || [];
      host.innerHTML = securityAccounts.length ? securityAccounts.map(account => {
        const locked = account.lockedUntil && new Date(account.lockedUntil).getTime() > Date.now();
        const status = !account.active ? 'Inactive' : locked ? 'Locked' : account.mustChangePassword ? 'Password change required' : 'Active';
        const statusClass = !account.active || locked ? 'inactive' : 'active';
        const lastLogin = account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString() : 'Never';
        const roleLabel = String(account.role || '').replaceAll('_', ' ');
        const departmentLabel = String(account.departmentName || 'Unassigned');
        const actions = [
          '<button type="button" class="outline-button compact-button" data-reset-staff-password="' + esc(account.userId) + '">Reset password</button>',
          '<button type="button" class="outline-button compact-button" data-revoke-staff-sessions="' + esc(account.userId) + '" ' + (Number(account.activeSessions) ? '' : 'disabled') + '>Revoke sessions</button>',
          locked ? '<button type="button" class="outline-button compact-button" data-unlock-staff-account="' + esc(account.userId) + '">Unlock</button>' : ''
        ].join('');
        return '<tr><td data-label="Employee"><strong>' + esc(account.displayName || account.username) + '</strong><small class="table-subtext">' + esc(account.username) + '</small></td>' +
          '<td data-label="Role / department"><div class="security-role-cell"><span class="role-line" title="' + esc(roleLabel) + '">' + esc(roleLabel) + '</span><span class="department-line" title="' + esc(departmentLabel) + '">' + esc(departmentLabel) + '</span></div></td>' +
          '<td data-label="Access status"><span class="account-status ' + statusClass + '">' + esc(status) + '</span></td>' +
          '<td data-label="Last sign-in">' + esc(lastLogin) + '</td>' +
          '<td data-label="Failed attempts">' + Number(account.failedLoginAttempts || 0) + ' / 5</td>' +
          '<td data-label="Sessions">' + Number(account.activeSessions || 0) + '</td>' +
          '<td data-label="Security actions"><div class="action-row">' + actions + '</div></td></tr>';
      }).join('') : '<tr><td colspan="7" class="empty-cell">No employee accounts found.</td></tr>';
      securityAccountsLoaded = true;
    } catch (error) {
      host.innerHTML = '<tr><td colspan="7" class="empty-cell">' + esc(error.message || 'Could not load account security status.') + '</td></tr>';
    }
  }
  function closeTemporaryPasswordModal() {
    $('temporaryPasswordValue').value = '';
    $('temporaryPasswordModal').hidden = true;
  }
  function showTemporaryPassword(result) {
    $('temporaryPasswordAccount').textContent = 'Temporary password for ' + (result.account.displayName || result.account.username) + ' (' + result.account.username + '). Share it privately.';
    $('temporaryPasswordValue').value = result.temporaryPassword;
    $('temporaryPasswordModal').hidden = false;
    $('copyTemporaryPassword').textContent = 'Copy';
  }
  $('closeTemporaryPasswordModal')?.addEventListener('click', closeTemporaryPasswordModal);
  $('doneTemporaryPasswordModal')?.addEventListener('click', closeTemporaryPasswordModal);
  $('temporaryPasswordModal')?.addEventListener('click', event => {
    if (event.target === $('temporaryPasswordModal')) closeTemporaryPasswordModal();
  });
  $('copyTemporaryPassword')?.addEventListener('click', async () => {
    const field = $('temporaryPasswordValue');
    try {
      await navigator.clipboard.writeText(field.value);
      $('copyTemporaryPassword').textContent = 'Copied';
    } catch {
      field.focus(); field.select();
      $('copyTemporaryPassword').textContent = 'Select and copy';
    }
  });
  $('securityAccountsRows')?.addEventListener('click', async event => {
    const reset = event.target.closest('[data-reset-staff-password]');
    const revoke = event.target.closest('[data-revoke-staff-sessions]');
    const unlock = event.target.closest('[data-unlock-staff-account]');
    const targetId = reset?.dataset.resetStaffPassword || revoke?.dataset.revokeStaffSessions || unlock?.dataset.unlockStaffAccount;
    if (!targetId) return;
    const account = securityAccounts.find(item => String(item.userId) === String(targetId));
    if (!account) return;
    const button = reset || revoke || unlock;
    if (reset) {
      if (!await AppDialog.confirm('Issue a new temporary password for ' + (account.displayName || account.username) + '? All current sessions will be revoked and the employee must change the password at next sign-in.', { title: 'Reset employee password', confirmText: 'Issue temporary password', variant: 'danger' })) return;
      button.disabled = true;
      try {
        const result = await api('/api/admin/security/accounts/' + encodeURIComponent(targetId) + '/reset-password', { method: 'POST', body: JSON.stringify({}) });
        showTemporaryPassword(result);
        await loadSecurityAccounts(true);
        await loadSecurityAudit(true);
        showToast('Temporary password created. Copy it and share it privately.');
      } catch (error) { showToast(error.message, true); button.disabled = false; }
      return;
    }
    if (revoke) {
      if (!await AppDialog.confirm('Revoke all active sessions for ' + (account.displayName || account.username) + '? The employee will need to sign in again.', { title: 'Revoke employee sessions', confirmText: 'Revoke sessions', variant: 'danger' })) return;
      button.disabled = true;
      try {
        const result = await api('/api/admin/security/accounts/' + encodeURIComponent(targetId) + '/revoke-sessions', { method: 'POST', body: JSON.stringify({}) });
        showToast(result.revokedSessions + ' active session(s) revoked.');
        await loadSecurityAccounts(true);
        await loadSecurityAudit(true);
      } catch (error) { showToast(error.message, true); button.disabled = false; }
      return;
    }
    if (unlock) {
      if (!await AppDialog.confirm('Unlock ' + (account.displayName || account.username) + ' and clear failed sign-in attempts?', { title: 'Unlock employee account', confirmText: 'Unlock account' })) return;
      button.disabled = true;
      try {
        await api('/api/admin/security/accounts/' + encodeURIComponent(targetId) + '/unlock', { method: 'POST', body: JSON.stringify({}) });
        showToast('Account unlocked.');
        await loadSecurityAccounts(true);
        await loadSecurityAudit(true);
      } catch (error) { showToast(error.message, true); button.disabled = false; }
    }
  });
  $('refreshSecurityAccounts')?.addEventListener('click', () => loadSecurityAccounts(true));

  let securityAuditLoaded = false;
  async function loadSecurityAudit(force = false) {
    const host = $('securityAuditRows');
    if (!host || (securityAuditLoaded && !force)) return;
    host.innerHTML = '<tr><td colspan="4" class="empty-cell">Loading account activity…</td></tr>';
    try {
      const result = await api('/api/admin/security/audit');
      const events = result.events || [];
      host.innerHTML = events.length ? events.map(item => {
        const when = item.createdAt ? new Date(item.createdAt).toLocaleString() : '—';
        const action = String(item.action || 'Administrative change').replaceAll('_',' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
        const record = [item.entityType, item.entityId].filter(Boolean).join(' · ') || '—';
        return '<tr><td data-label="Date and time">' + esc(when) + '</td><td data-label="Action">' + esc(action) + '</td><td data-label="Changed by">' + esc(item.actorName || 'System') + '</td><td data-label="Record">' + esc(record) + '</td></tr>';
      }).join('') : '<tr><td colspan="4" class="empty-cell">No administrative activity has been recorded yet.</td></tr>';
      securityAuditLoaded = true;
    } catch (error) {
      host.innerHTML = '<tr><td colspan="4" class="empty-cell">' + esc(error.message || 'Could not load account activity.') + '</td></tr>';
    }
  }
  $('refreshSecurityAudit')?.addEventListener('click', () => loadSecurityAudit(true));

  $('openAccountStatusManager')?.addEventListener('click', () => setAdminManagementTab('accounts'));
  document.querySelectorAll('[data-admin-go]').forEach(button => {
    button.addEventListener('click', () => {
      setView('teachers');
      setAdminManagementTab(button.dataset.adminGo);
    });
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
      NO_TEACHER: 'No Teacher Assigned',
      ON_LEAVE_UNCOVERED: 'On Leave',
      CHECK_IN_NOT_RECORDED: 'Check-in Not Recorded',
      COVERAGE_CHECK_IN_NOT_RECORDED: 'Check-in Not Recorded',
      TEACHER_INACTIVE: 'Uncovered Period',
      WAITING_FOR_START: 'Waiting for Class',
      SCHEDULED: 'Waiting for Class',
      COVERED: 'Substitute Assigned',
      ASSIGNED: 'Teacher Present'
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

  function coverageDisplayLabel(row) {
    if (row.checkInRecorded && ['ASSIGNED','COVERED'].includes(row.coverageStatus)) return 'Teacher Present';
    if (row.coverageStatus === 'COVERED') return 'Substitute Assigned';
    return coverageStatusLabel(row.coverageStatus);
  }

  function renderTeacherCoverage() {
    const host = $('teacherCoverageRows');
    if (!host) return;

    // Department scope is supplied by the server from the authenticated account.
    // Rows without a verified scope remain in the read-only Other Departments tab.
    const myRows = teacherCoverage.filter(row => row.departmentScope === 'MY_DEPARTMENT');
    const otherRows = teacherCoverage.filter(row => row.departmentScope !== 'MY_DEPARTMENT');
    const myAlerts = myRows.filter(coverageNeedsAction).length;
    const otherAlerts = otherRows.filter(coverageNeedsAction).length;
    const schoolSummary = teacherCoverageSummary || {};
    const schoolAlerts = Number(schoolSummary.activeAlerts ?? (myAlerts + otherAlerts));
    const count = $('coverageAlertCount');
    if (count) count.textContent = `${schoolAlerts} ${schoolAlerts === 1 ? 'alert' : 'alerts'}`;

    const setMetric = (id, value) => { if ($(id)) $(id).textContent = String(value); };
    setMetric('coverageTotalSchedules', schoolSummary.totalSchedules ?? teacherCoverage.length);
    setMetric('coverageNoTeacher', schoolSummary.noTeacher ?? teacherCoverage.filter(row => row.coverageStatus === 'NO_TEACHER').length);
    setMetric('coverageUncoveredLeave', schoolSummary.onLeaveUncovered ?? teacherCoverage.filter(row => row.coverageStatus === 'ON_LEAVE_UNCOVERED').length);
    setMetric('coverageMissingCheckins', schoolSummary.checkInNotRecorded ?? teacherCoverage.filter(row => ['CHECK_IN_NOT_RECORDED','COVERAGE_CHECK_IN_NOT_RECORDED'].includes(row.coverageStatus)).length);
    setMetric('coverageActiveAlerts', schoolAlerts);

    const myTab = $('coverageMyDepartmentTab');
    const otherTab = $('coverageOtherDepartmentsTab');
    const myCount = $('coverageMyDepartmentCount');
    const otherCount = $('coverageOtherDepartmentsCount');
    if (myCount) myCount.textContent = `${myRows.length} classes · ${myAlerts} alerts`;
    if (otherCount) otherCount.textContent = `${otherRows.length} classes · ${otherAlerts} alerts`;

    const showingMyDepartment = activeCoverageTab === 'MY_DEPARTMENT';
    if (myTab) {
      myTab.classList.toggle('is-active', showingMyDepartment);
      myTab.setAttribute('aria-selected', String(showingMyDepartment));
    }
    if (otherTab) {
      otherTab.classList.toggle('is-active', !showingMyDepartment);
      otherTab.setAttribute('aria-selected', String(!showingMyDepartment));
    }
    const panel = $('teacherCoveragePanel');
    if (panel) panel.setAttribute('aria-labelledby', showingMyDepartment ? 'coverageMyDepartmentTab' : 'coverageOtherDepartmentsTab');
    const notice = $('coverageOtherDepartmentsNotice');
    if (notice) notice.hidden = showingMyDepartment;

    const rows = showingMyDepartment ? myRows : otherRows;
    if (!rows.length) {
      host.innerHTML = showingMyDepartment
        ? '<div class="coverage-empty"><strong>No schedules in your department</strong><span>Active class schedules assigned to your department will appear here.</span></div>'
        : '<div class="coverage-empty"><strong>No other department schedules</strong><span>There are currently no schedules outside your department to monitor.</span></div>';
      return;
    }

    host.innerHTML = rows.map(row => {
      const canManageRow = showingMyDepartment && row.departmentScope === 'MY_DEPARTMENT' &&
        user.role === 'DEPARTMENT_HEAD' && user.departmentCode !== 'UNASSIGNED';
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
      let action = '';
      if (canManageRow && row.coverageStatus === 'COVERAGE_CHECK_IN_NOT_RECORDED') {
        action = '<span class="coverage-action-hint">Follow up with substitute</span>';
      } else if (canManageRow && coverageNeedsAction(row) && options.length) {
        action = `<div class="coverage-action-controls">
          <select aria-label="Choose teacher for ${esc(row.periodName)}" data-coverage-teacher-select="${esc(row.periodId)}">
            <option value="">Choose teacher</option>
            ${options.map(teacher => `<option value="${esc(teacher.userId)}">${esc(teacher.displayName)}</option>`).join('')}
          </select>
          <button type="button" class="outline-button compact-button" data-coverage-action="${esc(row.periodId)}">${row.coverageStatus === 'NO_TEACHER' ? 'Assign teacher' : 'Provide cover'}</button>
        </div>`;
      } else if (canManageRow && coverageNeedsAction(row)) {
        action = '<span class="coverage-action-hint">No eligible teacher available</span>';
      }

      const assigned = row.effectiveTeacherName || row.teacherName || 'No teacher assigned';
      const teacherName = row.substituteTeacherName
        ? `<strong>${esc(row.substituteTeacherName)}</strong><small class="table-subtext">Covering ${esc(row.teacherName || 'original teacher')}</small>`
        : `<strong>${esc(assigned)}</strong>`;
      const className = `${row.gradeLevel || 'Grade not set'} · ${row.section || 'All sections'}`;
      const statusLabel = coverageDisplayLabel(row);
      const departmentLine = showingMyDepartment ? '' : `<span class="coverage-department-label">${esc(row.departmentName || 'Unassigned department')}</span>`;
      return `<article class="coverage-class-card">
        <div class="coverage-class-main">
          <div class="coverage-class-heading">
            <div><h4>${esc(className)}</h4><p>${esc(row.subjectName || row.periodName || 'Class schedule')}</p></div>
            <span class="coverage-status-pill ${coverageStatusClass(row.coverageStatus)}">${esc(statusLabel)}</span>
          </div>
          ${departmentLine}
          <div class="coverage-class-details">
            <span><small>Teacher</small>${teacherName}</span>
            <span><small>Schedule</small>${esc(row.periodName)} · ${esc(row.startTime)}–${esc(row.endTime)}</span>
            ${row.classroom ? `<span><small>Room</small>${esc(row.classroom)}</span>` : ''}
          </div>
          ${action ? `<div class="coverage-card-actions">${action}</div>` : ''}
        </div>
      </article>`;
    }).join('');
  }

  async function loadTeacherCoverage(notifyNew = false) {
    if (user?.role !== 'DEPARTMENT_HEAD') return;
    const data = await api('/api/admin/teacher-coverage');
    const nextRows = data.coverage || [];
    teacherCoverageSummary = data.summary || null;
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

  function canSelectLearnerForBatch(student) {
    if (!student) return false;
    if (user.role === 'SCHOOL_ADMIN') return true;
    if (student.active === false || student.archivedAt) return false;
    if (user.role === 'TEACHER' && teacherHas('CLASS_ADVISER')) {
      return adviserAssignments.some(a => String(a.gradeLevel) === String(student.gradeLevel) &&
        String(a.section) === String(student.section));
    }
    if (user.role === 'DEPARTMENT_HEAD' && user.departmentId && user.departmentCode !== 'UNASSIGNED') {
      return periods.some(p => p.active !== false && String(p.scheduleDepartmentId) === String(user.departmentId) &&
        String(p.gradeLevel) === String(student.gradeLevel) &&
        String(p.section) === String(student.section));
    }
    return false;
  }

  function visibleBatchLearners() {
    const grade = $('bulkQrGrade')?.value || 'ALL';
    const section = $('bulkQrSection')?.value || 'ALL';
    const search = ($('studentRosterSearch')?.value || '').trim().toLocaleLowerCase();
    const statusFilter = $('studentStatusFilter')?.value || 'ACTIVE';
    return students.filter(student =>
      (grade === 'ALL' || student.gradeLevel === grade) &&
      (section === 'ALL' || student.section === section) &&
      (user.role !== 'SCHOOL_ADMIN' || statusFilter === 'ALL' ||
        (statusFilter === 'ACTIVE' && student.active !== false && !student.archivedAt) ||
        (statusFilter === 'INACTIVE' && student.active === false && !student.archivedAt) ||
        (statusFilter === 'ARCHIVED' && Boolean(student.archivedAt))) &&
      (!search || [student.fullName, student.studentId, student.lrn].some(v =>
        String(v || '').toLocaleLowerCase().includes(search)))
    ).filter(canSelectLearnerForBatch);
  }

  async function renderStudents() {
    refreshExistingGuardianChoices();
    const host = $('studentRows');
    const grade = $('bulkQrGrade').value;
    const section = $('bulkQrSection').value;
    const search = ($('studentRosterSearch')?.value || '').trim().toLocaleLowerCase();
    const admin = user.role === 'SCHOOL_ADMIN';
    const departmentHead = user.role === 'DEPARTMENT_HEAD';
    const teacher = user.role === 'TEACHER';
    const gateKeeper = user.role === 'GATE_KEEPER';
    const designations = Array.isArray(user.teacherDesignations) ? user.teacherDesignations : [];

    // Department Heads have a school-wide read-only roster. Keep only fields
    // useful for reviewing learner identity and class placement.
    const rosterHeader = $('studentRosterTable')?.querySelector('thead tr');
    if (rosterHeader && departmentHead) {
      rosterHeader.innerHTML = '<th>Select</th><th>Student ID</th><th>Full name</th><th>Sex</th><th>Grade</th><th>Section</th><th>Status</th>';
    } else if (rosterHeader) {
      rosterHeader.innerHTML = '<th>Select</th><th>Photo</th><th>Student ID</th><th>Full name</th><th>Sex</th><th>Grade</th><th>Section</th><th>Status</th><th>QR code</th><th>Actions</th>' + ((admin || teacher) ? '<th>Parent / guardian</th>' : '') + (admin ? '<th>Student portal account</th>' : '');
    }
    if ($('studentRosterDescription')) {
      $('studentRosterDescription').textContent = departmentHead
        ? 'School-wide learner roster. Select learners in sections managed by your department to apply authorized batch actions.'
        : 'QR previews remain tied to each student\'s existing private token. Editing details does not replace the QR code.';
    }
    const canManage = admin || (teacher && (designations.includes('CLASS_ADVISER') || designations.includes('SUBJECT_TEACHER')));
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
      const emptyMessage = teacher
        ? 'No learners match the grade and section currently assigned to your teacher account. Ask your Department Head to verify your active subject schedule or Class Adviser section against the students’ current enrollment.'
        : departmentHead
          ? 'No active learners are registered in this school yet.'
          : 'No students are available for this filter.';
      host.innerHTML = '<tr><td colspan="' + (departmentHead ? '7' : admin ? '11' : '10') + '" class="empty-cell">' + esc(emptyMessage) + '</td></tr>';
    } else {
      const rows = await Promise.all(visible.map(async student => {
        const photo = departmentHead ? '' : await photoDataUrl(student.photoUrl);
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
        const selection = canSelectLearnerForBatch(student) ? `<input type="checkbox" class="student-select-box" data-select-student="${esc(student.studentId)}" ${selectedStudentIds.has(student.studentId) ? 'checked' : ''} aria-label="Select ${esc(student.fullName)}">` : '';
        const editable = canManage && student.active !== false && !student.archivedAt;
        const actions = editable
          ? `<div class="student-row-actions"><button type="button" class="outline-button" data-edit-student="${esc(student.studentId)}">Edit</button>${canUploadPhoto ? `<label class="student-photo-upload">${student.hasPhoto ? 'Replace photo' : 'Upload photo'}<input type="file" accept="image/jpeg,image/png,image/webp" data-student-photo="${esc(student.studentId)}" hidden></label>` : ''}</div>`
          : '<span class="muted-inline">' + (student.archivedAt ? 'Archived' : student.active === false ? 'Inactive' : 'View only') + '</span>';
        const accountExists = Boolean(student.studentAccountUsername);
        const accountCell = admin
          ? `<div class="student-row-actions"><span class="muted-inline">${accountExists ? `Active login · ${esc(student.studentAccountUsername)}` : 'No student login'}</span><button type="button" class="outline-button" data-student-account="${esc(student.studentId)}" data-account-exists="${accountExists ? '1' : '0'}">${accountExists ? 'Reset login' : 'Create login'}</button></div>`
           : '';
        const statusLabel = student.archivedAt ? 'Archived' : student.active === false ? 'Inactive' : 'Active';
        if (departmentHead) {
          return `<tr><td data-label="Select">${selection || '<span class="muted-inline" title="Only your department’s assigned sections can be selected">View only</span>'}</td><td data-label="Student ID">${esc(student.studentId)}</td><td data-label="Full name"><strong>${esc(student.fullName)}</strong></td><td data-label="Sex">${esc(student.sex || 'Not set')}</td><td data-label="Grade">${esc(student.gradeLevel)}</td><td data-label="Section">${esc(student.section)}</td><td data-label="Status">${statusLabel}</td></tr>`;
        }
        return `<tr><td data-label="Select">${selection}</td><td data-label="Photo">${avatar}</td><td data-label="Student ID">${esc(student.studentId)}</td><td data-label="Full name">${esc(student.fullName)}</td><td data-label="Sex">${esc(student.sex || 'Not set')}</td><td data-label="Grade">${esc(student.gradeLevel)}</td><td data-label="Section">${esc(student.section)}</td><td data-label="Status">${statusLabel}</td><td data-label="QR code">${qrCell}</td><td data-label="Actions">${actions}</td>${(admin || teacher) ? `<td data-label="Parent / guardian"><strong>${esc(student.parentName || "Not provided")}</strong><small class="table-subtext">${esc(student.parentMobile || "No mobile number")}</small></td>` : ''}${admin ? `<td data-label="Student account">${accountCell}</td>` : ''}</tr>`;
      }));
      host.innerHTML = rows.join('');
      host.querySelectorAll('input[data-student-photo]').forEach(input => input.addEventListener('change', async () => {
        const file = input.files?.[0]; if (!file) return;
        input.disabled = true;
        try {
          const saved = await uploadStudentPhoto(input.dataset.studentPhoto, file);
          if (saved) { await loadSchoolData(); showToast('Student photo saved without stretching.'); }
        } catch (error) { showToast(error.message, true); }
        finally { input.disabled = false; input.value = ''; }
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
            ? 'Read-only school-wide learner roster. Student record changes and class placement are handled by the School Administrator and authorized Class Advisers.'
            : 'Students registered under this school. Manage student information, photos, and QR cards.';
    const canBatchManage = admin || departmentHead || (teacher && designations.includes('CLASS_ADVISER'));
    if ($('selectAllStudents')) $('selectAllStudents').disabled = !canBatchManage;
    document.querySelectorAll('.student-filter-row label, .student-bulk-actions').forEach(element => {
      if (gateKeeper) element.hidden = element.classList.contains('student-bulk-actions');
      else if (!canBatchManage) element.hidden = element.classList.contains('student-bulk-actions');
    });
    if (admin) refreshBulkQrSections();
    updateStudentSelectionUi();
  }

  function updateStudentSelectionUi() {
    const visible = visibleBatchLearners();
    for (const id of [...selectedStudentIds]) {
      const student = students.find(item => item.studentId === id);
      if (!canSelectLearnerForBatch(student)) selectedStudentIds.delete(id);
    }
    $('selectedStudentCount').textContent = selectedStudentIds.size + ' selected';
    const isAdmin = user.role === 'SCHOOL_ADMIN';
    const mayBatch = isAdmin || user.role === 'DEPARTMENT_HEAD' || (user.role === 'TEACHER' && teacherHas('CLASS_ADVISER'));
    const actions = $('studentBatchAction');
    if (actions) {
      [...actions.options].forEach(option => {
        if (!option.value) return;
        const available = isAdmin || ['SET_SEX','ASSIGN'].includes(option.value);
        option.hidden = !available;
        option.disabled = !available;
      });
      if (actions.selectedOptions[0]?.disabled) actions.value = '';
    }
    if ($('applyStudentBatch')) $('applyStudentBatch').disabled =
      !mayBatch || !selectedStudentIds.size || !actions?.value || selectedStudentIds.size > 500;
    const all = $('selectAllStudents');
    if (all) {
      all.disabled = !mayBatch || !visible.length;
      all.checked = visible.length > 0 && visible.every(s => selectedStudentIds.has(s.studentId));
      all.indeterminate = visible.some(s => selectedStudentIds.has(s.studentId)) && !all.checked;
    }
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
        showScanErrorModal(error.message, 'Teacher QR could not be verified');
      }
      return;
    }
    if (!studentMatch) {
      const message = 'This is not a recognized learner or teacher gate QR code. Make sure you are scanning the official QR card.';
      $('studentScanFeedback').textContent = message;
      $('studentScanFeedback').className = 'scanner-feedback is-error';
      showScanErrorModal(message, 'QR code not recognized');
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
      showScanErrorModal(error.message, 'Student could not be verified');
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
      showScanErrorModal(error.message, 'Teacher attendance not recorded');
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
    } catch (error) {
      showToast(error.message, true);
      $('studentScanFeedback').textContent = error.message;
      $('studentScanFeedback').className = 'scanner-feedback is-error';
      showScanErrorModal(error.message);
    }
  }

  function scheduleWeekDates(value) {
    const date=new Date((/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value:dataSchoolDate())+'T00:00:00Z');
    date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
    return Array.from({length:7},(_,index)=>{
      const d=new Date(date);d.setUTCDate(date.getUTCDate()+index);
      return d.toISOString().slice(0,10);
    });
  }
  function scheduleDateOverride(periodId,date) {
    return scheduleAdjustments.find(a=>String(a.periodId)===String(periodId)&&a.date===date)||null;
  }
  function scheduleOnDay(period,date) {
    if(period.effectiveFrom&&String(period.effectiveFrom).slice(0,10)>date)return null;
    if(period.effectiveTo&&String(period.effectiveTo).slice(0,10)<date)return null;
    if(!Array.isArray(period.weekdays)||!period.weekdays.map(Number).includes(new Date(date+'T00:00:00Z').getUTCDay()))return null;
    const a=scheduleDateOverride(period.periodId,date);
    return a?{...period,dayDate:date,adjustment:a,cancelled:a.type==='CANCEL',
      startTime:a.startTime||period.startTime,endTime:a.endTime||period.endTime,
      subjectName:a.subjectName||period.subjectName,
      assignedTeacherName:a.teacherName||period.assignedTeacherName,
      classroom:a.classroom==null?period.classroom:a.classroom}
      :{...period,dayDate:date,adjustment:null,cancelled:false};
  }
  async function loadScheduleAdjustments() {
    if(!['SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER'].includes(user?.role))return;
    const week=scheduleWeekDates($('weeklyScheduleAsOf')?.value);
    try {
      const result=await api('/api/schedule-adjustments?from='+encodeURIComponent(week[0])+'&to='+encodeURIComponent(week[6]));
      scheduleAdjustments=result.adjustments||[];
      renderAdjustmentList();
    }catch(error){
      scheduleAdjustments=[];
      if($('datedScheduleList'))$('datedScheduleList').textContent=error.message;
    }
    renderWeeklyTimetable();
  }
  function renderAdjustmentList() {
    const list=$('datedScheduleList');
    if(!list)return;
    const manager=['SCHOOL_ADMIN','DEPARTMENT_HEAD'].includes(user.role);
    const rows=scheduleAdjustments.filter(a=>user.role!=='DEPARTMENT_HEAD'||String(a.departmentId)===String(user.departmentId));
    const labels={SUBSTITUTE:'Teacher cover',REPLACE:'Subject replacement',RESCHEDULE:'Changed time',CANCEL:'Class cancelled'};
    list.innerHTML=rows.length?rows.map(a=>{
      const period=periods.find(p=>String(p.periodId)===String(a.periodId));
      const desc=[a.subjectName,a.teacherName,a.startTime&&a.endTime?a.startTime+'–'+a.endTime:null,a.reason?.replaceAll('_',' ')].filter(Boolean).join(' · ');
      return '<article class="dated-adjustment-card"><span class="status-tag neutral">'+esc(labels[a.type]||a.type)+'</span>'+
        '<div><strong>'+esc(a.date+' · '+(period?.periodName||'Class')+' · '+a.gradeLevel+' · '+a.section)+'</strong>'+
        '<span>'+esc(desc||'Date-specific timetable change')+'</span>'+
        (a.notes?'<small>'+esc(a.notes)+'</small>':'')+'</div>'+
        (manager&&a.date>=dataSchoolDate()?'<button type="button" class="outline-button" data-remove-adjustment="'+esc(a.adjustmentId)+'">Restore regular</button>':'')+
        '</article>';
    }).join(''):'<p class="muted-inline">No temporary changes this week. The regular schedule applies.</p>';
  }

  function renderWeeklyTimetable() {
    const host = $('weeklyTimetableBoard');
    if (!host) return;
    const gradeFilter = $('weeklyGradeFilter');
    const sectionFilter = $('weeklySectionFilter');
    const asOfFilter = $('weeklyScheduleAsOf');
    if (asOfFilter && !asOfFilter.value) asOfFilter.value = dataSchoolDate();
    const asOfDate = /^\d{4}-\d{2}-\d{2}$/.test(asOfFilter?.value || '') ? asOfFilter.value : dataSchoolDate();
    const weekDates = scheduleWeekDates(asOfDate);
    const effectivePeriods = periods.filter(period =>
      (!period.effectiveFrom || String(period.effectiveFrom).slice(0, 10) <= weekDates[6]) &&
      (!period.effectiveTo || String(period.effectiveTo).slice(0, 10) >= weekDates[0])
    );
    const previousGrade = gradeFilter?.value || '';
    const previousSection = sectionFilter?.value || '';
    const gradeLevels = [...new Set(effectivePeriods.map(period => String(period.gradeLevel || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b, undefined, {numeric:true}));
    if (gradeFilter) {
      gradeFilter.innerHTML = '<option value="">All grade levels</option>' + gradeLevels.map(grade => '<option value="' + esc(grade) + '">' + esc(grade) + '</option>').join('');
      if (gradeLevels.includes(previousGrade)) gradeFilter.value = previousGrade;
    }
    const selectedGrade = gradeFilter?.value || '';
    const sectionValues = [...new Set(effectivePeriods.filter(period => !selectedGrade || String(period.gradeLevel || '') === selectedGrade).map(period => String(period.section || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b, undefined, {numeric:true}));
    if (sectionFilter) {
      sectionFilter.innerHTML = '<option value="">All sections</option>' + sectionValues.map(section => '<option value="' + esc(section) + '">' + esc(section) + '</option>').join('');
      if (sectionValues.includes(previousSection)) sectionFilter.value = previousSection;
    }
    const selectedSection = sectionFilter?.value || '';
    const filtered = effectivePeriods.filter(period =>
      (!selectedGrade || String(period.gradeLevel || '') === selectedGrade) &&
      (!selectedSection || String(period.section || '') === selectedSection)
    );
    const configuredDays = schoolOperatingDays.filter(day => day.isOperatingDay).map(day => Number(day.weekday)).filter(day => day >= 0 && day <= 6);
    const scheduledDays = [...new Set(filtered.flatMap(period => Array.isArray(period.weekdays) ? period.weekdays.map(Number) : []))].filter(day => day >= 0 && day <= 6);
    const days = configuredDays.length ? configuredDays : scheduledDays.length ? scheduledDays : [1,2,3,4,5];
    const names = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const eligibleFor = period => teachers.filter(teacher =>
      teacher.active && (teacher.teacherDesignations || []).includes('SUBJECT_TEACHER') &&
      String(teacher.departmentId || '') === String(period.departmentId || '') &&
      (user.role !== 'DEPARTMENT_HEAD' || String(teacher.departmentId || '') === String(user.departmentId || ''))
    );
    const canAssign = user.role === 'SCHOOL_ADMIN' || user.role === 'DEPARTMENT_HEAD';
    const cardsForDay = day => {
      const date = weekDates.find(value => new Date(value + 'T00:00:00Z').getUTCDay() === day);
      return filtered.map(period => scheduleOnDay(period, date)).filter(Boolean)
        .sort((a,b) => String(a.startTime || '').localeCompare(String(b.startTime || '')) ||
          String(a.periodName || '').localeCompare(String(b.periodName || '')));
    };
    host.style.setProperty('--visible-days', String(days.length || 5));
    host.innerHTML = days.length ? days.map(day => {
      const dayPeriods = cardsForDay(day);
      const dayDate = weekDates.find(value => new Date(value + 'T00:00:00Z').getUTCDay() === day);
      return '<section class="weekly-day-column"><header><strong>' + names[day] + ' ' + esc(dayDate?.slice(5) || '') + '</strong><span>' + dayPeriods.filter(period => !period.cancelled).length + ' classes</span></header>' +
        (dayPeriods.length ? dayPeriods.map(period => {
          const unassigned = !period.assignedTeacherName;
          const teacherChoices = eligibleFor(period);
          const canEditThisPeriod = canAssign && (user.role === 'SCHOOL_ADMIN' ||
            String(period.scheduleDepartmentId) === String(user.departmentId));
          const adjustment = period.adjustment;
          const dayAdjustmentBadge = adjustment ?
            '<span class="weekly-adjustment-badge">' + esc(period.cancelled ? 'Cancelled' :
            adjustment.type === 'SUBSTITUTE' ? 'Teacher cover' :
            adjustment.type === 'REPLACE' ? 'Subject replacement' : 'Time / room change') + '</span>' +
            '<span class="weekly-adjustment-detail">' + esc(adjustment.reason?.replaceAll('_',' ') || '') +
            (adjustment.notes ? ' · ' + adjustment.notes : '') + '</span>' : '';
          const editAdjustment = canEditThisPeriod && period.dayDate >= dataSchoolDate() ?
            '<button class="outline-button compact-button weekly-adjustment-edit" type="button" data-open-adjustment="' +
            esc(period.periodId) + '" data-adjustment-date="' + esc(period.dayDate) + '">' +
            (adjustment ? 'Update this change' : 'Change this date') + '</button>' : '';
          const assignmentControl = canAssign && unassigned && !adjustment
            ? '<div class="weekly-assign-controls"><select data-weekly-teacher="' + esc(period.periodId) + '" aria-label="Choose teacher for ' + esc(period.periodName) + '"><option value="">Choose teacher</option>' + teacherChoices.map(teacher => '<option value="' + esc(teacher.userId) + '">' + esc(teacher.displayName) + '</option>').join('') + '</select><button type="button" class="primary-button compact-button" data-weekly-assign="' + esc(period.periodId) + '">Assign</button></div>'
            : '';
          return '<article class="weekly-schedule-card' + (unassigned ? ' is-unassigned' : '') +
            (adjustment ? ' is-adjusted' : '') + (period.cancelled ? ' is-cancelled' : '') + '">' +
            '<div class="weekly-card-time">' + esc(period.startTime || '—') + '–' + esc(period.endTime || '—') + '</div>' +
            '<strong>' + esc(period.subjectName || period.periodName || 'Class schedule') + '</strong>' +
            '<span class="weekly-card-class">' + esc(period.gradeLevel || '—') + ' · ' + esc(period.section || 'All sections') + '</span>' +
            '<span>' + esc(period.periodName || 'Schedule block') + (period.classroom ? ' · ' + esc(period.classroom) : '') + '</span>' +
            '<span class="weekly-card-teacher' + (unassigned ? ' is-unassigned' : '') + '">' +
            (period.cancelled ? 'No class today' : unassigned ? 'Unassigned teacher' : esc(period.assignedTeacherName)) + '</span>' +
            dayAdjustmentBadge + assignmentControl + editAdjustment + '</article>';
        }).join('') : '<p class="weekly-day-empty">No classes scheduled</p>') + '</section>';
    }).join('') : '<div class="weekly-empty-state"><strong>No schedules match these filters.</strong><span>Try another grade level or section, or create a class schedule.</span></div>';
    const summary = $('weeklyTimetableSummary');
    if (summary) summary.textContent = filtered.length + ' recurring classes · Week ' +
      weekDates[0] + ' to ' + weekDates[6] + ' · ' + scheduleAdjustments.length + ' temporary change(s)';
    if (window.TimetableGrid) {
      const weekdayDates=Object.fromEntries(days.map(day=>[
        day,weekDates.find(date=>new Date(date+'T00:00:00Z').getUTCDay()===day)
      ]));
      const entries=days.flatMap(day=>cardsForDay(day).map(period=>({
        ...period,dayIndex:day,date:weekdayDates[day],
        canEdit:canAssign && (user.role==='SCHOOL_ADMIN' ||
          String(period.scheduleDepartmentId)===String(user.departmentId)),
        eligibleTeachers:canAssign && !period.assignedTeacherName
          ? teachers.filter(t=>t.active && (t.teacherDesignations||[]).includes('SUBJECT_TEACHER') &&
              String(t.departmentId||'')===String(period.scheduleDepartmentId||period.departmentId||''))
          : []
      })));
      window.TimetableGrid.render({
        host,days,weekdayDates,entries,today:dataSchoolDate(),
        onAdjust:(id,date)=>openScheduleAdjustment(id,date),
        onAssign:async(periodId,teacherUserId)=>{
          const result=await api('/api/periods/'+encodeURIComponent(periodId)+'/assignments',{
            method:'POST',body:JSON.stringify({teacherUserId})
          });
          await loadSchoolData();
          setScheduleDisplay('weekly');
          showToast('Schedule assigned to '+(result.teacher?.displayName||'the selected teacher')+'.');
        }
      });
    }
    window.ScheduleWorkspaceUI?.update?.({periods,scheduleAdjustments,role:user?.role});
  }

  function setScheduleDisplay(mode) {
    activeScheduleDisplay = mode === 'list' ? 'list' : 'weekly';
    const weekly = activeScheduleDisplay === 'weekly';
    if ($('weeklyTimetableBoard')) $('weeklyTimetableBoard').hidden = !weekly;
    if ($('managerScheduleTableWrap')) $('managerScheduleTableWrap').hidden = weekly;
    document.querySelectorAll('[data-schedule-display]').forEach(button => {
      const active = button.dataset.scheduleDisplay === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (weekly) renderWeeklyTimetable();
  }

  function renderPeriods() {
    const canBulkAssign = user.role === 'DEPARTMENT_HEAD';
    const isTeacher = user.role === 'TEACHER';
    const isSchoolManager = user.role === 'SCHOOL_ADMIN' || user.role === 'DEPARTMENT_HEAD';
    if ($('periodBulkToolbar')) $('periodBulkToolbar').hidden = !canBulkAssign;
    if ($('timetableSettings')) $('timetableSettings').hidden = user.role !== 'SCHOOL_ADMIN';
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
    if ($('periodTeacherGroup')) $('periodTeacherGroup').hidden = false;
    if ($('periodTeacherSelfGroup')) $('periodTeacherSelfGroup').hidden = true;
    if ($('periodTeacherHint')) $('periodTeacherHint').textContent =
      'The Department Head assigns this class schedule to the selected Subject Teacher.';
    if ($('addScheduleSubject')) $('addScheduleSubject').hidden = !isSchoolManager;

    if ($('weeklyTimetableWorkspace')) $('weeklyTimetableWorkspace').hidden = isTeacher;
    if (isTeacher) {
      if ($('managerScheduleTableWrap')) $('managerScheduleTableWrap').hidden = true;
      if ($('teacherScheduleOverview')) $('teacherScheduleOverview').hidden = false;
      const hasTeachingRole = teacherHas('SUBJECT_TEACHER');
      const hasAdviserRole = teacherHas('CLASS_ADVISER');
      if ($('myTeachingScheduleCard')) $('myTeachingScheduleCard').hidden = !hasTeachingRole;
      if ($('myAdvisoryScheduleCard')) $('myAdvisoryScheduleCard').hidden = !hasAdviserRole;

      const teachingPeriods = periods.filter(period =>
        String(period.assignedTeacherUserId || '') === String(user.userId || '')
      );
      const advisoryPeriods = periods.filter(period =>
        hasAdviserRole && adviserAssignments.some(assignment =>
          String(assignment.gradeLevel) === String(period.gradeLevel) &&
          String(assignment.section) === String(period.section)
        )
      );
      const classLabel = period => `${period.gradeLevel || '—'} · ${period.section || 'All sections'}`;
      const timeLabel = period => `${period.startTime || '—'}–${period.endTime || '—'}`;
      const emptyRow = (columns, message) => `<tr><td colspan="${columns}" class="empty-cell">${message}</td></tr>`;

      if ($('myTeachingScheduleRows')) {
        $('myTeachingScheduleRows').innerHTML = teachingPeriods.length ? teachingPeriods.map(period => `
          <tr>
            <td><strong>${esc(period.subjectName || '—')}</strong></td>
            <td>${esc(classLabel(period))}</td>
            <td>${esc(period.periodName || '—')}</td>
            <td>${esc(timeLabel(period))}<small class="schedule-day-caption">${esc(formatScheduleDays(period.weekdays))}</small></td>
            <td data-label="Room">${esc(period.classroom || '—')}</td>
          </tr>`).join('') : emptyRow(5, 'No teaching schedules have been assigned to your account yet.');
      }
      if ($('myAdvisoryScheduleRows')) {
        $('myAdvisoryScheduleRows').innerHTML = advisoryPeriods.length ? advisoryPeriods.map(period => `
          <tr>
            <td><strong>${esc(period.subjectName || '—')}</strong></td>
            <td>${esc(period.periodName || '—')}</td>
            <td>${esc(timeLabel(period))}</td>
            <td>${esc(period.classroom || '—')}</td>
            <td>${esc(String(period.assignedTeacherUserId || '') === String(user.userId || '') ? 'You' : (period.assignedTeacherName || 'Unassigned'))}</td>
          </tr>`).join('') : emptyRow(5, 'No subject schedules have been added to your advisory section yet.');
      }

      $('scheduleScopeText').textContent = hasTeachingRole && hasAdviserRole
        ? 'Your schedule combines all subjects you teach with the complete timetable and Subject Teacher list for your advisory class.'
        : hasAdviserRole
          ? 'View every subject schedule assigned to your advisory section, including the teacher handling each subject.'
          : 'View all class schedules assigned to your teacher account.';
    } else {
      if ($('managerScheduleTableWrap')) $('managerScheduleTableWrap').hidden = false;
      if ($('teacherScheduleOverview')) $('teacherScheduleOverview').hidden = true;
      $('scheduleRows').innerHTML = periods.length ? periods.map(period => {
        const canSelectPeriod = (user.role === 'SCHOOL_ADMIN' || String(period.departmentId) === String(user.departmentId)) && !period.assignedTeacherName;
        const selection = canBulkAssign
          ? '<td data-label="Select">' + (canSelectPeriod
            ? '<input type="checkbox" data-select-period="' + esc(period.periodId) + '" ' +
              (selectedPeriodIds.has(String(period.periodId)) ? 'checked' : '') + ' aria-label="Select ' + esc(period.periodName) + '">'
            : '—') + '</td>'
          : '';
        const deleteAction = (user.role === 'SCHOOL_ADMIN' || (user.role === 'DEPARTMENT_HEAD' && String(period.departmentId) === String(user.departmentId))) ? `<button type="button" class="outline-button compact-button danger-button" data-delete-period="${esc(period.periodId)}">Delete</button>` : '—';
        return `<tr>
          ${selection}<td data-label="Schedule"><strong>${esc(period.periodName)}</strong></td>
          <td data-label="Subject">${esc(period.subjectName || '—')}</td>
          <td data-label="Department">${esc(period.departmentName || 'Unassigned')}</td>
          <td data-label="Grade">${esc(period.gradeLevel)}</td>
          <td data-label="Section">${esc(period.section || 'All sections')}</td>
          <td>${esc(period.classroom || '—')}</td>
          <td data-label="Days">${esc(formatScheduleDays(period.weekdays))}</td><td data-label="Time">${esc(period.startTime)}–${esc(period.endTime)}</td>
          <td data-label="Assigned teacher">${esc(period.assignedTeacherName || 'Unassigned')}</td><td data-label="Actions">${deleteAction}</td>
        </tr>`;
      }).join('') : '<tr><td colspan="' + (canBulkAssign ? 10 : 9) + '" class="empty-cell">No class schedules are available yet.</td></tr>';

      renderWeeklyTimetable();
      setScheduleDisplay(activeScheduleDisplay);

      $('scheduleScopeText').textContent = user.role === 'DEPARTMENT_HEAD'
        ? 'Create class schedules and assign Subject Teachers within your department. View schedules across the school.'
        : 'Create class schedules and assign Subject Teachers. Department and subject options follow the selected teacher profile.';
    }

    document.querySelectorAll('[data-select-period]').forEach(box => box.addEventListener('change', () => {
      if (box.checked) selectedPeriodIds.add(String(box.dataset.selectPeriod)); else selectedPeriodIds.delete(String(box.dataset.selectPeriod));
      updatePeriodBatchUi();
    }));

    const departmentHeadCanCreate = user.role === 'SCHOOL_ADMIN' || (user.role === 'DEPARTMENT_HEAD' && Boolean(user.departmentId) && user.departmentCode !== 'UNASSIGNED');
    $('showScheduleForm').hidden = !departmentHeadCanCreate;
    $('showScheduleForm').textContent = '＋ Create class schedule';
    if (user.role === 'DEPARTMENT_HEAD' && !departmentHeadCanCreate) {
      $('scheduleScopeText').textContent = 'Your account is awaiting department assignment. You can monitor schedules until the School Administrator assigns your department.';
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
    const photo = await window.ProfilePhotos.edit(file, { purpose: 'logo' });
    if (!photo) return false;
    await window.ProfilePhotos.post(`/api/photos/official/teacher/${encodeURIComponent(userId)}`, token, photo);
    return true;
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
      const classScopesHtml = classScopes.length
        ? `<div class="teacher-scope-list">${classScopes.map(item => `<span class="teacher-scope-item">${esc(item.gradeLevel)} · ${esc(item.section)}</span>`).join('')}</div>`
        : '<span class="muted-inline">No assigned classes</span>';

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
        .map(item => `<button type="button" class="outline-button compact-button danger-button" data-cancel-substitution="${esc(item.substitutionId)}">End cover · ${esc(item.periodName)}</button>`)
        .join('');

      const isSchoolAdmin = user.role === 'SCHOOL_ADMIN';
      const accountActions = !isSchoolAdmin ? '<span class="muted-inline">View only</span>' : (active
        ? `<div class="teacher-action-menu-label">Account &amp; permissions</div>
           <button type="button" class="teacher-action-item" data-edit-teacher-profile="${esc(teacher.userId)}">Edit account profile</button>
<button type="button" class="teacher-action-item" data-teacher-qr="${esc(teacher.userId)}">Print gate QR badge</button>
           <label class="teacher-action-item teacher-photo-upload-menu">${teacher.hasTeacherPhoto ? 'Replace teacher photo' : 'Upload teacher photo'}<input type="file" accept="image/jpeg,image/png,image/webp" data-teacher-photo="${esc(teacher.userId)}" hidden></label>
           <div class="teacher-action-menu-divider"></div>
           <div class="teacher-action-menu-label">Account</div>
           <button type="button" class="teacher-action-item" data-place-leave="${esc(teacher.userId)}">Set on leave</button>
           <button type="button" class="teacher-action-item danger" data-deactivate-teacher="${esc(teacher.userId)}">Deactivate account</button>`
        : onLeave
          ? `<div class="teacher-action-menu-label">Account access</div>
             <button type="button" class="teacher-action-item" data-return-teacher="${esc(teacher.userId)}">Mark returned</button>`
          : `<div class="teacher-action-menu-label">Account</div>
             <button type="button" class="teacher-action-item" data-return-teacher="${esc(teacher.userId)}">Reactivate account</button>`);

      const designationLabels = (teacher.teacherDesignations || []).map(value => value === 'CLASS_ADVISER' ? 'Class Adviser' : 'Subject Teacher').join(' + ') || 'No designation';
      const canManageDepartment = user.role === 'DEPARTMENT_HEAD' && String(teacher.departmentId) === String(user.departmentId);
      const canAssignSubstitute = canManageDepartment && onLeave && assigned.length > 0;
      const departmentHeadCoverageActions = [
        ...(canManageDepartment && active ? [`<button type="button" class="outline-button compact-button" data-edit-teacher-permission="${esc(teacher.userId)}">Edit designation</button>`, `<button type="button" class="outline-button compact-button" data-manage-permanent="${esc(teacher.userId)}">Manage schedules</button>`] : []),
        ...(canAssignSubstitute ? [`<button type="button" class="outline-button compact-button" data-assign-substitute="${esc(teacher.userId)}">Assign substitute</button>`] : []),
        ...(canManageDepartment && cancelCoverActions ? [cancelCoverActions] : [])
      ].join('');
      const actionMenu = isSchoolAdmin ? `<details class="teacher-action-menu">
        <summary class="outline-button compact-button teacher-actions-trigger" aria-label="Actions for ${esc(teacher.displayName)}">Actions <span class="teacher-actions-chevron" aria-hidden="true">▾</span></summary>
        <div class="teacher-action-menu-panel" hidden>${accountActions}</div>
      </details>` : (user.role === 'DEPARTMENT_HEAD' && departmentHeadCoverageActions
        ? `<div class="teacher-coverage-actions">${departmentHeadCoverageActions}</div>`
        : '<span class="muted-inline">Read only</span>');

      const departmentCell = user.role === 'SCHOOL_ADMIN'
        ? `<select class="teacher-department-select" data-change-teacher-department="${esc(teacher.userId)}" aria-label="Department for ${esc(teacher.displayName)}">
            ${departments.filter(item => item.active || String(item.departmentId) === String(teacher.departmentId)).map(item => `<option value="${esc(item.departmentId)}" ${String(item.departmentId) === String(teacher.departmentId) ? 'selected' : ''} ${item.active ? '' : 'disabled'}>${esc(item.name)}${item.active ? '' : ' (Inactive)'}</option>`).join('')}
          </select>`
        : esc(teacher.departmentName || 'Unassigned');
      return `<tr>
        <td data-label="Teacher"><div class="teacher-cell-value teacher-identity">${user.role === 'SCHOOL_ADMIN' ? '<input type="checkbox" data-select-staff="' + esc(teacher.userId) + '" ' + (selectedStaffIds.has(String(teacher.userId)) ? 'checked' : '') + ' aria-label="Select ' + esc(teacher.displayName) + '">' : ''}<strong>${esc(teacher.displayName)}</strong><small class="table-subtext">${esc(teacher.username)}</small><small class="table-subtext">${esc(teacher.position || 'Position not set')} · ${esc(designationLabels)}</small></div></td>
        <td data-label="Department"><div class="teacher-cell-value">${departmentCell}</div></td>
        <td data-label="Status"><div class="teacher-cell-value"><span class="account-status ${statusClass}">${statusLabel}</span>${leaveDetails}</div></td>
        <td data-label="Assigned classes"><div class="teacher-cell-value">${classScopesHtml}</div></td>
        <td data-label="Assigned schedules"><div class="teacher-cell-value">${assignmentsHtml}</div></td>
        <td data-label="Account action"><div class="teacher-cell-value"><div class="action-row">${actionMenu}</div></div></td>
      </tr>`;
    }).join('') : '<tr><td colspan="6" class="empty-cell">No teacher accounts have been created for this school yet.</td></tr>';

    $('teacherRows').innerHTML = rows;
    $('teacherRows').querySelectorAll('[data-select-staff]').forEach(box => box.addEventListener('change', () => {
      if (box.checked) selectedStaffIds.add(String(box.dataset.selectStaff)); else selectedStaffIds.delete(String(box.dataset.selectStaff));
      updateStaffBulkUi();
    }));
    $('teacherRows').querySelectorAll('input[data-teacher-photo]').forEach(input => input.addEventListener('change', async () => {
      const file = input.files?.[0]; if (!file) return;
      input.disabled = true;
      try {
        const saved = await uploadTeacherPhoto(input.dataset.teacherPhoto, file);
        if (saved) { await loadSchoolData(); showToast('Official teacher photo saved.'); }
      } catch (error) { showToast(error.message, true); }
      finally { input.disabled = false; input.value = ''; }
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
        if (!await AppDialog.confirm(`Remove the permanent assignment for ${period?.periodName || 'this schedule'} from ${teacher.displayName}? This does not delete attendance history.`, { title: 'Remove permanent assignment', confirmText: 'Continue to verification', variant: 'danger' })) return;
        const password = await AppDialog.prompt('Enter your account password to confirm this change. The schedule will be deactivated, but attendance history will remain intact.', '', { title: 'Confirm schedule deactivation', label: 'Account password', inputType: 'password', required: true, requiredMessage: 'Enter your password to continue.', confirmText: 'Verify and deactivate' });
        if (password === null || !password) return;
        button.disabled = true;
        feedback.textContent = 'Removing permanent assignment…';
        try {
          await api(`/api/periods/${encodeURIComponent(periodId)}/assignments/${encodeURIComponent(teacher.userId)}`, { method: 'DELETE', body: JSON.stringify({ password }) });
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
            ${departments.filter(item => item.active || String(item.departmentId) === String(account.departmentId)).map(item => `<option value="${esc(item.departmentId)}" ${String(item.departmentId) === String(account.departmentId) ? 'selected' : ''} ${item.active ? '' : 'disabled'}>${esc(item.name)}${item.active ? '' : ' (Inactive)'}</option>`).join('')}
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

  function updateAdviserSections() {
    const gradeSelect = $('adviserGradeInput');
    const sectionSelect = $('adviserSectionInput');
    const hint = $('adviserSectionHint');
    if (!gradeSelect || !sectionSelect) return;
    const grade = gradeSelect.value;
    const previousSection = sectionSelect.value;
    const availableSections = [...new Set(students
      .filter(student => student.active !== false && !student.archivedAt && String(student.gradeLevel || '') === grade)
      .map(student => String(student.section || '').trim())
      .filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    sectionSelect.innerHTML = '<option value="">Choose enrolled section</option>' +
      availableSections.map(section => `<option value="${esc(section)}">${esc(section)}</option>`).join('');
    sectionSelect.disabled = availableSections.length === 0;
    if (availableSections.includes(previousSection)) sectionSelect.value = previousSection;
    if (hint) hint.textContent = availableSections.length
      ? availableSections.length + ' enrolled section' + (availableSections.length === 1 ? '' : 's') + ' available for ' + grade + '. Special-program sections such as SPJ are included.'
      : (grade ? 'No active enrolled sections were found for this grade.' : 'Choose a grade to see its enrolled sections.');
  }

  function renderAdviserAssignments() {
    const host = $('adviserAssignmentRows');
    if (!host) return;
    const advisers = teachers.filter(item => Array.isArray(item.teacherDesignations) &&
      item.teacherDesignations.includes('CLASS_ADVISER') && item.active &&
      (user.role !== 'DEPARTMENT_HEAD' || String(item.departmentId) === String(user.departmentId)));
    const teacherSelect = $('adviserTeacherSelect');
    if (teacherSelect) {
      const previous = teacherSelect.value;
      teacherSelect.innerHTML = '<option value="">Choose an eligible teacher</option>' +
        advisers.map(item => `<option value="${esc(item.userId)}">${esc(item.displayName)}</option>`).join('');
      if (advisers.some(item => String(item.userId) === previous)) teacherSelect.value = previous;
    }

    const gradeSelect = $('adviserGradeInput');
    if (gradeSelect) {
      const previousGrade = gradeSelect.value;
      const availableGrades = [...new Set(students
        .filter(student => student.active !== false && !student.archivedAt && String(student.gradeLevel || '').trim())
        .map(student => String(student.gradeLevel).trim()))]
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      gradeSelect.innerHTML = '<option value="">Choose grade level</option>' +
        availableGrades.map(grade => `<option value="${esc(grade)}">${esc(grade)}</option>`).join('');
      if (availableGrades.includes(previousGrade)) gradeSelect.value = previousGrade;
      if (!gradeSelect.dataset.sectionPickerBound) {
        gradeSelect.addEventListener('change', updateAdviserSections);
        gradeSelect.dataset.sectionPickerBound = '1';
      }
      updateAdviserSections();
    }

    const addButton = $('addAdviserAssignmentButton');
    const form = $('adviserAssignmentForm');
    if (addButton && !addButton.dataset.formToggleBound) {
      addButton.addEventListener('click', () => {
        form.hidden = false;
        $('adviserAssignmentFeedback').textContent = '';
        addButton.hidden = true;
        $('adviserTeacherSelect')?.focus();
      });
      addButton.dataset.formToggleBound = '1';
    }
    if (form && !form.dataset.cancelBound) {
      $('cancelAdviserAssignment')?.addEventListener('click', () => {
        form.reset();
        form.hidden = true;
        if (addButton) addButton.hidden = false;
        updateAdviserSections();
        const feedback = $('adviserAssignmentFeedback');
        if (feedback) { feedback.textContent = ''; feedback.className = 'inline-feedback'; }
      });
      form.dataset.cancelBound = '1';
    }

    const count = $('adviserAssignmentCount');
    if (count) count.textContent = adviserAssignments.length + ' assigned section' + (adviserAssignments.length === 1 ? '' : 's');
    host.innerHTML = adviserAssignments.length ? adviserAssignments.map(item => `
      <tr><td><strong>${esc(item.gradeLevel)}</strong></td><td><span class="adviser-section-chip">${esc(item.section)}</span></td><td>${esc(item.adviserName || item.adviserUserId)}</td>
      <td>${['SCHOOL_ADMIN','DEPARTMENT_HEAD'].includes(user.role)
        ? '<div class="action-row"><button type="button" class="outline-button compact-button" data-edit-adviser="' + esc(item.assignmentId) + '">Edit</button><button type="button" class="outline-button compact-button danger-button" data-remove-adviser="' + esc(item.assignmentId) + '">Remove</button></div>'
        : '<span class="muted-inline">View only</span>'}</td></tr>`).join('')
      : '<tr><td colspan="4" class="empty-cell">No Class Adviser assignments yet. Use “Assign Class Adviser” to assign the first section.</td></tr>';
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

  async function loadSchedulingSettings() {
    const canRead = ['SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER'].includes(user.role);
    if (!canRead) return;
    try {
      const [daysResult, templatesResult, exceptionsResult] = await Promise.all([
        api('/api/scheduling-config/operating-days'),
        api('/api/scheduling-config/templates'),
        api('/api/scheduling-config/calendar-exceptions?from=' + encodeURIComponent(schoolDateManila()) + '&to=' + encodeURIComponent(new Date(Date.now() + 365 * 86400000).toISOString().slice(0,10)))
      ]);
      schoolOperatingDays = daysResult.days || [];
      timetableTemplates = templatesResult.templates || [];
      renderCalendarExceptions(exceptionsResult.exceptions || []);
      const exceptionScheduleSelect = $('calendarExceptionSchedules');
      if (exceptionScheduleSelect) exceptionScheduleSelect.innerHTML = periods.map(period => '<option value="' + esc(period.periodId) + '">' + esc(period.gradeLevel + ' · ' + (period.section || 'All sections') + ' · ' + (period.subjectName || period.periodName)) + '</option>').join('');
      const dayMap = new Map(schoolOperatingDays.map(day => [Number(day.weekday), Boolean(day.isOperatingDay)]));
      document.querySelectorAll('#operatingDayChoices input[type="checkbox"]').forEach(input => {
        input.checked = dayMap.has(Number(input.value)) ? dayMap.get(Number(input.value)) : Number(input.value)>=1 && Number(input.value)<=5;
      });
      const configuredDays = schoolOperatingDays.filter(day=>day.isOperatingDay).map(day=>Number(day.weekday));
      document.querySelectorAll('#scheduleWeekdayChoices input[type="checkbox"]').forEach(input => {
        input.checked = configuredDays.length ? configuredDays.includes(Number(input.value)) : Number(input.value)>=1 && Number(input.value)<=5;
      });
      const select = $('scheduleTemplatePeriod');
      if (select) {
        select.innerHTML = '<option value="">Custom time</option>' + timetableTemplates.filter(template => template.active).flatMap(template =>
          (template.periods || []).filter(period => !['BREAK','LUNCH'].includes(period.blockType)).map(period =>
            '<option value="' + esc(template.templateId + '|' + period.templatePeriodId) + '">' +
            esc(template.name + ' · ' + period.label + ' (' + period.startTime + '–' + period.endTime + ')') + '</option>')
        ).join('');
      }
      const list = $('timetableTemplateList');
      if (list) list.innerHTML = '<strong>Saved templates</strong>' + (timetableTemplates.length
        ? '<div class="timetable-template-chips">' + timetableTemplates.map(template =>
          '<div class="timetable-saved-template"><strong>' + esc(template.name) + (template.active ? '' : ' (Archived)') + '</strong><small>' + esc(template.shiftCode) + '</small>' +
          '<ul>' + (template.periods || []).map(p => '<li>' + esc(p.label) + ' · ' + esc(p.startTime) + '–' + esc(p.endTime) + ' (' + esc(p.blockType) + ')</li>').join('') + '</ul>' +
          (user.role === 'SCHOOL_ADMIN' && template.active ? '<div class="form-actions"><button type="button" class="outline-button compact-button" data-template-edit="' + esc(template.templateId) + '">Edit</button><button type="button" class="outline-button compact-button" data-template-duplicate="' + esc(template.templateId) + '">Duplicate</button><button type="button" class="outline-button compact-button" data-template-remove="' + esc(template.templateId) + '">Delete / Archive</button></div>' : '') + '</div>'
        ).join('') + '</div>'
        : '<p>No templates yet. Create a template to reuse period times.</p>');
    } catch (error) {
      console.warn('Scheduling settings could not be loaded:', error.message);
      if ($('operatingDaysFeedback')) { $('operatingDaysFeedback').textContent = 'Unable to load settings. Check your connection and refresh before editing. ' + error.message; $('operatingDaysFeedback').classList.add('error'); }
    }
  }

  function renderCalendarExceptions(items) {
    calendarExceptionItems = Array.isArray(items) ? items : [];
    const host=$('calendarExceptionList'); if(!host)return;
    const labels={CLOSED:'Closed',OPEN:'Additional operating day',SPECIAL_CLASS:'Special classes',SHORTENED_DAY:'Shortened day'};
    host.innerHTML='<strong>Saved calendar dates</strong>'+(items.length?'<div class="timetable-template-chips">'+items.map(item=>
      '<span><b>'+esc(item.date)+' · '+esc(item.title)+'</b><small>'+esc(labels[item.type]||item.type)+(item.dismissalTime?' · Dismissal '+esc(item.dismissalTime):'')+
      (item.schedules?.length?' · '+item.schedules.length+' selected schedule(s)':'')+'</small>'+
      (user.role==='SCHOOL_ADMIN'?'<span class="calendar-exception-actions"><button type="button" class="secondary-button compact-button" data-edit-calendar-exception="'+esc(item.exceptionId)+'">Edit</button><button type="button" class="secondary-button compact-button" data-delete-calendar-exception="'+esc(item.exceptionId)+'">Delete</button></span>':'')+'</span>'
    ).join('')+'</div>':'<p>No upcoming calendar exceptions have been saved.</p>');
  }
  async function refreshCalendarExceptions() {
    const from=schoolDateManila(),to=new Date(Date.now()+365*86400000).toISOString().slice(0,10);
    const result=await api('/api/scheduling-config/calendar-exceptions?from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to));
    renderCalendarExceptions(result.exceptions||[]);
  }
  function updateCalendarExceptionFields() {
    const type=$('calendarExceptionType')?.value;
    if($('calendarDismissalWrap'))$('calendarDismissalWrap').hidden=type!=='SHORTENED_DAY';
    if($('calendarSchedulesWrap'))$('calendarSchedulesWrap').hidden=!['OPEN','SPECIAL_CLASS'].includes(type);
    if($('calendarDismissalTime'))$('calendarDismissalTime').required=type==='SHORTENED_DAY';
    if($('calendarExceptionSchedules'))$('calendarExceptionSchedules').required=['OPEN','SPECIAL_CLASS'].includes(type);
  }

  function formatScheduleDays(weekdays) {
    const names=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return Array.isArray(weekdays)&&weekdays.length ? weekdays.map(day=>names[Number(day)]).filter(Boolean).join(', ') : 'Mon–Fri';
  }

  function selectedScheduleWeekdays() {
    return Array.from(document.querySelectorAll('#scheduleWeekdayChoices input[type="checkbox"]:checked'))
      .map(input => Number(input.value)).filter(day => Number.isInteger(day) && day>=0 && day<=6);
  }

  function applyTemplatePeriodSelection() {
    const raw = $('scheduleTemplatePeriod')?.value || '';
    if (!raw) return;
    const [templateId, periodId] = raw.split('|');
    const template = timetableTemplates.find(item => String(item.templateId) === templateId);
    const period = template?.periods?.find(item => String(item.templatePeriodId) === periodId);
    if (!period) return;
    $('periodName').value = period.label;
    $('startTime').value = period.startTime;
    $('endTime').value = period.endTime;
    $('scheduleFormFeedback').textContent = 'Times filled from ' + template.name + '. You can still adjust them if authorized.';
  }

  function templateMinutes(value) {
    if (!/^\d{2}:\d{2}$/.test(value || '')) return NaN;
    const parts = value.split(':').map(Number);
    if (parts[0] > 23 || parts[1] > 59) return NaN;
    return parts[0] * 60 + parts[1];
  }

  function templateClock(minutes) {
    return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
  }

  function updateTemplateBlockSummary() {
    const host = $('templateBlockRows');
    const status = $('templateBlockSummary');
    if (!host || !status) return;
    const rows = Array.from(host.children);
    const blocks = rows.map((row, index) => {
      const label = row.querySelector('[data-block-label]')?.value.trim() || '';
      const start = templateMinutes(row.querySelector('[data-block-start]')?.value);
      const end = templateMinutes(row.querySelector('[data-block-end]')?.value);
      row.querySelector('[data-block-number]').textContent = String(index + 1).padStart(2, '0');
      row.querySelector('[data-remove-block]').setAttribute('aria-label', 'Remove block ' + (index + 1) + (label ? ': ' + label : ''));
      const valid = label && Number.isFinite(start) && Number.isFinite(end) && end > start;
      row.classList.toggle('is-invalid', !valid);
      row.querySelector('[data-block-duration]').textContent = valid ? (end - start) + ' min' : 'Check time';
      return { row, start, end, valid };
    });
    const ordered = [...blocks].filter(block => block.valid).sort((a, b) => a.start - b.start);
    let overlaps = 0;
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i].start < ordered[i - 1].end) {
        ordered[i].row.classList.add('is-invalid');
        ordered[i - 1].row.classList.add('is-invalid');
        overlaps++;
      }
    }
    rows.forEach(row => {
      row.querySelectorAll('[data-block-start],[data-block-end]').forEach(field => {
        field.setAttribute('aria-invalid', String(row.classList.contains('is-invalid')));
      });
    });
    const outOfOrder = blocks.some((block, index) => index > 0 && Number.isFinite(block.start) && Number.isFinite(blocks[index - 1].start) && block.start < blocks[index - 1].start);
    const validTimes = ordered.length;
    const firstTime = validTimes ? templateClock(ordered[0].start) : '';
    const lastTime = validTimes ? templateClock(Math.max(...ordered.map(block => block.end))) : '';
    const invalid = blocks.some(block => !block.valid);
    status.classList.toggle('has-warning', Boolean(invalid || overlaps || outOfOrder));
    status.textContent = rows.length + (rows.length === 1 ? ' block' : ' blocks') +
      (firstTime && lastTime ? ' · ' + firstTime + '–' + lastTime : '') +
      (overlaps ? ' · Overlapping times' : invalid ? ' · Check highlighted blocks' : outOfOrder ? ' · Sort by time' : '');
  }

  function addTemplateBlock(type = 'CLASS') {
    const host = $('templateBlockRows');
    if (!host || host.children.length >= 100) return;
    const previousEnd = host.lastElementChild?.querySelector('[data-block-end]')?.value || '07:30';
    const duration = type === 'BREAK' ? 15 : type === 'LUNCH' ? 45 : 60;
    const startMinutes = templateMinutes(previousEnd);
    const validStart = Number.isFinite(startMinutes) && startMinutes + duration < 1440 ? startMinutes : 450;
    const row = document.createElement('div');
    row.className = 'template-block-row';
    row.setAttribute('role', 'group');
    row.innerHTML = '<span class="template-row-index" data-block-number></span>' +
      '<label class="template-block-name"><span class="template-mobile-label">Period / activity</span><input data-block-label required maxlength="80" placeholder="e.g. Period 1"></label>' +
      '<label class="template-block-kind"><span class="template-mobile-label">Type</span><select data-block-type><option value="CLASS">Class</option><option value="BREAK">Break</option><option value="LUNCH">Lunch</option><option value="HOMEROOM">Homeroom</option><option value="ADVISORY">Advisory</option><option value="OTHER">Other</option></select></label>' +
      '<label class="template-block-start"><span class="template-mobile-label">Start</span><input data-block-start type="time" required step="60"></label>' +
      '<label class="template-block-end"><span class="template-mobile-label">End</span><input data-block-end type="time" required step="60"><small class="template-row-duration" data-block-duration></small></label>' +
      '<button type="button" class="template-remove-button" data-remove-block title="Remove block" aria-label="Remove block">×</button>';
    row.querySelector('[data-block-type]').value = type;
    row.querySelector('[data-block-label]').value = type === 'BREAK' ? 'Morning break' : type === 'LUNCH' ? 'Lunch' : 'Period ' + (host.children.length + 1);
    row.querySelector('[data-block-start]').value = templateClock(validStart);
    row.querySelector('[data-block-end]').value = templateClock(validStart + duration);
    row.querySelector('[data-remove-block]').addEventListener('click', () => {
      row.remove();
      if (!host.children.length) addTemplateBlock();
      updateTemplateBlockSummary();
    });
    host.append(row);
    updateTemplateBlockSummary();
  }

  function wireSchedulingSettingsForms() {
    addTemplateBlock();
    $('addTemplateBlock')?.addEventListener('click', () => {
      addTemplateBlock();
      $('templateBlockRows').lastElementChild?.querySelector('[data-block-label]')?.focus();
    });
    document.querySelectorAll('#timetableTemplateForm [data-add-template-type]').forEach(button => {
      button.addEventListener('click', () => {
        addTemplateBlock(button.dataset.addTemplateType);
        $('templateBlockRows').lastElementChild?.querySelector('[data-block-label]')?.focus();
      });
    });
    $('sortTemplateBlocks')?.addEventListener('click', () => {
      const host = $('templateBlockRows');
      const sorted = [...host.children].sort((left, right) => 
        (left.querySelector('[data-block-start]').value || '').localeCompare(right.querySelector('[data-block-start]').value || ''));
      host.append(...sorted);
      updateTemplateBlockSummary();
      $('templateFeedback').textContent = 'Blocks sorted by start time.';
    });
    $('templateBlockRows')?.addEventListener('input', updateTemplateBlockSummary);
    $('templateBlockRows')?.addEventListener('change', updateTemplateBlockSummary);
    $('cancelTemplateEdit')?.addEventListener('click',()=>{
      delete $('timetableTemplateForm').dataset.editingId;
      $('timetableTemplateForm').reset();$('templateBlockRows').replaceChildren();addTemplateBlock();updateTemplateBlockSummary();
      $('saveTemplateButton').textContent='Save template';$('cancelTemplateEdit').hidden=true;
      $('templateFeedback').textContent='Edit cancelled.';
    });
    $('timetableTemplateList')?.addEventListener('click',async event=>{
      const button=event.target.closest('button[data-template-edit],button[data-template-duplicate],button[data-template-remove]');
      if(!button||user.role!=='SCHOOL_ADMIN')return;
      const id=button.dataset.templateEdit||button.dataset.templateDuplicate||button.dataset.templateRemove;
      const template=timetableTemplates.find(t=>String(t.templateId)===String(id));
      if(!template)return;
      if(button.dataset.templateRemove){
        if(!confirm('Delete this template if unused, or archive it if schedules reference it? Existing schedules and attendance will be preserved.'))return;
        try{const result=await api('/api/scheduling-config/templates/'+encodeURIComponent(id),{method:'DELETE'});
          await loadSchedulingSettings();showToast('Template '+result.action+'.');
        }catch(error){showToast(error.message,true);}
        return;
      }
      $('templateName').value=template.name+(button.dataset.templateDuplicate?' (copy)':'');
      $('templateShift').value=template.shiftCode;
      $('templateBlockRows').replaceChildren();
      (template.periods||[]).forEach(p=>{
        addTemplateBlock();
        const row=$('templateBlockRows').lastElementChild;
        row.querySelector('[data-block-label]').value=p.label;
        row.querySelector('[data-block-type]').value=p.blockType;
        row.querySelector('[data-block-start]').value=p.startTime;
        row.querySelector('[data-block-end]').value=p.endTime;
      });
      updateTemplateBlockSummary();
      if(button.dataset.templateEdit){
        $('timetableTemplateForm').dataset.editingId=id;
        $('saveTemplateButton').textContent='Save changes';
        $('cancelTemplateEdit').hidden=false;
      }else{
        delete $('timetableTemplateForm').dataset.editingId;
        $('saveTemplateButton').textContent='Save duplicate';
        $('cancelTemplateEdit').hidden=false;
      }
      $('timetableTemplateForm').scrollIntoView({behavior:'smooth',block:'start'});
      $('templateName').focus({preventScroll:true});
    });
    $('operatingDaysForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const feedback = $('operatingDaysFeedback');
      const days = Array.from({length:7},(_,weekday)=>({weekday,isOperatingDay:Boolean(document.querySelector('#operatingDayChoices input[value="' + weekday + '"]')?.checked)}));
      if (!days.some(day=>day.isOperatingDay)) { feedback.textContent='Select at least one operating day.'; return; }
      feedback.textContent='Saving…';
      try { await api('/api/scheduling-config/operating-days',{method:'PUT',body:JSON.stringify({days})}); schoolOperatingDays=days;
        document.querySelectorAll('#scheduleWeekdayChoices input[type="checkbox"]').forEach(input=>{input.checked=days.some(day=>day.isOperatingDay&&Number(day.weekday)===Number(input.value));});
        feedback.textContent='Operating days saved.'; }
      catch(error){feedback.textContent=error.message;}
    });
    $('timetableTemplateForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const feedback=$('templateFeedback');
      const periods = [...$('templateBlockRows').children].map((row,index) => ({
        order:index+1, label:row.querySelector('[data-block-label]').value.trim(),
        startTime:row.querySelector('[data-block-start]').value,
        endTime:row.querySelector('[data-block-end]').value,
        blockType:row.querySelector('[data-block-type]').value
      })).sort((a,b) => a.startTime.localeCompare(b.startTime));
      for (let i=0;i<periods.length;i++) {
        const block=periods[i]; block.order=i+1;
        if (!block.label || !block.startTime || !block.endTime || block.endTime<=block.startTime) {
          feedback.textContent='Each block needs a label and an end time later than its start.'; return;
        }
        if (i && block.startTime<periods[i-1].endTime) {
          feedback.textContent=block.label+' overlaps '+periods[i-1].label+'. Adjust their times.'; return;
        }
      }
      feedback.textContent='Saving template…';
      try {
        const editingId = $('timetableTemplateForm').dataset.editingId;
        await api('/api/scheduling-config/templates' + (editingId ? '/' + encodeURIComponent(editingId) : ''),{method:editingId?'PUT':'POST',body:JSON.stringify({name:$('templateName').value.trim(),shiftCode:$('templateShift').value,periods})});
        delete $('timetableTemplateForm').dataset.editingId;
        $('saveTemplateButton').textContent = 'Save template';
        $('cancelTemplateEdit').hidden = true;
        $('timetableTemplateForm').reset(); $('templateBlockRows').replaceChildren(); addTemplateBlock(); await loadSchedulingSettings(); feedback.textContent='Template saved.';
      } catch(error){feedback.textContent=error.message;}
    });
    $('cancelCalendarExceptionEdit')?.addEventListener('click',()=>{
      $('calendarExceptionForm').reset();
      $('calendarExceptionForm').dataset.editing='false';
      delete $('calendarExceptionForm').dataset.exceptionId;
      const saveButton=$('calendarExceptionForm').querySelector('button[type="submit"]');
      if(saveButton)saveButton.textContent='Save calendar date';
      $('cancelCalendarExceptionEdit').hidden=true;
      $('calendarExceptionFeedback').textContent='Edit cancelled.';
      updateCalendarExceptionFields();
    });
    $('calendarExceptionType')?.addEventListener('change',updateCalendarExceptionFields);
    updateCalendarExceptionFields();
    $('calendarExceptionForm')?.addEventListener('submit',async event=>{
      event.preventDefault();const feedback=$('calendarExceptionFeedback');feedback.textContent='Saving…';
      try{
        const type=$('calendarExceptionType').value;
        const periodIds=Array.from($('calendarExceptionSchedules')?.selectedOptions||[]).map(option=>option.value);
        await api('/api/scheduling-config/calendar-exceptions',{method:'POST',body:JSON.stringify({
          date:$('calendarExceptionDate').value,title:$('calendarExceptionTitle').value.trim(),type,
          exceptionId:$('calendarExceptionForm').dataset.exceptionId||null,
          dismissalTime:type==='SHORTENED_DAY'?$('calendarDismissalTime').value:null,
          periodIds,notes:$('calendarExceptionNotes').value.trim()||null
        })});
        $('calendarExceptionForm').reset();
        $('calendarExceptionForm').dataset.editing='false';
        delete $('calendarExceptionForm').dataset.exceptionId;
        const saveButton=$('calendarExceptionForm').querySelector('button[type="submit"]');
        if(saveButton)saveButton.textContent='Save calendar date';
        $('cancelCalendarExceptionEdit')?.setAttribute('hidden','');
        updateCalendarExceptionFields();await refreshCalendarExceptions();
        feedback.textContent='Calendar date saved.';
      }catch(error){feedback.textContent=error.message;}
    });
    $('calendarExceptionList')?.addEventListener('click',async event=>{
      const editButton=event.target.closest('[data-edit-calendar-exception]');
      if(editButton){
        const item=calendarExceptionItems.find(entry=>String(entry.exceptionId)===editButton.dataset.editCalendarException);
        if(!item)return;
        $('calendarExceptionDate').value=item.date;
        $('calendarExceptionTitle').value=item.title||'';
        $('calendarExceptionType').value=item.type;
        $('calendarDismissalTime').value=item.dismissalTime||'';
        $('calendarExceptionNotes').value=item.notes||'';
        const selected=new Set(item.periodIds||[]);
        Array.from($('calendarExceptionSchedules')?.options||[]).forEach(option=>{option.selected=selected.has(option.value);});
        $('calendarExceptionForm').dataset.editing='true';
        $('calendarExceptionForm').dataset.exceptionId=item.exceptionId;
        const saveButton=$('calendarExceptionForm').querySelector('button[type="submit"]');
        if(saveButton)saveButton.textContent='Update calendar date';
        $('cancelCalendarExceptionEdit')?.removeAttribute('hidden');
        updateCalendarExceptionFields();
        $('calendarExceptionFeedback').textContent='Editing saved date. Saving will update this date, not create a duplicate.';
        $('calendarExceptionForm').scrollIntoView({behavior:'smooth',block:'start'});
        return;
      }
      const button=event.target.closest('[data-delete-calendar-exception]');if(!button)return;
      if(!confirm('Delete this calendar exception? This will not delete attendance records.'))return;
      button.disabled=true;
      try{await api('/api/scheduling-config/calendar-exceptions/'+encodeURIComponent(button.dataset.deleteCalendarException),{method:'DELETE'});await refreshCalendarExceptions();}
      catch(error){button.disabled=false;showToast(error.message,true);}
    });
    $('scheduleTemplatePeriod')?.addEventListener('change',applyTemplatePeriodSelection);
  }

  wireSchedulingSettingsForms();

  function availableAdjustmentPeriods() {
    return periods.filter(p=>user.role==='SCHOOL_ADMIN' ||
      (user.role==='DEPARTMENT_HEAD'&&String(p.scheduleDepartmentId)===String(user.departmentId)));
  }

  function populateAdjustmentPeriodOptions() {
    const select=$('adjustmentPeriodId');
    if(!select)return;
    const previous=select.value;
    const options=availableAdjustmentPeriods();
    select.innerHTML='<option value="">Choose a class schedule</option>'+
      options.map(p=>'<option value="'+esc(p.periodId)+'">'+
        esc(p.gradeLevel+' · '+p.section+' · '+p.subjectName+' · '+p.startTime+'–'+p.endTime)+'</option>').join('');
    if(options.some(p=>String(p.periodId)===previous))select.value=previous;
    if($('toggleScheduleAdjustmentForm'))$('toggleScheduleAdjustmentForm').hidden=
      !['SCHOOL_ADMIN','DEPARTMENT_HEAD'].includes(user.role);
  }

  function setAdjustmentFields() {
    const type=$('adjustmentType')?.value;
    const chosen=periods.find(p=>String(p.periodId)===$('adjustmentPeriodId')?.value);
    if(!chosen)return;
    $('adjustmentTeacherWrap').hidden=!['SUBSTITUTE','REPLACE'].includes(type);
    $('adjustmentSubjectWrap').hidden=type!=='REPLACE';
    $('adjustmentDepartmentWrap').hidden=type!=='REPLACE'||user.role!=='SCHOOL_ADMIN';
    $('adjustmentStartWrap').hidden=!['RESCHEDULE','REPLACE'].includes(type);
    $('adjustmentEndWrap').hidden=!['RESCHEDULE','REPLACE'].includes(type);
    $('adjustmentRoomWrap').hidden=!['RESCHEDULE','REPLACE'].includes(type);
    const teacherDept=type==='REPLACE'&&user.role==='SCHOOL_ADMIN'
      ?$('adjustmentDepartment').value:String(chosen.scheduleDepartmentId||chosen.departmentId||'');
    const select=$('adjustmentTeacher');
    const previous=select.value;
    const eligible=teachers.filter(t=>t.active&&(t.teacherDesignations||[]).includes('SUBJECT_TEACHER')&&
      String(t.departmentId)===String(teacherDept));
    select.innerHTML='<option value="">'+(type==='REPLACE'?'Keep existing teacher':'Choose covering teacher')+'</option>'+
      eligible.map(t=>'<option value="'+esc(t.userId)+'">'+esc(t.displayName)+'</option>').join('');
    if(eligible.some(t=>t.userId===previous))select.value=previous;
    if(type==='RESCHEDULE'){
      if(!$('adjustmentStartTime').value)$('adjustmentStartTime').value=chosen.startTime||'';
      if(!$('adjustmentEndTime').value)$('adjustmentEndTime').value=chosen.endTime||'';
    }
    const descriptions={
      SUBSTITUTE:'The selected Subject Teacher covers this class on the specified date(s). The permanent teacher returns automatically afterward.',
      REPLACE:'This class meets as a different subject on the specified date(s). Choose a replacement department, subject and teacher as needed. The original timetable returns afterward.',
      RESCHEDULE:'Change this class time and/or room for the selected date(s). The normal weekday timetable is untouched.',
      CANCEL:'This class does not meet on the specified date(s). The following scheduled class days are unaffected.'
    };
    $('adjustmentFormDescription').textContent=descriptions[type]||'';
  }

  async function loadAdjustmentSubjects() {
    const chosen=periods.find(p=>String(p.periodId)===$('adjustmentPeriodId')?.value);
    const selector=$('adjustmentDepartment');
    if(!chosen||!selector)return;
    const departmentId=user.role==='SCHOOL_ADMIN'
      ?selector.value:String(chosen.scheduleDepartmentId||chosen.departmentId||'');
    const subject=$('adjustmentSubject'),previous=subject.value;
    subject.innerHTML='<option value="">Choose replacement subject</option>';
    if(!departmentId)return;
    try{
      const response=await api('/api/subjects?departmentId='+encodeURIComponent(departmentId));
      subject.innerHTML='<option value="">Choose replacement subject</option>'+
        (response.subjects||[]).map(item=>'<option value="'+esc(item.subjectId)+'">'+esc(item.subjectName)+'</option>').join('');
      if((response.subjects||[]).some(item=>item.subjectId===previous))subject.value=previous;
    }catch(error){$('scheduleAdjustmentFeedback').textContent=error.message;}
  }

  function openScheduleAdjustment(periodId,date) {
    const today=dataSchoolDate(),form=$('scheduleAdjustmentForm');
    if(!form)return;
    form.reset();
    populateAdjustmentPeriodOptions();
    if(periodId&&[...$('adjustmentPeriodId').options].some(option=>option.value===periodId))
      $('adjustmentPeriodId').value=periodId;
    const period=periods.find(p=>String(p.periodId)===$('adjustmentPeriodId').value);
    const departmentsToShow=departments.filter(d=>d.active!==false);
    $('adjustmentDepartment').innerHTML='<option value="">Choose department</option>'+
      departmentsToShow.map(d=>'<option value="'+esc(d.departmentId)+'">'+esc(d.name||d.departmentName)+'</option>').join('');
    const existing=periodId&&date?scheduleDateOverride(periodId,date):null;
    if(period)$('adjustmentDepartment').value=existing?.subjectDepartmentId||
      period.scheduleDepartmentId||period.departmentId||'';
    $('adjustmentStartDate').min=today;
    $('adjustmentEndDate').min=today;
    $('adjustmentStartDate').value=date&&date>=today?date:today;
    $('adjustmentEndDate').value=$('adjustmentStartDate').value;
    if(existing) {
      $('adjustmentType').value=existing.type;
      $('adjustmentReason').value=existing.reason;
      $('adjustmentNotes').value=existing.notes||'';
      $('adjustmentStartTime').value=existing.startTime||'';
      $('adjustmentEndTime').value=existing.endTime||'';
      $('adjustmentRoom').value=existing.classroom||'';
    }
    $('scheduleAdjustmentFeedback').textContent=existing
      ?'Editing the saved change for '+existing.date+'. This will replace only that date’s adjustment.'
      :'Choose a date when the selected class normally meets. Unscheduled days are skipped automatically.';
    form.hidden=false;
    setAdjustmentFields();
    if(existing?.teacherUserId&&[...$('adjustmentTeacher').options].some(o=>o.value===existing.teacherUserId))
      $('adjustmentTeacher').value=existing.teacherUserId;
    loadAdjustmentSubjects().then(()=>{
      if(existing?.subjectId&&[...$('adjustmentSubject').options].some(o=>o.value===existing.subjectId))
        $('adjustmentSubject').value=existing.subjectId;
    }).catch(error=>showToast(error.message,true));
    form.scrollIntoView({behavior:'smooth',block:'start'});
  }

  function wireScheduleAdjustments() {
    $('toggleScheduleAdjustmentForm')?.addEventListener('click',()=>openScheduleAdjustment());
    $('cancelScheduleAdjustment')?.addEventListener('click',()=>{$('scheduleAdjustmentForm').hidden=true;});
    $('adjustmentPeriodId')?.addEventListener('change',()=>{
      const p=periods.find(p=>String(p.periodId)===$('adjustmentPeriodId').value);
      if(p)$('adjustmentDepartment').value=p.scheduleDepartmentId||p.departmentId||'';
      $('adjustmentStartTime').value='';$('adjustmentEndTime').value='';
      setAdjustmentFields();loadAdjustmentSubjects().catch(e=>showToast(e.message,true));
    });
    $('adjustmentType')?.addEventListener('change',()=>{setAdjustmentFields();});
    $('adjustmentDepartment')?.addEventListener('change',()=>{
      setAdjustmentFields();loadAdjustmentSubjects().catch(e=>showToast(e.message,true));
    });
    $('adjustmentStartDate')?.addEventListener('change',()=>{
      $('adjustmentEndDate').min=$('adjustmentStartDate').value||dataSchoolDate();
      if($('adjustmentEndDate').value<$('adjustmentStartDate').value)
        $('adjustmentEndDate').value=$('adjustmentStartDate').value;
    });
    $('scheduleAdjustmentForm')?.addEventListener('submit',async e=>{
      e.preventDefault();
      const type=$('adjustmentType').value,periodId=$('adjustmentPeriodId').value;
      const period=periods.find(p=>String(p.periodId)===periodId);
      const payload={
        periodId,type,startDate:$('adjustmentStartDate').value,endDate:$('adjustmentEndDate').value,
        reason:$('adjustmentReason').value,notes:$('adjustmentNotes').value.trim()
      };
      if(['SUBSTITUTE','REPLACE'].includes(type))payload.teacherUserId=$('adjustmentTeacher').value||null;
      if(type==='REPLACE')payload.subjectId=$('adjustmentSubject').value||null;
      if(['RESCHEDULE','REPLACE'].includes(type)){
        payload.startTime=$('adjustmentStartTime').value||null;
        payload.endTime=$('adjustmentEndTime').value||null;
        payload.classroom=$('adjustmentRoom').value.trim()||null;
      }
      if(!period||!payload.startDate||!payload.endDate||payload.startDate>payload.endDate||
        (type==='SUBSTITUTE'&&!payload.teacherUserId)||(type==='REPLACE'&&!payload.subjectId)||
        (type==='RESCHEDULE'&&(!payload.startTime||!payload.endTime))){
        $('scheduleAdjustmentFeedback').textContent='Complete the required class, date, subject, teacher and time details.';
        return;
      }
      const summary=(type==='CANCEL'?'Cancel':type==='SUBSTITUTE'?'Arrange coverage for':
        type==='REPLACE'?'Replace subject for':'Change time for')+' '+
        period.subjectName+' · '+period.gradeLevel+' · '+period.section+' from '+
        payload.startDate+' through '+payload.endDate+'. The recurring schedule will not change.';
      if(!await AppDialog.confirm(summary,{title:'Confirm temporary timetable change',confirmText:'Save dated change'}))return;
      const button=$('saveScheduleAdjustment');
      button.disabled=true;$('scheduleAdjustmentFeedback').textContent='Checking daily conflicts and saving…';
      try{
        const result=await api('/api/schedule-adjustments',{method:'POST',body:JSON.stringify(payload)});
        $('scheduleAdjustmentForm').hidden=true;
        await loadScheduleAdjustments();
        showToast(result.updated+' class date(s) updated'+(result.skipped?' · '+result.skipped+' non-class date(s) skipped':'')+'. The regular timetable remains intact.');
      }catch(error){$('scheduleAdjustmentFeedback').textContent=error.message;showToast(error.message,true);}
      finally{button.disabled=false;}
    });
    $('datedScheduleList')?.addEventListener('click',async e=>{
      const button=e.target.closest('[data-remove-adjustment]');
      if(!button)return;
      if(!await AppDialog.confirm('Restore the regular timetable on this date? Previously recorded attendance will not be deleted.',{
        title:'Restore regular schedule',confirmText:'Restore schedule'}))return;
      button.disabled=true;
      try{
        await api('/api/schedule-adjustments/'+encodeURIComponent(button.dataset.removeAdjustment),{method:'DELETE'});
        await loadScheduleAdjustments();showToast('Regular schedule restored for the selected date.');
      }catch(error){button.disabled=false;showToast(error.message,true);}
    });
  }
  wireScheduleAdjustments();


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

    const isSchoolAdmin = role === 'SCHOOL_ADMIN';
    const isDepartmentHead = role === 'DEPARTMENT_HEAD';
    const isSchoolManager = isSchoolAdmin || isDepartmentHead;
    const canViewClassSchedules = isSchoolManager ||
      (role === 'TEACHER' && (teacherHas('SUBJECT_TEACHER') || teacherHas('CLASS_ADVISER')));
    $('teacherCoverageCard').hidden = !isDepartmentHead;
    if ($('departmentHeadOverview')) $('departmentHeadOverview').hidden = !isDepartmentHead;

    // Student records are independent of timetable, department, and dashboard APIs.
    // A failure in any secondary API must not prevent the roster from rendering.
    let rosterError = null;
    try {
      const roster = await api('/api/students');
      if (!Array.isArray(roster?.students)) throw new Error('The student service returned an invalid roster.');
      students = roster.students;
      // Show real student records immediately, before the slower secondary panels load.
      renderStudents().catch(error => showToast('Could not render students: ' + error.message, true));
    } catch (error) {
      rosterError = error;
      students = [];
      const table = $('studentRows');
      if (table) table.innerHTML = '<tr><td colspan="12" class="empty-cell">Student records could not be loaded: ' +
        esc(error.message) + '. Use Refresh to retry. No records have been deleted.</td></tr>';
      showToast('Student roster unavailable: ' + error.message, true);
    }
    const secondary = await Promise.allSettled([
      isSchoolAdmin ? Promise.resolve({}) : api('/api/admin/dashboard'),
      canViewClassSchedules ? api('/api/periods?weekDate='+encodeURIComponent($('weeklyScheduleAsOf')?.value||dataSchoolDate())) : Promise.resolve({ periods: [] }),
      isSchoolManager ? api('/api/departments') : Promise.resolve({ departments: [] })
    ]);
    const valueOr = (item, fallback, name) => {
      if (item.status === 'fulfilled') return item.value;
      console.warn('Attendigo ' + name + ' could not load:', item.reason);
      return fallback;
    };
    dashboardData = valueOr(secondary[0], {}, 'dashboard');
    periods = valueOr(secondary[1], { periods: [] }, 'timetable').periods || [];
    departments = valueOr(secondary[2], { departments: [] }, 'departments').departments || [];
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
      // When a teacher is also a Class Adviser, default to the assigned advisory
      // section so advisory-only classes (such as Grade 8 - SPJ) are not treated
      // as regular subject periods. Subject attendance remains selectable.
      scopeSelect.value = hasAdviserRole && adviserAssignments.length
        ? 'ADVISORY'
        : hasSubjectRole ? 'CLASS' : 'ADVISORY';
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
      const staffData = await api('/api/school-users');
      schoolUsers = (staffData.users || []).filter(account => ['DEPARTMENT_HEAD', 'GATE_KEEPER'].includes(account.role));
      renderStaffUsers();
    }
    if (role === 'DEPARTMENT_HEAD') {
      const adviserData = await api('/api/class-adviser-assignments');
      adviserAssignments = adviserData.assignments || [];
      renderAdviserAssignments();
    } else if (role === 'TEACHER' && (user.teacherDesignations || []).includes('CLASS_ADVISER')) {
      const adviserData = await api('/api/class-adviser-assignments');
      adviserAssignments = adviserData.assignments || [];
    }

    await loadSchedulingSettings();
    populateAdjustmentPeriodOptions();
    await loadScheduleAdjustments();
    renderStats(dashboardData);
    if (!rosterError) await renderStudents();
    renderPeriods();
    if (isSchoolManager) renderTeachers();
    if (isDepartmentHead) renderDepartmentHeadOverview();
    if (isDepartmentHead) {
      await loadTeacherCoverage(false);
    }
    // SF2 options are for Department Heads and teachers only.
    // School Administrators do not use the academic reporting workflow.
    if (['DEPARTMENT_HEAD', 'TEACHER'].includes(role)) {
      await loadSf2Options();
    }
    if (role === 'DEPARTMENT_HEAD') {
      $('sf2SubmissionsCard').hidden = false;
      await loadSf2Submissions();
    }
    if (role === 'TEACHER' && (user.teacherDesignations || []).includes('CLASS_ADVISER')) {
      renderAdviserAssignments();
    }
    if (role === 'SCHOOL_ADMIN') {
      const currentTab = $('adminManagementTabs')?.querySelector('.is-active')?.dataset.adminManagementTab || 'accounts';
      setAdminManagementTab(currentTab);
    }
  }

  let teacherHistoryData = [];
  let teacherHistoryPage = 0;
  function renderTeacherClassAttendance(records, requestedPage = 0) {
    teacherHistoryData = records;
    const pages = Math.max(1, Math.ceil(records.length / 10));
    teacherHistoryPage = Math.max(0, Math.min(pages - 1, requestedPage));
    const visibleRecords = records.slice(teacherHistoryPage * 10, teacherHistoryPage * 10 + 10);
    if ($('mfQrPageNum')) $('mfQrPageNum').textContent = 'Page ' + (teacherHistoryPage + 1) + ' of ' + pages;
    if ($('mfQrPrev')) $('mfQrPrev').disabled = teacherHistoryPage === 0;
    if ($('mfQrNext')) $('mfQrNext').disabled = teacherHistoryPage >= pages - 1;
    const host = $('teacherAttendanceRows');
    if (!host) return;
    $('teacherAttendanceCount').textContent = String(records.length);
    host.innerHTML = visibleRecords.length ? visibleRecords.map(item => {
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

  function applySchoolBranding(data) {
    schoolBranding = data;
    const name = data.schoolName || user.schoolName || 'School workspace';
    $('schoolTitle').textContent = name;
    $('schoolCodeLabel').textContent = data.schoolCode || user.schoolCode || 'SCHOOL WORKSPACE';
    $('sidebarSchoolName').textContent = name;
    const color = /^#[0-9a-f]{6}$/i.test(data.brandColor || '') ? data.brandColor : '#2463a5';
    document.documentElement.style.setProperty('--brand', color);
    const rgb = color.match(/[0-9a-f]{2}/gi).map(part => parseInt(part, 16));
    const darker = '#' + rgb.map(value => Math.round(value * 0.76).toString(16).padStart(2, '0')).join('');
    document.documentElement.style.setProperty('--brand-strong', darker);
    document.documentElement.style.setProperty('--sidebar', '#' + rgb.map(value => Math.round(value * 0.32).toString(16).padStart(2, '0')).join(''));
    document.documentElement.style.setProperty('--nav-active', darker);
    const emblem = $('schoolEmblem');
    const sidebarMark = $('sidebarSchoolMark');
    // Keep the existing image visible until loadSchoolBranding fetches the new binary.
    if (!data.logoUrl) {
      if (emblem) emblem.textContent = name.trim().charAt(0).toUpperCase();
      if (sidebarMark) sidebarMark.textContent = name.trim().charAt(0).toUpperCase();
    }
    if ($('schoolBrandingName')) $('schoolBrandingName').value = name;
    if ($('schoolBrandColor')) $('schoolBrandColor').value = color;
    const preview = $('schoolLogoPreview');
    if (preview && !data.logoUrl) preview.textContent = name.trim().charAt(0).toUpperCase();
  }

  async function loadSchoolBranding() {
    try {
      const data = await api('/api/school/branding');
      applySchoolBranding(data.branding);
      if (data.branding.logoUrl) {
        const response = await fetch(data.branding.logoUrl, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
        if (response.ok) {
          const blob = await response.blob();
          if (brandingLogoObjectUrl) URL.revokeObjectURL(brandingLogoObjectUrl);
          brandingLogoObjectUrl = URL.createObjectURL(blob);
          for (const node of [$('schoolEmblem'), $('sidebarSchoolMark'), $('schoolLogoPreview')]) {
            if (!node) continue;
            node.replaceChildren();
            const image = document.createElement('img'); image.src = brandingLogoObjectUrl; image.alt = `${data.branding.schoolName} logo`; node.append(image);
          }
        } else {
          $('schoolBrandingFeedback').textContent = 'The previous logo file is unavailable. Please upload it again to store it permanently.';
        }
      }
    } catch (error) {
      $('schoolBrandingFeedback').textContent = error.message;
    }
  }

  $('schoolBrandingForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const feedback = $('schoolBrandingFeedback'); feedback.textContent = 'Saving school identity…'; feedback.className = 'inline-feedback';
    try {
      const data = await api('/api/school/branding', { method: 'PUT', body: JSON.stringify({
        schoolName: $('schoolBrandingName').value.trim(), brandColor: $('schoolBrandColor').value
      }) });
      user.schoolName = data.branding.schoolName; sessionStorage.setItem(userKey, JSON.stringify(user));
      applySchoolBranding({ ...data.branding, logoUrl: schoolBranding?.logoUrl || null });
      feedback.textContent = 'School identity saved.'; showToast('School identity saved.');
    } catch (error) { feedback.textContent = error.message; feedback.className = 'inline-feedback error'; }
  });

  $('uploadSchoolLogo')?.addEventListener('click', async () => {
    const file = $('schoolLogoFile').files?.[0];
    const feedback = $('schoolBrandingFeedback');
    if (!file) { feedback.textContent = 'Choose a logo image first.'; return; }
    if (!window.ProfilePhotos?.edit) { feedback.textContent = 'Photo editor not available. Refresh the page and try again.'; return; }
    const button = $('uploadSchoolLogo'); button.disabled = true;
    try {
      // Allow zoom and repositioning for every school logo. The editor keeps
      // transparent pixels intact and exports PNG without a painted background.
      const edited = await window.ProfilePhotos.edit(file, { purpose: 'school-logo' });
      if (!edited) return;
      const binary = atob(edited.cropped);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const mime = 'image/png';
      if (bytes.length > 2 * 1024 * 1024) throw new Error('Logo exceeds 2 MB. Choose a smaller image.');
      const response = await fetch('/api/school/branding/logo', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': mime },
        body: bytes, cache: 'no-store'
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not upload logo.');
      $('schoolLogoFile').value = '';
      await loadSchoolBranding();
      feedback.textContent = 'School logo saved permanently.';
      feedback.className = 'inline-feedback';
      showToast('School logo updated.');
    } catch (error) { feedback.textContent = error.message; feedback.className = 'inline-feedback error'; }
    finally { button.disabled = false; }
  });

  $('removeSchoolLogo')?.addEventListener('click', async () => {
    try { await api('/api/school/branding/logo', { method: 'DELETE' }); await loadSchoolBranding(); $('schoolBrandingFeedback').textContent = 'School logo removed.'; }
    catch (error) { $('schoolBrandingFeedback').textContent = error.message; $('schoolBrandingFeedback').className = 'inline-feedback error'; }
  });


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
        ['Manual presence days', data.summary.manualPresentDays || 0],
        ['QR presence days', data.summary.qrPresentDays || 0],
        ['Conflicts to resolve', data.summary.conflicts || 0],
        [data.mode === 'PERSONAL' ? 'No record (this teacher)' : 'Pending review', data.mode === 'PERSONAL' ? data.summary.noRecord : data.summary.pending],
        ['Missing sex', data.summary.missingSex]
      ];
      $('sf2Summary').innerHTML = metrics.map(([label, value]) => `<article class="learner-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`).join('');
      $('sf2ModeNote').hidden = false;
      $('sf2ModeNote').textContent = `${data.note} ${data.calendarNote || ''}`;
      const sf2Head = $('sf2Rows').closest('table').querySelector('thead');
      sf2Head.innerHTML = '<tr><th scope="col">Learner</th><th scope="col">Sex</th>'+data.dates.map(date=>'<th scope="col" title="'+esc(date)+'">'+esc(new Date(date+'T12:00:00').toLocaleDateString('en-PH',{day:'numeric',month:'short'}))+'</th>').join('')+'</tr>';
      $('sf2TableWrap').classList.add('sf2-matrix-wrap');
      const sourceLabel = (status,sources) => {
        if(status==='CONFLICT')return ['conflict','!','Conflict'];
        if(status==='ABSENT')return ['absent','X','Confirmed absent'];
        if(status==='PENDING')return ['pending','?','Needs review'];
        if(status==='NO_RECORD')return ['missing','—','No record'];
        if(sources.includes('QR') && sources.some(v=>v.startsWith('MANUAL_')))return ['both','Q+M','QR and manual presence'];
        if(sources.includes('QR'))return ['qr','QR','QR check-in'];
        if(sources.includes('MANUAL_LATE'))return ['late','L','Manual late'];
        if(sources.includes('MANUAL_PRESENT'))return ['manual','M','Manual present'];
        return ['present','P','Present'];
      };
      $('sf2Rows').innerHTML = data.students.map(student => {
        const cells = student.days.map((status,index) => {
          const date=data.dates[index], sources=student.sources?.[index]||[];
          const [tone,label,meaning]=sourceLabel(status,sources);
          const title=esc(date+' · '+meaning+' · '+(sources.join(', ')||'No evidence source'));
          if(status==='PENDING'&&data.canConfirmAbsence)return '<td class="sf2-cell"><button type="button" class="sf2-mark pending" data-sf2-absent="'+esc(student.id)+'" data-date="'+esc(date)+'" title="'+title+'" aria-label="Review '+esc(student.name)+' on '+esc(date)+'">Review</button></td>';
          if(status==='ABSENT'&&data.canConfirmAbsence)return '<td class="sf2-cell"><button type="button" class="sf2-mark absent" data-sf2-remove-absent="'+esc(student.id)+'" data-date="'+esc(date)+'" title="'+title+'" aria-label="Remove confirmed absence for '+esc(student.name)+' on '+esc(date)+'">X</button></td>';
          return '<td class="sf2-cell"><span class="sf2-mark '+tone+'" title="'+title+'" aria-label="'+title+'">'+label+'</span></td>';
        }).join('');
        return '<tr data-sf2-row><th scope="row"><strong>'+esc(student.name)+'</strong><small>'+esc(student.gradeLevel)+' · '+esc(student.section)+'</small></th><td>'+esc(student.sex||'—')+'</td>'+cells+'</tr>';
      }).join('') || '<tr><td colspan="'+(data.dates.length+2)+'" class="empty-cell">No learners are enrolled in this section.</td></tr>';
      const wrap=$('sf2TableWrap');
      let tools=wrap.previousElementSibling;
      if(!tools||!tools.classList.contains('sf2-review-tools')){
        tools=document.createElement('div');tools.className='sf2-review-tools';wrap.before(tools);
        tools.innerHTML='<div class="sf2-legend"><span class="sf2-mark qr">QR</span> QR present <span class="sf2-mark manual">M</span> Manual present <span class="sf2-mark both">Q+M</span> Both <span class="sf2-mark late">L</span> Late <span class="sf2-mark absent">X</span> Absent <span class="sf2-mark conflict">!</span> Conflict <span class="sf2-mark pending">?</span> Review</div><div class="sf2-navigation"><button type="button" class="outline-button compact-button" data-sf2-scroll="-1">← Earlier</button><button type="button" class="outline-button compact-button" data-sf2-scroll="1">Later →</button><button type="button" class="outline-button compact-button" data-sf2-conflicts>Show conflicts only</button></div>';
        tools.addEventListener('click',event=>{
          const scroll=event.target.closest('[data-sf2-scroll]');
          if(scroll)wrap.scrollBy({left:Number(scroll.dataset.sf2Scroll)*Math.max(320,wrap.clientWidth*.7),behavior:'smooth'});
          const conflicts=event.target.closest('[data-sf2-conflicts]');
          if(conflicts){const active=conflicts.dataset.active!=='true';conflicts.dataset.active=String(active);conflicts.textContent=active?'Show all learners':'Show conflicts only';wrap.querySelectorAll('[data-sf2-row]').forEach(row=>{row.hidden=active&&!row.querySelector('.sf2-mark.conflict')});}
        });
      } else {
        const button=tools.querySelector('[data-sf2-conflicts]');
        if(button){button.dataset.active='false';button.textContent='Show conflicts only';}
      }
      const personal = data.mode === 'PERSONAL';
      const canExport = personal || (data.summary.pending === 0 && data.summary.conflicts === 0 && data.summary.missingSex === 0);
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
    if (user.mustChangePassword) { window.location.replace('/force-password-change.html'); return; }
    sessionStorage.setItem(userKey, JSON.stringify(user));
    $('userDisplay').textContent = user.displayName || user.username;
    if ($('userRole')) $('userRole').textContent = user.role.replaceAll('_', ' ');
    $('accountMenuName').textContent = user.displayName || user.username;
    $('accountMenuRole').textContent = user.role.replaceAll('_', ' ');
    $('userAvatar').textContent = (user.displayName || user.username || 'U').trim().charAt(0).toUpperCase();
    window.ProfilePhotos?.mountSelf({token,role:user.role,container:'#accountProfileDialog',displayName:user.displayName||user.username});
    window.ProfilePhotos?.mountReviews({token,role:user.role,designations:user.teacherDesignations||[]});
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
      const platformMenu = [
        ['platform', 'layout-dashboard', 'Platform overview'],
        ['platformSchools', 'school', 'Schools'],
        ['platformOnboard', 'school-plus', 'Onboard school'],
        ['platformPlans', 'credit-card', 'Plans & feature access'],
        ['platformSecurity', 'shield-check', 'Account security']
      ];
      const navigation = document.querySelector('.side-nav');
      navigation.replaceChildren();
      for (const [view, icon, label] of platformMenu) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'nav-item';
        button.dataset.view = view;
        button.title = label;
        const symbol = document.createElement('span');
        symbol.className = 'nav-icon';
        symbol.dataset.uiIcon = icon;
        const text = document.createElement('span');
        text.className = 'nav-label';
        text.textContent = label;
        button.append(symbol, text);
        button.addEventListener('click', () => setView(view));
        navigation.append(button);
      }
      $('refreshButton').hidden = true;
      setView('platform');
      try { await loadPlatformData(); }
      catch (error) { $('platformSchoolRows').innerHTML = `<tr><td colspan="7" class="empty-cell">${esc(error.message)}</td></tr>`; }
    } else {
      $('schoolTitle').textContent = user.schoolName || 'School workspace';
      $('schoolCodeLabel').textContent = user.schoolCode || 'SCHOOL WORKSPACE';
      $('schoolEmblem').textContent = (user.schoolName || 'S').trim().charAt(0).toUpperCase();
      try {
        schoolEntitlements = await api('/api/school/entitlements');
      } catch (error) {
        // Fail closed for optional modules when entitlement verification is unavailable.
        schoolEntitlements = {features:{planner:false,sms_notifications:false,advanced_analytics:false,custom_branding:false}};
        showToast('School feature access could not be verified. Optional modules are temporarily unavailable.',true);
      }
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
      await loadSchoolBranding();
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
      if ($('cloudSyncPendingCount')) $('cloudSyncPendingCount').textContent = String(data.pendingCount || 0);
      if ($('cloudSyncLastSuccess')) $('cloudSyncLastSuccess').textContent = data.lastSuccessAt ? new Date(data.lastSuccessAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : 'Not connected';
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
      $('cloudSyncEnabled').checked = Boolean(data.enabled);
      $('cloudSyncStatus').textContent = data.configured ? 'Saved · Not connected' : 'Not configured';
      $('cloudSyncFeedback').textContent = data.secretConfigured ? 'Cloud settings loaded.' : 'Set CLOUD_SYNC_SHARED_SECRET on both servers before enabling cloud forwarding.';
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
        method: 'PUT', body: JSON.stringify({ cloudBaseUrl: $('cloudBaseUrl').value.trim(), enabled: $('cloudSyncEnabled').checked })
      });
      $('cloudSyncStatus').textContent = data.configured ? 'Saved · Not connected' : 'Not configured';
      $('cloudSyncFeedback').textContent = data.message;
      await loadCloudSyncStatus();
      showToast(data.enabled ? 'Cloud forwarding enabled.' : 'Cloud destination saved.');
    } catch (error) {
      $('cloudSyncFeedback').className = 'inline-feedback error';
      $('cloudSyncFeedback').textContent = error.message;
    } finally { button.disabled = false; }
  });
  $('refreshCloudDestination')?.addEventListener('click', loadCloudSyncSettings);
  $('testCloudDestination')?.addEventListener('click', async () => {
    const button=$('testCloudDestination');button.disabled=true;$('cloudSyncFeedback').textContent='Testing secure connection…';
    try { const data=await api('/api/cloud-sync/test',{method:'POST'});$('cloudSyncFeedback').textContent=data.message;await loadCloudSyncStatus(); }
    catch(error){$('cloudSyncFeedback').textContent=error.message;$('cloudSyncFeedback').className='inline-feedback error';}
    finally{button.disabled=false;}
  });
  $('runCloudSync')?.addEventListener('click', async () => {
    const button=$('runCloudSync');button.disabled=true;$('cloudSyncFeedback').textContent='Sending pending attendance…';
    try { const data=await api('/api/cloud-sync/run',{method:'POST'});$('cloudSyncFeedback').textContent=`Sync finished. Sent ${data.sent||0}; failed ${data.failed||0}.`;
      await loadCloudSyncStatus(); }
    catch(error){$('cloudSyncFeedback').textContent=error.message;$('cloudSyncFeedback').className='inline-feedback error';}
    finally{button.disabled=false;}
  });

  async function loadPlatformData() {
    const [overview, schools, recovery] = await Promise.all([api('/api/platform/overview'),api('/api/platform/schools'),api('/api/platform/recovery/school-admins')]);
    const selection=$('platformRecoveryAdmin');
    if(selection){
      const previous=selection.value;
      selection.replaceChildren(new Option('Select an active School Admin',''));
      for(const entry of recovery.administrators){
        const label=entry.schoolName+' · '+entry.displayName+' ('+entry.username+')';
        selection.add(new Option(label,entry.schoolId+'|'+entry.userId));
      }
      if([...selection.options].some(option=>option.value===previous))selection.value=previous;
    }
    $('platformSchoolCount').textContent=String(overview.overview.schoolCount||0);
    $('platformActiveSchools').textContent=String(overview.overview.activeSchoolCount||0);
    $('platformActiveAccounts').textContent=String(overview.overview.activeAccountCount||0);
    $('platformQueuedSync').textContent=String(overview.overview.queuedSyncCount||0);
    const rows=$('platformSchoolRows');
    rows.innerHTML=schools.schools.length?schools.schools.map(s=>`<tr>
      <td><strong>${esc(s.schoolName)}</strong></td><td>${esc(s.schoolCode)}</td>
      <td>${esc(s.activeAccounts)}</td><td>${esc(s.activeLearners)}</td>
      <td>${s.cloudSyncEnabled?'Enabled':'—'}${s.cloudSyncError?`<small class="table-subtext">${esc(s.cloudSyncError)}</small>`:''}</td>
      <td><span class="status-tag ${s.active?'':'late'}">${s.active?'Active':'Inactive'}</span></td>
      <td><div class="platform-school-actions"><button class="outline-button compact-button" type="button" data-platform-school="${esc(s.schoolId)}" data-next-active="${!s.active}">${s.active?'Deactivate':'Activate'}</button><button class="outline-button compact-button platform-delete-button" type="button" data-platform-school-delete="${esc(s.schoolId)}" aria-label="Delete ${esc(s.schoolName)}">Delete</button></div></td>
    </tr>`).join(''):'<tr><td colspan="7" class="empty-cell">No schools registered yet.</td></tr>';
  }

  $('platformRecoveryForm')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const button=$('platformRecoveryIssueButton'),feedback=$('platformRecoveryFeedback');
    $('platformRecoveryResult').hidden=true;
    feedback.className='inline-feedback';
    const [schoolId,userId]=($('platformRecoveryAdmin').value||'').split('|');
    if(!schoolId||!userId){feedback.textContent='Select an active School Administrator.';return;}
    button.disabled=true;feedback.textContent='Verifying Super Admin identity…';
    try{
      const result=await api('/api/platform/recovery/issue',{method:'POST',body:JSON.stringify({
        schoolId,userId,superAdminPassword:$('platformRecoveryPassword').value
      })});
      $('platformRecoveryCode').textContent=result.recoveryCode;
      $('platformRecoveryExpiry').textContent='Expires '+new Date(result.expiresAt).toLocaleString('en-PH',{
        timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'
      })+' (Philippine time).';
      $('platformRecoveryResult').hidden=false;
      feedback.textContent='Code issued to '+result.displayName+'. Share it privately.';
      showToast('Recovery code issued successfully.');
    }catch(error){feedback.textContent=error.message;feedback.className='inline-feedback error';}
    finally{button.disabled=false;$('platformRecoveryPassword').value='';}
  });
  $('platformRecoveryCopy')?.addEventListener('click',async ()=>{
    const value=$('platformRecoveryCode').textContent;
    if(!value)return;
    try{await navigator.clipboard.writeText(value);showToast('Recovery code copied.');}
    catch{showToast('Clipboard unavailable. Select the code manually to copy it.',true);}
  });

  $('platformCreateSchoolForm')?.addEventListener('submit', async event => {
    event.preventDefault(); const button=$('platformCreateSchoolButton');button.disabled=true;
    const feedback=$('platformFeedback');feedback.textContent='Creating school and first administrator…';feedback.className='inline-feedback';
    try {
      await api('/api/platform/schools',{method:'POST',body:JSON.stringify({
        schoolCode:$('platformSchoolCode').value.trim(),schoolName:$('platformSchoolName').value.trim(),
        adminUsername:$('platformAdminUsername').value.trim(),adminDisplayName:$('platformAdminName').value.trim(),adminPassword:$('platformAdminPassword').value
      })});
      event.currentTarget.reset();feedback.textContent='School and first administrator created.';showToast('School onboarded.');await loadPlatformData();
    } catch(error){feedback.textContent=error.message;feedback.className='inline-feedback error';}
    finally{button.disabled=false;}
  });
  $('platformSchoolRows')?.addEventListener('click', async event => {
    const deleteButton=event.target.closest('[data-platform-school-delete]');
    if(deleteButton){
      deleteButton.disabled=true;
      try {
        const schoolId=deleteButton.dataset.platformSchoolDelete;
        const review=await api('/api/platform/schools/'+encodeURIComponent(schoolId)+'/deletion-preview');
        const school=review.school, counts=school.impact;
        const warning='Delete '+school.schoolName+' ('+school.schoolCode+')?\n\nThis will remove '+counts.students+' student records, '+counts.accounts+' school accounts, '+counts.attendanceEvents+' attendance events, '+counts.sf2Submissions+' SF2 submissions, '+counts.manualMarks+' manual marks, and '+counts.manualNotes+' notes.\n\n'+(counts.pendingSync?'WARNING: '+counts.pendingSync+' cloud sync items are still pending.\n\n':'')+'All associated school data and logins will be removed. A recovery snapshot must be saved and verified in the database before deletion can finish. This is not an off-site backup.';
        if(!await AppDialog.confirm(warning,{title:'First confirmation · Delete school',confirmText:'Continue to final confirmation',variant:'danger'}))return;
        const expected='DELETE '+school.schoolCode;
        const typed=await AppDialog.prompt('Final confirmation for '+school.schoolName+'. Type the exact phrase below to permanently remove the school from the active system:\n\n'+expected,'',{
          title:'Final confirmation · Irreversible action',label:'Confirmation phrase',required:true,variant:'danger',confirmText:'Delete school',
          validate:value=>value===expected?true:'Type exactly: '+expected
        });
        if(typed!==expected)return;
        await api('/api/platform/schools/'+encodeURIComponent(schoolId),{
          method:'DELETE',body:JSON.stringify({previewToken:review.previewToken,confirmationPhrase:typed})
        });
        await loadPlatformData();
        showToast('School deleted. A database recovery snapshot and audit record were saved.');
      }catch(error){showToast(error.message,true);}
      finally{deleteButton.disabled=false;}
      return;
    }
    const button=event.target.closest('[data-platform-school]');if(!button)return;
    const active=button.dataset.nextActive==='true';
    if(active===false&&!await AppDialog.confirm('Deactivate this school? All current school and student sessions will be signed out.',{title:'Deactivate school',confirmText:'Deactivate',variant:'danger'}))return;
    button.disabled=true;
    try{await api(`/api/platform/schools/${encodeURIComponent(button.dataset.platformSchool)}/status`,{method:'PATCH',body:JSON.stringify({active})});await loadPlatformData();showToast(active?'School activated.':'School deactivated.');}
    catch(error){showToast(error.message,true);button.disabled=false;}
  });
  $('platformRefreshButton')?.addEventListener('click',()=>loadPlatformData().catch(error=>showToast(error.message,true)));

  document.querySelectorAll('.nav-item[data-view]').forEach(button => {
    button.addEventListener('click', () => {
      setView(button.dataset.view);
      if (window.matchMedia('(max-width: 860px)').matches) closeMobileSidebar();
    });
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
  document.querySelectorAll('.nav-group-toggle[data-nav-group]').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.navGroup;
      const submenu = document.querySelector('[data-submenu="' + key + '"]');
      const opening = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(opening));
      if (submenu) submenu.hidden = !opening;
      const layout = document.querySelector('.portal-layout');
      if (layout.classList.contains('sidebar-collapsed') && !window.matchMedia('(max-width: 860px)').matches) {
        setSidebarCollapsed(false);
      }
    });
  });

  function setSidebarCollapsed(collapsed) {
    const layout = document.querySelector('.portal-layout');
    const control = $('sidebarCollapseButton');
    if (!layout) return;
    const nextCollapsed = Boolean(collapsed);
    layout.classList.toggle('sidebar-collapsed', nextCollapsed);
    layout.dataset.sidebarCollapsed = String(nextCollapsed);
    document.body.classList.toggle('portal-sidebar-collapsed', nextCollapsed);
    if (control) {
      control.setAttribute('aria-expanded', String(!nextCollapsed));
      control.setAttribute('aria-pressed', String(nextCollapsed));
      control.setAttribute('aria-label', nextCollapsed ? 'Expand sidebar' : 'Collapse sidebar');
      control.title = nextCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
      const arrow = control.querySelector('.sidebar-toggle-glyph');
      if (arrow) arrow.innerHTML = window.DashboardIcons?.html(nextCollapsed ? 'panel-expand' : 'panel-collapse') || (nextCollapsed ? '›' : '‹');
      const label = control.querySelector('.collapse-control-label');
      if (label) label.textContent = nextCollapsed ? 'Expand menu' : 'Collapse menu';
    }
    try { localStorage.setItem('attendance-sidebar-collapsed', nextCollapsed ? '1' : '0'); } catch {}
  }
  function closeMobileSidebar() {
    $('sidebar').classList.remove('open');
    $('sidebarBackdrop').classList.remove('visible');
    document.body.classList.remove('sidebar-drawer-open');
    $('sidebarToggle').setAttribute('aria-expanded', 'false');
    $('sidebarToggle').setAttribute('aria-label', 'Open navigation');
    $('sidebarToggle').title = 'Open navigation';
    $('sidebarToggle').textContent = '☰';
  }
  function openMobileSidebar() {
    $('sidebar').classList.add('open');
    $('sidebarBackdrop').classList.add('visible');
    document.body.classList.add('sidebar-drawer-open');
    $('sidebarToggle').setAttribute('aria-expanded', 'true');
    $('sidebarToggle').setAttribute('aria-label', 'Close navigation');
    $('sidebarToggle').title = 'Close navigation';
    $('sidebarToggle').textContent = '×';
  }
  try { setSidebarCollapsed(localStorage.getItem('attendance-sidebar-collapsed') === '1'); } catch {}
  document.addEventListener('click', event => {
    const control = event.target.closest('#sidebarCollapseButton');
    if (!control) return;
    event.preventDefault();
    const layout = document.querySelector('.portal-layout');
    const currentlyCollapsed = layout?.dataset.sidebarCollapsed === 'true' ||
      layout?.classList.contains('sidebar-collapsed');
    setSidebarCollapsed(!currentlyCollapsed);
  });
  $('sidebarToggle').addEventListener('click', () => {
    if ($('sidebar').classList.contains('open')) closeMobileSidebar();
    else openMobileSidebar();
  });
  $('sidebarBackdrop').addEventListener('click', closeMobileSidebar);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && $('sidebar').classList.contains('open')) {
      closeMobileSidebar();
      $('sidebarToggle').focus();
    }
  });
  window.addEventListener('resize', () => {
    if (!window.matchMedia('(max-width: 860px)').matches) closeMobileSidebar();
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
  async function openAccountProfile(focusPassword = false) {
    const dialog = $('accountProfileDialog');
    try {
      const data = await api('/api/account/profile');
      $('accountProfileUsername').value = data.profile.username || '';
      $('accountProfileDisplayName').value = data.profile.displayName || '';
      $('accountProfileMobile').value = data.profile.mobile || '';
      $('accountProfileFeedback').textContent = '';
      $('accountCurrentPassword').value = '';
      $('accountNewPassword').value = '';
      dialog.showModal();
      (focusPassword ? $('accountCurrentPassword') : $('accountProfileDisplayName')).focus();
    } catch (error) { showToast(error.message, true); }
  }
  $('profileMenuButton').addEventListener('click', () => { $('accountDropdown').hidden = true; openAccountProfile(false); });
  $('settingsMenuButton').addEventListener('click', () => { $('accountDropdown').hidden = true; openAccountProfile(true); });
  $('closeAccountProfile')?.addEventListener('click', () => $('accountProfileDialog').close());
  $('accountProfileDialog')?.addEventListener('click', event => { if (event.target === $('accountProfileDialog')) $('accountProfileDialog').close(); });
  $('accountProfileForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const feedback = $('accountProfileFeedback'); feedback.textContent = 'Saving profile…'; feedback.className = 'inline-feedback';
    try {
      const data = await api('/api/account/profile', { method: 'PATCH', body: JSON.stringify({
        displayName: $('accountProfileDisplayName').value.trim(), mobile: $('accountProfileMobile').value.trim()
      }) });
      user.displayName = data.profile.displayName; user.mobile = data.profile.mobile || '';
      sessionStorage.setItem(userKey, JSON.stringify(user));
      $('userDisplay').textContent = user.displayName; $('accountMenuName').textContent = user.displayName;
      if (!$('userAvatar').querySelector('img')) $('userAvatar').textContent = user.displayName.trim().charAt(0).toUpperCase();
      feedback.textContent = 'Profile saved.'; showToast('Profile saved.');
    } catch (error) { feedback.textContent = error.message; feedback.className = 'inline-feedback error'; }
  });
  $('accountPasswordForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const feedback = $('accountProfileFeedback'); feedback.textContent = 'Updating password…'; feedback.className = 'inline-feedback';
    try {
      const data = await api('/api/account/change-password', { method: 'POST', body: JSON.stringify({
        currentPassword: $('accountCurrentPassword').value, newPassword: $('accountNewPassword').value
      }) });
      $('accountCurrentPassword').value = ''; $('accountNewPassword').value = '';
      feedback.textContent = data.message || 'Password changed.'; showToast('Password changed.');
    } catch (error) { feedback.textContent = error.message; feedback.className = 'inline-feedback error'; }
  });
  $('logoutButton').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* clear local session regardless */ }
    clearSession();
    window.location.replace('/portal-login.html');
  });

  $('downloadStudentTemplate')?.addEventListener('click', () => {
    const template = 'Student ID,Full Name,Sex,Grade Level,Section,LRN,Parent Name,Parent Mobile\r\n';
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
    payload.updateExisting = user.role === 'SCHOOL_ADMIN' && Boolean($('studentImportUpdateExisting')?.checked);
    if (user.role === 'TEACHER' && teacherHas('CLASS_ADVISER') && select?.value) {
      payload.advisoryAssignmentId = select.value;
    }
    return payload;
  }

  function resetStudentImport() {
    pendingStudentImport = null; pendingStudentImportPreview = null;
    $('studentImportFile').value = ''; $('studentImportSummary').textContent = '';
    if ($('studentImportUpdateExisting')) $('studentImportUpdateExisting').checked = false;
    if ($('studentImportExistingList')) { $('studentImportExistingList').hidden = true; $('studentImportExistingList').replaceChildren(); }
    $('studentImportPreviewRows').innerHTML = '<tr><td colspan="8" class="empty-cell">Choose a file to preview.</td></tr>';
    $('confirmStudentImport').disabled = true;
  }

  async function previewStudentImport() {
    if (!pendingStudentImport) return;
    const summary = $('studentImportSummary');
    const list = $('studentImportExistingList');
    summary.textContent = 'Validating file and checking which students already exist…';
    $('confirmStudentImport').disabled = true;
    if (list) { list.hidden = true; list.replaceChildren(); }
    try {
      const preview = await api('/api/students/import/preview', { method:'POST', body:JSON.stringify(studentImportRequestPayload()) });
      pendingStudentImportPreview = preview;
      const counts = preview.summary || { create:0, update:0, skip:0, error:0 };
      const eligible = Number(counts.create || 0) + Number(counts.update || 0);
      summary.textContent = preview.total + ' rows · ' + (counts.create || 0) + ' new · ' +
        (counts.update || 0) + ' updates · ' + (counts.skip || 0) + ' already exist (skip) · ' +
        (counts.error || 0) + ' errors.' +
        (!eligible && !counts.error ? ' All students are already registered; nothing will be imported.' : '');
      const labels = {CREATE:'Add new', UPDATE:'Update existing', SKIP:'Already exists — skip', ERROR:'Needs correction'};
      $('studentImportPreviewRows').innerHTML = preview.rows.map(item => {
        const match = item.existingStudent;
        const description = match ? '<strong>' + esc(match.fullName) + '</strong><small class="table-subtext">' +
          esc(match.gradeLevel + ' · ' + match.section) + '</small>' : '<span class="muted-inline">Not registered</span>';
        return '<tr class="student-import-result-' + esc(String(item.action||'').toLowerCase()) + '"><td>' +
          esc(item.rowNumber) + '</td><td>' + esc(item.studentId) + '</td><td>' + esc(item.fullName) +
          '</td><td>' + esc(item.gradeLevel) + '</td><td>' + esc(item.section) +
          '</td><td><span class="student-import-action-tag">' + esc(labels[item.action] || item.action) +
          '</span></td><td>' + description + '</td><td>' + esc((item.errors||[]).join(' ')) + '</td></tr>';
      }).join('') || '<tr><td colspan="8" class="empty-cell">No student rows were found.</td></tr>';
      const existing = preview.rows.filter(item => item.existingStudent);
      if (existing.length && list) {
        list.hidden = false;
        list.innerHTML = '<strong>' + existing.length + ' student' + (existing.length===1?'':'s') +
          ' already registered</strong><p>These existing students are shown in the preview. They are skipped unless the School Admin selects Update matching students.</p><ul>' +
          existing.map(item => '<li><b>' + esc(item.studentId) + '</b> · ' + esc(item.existingStudent.fullName) +
            ' (' + esc(item.existingStudent.gradeLevel) + ' · ' + esc(item.existingStudent.section) + ')</li>').join('') +
          '</ul>';
      }
      $('confirmStudentImport').disabled = Number(counts.error||0)>0 || !eligible;
      $('confirmStudentImport').textContent = eligible ? 'Import ' + eligible + ' student' + (eligible===1?'':'s') : 'No new students';
    } catch(error) {
      pendingStudentImportPreview = null;
      summary.textContent = error.message;
      $('studentImportPreviewRows').innerHTML = '<tr><td colspan="8" class="empty-cell">File could not be validated.</td></tr>';
    }
  }

  $('bulkImportStudentsButton')?.addEventListener('click', () => {
    resetStudentImport();
    if ($('studentImportUpdateExistingWrap')) $('studentImportUpdateExistingWrap').hidden = user.role !== 'SCHOOL_ADMIN';
    prepareStudentImportAdvisoryScope();
    $('studentImportModal').hidden = false;
  });
  $('closeStudentImport')?.addEventListener('click', () => { $('studentImportModal').hidden = true; });
  $('cancelStudentImport')?.addEventListener('click', () => { $('studentImportModal').hidden = true; resetStudentImport(); });
  $('studentImportAdvisoryAssignment')?.addEventListener('change', () => { previewStudentImport().catch(error => showToast(error.message, true)); });
  $('studentImportUpdateExisting')?.addEventListener('change', () => { previewStudentImport().catch(error => showToast(error.message, true)); });
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
    if (!await AppDialog.confirm('Import ' + (pendingStudentImportPreview.summary.create + pendingStudentImportPreview.summary.update) + ' student records? ' + (pendingStudentImportPreview.summary.skip || 0) + ' existing students will be skipped. Duplicate IDs will not be created.', { title: 'Import student records', confirmText: 'Import students' })) return;
    $('confirmStudentImport').disabled = true; $('studentImportSummary').textContent = 'Saving records…';
    try {
      const result = await api('/api/students/import/commit', { method:'POST', body:JSON.stringify(studentImportRequestPayload()) });
      const summary = 'Completed: ' + result.created + ' created, ' + result.updated + ' updated, ' + (result.skipped || 0) + ' already existing skipped.';
      resetStudentImport(); $('studentImportModal').hidden = true; selectedStudentIds.clear(); await loadSchoolData();
      showToast(summary);
    } catch (error) { $('studentImportSummary').textContent = error.message; $('confirmStudentImport').disabled = false; }
  });
  function availableStudentBatchSections() {
    const role = user.role;
    let destinations;
    if (role === 'TEACHER') {
      destinations = adviserAssignments.map(a => ({ gradeLevel:a.gradeLevel, section:a.section }));
    } else if (role === 'DEPARTMENT_HEAD') {
      destinations = periods.filter(p => p.active !== false &&
        String(p.scheduleDepartmentId) === String(user.departmentId))
        .map(p => ({ gradeLevel:p.gradeLevel, section:p.section }));
    } else if (role === 'SCHOOL_ADMIN') {
      destinations = [
        ...students.filter(s => s.active !== false && !s.archivedAt)
          .map(s => ({ gradeLevel:s.gradeLevel, section:s.section })),
        ...periods.filter(p => p.active !== false)
          .map(p => ({ gradeLevel:p.gradeLevel, section:p.section }))
      ];
    } else {
      destinations = [];
    }
    const unique = new Map();
    for (const section of destinations) {
      const grade = String(section.gradeLevel || '').trim();
      const name = String(section.section || '').trim();
      if (grade && name) unique.set(grade + '|' + name, {gradeLevel:grade,section:name});
    }
    return [...unique.values()].sort((a,b) =>
      a.gradeLevel.localeCompare(b.gradeLevel,undefined,{numeric:true}) ||
      a.section.localeCompare(b.section,undefined,{numeric:true}));
  }

  function refreshStudentBatchDestinations() {
    const gradeSelect = $('batchGrade');
    const sectionSelect = $('batchSection');
    const allowed = availableStudentBatchSections();
    const previousGrade = gradeSelect.value, previousSection = sectionSelect.value;
    const grades = [...new Set(allowed.map(s => s.gradeLevel))];
    gradeSelect.innerHTML = '<option value="">Choose grade</option>' +
      grades.map(grade => '<option value="' + esc(grade) + '">' + esc(grade) + '</option>').join('');
    gradeSelect.value = grades.includes(previousGrade) ? previousGrade : '';
    const sections = allowed.filter(s => s.gradeLevel === gradeSelect.value).map(s => s.section);
    sectionSelect.innerHTML = '<option value="">Choose existing section</option>' +
      sections.map(section => '<option value="' + esc(section) + '">' + esc(section) + '</option>').join('');
    sectionSelect.value = sections.includes(previousSection) ? previousSection : '';
    sectionSelect.disabled = sections.length === 0;
    gradeSelect.disabled = grades.length === 0;
    if ($('batchSectionHint')) $('batchSectionHint').textContent = grades.length
      ? 'Only registered or scheduled sections in your authorized scope can be selected.'
      : 'No eligible sections are available. Ask the School Admin to create the section or check your assigned timetable.';
  }

  function closeStudentBatch() {
    $('studentBatchModal').hidden = true;
    $('studentBatchForm').reset();
    $('studentBatchFeedback').textContent = '';
  }

  function openStudentBatch() {
    const action = $('studentBatchAction').value;
    const selected = students.filter(s => selectedStudentIds.has(s.studentId) && canSelectLearnerForBatch(s));
    if (!action || !selected.length) return;
    if (selected.length !== selectedStudentIds.size || selected.length > 500) {
      showToast('Some learners are not in your authorized selection. Refresh and select again (maximum 500).',true);
      return;
    }
    if (user.role !== 'SCHOOL_ADMIN' && !['SET_SEX','ASSIGN'].includes(action)) {
      showToast('Only School Admin may manage student account status.',true);
      return;
    }
    $('studentBatchForm').reset();
    $('studentBatchFeedback').textContent = '';
    const labels = {
      SET_SEX:'Set sex', ASSIGN:'Move grade / section', ACTIVATE:'Activate',
      DEACTIVATE:'Deactivate', ARCHIVE:'Archive'
    };
    const descriptions = {
      SET_SEX:'Choose one sex for the entire selected group. Do not use this when the learners have different sex classifications.',
      ASSIGN:'Move selected learners to an existing school-year section. Student identity and past attendance are preserved.',
      ACTIVATE:'Restore access for selected inactive or archived learners. Their historical attendance is preserved.',
      DEACTIVATE:'Disable selected learners and their student logins without deleting past attendance.',
      ARCHIVE:'Archive selected learners and disable their logins. Records and attendance history remain available to authorized staff.'
    };
    $('studentBatchTitle').textContent = (labels[action] || action) + ' · ' + selected.length + ' learners';
    $('studentBatchDescription').textContent = descriptions[action] || '';
    $('studentBatchSelectedCount').textContent = selected.length + ' selected learner' + (selected.length === 1 ? '' : 's');
    const preview = selected.slice(0,8);
    $('studentBatchSelectedPreview').innerHTML = preview.map(learner =>
      '<span class="student-batch-chip">' + esc(learner.fullName) + ' <small>' +
      esc(learner.studentId) + '</small></span>').join('') +
      (selected.length > preview.length ? '<span class="student-batch-chip">+' + (selected.length-preview.length) + ' more</span>' : '');
    $('batchSexGroup').hidden = action !== 'SET_SEX';
    $('batchGradeGroup').hidden = action !== 'ASSIGN';
    $('batchSectionGroup').hidden = action !== 'ASSIGN';
    if (action === 'ASSIGN') refreshStudentBatchDestinations();
    const acknowledge = ['SET_SEX','DEACTIVATE','ARCHIVE'].includes(action);
    $('studentBatchAcknowledgeWrap').hidden = !acknowledge;
    $('studentBatchAcknowledgeText').textContent = action === 'SET_SEX'
      ? 'I verified that all selected learners should receive the same sex classification.'
      : 'I understand this changes the selected student accounts and will preserve their attendance history.';
    $('studentBatchChangeSummary').textContent = descriptions[action];
    $('confirmStudentBatch').textContent = action === 'ASSIGN' ? 'Review section transfer'
      : action === 'SET_SEX' ? 'Review sex update' : 'Review ' + (labels[action] || action).toLowerCase();
    $('studentBatchModal').hidden = false;
  }

  $('applyStudentBatch')?.addEventListener('click',openStudentBatch);
  $('studentBatchAction')?.addEventListener('change',updateStudentSelectionUi);
  $('batchGrade')?.addEventListener('change',refreshStudentBatchDestinations);
  $('closeStudentBatch')?.addEventListener('click',closeStudentBatch);
  $('cancelStudentBatch')?.addEventListener('click',closeStudentBatch);
  $('studentBatchForm')?.addEventListener('submit',async event => {
    event.preventDefault();
    const action = $('studentBatchAction').value;
    const chosen = students.filter(s => selectedStudentIds.has(s.studentId) && canSelectLearnerForBatch(s));
    const feedback = $('studentBatchFeedback');
    feedback.className = 'inline-feedback';
    if (!action || !chosen.length || chosen.length !== selectedStudentIds.size || chosen.length > 500) {
      feedback.className = 'inline-feedback error';
      feedback.textContent = 'Please select valid learners and try again.';
      return;
    }
    if (user.role !== 'SCHOOL_ADMIN' && !['SET_SEX','ASSIGN'].includes(action)) {
      feedback.className = 'inline-feedback error';
      feedback.textContent = 'This action requires School Admin permissions.';
      return;
    }
    const body = {action,studentIds:chosen.map(s=>s.studentId)};
    let changeDescription = '';
    if (action === 'SET_SEX') {
      const sex = $('batchSex').value;
      if (!['MALE','FEMALE'].includes(sex)) {
        feedback.textContent = 'Choose Male or Female for the selected learners.';
        feedback.className = 'inline-feedback error';
        return;
      }
      body.sex = sex;
      changeDescription = 'Set sex to ' + (sex === 'MALE' ? 'Male' : 'Female');
    } else if (action === 'ASSIGN') {
      const gradeLevel = $('batchGrade').value, section = $('batchSection').value;
      if (!availableStudentBatchSections().some(d => d.gradeLevel === gradeLevel && d.section === section)) {
        feedback.textContent = 'Choose an existing section within your authorized scope.';
        feedback.className = 'inline-feedback error';
        return;
      }
      body.gradeLevel = gradeLevel; body.section = section;
      changeDescription = 'Move to ' + gradeLevel + ' · ' + section;
    } else {
      changeDescription = action === 'ACTIVATE' ? 'Activate learners' :
        action === 'DEACTIVATE' ? 'Deactivate learners and revoke their login sessions' :
        'Archive learners and revoke their login sessions';
    }
    if (!$('studentBatchAcknowledgeWrap').hidden && !$('studentBatchAcknowledge').checked) {
      feedback.textContent = 'Please check the confirmation box after verifying the selected learners.';
      feedback.className = 'inline-feedback error';
      return;
    }
    const preview = chosen.slice(0,4).map(s=>s.fullName).join(', ');
    const message = changeDescription + ' for ' + chosen.length + ' selected learners?\n' +
      preview + (chosen.length > 4 ? ' and ' + (chosen.length-4) + ' others' : '') +
      '\nThis will not change anyone’s name, Student ID, LRN or guardian information.';
    if (!await AppDialog.confirm(message, {
      title: 'Confirm batch ' + action.toLowerCase().replaceAll('_',' '),
      confirmText: action === 'ARCHIVE' ? 'Archive selected' : 'Apply to ' + chosen.length,
      variant:['ARCHIVE','DEACTIVATE'].includes(action) ? 'danger' : 'primary'
    })) return;
    $('confirmStudentBatch').disabled = true;
    feedback.textContent = 'Applying ' + changeDescription.toLowerCase() + '…';
    try {
      const result = await api('/api/students/batch', {method:'POST',body:JSON.stringify(body)});
      closeStudentBatch();
      selectedStudentIds.clear();
      $('studentBatchAction').value = '';
      await loadSchoolData();
      showToast(result.updated + ' learners updated: ' + changeDescription + '.');
    } catch(error) {
      feedback.textContent = error.message;
      feedback.className = 'inline-feedback error';
    } finally {
      $('confirmStudentBatch').disabled = false;
      updateStudentSelectionUi();
    }
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
    const selected = Boolean($('selectAllStudents').checked);
    visibleBatchLearners().forEach(student => {
      if (selected) selectedStudentIds.add(student.studentId);
      else selectedStudentIds.delete(student.studentId);
    });
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
  let qrHistoryFlipping = false;
  function flipQrHistory(direction) {
    const pages = Math.max(1, Math.ceil(teacherHistoryData.length / 10));
    const next = teacherHistoryPage + direction;
    if (qrHistoryFlipping || next < 0 || next >= pages) return;
    const page = document.querySelector('#mfQrHistoryDetails .manual-qr-pages');
    if (!page) { renderTeacherClassAttendance(teacherHistoryData, next); return; }
    qrHistoryFlipping = true;
    const prev = $('mfQrPrev'), forward = $('mfQrNext');
    if (prev) prev.disabled = true;
    if (forward) forward.disabled = true;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      renderTeacherClassAttendance(teacherHistoryData, next);
      qrHistoryFlipping = false;
      return;
    }
    // A frozen page is animated above the next page; never rotate the live table.
    const leaf = document.createElement('div');
    leaf.className = 'manual-qr-turn-leaf ' + (direction > 0 ? 'forward' : 'backward');
    leaf.setAttribute('aria-hidden', 'true');
    const snapshot = page.querySelector('table')?.cloneNode(true);
    if (snapshot) {
      snapshot.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
      leaf.appendChild(snapshot);
    }
    page.appendChild(leaf);
    page.classList.add('manual-qr-is-turning');
    const duration = 440;
    setTimeout(() => renderTeacherClassAttendance(teacherHistoryData, next), Math.round(duration * .46));
    setTimeout(() => {
      leaf.remove();
      page.classList.remove('manual-qr-is-turning');
      qrHistoryFlipping = false;
      if (prev) prev.disabled = next === 0;
      if (forward) forward.disabled = next >= pages - 1;
    }, duration + 40);
  }
  $('mfQrPrev')?.addEventListener('click', () => flipQrHistory(-1));
  $('mfQrNext')?.addEventListener('click', () => flipQrHistory(1));
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

  function openParentInvite(student, guardian = {}) {
    const schoolCode = user.schoolCode || '';
    const registerUrl = `${window.location.origin}/parent-register.html`;
    const parentName = guardian.parentName || $('newParentName').value.trim();
    const mobile = guardian.parentMobile || $('newParentMobile').value.trim();
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

  function refreshExistingGuardianChoices() {
    const select = $('existingGuardianSelect');
    if (!select) return;
    const contacts = new Map();
    for (const student of students) {
      const name = String(student.parentName || '').trim();
      const mobile = String(student.parentMobile || '').trim();
      if (!name || !mobile || /^0+$/.test(mobile.replace(/\D/g,''))) continue;
      const key = mobile.replace(/\D/g,'');
      if (!contacts.has(key)) contacts.set(key, { name, mobile });
    }
    select.replaceChildren(new Option('Enter a new guardian', ''));
    [...contacts.values()].sort((a,b) => a.name.localeCompare(b.name)).forEach(({name,mobile}) => {
      select.add(new Option(name + ' · ' + mobile, mobile));
    });
  }
  $('existingGuardianSelect')?.addEventListener('change', event => {
    const mobile = event.target.value;
    if (!mobile) return;
    const match = students.find(student => student.parentMobile === mobile && student.parentName);
    if (match) {
      $('newParentName').value = match.parentName;
      $('newParentMobile').value = match.parentMobile;
    }
  });
  $('showStudentPortalHelp')?.addEventListener('click', () => {
    // Navigate to the dedicated, role-scoped Student Portal Accounts workspace.
    // The old action only scrolled to the roster and appeared to do nothing when
    // a School Admin had an empty list.
    setView('studentAccounts');
    $('sapSearch')?.focus({preventScroll:true});
  });
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
      const photoFile = $('newStudentPhoto').files?.[0];
      const preparedPhoto = photoFile ? await window.ProfilePhotos.edit(photoFile) : null;
      const created = await api('/api/students', { method: 'POST', body: JSON.stringify(payload) });
      if (preparedPhoto) await uploadStudentPhoto(created.student.studentId, photoFile, preparedPhoto);
      const inviteStudent = { fullName: payload.fullName, studentId: created.student.studentId, gradeLevel: payload.gradeLevel, section: payload.section };
      $('studentForm').reset();
      $('newSection').innerHTML = '<option value="">Select grade level first</option>';
      $('newSection').disabled = true;
      $('newSectionHint').textContent = 'Choose a grade to load its available sections.';
      $('studentForm').hidden = true;
      await loadSchoolData();
      showToast('Student registered successfully.');
      if (payload.parentName || payload.parentMobile) openParentInvite(inviteStudent, payload);
    } catch (error) {
      feedback.className = 'inline-feedback error';
      feedback.textContent = error.message;
    }
  });

  function updatePeriodBatchUi() {
    const visibleIds = periods
      .filter(p => String(p.departmentId) === String(user.departmentId) && !p.assignedTeacherUserId && !p.assignedTeacherName)
      .map(p => String(p.periodId));
    const eligibleIds = new Set(visibleIds);
    [...selectedPeriodIds].forEach(id => { if (!eligibleIds.has(id)) selectedPeriodIds.delete(id); });
    $('selectedPeriodCount').textContent = selectedPeriodIds.size + ' selected';
    $('selectAllPeriods').checked = visibleIds.length > 0 && visibleIds.every(id => selectedPeriodIds.has(id));
    $('selectAllPeriods').indeterminate = visibleIds.some(id => selectedPeriodIds.has(id)) && !$('selectAllPeriods').checked;
    $('applyBulkScheduleAssignment').disabled = !selectedPeriodIds.size || !$('bulkScheduleTeacher').value;
  }
  document.querySelectorAll('[data-schedule-display]').forEach(button => {
    button.addEventListener('click', () => setScheduleDisplay(button.dataset.scheduleDisplay));
  });
  $('weeklyScheduleAsOf')?.addEventListener('change', async () => {
    if (user.role === 'TEACHER') await loadSchoolData();
    else await loadScheduleAdjustments();
  });
  $('weeklyGradeFilter')?.addEventListener('change', renderWeeklyTimetable);
  $('weeklySectionFilter')?.addEventListener('change', renderWeeklyTimetable);
  $('weeklyTimetableBoard')?.addEventListener('click', async event => {
    const changeButton = event.target.closest('[data-open-adjustment]');
    if(changeButton) {
      openScheduleAdjustment(changeButton.dataset.openAdjustment,changeButton.dataset.adjustmentDate);
      return;
    }
    const button = event.target.closest('[data-weekly-assign]');
    if (!button) return;
    const periodId = button.dataset.weeklyAssign;
    const select = $('weeklyTimetableBoard').querySelector('[data-weekly-teacher="' + CSS.escape(periodId) + '"]');
    const teacherUserId = select?.value || '';
    if (!teacherUserId) { showToast('Choose a Subject Teacher before assigning this schedule.', true); return; }
    button.disabled = true;
    try {
      const result = await api('/api/periods/' + encodeURIComponent(periodId) + '/assignments', {
        method: 'POST', body: JSON.stringify({ teacherUserId })
      });
      await loadSchoolData();
      setScheduleDisplay('weekly');
      showToast('Schedule assigned to ' + (result.teacher?.displayName || 'the selected teacher') + '.');
    } catch (error) {
      button.disabled = false;
      showToast(error.message, true);
    }
  });

  $('selectAllPeriods')?.addEventListener('change', () => {
    const visible = periods.filter(p =>
      String(p.departmentId) === String(user.departmentId) && !p.assignedTeacherUserId && !p.assignedTeacherName
    );
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
    const selected = teachers.find(item => String(item.userId) === String($('periodTeacher')?.value));
    if (selected) return selected;
    if (user.role === 'DEPARTMENT_HEAD' && user.departmentId) {
      return {
        userId: null,
        displayName: null,
        departmentId: user.departmentId,
        departmentName: user.departmentName || user.departmentCode || 'Your department'
      };
    }
    return null;
  }

  async function loadScheduleSubjects(preferredSubjectId = '') {
    const teacher = selectedScheduleTeacher();
    const select = $('periodSubject');
    const hint = $('periodSubjectHint');
    if (!select) return;
    select.disabled = true;
    select.innerHTML = '<option value="">Loading department subjects…</option>';
    if (!teacher?.departmentId) {
      select.innerHTML = '<option value="">Choose a department or teacher first</option>';
      if (hint) hint.textContent = 'Choose a Subject Teacher to load their department subjects. Department Heads can create an unassigned schedule within their own department.';
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
    const defaultDays = schoolOperatingDays.filter(day=>day.isOperatingDay).map(day=>Number(day.weekday));
    document.querySelectorAll('#scheduleWeekdayChoices input[type="checkbox"]').forEach(input=>{
      input.checked = defaultDays.length ? defaultDays.includes(Number(input.value)) : Number(input.value)>=1 && Number(input.value)<=5;
    });
    if (user.role !== 'TEACHER') {
      const eligible = teachers.filter(item => item.active && (item.teacherDesignations || []).includes('SUBJECT_TEACHER') &&
        (user.role !== 'DEPARTMENT_HEAD' || String(item.departmentId) === String(user.departmentId)));
      $('periodTeacher').innerHTML = '<option value="">Choose active Subject Teacher</option>' +
        eligible.map(item => '<option value="' + esc(item.userId) + '">' + esc(item.displayName) + '</option>').join('');
      $('periodTeacher').value = eligible.length === 1 ? String(eligible[0].userId) : '';
    }
    const form = $('scheduleForm');
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('periodTeacher')?.focus({ preventScroll: true });
    const feedback = $('scheduleFormFeedback');
    feedback.className = 'inline-feedback';
    feedback.textContent = 'Loading subjects and sections…';
    const failures = [];
    try { await loadScheduleSubjects(); } catch (error) { failures.push('Subjects: ' + error.message); }
    try { await loadScheduleSections($('periodGrade').value); } catch (error) { failures.push('Sections: ' + error.message); }
    if (failures.length) {
      feedback.className = 'inline-feedback error';
      feedback.textContent = 'Unable to load schedule options. ' + failures.join(' | ') + '. Please retry opening the form.';
      feedback.setAttribute('role', 'alert');
    } else {
      feedback.textContent = 'Choose a subject and section, then save your class schedule.';
    }
  });
  $('cancelScheduleForm').addEventListener('click', () => {
    $('scheduleForm').reset();
    $('scheduleForm').hidden = true;
    $('scheduleFormFeedback').textContent = '';
    if ($('periodSubject')) { $('periodSubject').innerHTML = '<option value="">Choose a teacher or your department</option>'; $('periodSubject').disabled = true; }
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
      graceMinutes: Number($('graceMinutes').value || 0),
      weekdays: selectedScheduleWeekdays(),
      timetableTemplateId: ($('scheduleTemplatePeriod').value || '').split('|')[0] || null
    };
    if (!payload.weekdays.length) {
      feedback.className = 'inline-feedback error';
      feedback.textContent = 'Select at least one class day.';
      return;
    }
    try {
      const saved = await api('/api/periods', { method: 'POST', body: JSON.stringify(payload) });
      $('scheduleForm').reset();
      $('scheduleForm').hidden = true;
      if ($('periodSubject')) { $('periodSubject').innerHTML = '<option value="">Choose a teacher or your department</option>'; $('periodSubject').disabled = true; }
      if ($('periodSection')) { $('periodSection').innerHTML = '<option value="">Select grade first</option>'; $('periodSection').disabled = true; }
      await loadSchoolData();
      showToast(saved.teacher ? 'Schedule saved and assigned to ' + saved.teacher + '.' : 'Class schedule saved. Assign a Subject Teacher when ready.');
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
        $('adviserAssignmentForm').hidden = true;
        if ($('addAdviserAssignmentButton')) $('addAdviserAssignmentButton').hidden = false;
        await loadSchoolData();
        feedback.textContent = 'Class Adviser assignment saved.';
      } catch (error) { feedback.className = 'inline-feedback error'; feedback.textContent = error.message; }
    });
    document.addEventListener('click', async event => {
      const deleteScheduleButton = event.target.closest('[data-delete-period]');
      if (deleteScheduleButton) {
        const period = periods.find(item => String(item.periodId) === String(deleteScheduleButton.dataset.deletePeriod));
        if (!period) return;
        if (!await AppDialog.confirm('Deactivate ' + period.periodName + ' for ' + period.gradeLevel + ' · ' + period.section + '? Attendance history will be preserved.', { title: 'Delete class schedule', confirmText: 'Continue to verification', variant: 'danger' })) return;
        const password = window.prompt('Second authentication required. Enter your account password:');
        if (password === null || !password) return;
        deleteScheduleButton.disabled = true;
        try {
          await api('/api/periods/' + encodeURIComponent(period.periodId), { method: 'DELETE', body: JSON.stringify({ password }) });
          await loadSchoolData();
          showToast('Schedule deleted. Attendance history was preserved.');
        } catch (error) { showToast(error.message, true); deleteScheduleButton.disabled = false; }
        return;
      }
      const button = event.target.closest('[data-edit-teacher-permission]');
      if (!button) return;
      const teacher = teachers.find(item => String(item.userId) === String(button.dataset.editTeacherPermission));
      if (!teacher) return;
      const currentValues = teacher.teacherDesignations || [];
      const current = currentValues.includes('SUBJECT_TEACHER') && currentValues.includes('CLASS_ADVISER')
        ? 'BOTH' : currentValues[0] || '';
      const answer = await AppDialog.prompt('Choose the teaching designation for this teacher. Existing subject schedules and advisory assignments are preserved. A designation cannot be removed while linked assignments still depend on it.', current, {
        title: 'Edit teacher designation',
        label: 'Teacher designation',
        helpText: 'Subject Teacher: handles assigned subject-class attendance. Class Adviser: handles an assigned advisory section and official SF2. Both: enables both responsibilities.',
        placeholder: 'Choose permissions',
        required: true,
        selectOptions: [
          { value: 'SUBJECT_TEACHER', label: 'Subject Teacher' },
          { value: 'CLASS_ADVISER', label: 'Class Adviser' },
          { value: 'BOTH', label: 'Both permissions' }
        ]
      });
      if (answer === null) return;
      const designations = answer === 'BOTH' ? ['SUBJECT_TEACHER','CLASS_ADVISER'] : [answer];
      button.disabled = true;
      try {
        await api('/api/teachers/' + encodeURIComponent(teacher.userId) + '/designations', {
          method: 'PATCH', body: JSON.stringify({ teacherDesignations: designations })
        });
        await loadSchoolData();
        showToast('Teacher designation updated. Existing schedules and advisory assignments were preserved.');
      } catch (error) {
        showToast(error.message, true);
        button.disabled = false;
      }
    });

    $('adviserAssignmentRows').addEventListener('click', async event => {
      const editButton = event.target.closest('[data-edit-adviser]');
      if (editButton) {
        const assignment = adviserAssignments.find(item => String(item.assignmentId) === String(editButton.dataset.editAdviser));
        if (!assignment) return;
        const activeAdvisers = teachers.filter(item =>
          item.active &&
          Array.isArray(item.teacherDesignations) &&
          item.teacherDesignations.includes('CLASS_ADVISER') &&
          (user.role !== 'DEPARTMENT_HEAD' || String(item.departmentId) === String(user.departmentId))
        );
        const values = await AppDialog.form(
          'Update the assigned teacher or class section. The selected Class Adviser must belong to your department.',
          [
            { name: 'adviserUserId', label: 'Class Adviser', required: true, defaultValue: String(assignment.adviserUserId),
              selectOptions: activeAdvisers.map(item => ({ value: String(item.userId), label: item.displayName })) },
            { name: 'gradeLevel', label: 'Grade level', required: true, defaultValue: assignment.gradeLevel, maxLength: 40,
              validate: value => String(value).trim().length <= 40 || 'Grade level must be 40 characters or fewer.' },
            { name: 'section', label: 'Section', required: true, defaultValue: assignment.section, maxLength: 100,
              validate: value => String(value).trim().length <= 100 || 'Section must be 100 characters or fewer.' }
          ],
          { title: 'Edit advisory section', confirmText: 'Save assignment' }
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
      const password = window.prompt('Second authentication required. Enter your account password to remove this Class Adviser assignment:');
      if (password === null || !password) return;
      button.disabled = true;
      try {
        await api('/api/class-adviser-assignments/' + encodeURIComponent(button.dataset.removeAdviser), { method: 'DELETE', body: JSON.stringify({ password }) });
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
      $('teacherDesignationFields').hidden = !isTeacherAccount || user?.role === 'SCHOOL_ADMIN';
      $('newTeacherDepartmentGroup').hidden = !needsDepartment;
      $('newTeacherPositionGroup').hidden = !isTeacherAccount;
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
    $('addSchoolStaffAccount')?.addEventListener('click', () => {
      $('teacherForm').hidden = false;
      $('newAccountRole').value = 'DEPARTMENT_HEAD';
      $('newAccountRole').dispatchEvent(new Event('change', { bubbles:true }));
      $('teacherFormFeedback').className = 'inline-feedback';
      $('teacherFormFeedback').textContent = 'Creating a Department Head account. You can select Gate Keeper in the Account role field instead.';
      $('teacherForm').scrollIntoView({ behavior:'smooth', block:'center' });
      $('newTeacherName').focus({ preventScroll:true });
    });
    $('createDemoStudentLogin')?.addEventListener('click', async () => {
      const button = $('createDemoStudentLogin');
      const feedback = $('demoStudentLoginFeedback');
      button.disabled = true;
      feedback.textContent = 'Creating a secure, one-time demo student password…';
      feedback.className = 'inline-feedback';
      try {
        const created = await api('/api/admin/demo-student-login', { method:'POST', body:'{}' });
        $('demoStudentLoginUsername').textContent = created.username;
        $('demoStudentLoginPassword').textContent = created.temporaryPassword;
        $('demoStudentLoginCredentials').hidden = false;
        button.hidden = true;
        feedback.textContent = 'Demo student login created. Copy the temporary password before leaving this page.';
      } catch (error) {
        feedback.className = 'inline-feedback error';
        feedback.textContent = error.message;
        button.disabled = false;
      }
    });
    $('copyDemoStudentLogin')?.addEventListener('click', async () => {
      const username = $('demoStudentLoginUsername')?.textContent || '';
      const password = $('demoStudentLoginPassword')?.textContent || '';
      if (!username || !password) return;
      try {
        await navigator.clipboard.writeText('School: DEMO001\nStudent username: ' + username + '\nTemporary password: ' + password);
        $('demoStudentLoginFeedback').textContent = 'Credentials copied. Share them only with the intended demo tester.';
      } catch {
        $('demoStudentLoginFeedback').textContent = 'Your browser blocked copying. Select and copy the displayed username and password.';
      }
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
      const position = $('newAccountRole').value === 'TEACHER' ? $('newTeacherPosition').value.trim() : null;
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
          ? (user?.role === 'SCHOOL_ADMIN'
              ? ['SUBJECT_TEACHER']
              : [
                  $('designationSubjectTeacher').checked ? 'SUBJECT_TEACHER' : null,
                  $('designationClassAdviser').checked ? 'CLASS_ADVISER' : null
                ].filter(Boolean))
          : [];
        if (role === 'TEACHER' && !teacherDesignations.length) throw new Error('Select Subject Teacher, Class Adviser, or both.');
        const departmentId = $('newTeacherDepartment').value || null;
        if (['TEACHER', 'DEPARTMENT_HEAD'].includes(role) && !departmentId) throw new Error('Select a department for this account.');
        await api('/api/school-users', {
          method: 'POST',
          body: JSON.stringify({ username, displayName, password, role, teacherDesignations, departmentId, position })
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
      const manageAssignmentsButton = event.target.closest('[data-manage-permanent]');
      const leaveButton = event.target.closest('[data-place-leave]');
      const profileButton = event.target.closest('[data-edit-teacher-profile]');
      const teacherQrButton = event.target.closest('[data-teacher-qr]');
      const substituteButton = event.target.closest('[data-assign-substitute]');
      const cancelSubstitutionButton = event.target.closest('[data-cancel-substitution]');
      const returnButton = event.target.closest('[data-return-teacher]');
      const deactivateButton = event.target.closest('[data-deactivate-teacher]');

      if (profileButton) {
        const teacher = teachers.find(item => String(item.userId) === String(profileButton.dataset.editTeacherProfile));
        if (!teacher) return;
        const values = await AppDialog.form('Update the teacher name and personnel position. Access permissions, QR identity and assigned schedules are preserved.',
          [
            { name: 'displayName', label: 'Display name', defaultValue: teacher.displayName || '', required: true, maxLength: 160 },
            { name: 'position', label: 'Position / rank (e.g., Teacher I, Master Teacher II)', defaultValue: teacher.position || '', maxLength: 100 }
          ],
          { title: 'Edit teacher account', confirmText: 'Save account' });
        if (values === null) return;
        profileButton.disabled = true;
        try {
          await api('/api/teachers/' + encodeURIComponent(teacher.userId), { method: 'PATCH', body: JSON.stringify({ displayName: values.displayName.trim(), position: (values.position || '').trim() }) });
          await loadSchoolData();
          showToast('Teacher account updated. Existing teacher QR identity and schedules were preserved.');
        } catch (error) { showToast(error.message, true); profileButton.disabled = false; }
        return;
      }

      if (teacherQrButton) {
        try { await printTeacherGateQr(teacherQrButton.dataset.teacherQr); }
        catch (error) { showToast(error.message, true); }
        return;
      }

      if (manageAssignmentsButton) {
        const teacher = teachers.find(item => String(item.userId) === String(manageAssignmentsButton.dataset.managePermanent));
        if (teacher) openPermanentAssignmentDialog(teacher, manageAssignmentsButton);
      } else if (substituteButton) {
        const teacher = teachers.find(item => String(item.userId) === String(substituteButton.dataset.assignSubstitute));
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
        if (!await AppDialog.confirm('Deactivate this teacher account? Login will be disabled, but historical attendance and schedule assignments will be preserved.', { title: 'Deactivate teacher account', confirmText: 'Deactivate account', variant: 'danger' })) return;
        deactivateButton.disabled = true;
        try {
          await api(`/api/teachers/${encodeURIComponent(teacherId)}`, { method: 'PATCH', body: JSON.stringify({ active: false }) });
          await loadSchoolData();
          showToast('Teacher account deactivated.');
        } catch (error) {
          showToast(error.message, true);
          deactivateButton.disabled = false;
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

  

$('teacherCoverageCard')?.addEventListener('click', event => {
    const tab = event.target.closest('[data-coverage-tab]');
    if (!tab) return;
    const nextTab = tab.dataset.coverageTab;
    if (!['MY_DEPARTMENT', 'OTHER_DEPARTMENTS'].includes(nextTab) || nextTab === activeCoverageTab) return;
    activeCoverageTab = nextTab;
    renderTeacherCoverage();
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
    if (user?.role === 'DEPARTMENT_HEAD') {
      window.setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        loadTeacherCoverage(true).catch(error => console.warn('Teacher coverage refresh failed:', error.message));
      }, 60000);
    }
  }).catch(error => showToast(error.message || 'Portal initialization failed.', true));
})();
