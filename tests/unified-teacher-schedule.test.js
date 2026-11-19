'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

// Single source of truth: teachers have ONE weekly/list timetable, not a
// redundant second "My Teaching Schedule" table. Advisers retain a distinct
// advisory-only subject overview for their assigned section.
test('teacher weekly/list timetable is scoped to their own assignments without a redundant table',()=>{
 const html=read('public/portal.html'),js=read('public/portal.js');
 assert.match(html,/id="weeklyTimetableWorkspace"/);
 assert.match(html,/id="weeklyTimetableBoard"/);
 assert.match(html,/id="teacherScheduleOverview"/);
 assert.doesNotMatch(html,/id="myTeachingScheduleCard"/);
 assert.match(js,/function renderWeeklyTimetable\(\)/);
 assert.match(js,/const effectivePeriods = periods\.filter\(period =>/);
 assert.match(js,/user\.role !== 'TEACHER' \|\| String\(period\.assignedTeacherUserId \|\| ''\) === String\(user\.userId \|\| ''\)/);
 assert.match(js,/user\.role==='TEACHER'\?'My Teaching Schedule':'Weekly timetable'/);
 assert.match(js,/setScheduleDisplay\(activeScheduleDisplay\)/);
});
test('advisers see all subjects in their advisory section, but only their own teaching timetable',()=>{
 const html=read('public/portal.html'),js=read('public/portal.js');
 assert.match(html,/<details id="myAdvisoryScheduleCard"/);
 assert.match(html,/id="myAdvisoryScheduleRows"/);
 assert.match(js,/const advisoryPeriods = periods\.filter\(period =>/);
 assert.match(js,/hasAdviserRole && adviserAssignments\.some\(assignment =>/);
 assert.match(js,/String\(assignment\.gradeLevel\) === String\(period\.gradeLevel\)/);
 assert.match(js,/String\(assignment\.section\) === String\(period\.section\)/);
 assert.match(js,/String\(period\.assignedTeacherUserId \|\| ''\) === String\(user\.userId \|\| ''\) \? 'You'/);
 assert.match(js,/\$\('myAdvisoryScheduleCard'\)\.hidden = !hasAdviserRole/);
});
test('Class Adviser-only accounts can open the schedule but cannot create class schedules',()=>{
 const js=read('public/portal.js'),server=read('server.js');
 assert.match(js,/teacher && !\(subjectTeacher \|\| classAdviser\)/);
 assert.match(js,/if \(teacherHas\('SUBJECT_TEACHER'\) \|\| teacherHas\('CLASS_ADVISER'\)\) views\.push\('schedules'\)/);
 assert.match(js,/\$\('showScheduleForm'\)\.hidden = !\(admin \|\| \(departmentHead&&user\.departmentId&&user\.departmentCode!=='UNASSIGNED'\)\)/);
 assert.match(server,/app\.post\('\/api\/periods', authenticateSchoolClient, requireSchoolRoles\('SCHOOL_ADMIN', 'DEPARTMENT_HEAD'\)/);
});
