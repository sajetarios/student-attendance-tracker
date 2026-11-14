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
  assert.match(runner,/'020_configurable_school_timetable\.sql'/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS school_operating_days/);
  assert.match(sql,/weekday BETWEEN 0 AND 6/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS timetable_templates/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS timetable_template_periods/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS school_calendar_exceptions/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS class_period_days/);
  assert.match(sql,/ADD COLUMN IF NOT EXISTS effective_from DATE/);
  assert.doesNotMatch(sql,/DROP TABLE|TRUNCATE|DELETE FROM (students|attendance)/i);
});

test('school scheduling configuration APIs enforce admin writes and school scoping',()=>{
  const routes=read('scheduling-config-routes.js');
  const server=read('server.js');
  assert.match(server,/registerSchedulingConfigRoutes\(app, pool/);
  assert.match(routes,/app\.put\('\/api\/scheduling-config\/operating-days',authenticateSchoolClient,admin/);
  assert.match(routes,/app\.post\('\/api\/scheduling-config\/templates',authenticateSchoolClient,admin/);
  assert.match(routes,/app\.post\('\/api\/scheduling-config\/calendar-exceptions',authenticateSchoolClient,admin/);
  assert.match(routes,/WHERE school_id=\$1/);
  assert.match(routes,/days\.length!==7/);
  assert.match(routes,/WEEKEND/);
});
