'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('configurable scheduling migration is registered and additive',()=>{
  const runner=read('scripts/migrate.js');
  const sql=read('migrations/020_configurable_school_timetable.sql');
  const calendarSql=read('migrations/021_calendar_exception_schedule_selection.sql');
  assert.match(runner,/'020_configurable_school_timetable\.sql'/);
  assert.match(runner,/'021_calendar_exception_schedule_selection\.sql'/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS school_operating_days/);
  assert.match(sql,/weekday BETWEEN 0 AND 6/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS timetable_templates/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS timetable_template_periods/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS school_calendar_exceptions/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS class_period_days/);
  assert.match(calendarSql,/ADD COLUMN IF NOT EXISTS dismissal_time TIME/);
  assert.match(calendarSql,/CREATE TABLE IF NOT EXISTS school_calendar_exception_periods/);
  assert.match(calendarSql,/school_calendar_exceptions_school_exception_uidx/);
  assert.match(sql,/ADD COLUMN IF NOT EXISTS effective_from DATE/);
  assert.doesNotMatch(sql,/DROP TABLE|TRUNCATE|DELETE FROM (students|attendance)/i);
});

test('calendar date validator accepts real ISO dates and rejects impossible dates',()=>{
  const routes=read('scheduling-config-routes.js');
  const validatorLine=routes.split('\n').find(line=>line.startsWith('const dateOk='));
  assert.ok(validatorLine,'date validator should be present');
  const dateOk=new Function(validatorLine+'; return dateOk;')();
  assert.equal(dateOk('2026-11-15'),true);
  assert.equal(dateOk('2024-02-29'),true);
  assert.equal(dateOk('2026-02-29'),false);
  assert.equal(dateOk('2026-13-01'),false);
  assert.equal(dateOk('15-11-2026'),false);
});

