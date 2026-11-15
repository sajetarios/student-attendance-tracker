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

test('school scheduling configuration APIs enforce admin writes and school scoping',()=>{
  const routes=read('scheduling-config-routes.js');
  const server=read('server.js');
  const sql=read('migrations/021_calendar_exception_schedule_selection.sql');
  assert.match(server,/registerSchedulingConfigRoutes\(app, pool/);
  assert.match(routes,/app\.put\('\/api\/scheduling-config\/operating-days',authenticateSchoolClient,admin/);
  assert.match(routes,/app\.post\('\/api\/scheduling-config\/templates',authenticateSchoolClient,admin/);
  assert.match(routes,/app\.post\('\/api\/scheduling-config\/calendar-exceptions',authenticateSchoolClient,admin/);
  assert.match(routes,/school_calendar_exception_periods/);
  assert.match(routes,/dismissal_time/);
  assert.match(routes,/new Date\(v\+'T00:00:00Z'\)\.toISOString\(\)\.slice\(0,10\)===v/);
  assert.match(routes,/notes\.length>500/);
  assert.match(routes,/app\.delete\('\/api\/scheduling-config\/calendar-exceptions\/:exceptionId'/);
  assert.match(sql,/school_calendar_exception_periods/);
  assert.match(routes,/WHERE school_id=\$1/);
  assert.match(routes,/days\.length!==7/);
  assert.match(routes,/WEEKEND/);
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
  assert.match(portal,/scheduleTemplatePeriod/);
  assert.match(server,/INSERT INTO class_period_days\(school_id,period_id,weekday\)/);
  assert.match(server,/d\.weekday=ANY\(\$[0-9]+::smallint\[\]\)/);
  assert.match(server,/array_agg\(d\.weekday ORDER BY d\.weekday\)/);
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
