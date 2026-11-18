'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sql = fs.readFileSync(path.join(__dirname, '../migrations/062_mnchs_pilot_attendance_reset.sql'),'utf8');

test('MNCHS pilot attendance reset is bound to exact school code, name and UUID', () => {
  assert.match(sql,/current_database\(\) <> 'student_tracker_bpv7'/);
  assert.match(sql,/school_code='MNCHS'/);
  assert.match(sql,/63643724-c50d-4859-aa42-c54818c2a152/);
  assert.match(sql,/MATI NATIONAL COMPREHENSIVE HIGH SCHOOL/);
  assert.match(sql,/school identity mismatch/);
  assert.match(sql,/not present; attendance-only pilot reset skipped/);
});

test('reset archives before deleting with a unique one-time marker and verification', () => {
  const snapshot = sql.indexOf('FOREACH v_table IN ARRAY ARRAY[');
  const deletion = sql.indexOf('DELETE FROM sms_outbox so');
  const finish = sql.indexOf('SET completed_at=clock_timestamp()');
  assert.ok(snapshot > 0 && deletion > snapshot && finish > deletion);
  assert.match(sql,/to_jsonb\(t\) FROM %I t WHERE t.school_id=\$2/);
  assert.match(sql,/UNIQUE \(school_id, reason\)/);
  assert.match(sql,/already been completed; no further rows deleted/);
  assert.match(sql,/failed verification for table/);
});

test('only attendance event, session, check-in, finalization, manual, SF2, SARDO and DTR review rows are deleted', () => {
  const matches = [...sql.matchAll(/DELETE FROM\s+(\w+)/g)].map(m=>m[1]);
  const expected = new Set([
    'sms_outbox', 'staff_attendance_challenge_redemptions',
    'staff_attendance_events','staff_attendance_challenges','teacher_gate_events',
    'class_qr_checkins','class_qr_sessions','class_attendance_finalization_events',
    'class_attendance_finalizations','manual_attendance_marks','manual_attendance_notes',
    'sf2_daily_overrides','sf2_submissions','sardo_followup_events','sardo_followups',
    'school_cloud_sync_outbox','attendance_events','staff_form48_monthly_reviews'
  ]);
  assert.deepEqual(new Set(matches),expected);
  assert.equal(matches.length,expected.size);
  for(const table of matches){
    if (table !== 'sms_outbox') assert.ok(sql.includes('DELETE FROM '+table+' WHERE school_id=v_school_id;'));
  }
  assert.match(sql,/DELETE FROM sms_outbox so USING attendance_events ae\s+WHERE so.event_id=ae.event_id AND ae.school_id=v_school_id/);
});

test('do not remove school accounts, students, enrollment, working schedules, leave, OB or security audit trails', () => {
  for(const protectedTable of [
    'school_users','student_accounts','students','student_enrollments','student_sessions',
    'class_periods','timetable_templates','staff_form48_employee_schedules',
    'staff_form48_school_defaults','staff_form48_approved_leaves',
    'staff_official_business_requests','staff_attendance_audit','manual_attendance_audit',
    'audit_logs','school_years','staff_lunch_presenter_assignments'
  ]){
    assert.doesNotMatch(sql,new RegExp('DELETE\\s+FROM\\s+'+protectedTable+'\\b','i'));
    assert.doesNotMatch(sql,new RegExp('UPDATE\\s+'+protectedTable+'\\s+SET','i'));
  }
  assert.match(sql,/account\/enrollment preservation check failed/);
  assert.match(fs.readFileSync(path.join(__dirname, '../scripts/migrate.js'),'utf8'),/062_mnchs_pilot_attendance_reset\.sql/);
});