test('school scheduling configuration APIs enforce admin writes and school scoping',()=>{
  const routes=read('scheduling-config-routes.js');
  const server=read('server.js');
  const sql=read('migrations/021_calendar_exception_schedule_selection.sql');
  assert.match(server,/registerSchedulingConfigRoutes\(app, pool/);
  assert.match(routes,/app\.put\('\/api\/scheduling-config\/operating-days',authenticateSchoolClient,admin/);
  assert.match(routes,/app\.post\('\/api\/scheduling-config\/templates',authenticateSchoolClient,admin/);
  assert.match(routes,/app\.post\('\/api\/scheduling-config\/calendar-exceptions',authenticateSchoolClient,admin/);
  assert.match(routes,/school_calendar_exception_periods/);
  assert.match(routes,/effective_from<=\$3::date/);
  assert.match(routes,/effective_to>=\$3::date/);

  assert.match(routes,/dismissal_time/);
  assert.match(routes,/new Date\(v\+'T00:00:00Z'\)\.toISOString\(\)\.slice\(0,10\)===v/);
  assert.match(routes,/notes\.length>500/);
  assert.match(routes,/app\.delete\('\/api\/scheduling-config\/calendar-exceptions\/:exceptionId'/);
  assert.match(sql,/school_calendar_exception_periods/);
  assert.match(routes,/WHERE school_id=\$1/);
  assert.match(routes,/days\.length!==7/);
  assert.match(routes,/WEEKEND/);
});

test('editing a calendar exception updates the existing record even when its date changes',()=>{
  const routes=read('scheduling-config-routes.js');
  const portal=read('public/portal.js');
  assert.match(routes,/exceptionId!==null/);
  assert.match(routes,/UPDATE school_calendar_exceptions SET calendar_date=\$3::date/);
  assert.match(routes,/Calendar exception not found/);
  assert.match(routes,/Another calendar exception already exists on that date/);
  assert.match(portal,/exceptionId:\$\('calendarExceptionForm'\)\.dataset\.exceptionId\|\|null/);
  assert.match(portal,/dataset\.exceptionId=item\.exceptionId/);
});

test('weekly schedule assignments are stored and conflicts are limited to shared weekdays',()=>{
  const html=read('public/portal.html');
  const portal=read('public/portal.js');
  const server=read('server.js');
  assert.match(html,/id="operatingDaysForm"/);
  assert.match(html,/id="timetableTemplateForm"/);
  assert.match(html,/id="calendarExceptionForm"/);
  assert.match(html,/id="scheduleWeekdayChoices"/);
  assert.match(portal,/weekdays: selectedScheduleWeekdays\(\)/);
  assert.match(portal,/weeklyScheduleAsOf/);
  assert.match(portal,/period\.effectiveFrom/);
  assert.match(portal,/period\.effectiveTo/);
  assert.match(html,/id="weeklyScheduleAsOf"/);
  assert.match(portal,/scheduleTemplatePeriod/);
  assert.match(server,/INSERT INTO class_period_days\(school_id,period_id,weekday\)/);
  assert.match(server,/d\.weekday=ANY\(\$[0-9]+::smallint\[\]\)/);
  assert.match(server,/array_agg\(d\.weekday ORDER BY d\.weekday\)/);
});

test('teacher assignment conflict checks keep permanent and substitute SQL aliases separate',()=>{
  const server=read('server.js');
  const assignmentQuery=server.match(/const scheduleConflict = await client\.query\(([\s\S]*?)\n\s*\[req\.auth\.schoolId, teacherUserId, req\.params\.periodId\]\n\s*\);/);
  assert.ok(assignmentQuery,'single schedule assignment conflict query should be present');
  const assignmentSql=assignmentQuery[1];
  const permanentBranch=assignmentSql.split('UNION ALL')[0];
  const substituteBranch=assignmentSql.split('UNION ALL')[1]||'';
  assert.match(permanentBranch,/FROM teacher_period_assignments existing/);
  assert.doesNotMatch(permanentBranch,/\bts\./);
  assert.match(substituteBranch,/FROM teacher_period_substitutions ts/);
  assert.match(substituteBranch,/ts\.start_date/);

  const bulkQuery=server.match(/const conflict = await client\.query\(([\s\S]*?)\n\s*\[req\.auth\.schoolId, teacherUserId, p\.periodId, p\.startTime, p\.endTime\]\n\s*\);/);
  assert.ok(bulkQuery,'bulk schedule assignment conflict query should be present');
  const bulkPermanentBranch=bulkQuery[1].split('UNION ALL')[0];
  assert.match(bulkPermanentBranch,/FROM teacher_period_assignments a/);
  assert.doesNotMatch(bulkPermanentBranch,/\bts\./);
});

test('Admin dashboard tab switching does not reference a removed permissions card',()=>{
  const portal=read('public/portal.js');
  const html=read('public/portal.html');
  assert.match(portal,/function setAdminManagementTab\(tabName = 'accounts'\)/);
  assert.doesNotMatch(portal,/\\bteacherPermissionsCard\\b/);
  assert.match(portal,/if \(accountAccessPanel\) accountAccessPanel\.hidden = activeTab !== 'permissions'/);
  assert.match(html,/id="accountAccessPanel"/);
});

test('administrator can load the shared timetable while configuration writes remain admin-only',()=>{
  const server=read('server.js');
  const routes=read('scheduling-config-routes.js');
  assert.match(server,/app\.get\('\/api\/periods', authenticateSchoolClient, requireSchoolRoles\('SCHOOL_ADMIN','DEPARTMENT_HEAD','TEACHER'\)/);
  assert.match(routes,/app\.put\('\/api\/scheduling-config\/operating-days',authenticateSchoolClient,admin/);
});


test('calendar exceptions require selected schedules or an explicit shortened-day dismissal time',()=>{
  const routes=read('scheduling-config-routes.js');
  const server=read('server.js');
  const portal=read('public/portal.js');
  const html=read('public/portal.html');
  assert.match(routes,/Additional operating and special-class days require selected schedules/);
  assert.match(routes,/dismissal_time/);
  assert.match(routes,/school_calendar_exception_periods/);
  assert.match(routes,/app\.delete\('\/api\/scheduling-config\/calendar-exceptions\/:exceptionId'/);
  assert.match(server,/School is marked closed on this date/);
  assert.match(server,/not selected to operate on this special calendar date/);
  assert.match(server,/after the scheduled dismissal time for this shortened day/);
  assert.match(server,/calendarException\.dismissalTime && event\.eventType === 'TIME_IN'/);
  assert.match(server,/exception\.dismissalTime && eventType === 'TIME_IN'/);
  assert.match(server,/calendarException\.dismissalTime && event\.eventType === 'TIME_IN'/);
  assert.match(server,/updated_at AS \"appliedAt\"/);
  assert.match(server,/new Date\(event\.occurredAt\) >= new Date\(calendarException\.appliedAt\)/);
  assert.match(server,/p\.effective_from<=\$4::date/);
  assert.match(portal,/calendarExceptionSchedules/);
  assert.match(portal,/renderCalendarExceptions/);
  assert.match(portal,/data-edit-calendar-exception/);
  assert.match(portal,/cancelCalendarExceptionEdit/);
  assert.match(html,/id="cancelCalendarExceptionEdit"/);
  assert.match(html,/id="calendarExceptionList"/);
  assert.match(html,/id="calendarDismissalTime"/);
});
