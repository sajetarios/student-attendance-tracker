'use strict';
/* Teacher-only progressive enhancement: no API, permission, or calculation changes. */
(() => {
 const $ = id => document.getElementById(id);
 function init(user) {
  if (user?.role !== 'TEACHER') return;
  const dashboard = $('dashboardView');
  if (!dashboard || dashboard.dataset.teacherV2 === 'true') return;
  dashboard.dataset.teacherV2 = 'true';
  document.documentElement.classList.add('attendigo-teacher-v2');
  const scan = $('dashboardScanCta'), planner = $('plannerDashboardWidget');
  const stats = $('statsGrid'), summary = $('learnerSummaryCard');
  const recent = $('recentActivityCard'), shortcuts = $('quickActionsCard');
  // One authoritative set of learner statistics; keep the original stats DOM/data bindings intact.
  if (stats) {
   stats.classList.add('teacher-v2-redundant-stats');
   stats.setAttribute('aria-hidden','true');
  }
  if (summary) {
   const heading = summary.querySelector('.card-heading h3');
   if (heading) heading.textContent = 'My Learner Attendance';
   const note = summary.querySelector('.card-heading p');
   if (note) note.textContent = 'Confirmed class attendance only · Gate scans are separate';
  }
  if (scan) {
   const heading = scan.querySelector('h2');
   if (heading) heading.textContent = 'Record Class Attendance';
   const hint = scan.querySelector('.dashboard-scan-cta-copy p');
   if (hint) hint.textContent = 'Choose an assigned class or advisory section before scanning.';
   const addStudent = $('dashboardAddStudent');
   if (addStudent) addStudent.classList.add('teacher-v2-secondary-action');
  }
  if (shortcuts) {
   const title = shortcuts.querySelector('.card-heading h3');
   if (title) title.textContent = 'My Teaching Shortcuts';
   const description = shortcuts.querySelector('.card-heading p');
   if (description) description.textContent = 'Learners, timetable and authorized reports';
  }
  if (recent) {
   const title = recent.querySelector('.card-heading h3');
   if (title) title.textContent = 'Recent Class Attendance';
   const desc = recent.querySelector('.card-heading p');
   if (desc) desc.textContent = 'Recent records available to your teacher account';
  }
  // Preserve existing planner buttons and listeners while collapsing its metrics by default.
  function addCollapse(section, header, elements, label, defaultOpen) {
   if (!section || !header || !elements.length) return;
   const first = elements.find(el => el && el.parentNode === section);
   if (!first) return;
   const body = document.createElement('div');
   body.className = 'teacher-v2-panel-body';
   body.id = 'teacher-v2-' + label.toLowerCase().replace(/[^a-z0-9]+/g,'-');
   section.insertBefore(body,first);
   elements.forEach(el => { if(el) body.append(el); });
   const button = document.createElement('button');
   button.type='button';button.className='teacher-v2-toggle';
   button.setAttribute('aria-controls',body.id);
   button.setAttribute('aria-expanded',String(defaultOpen));
   button.setAttribute('aria-label','Toggle '+label);
   button.textContent = defaultOpen ? '⌃' : '⌄';
   header.append(button);
   body.hidden = !defaultOpen;
   button.addEventListener('click',()=>{
    const open=button.getAttribute('aria-expanded')!=='true';
    button.setAttribute('aria-expanded',String(open));
    button.textContent=open?'⌃':'⌄';
    body.hidden=!open;
   });
  }
  if (planner) {
   const header=planner.querySelector('.planner-dashboard-intro');
   const metric=planner.querySelector('.planner-dashboard-metrics');
   const preview=$('plannerDashboardPreview');
   if(header) addCollapse(planner,header,[metric,preview],'Planner',false);
  }
  if (recent) {
   const header=recent.querySelector('.card-heading');
   const table=recent.querySelector('.table-scroll');
   if(header && table) addCollapse(recent,header,[table],'Recent Attendance',true);
  }
  // Quick shortcuts reuse the app's existing data-go navigation and permission checks.
  if (shortcuts) {
   const schedule=shortcuts.querySelector('[data-go="schedules"] strong');
   if(schedule) schedule.textContent='My Timetable';
   const students=shortcuts.querySelector('[data-go="students"] strong');
   if(students) students.textContent='My Assigned Learners';
   const sf2=shortcuts.querySelector('[data-go="sf2"] strong');
   if(sf2) sf2.textContent='My Section SF2';
  }
 }
 if(window.attendigoStaffIdentity?.then) window.attendigoStaffIdentity.then(init).catch(()=>{});
})();
