'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname,'..','cloud-sync-routes.js'),'utf8');
const receive = source.split("app.post('/api/cloud-sync/receive'")[1]?.split("app.get('/api/cloud-sync/status'")[0] || '';

test('delayed cloud attendance never overwrites learner identity or current placement', () => {
  assert.ok(receive, 'Cloud receive route is registered');
  assert.match(receive, /FROM students s/);
  assert.match(receive, /s\.active=TRUE AND s\.archived_at IS NULL/);
  assert.match(receive, /student_enrollments e/);
  assert.match(receive, /sy\.status='ACTIVE' AND e\.enrollment_status='ENROLLED'/);
  assert.doesNotMatch(receive, /INSERT INTO students\(/, 'Historic QR events must not provision school master data');
  assert.doesNotMatch(receive, /ON CONFLICT\(student_id\) DO UPDATE/);
  assert.doesNotMatch(receive, /SET full_name=EXCLUDED\.full_name/);
  assert.doesNotMatch(receive, /SET grade_level=EXCLUDED\.grade_level/);
  assert.doesNotMatch(receive, /SET section=EXCLUDED\.section/);
  assert.doesNotMatch(receive, /INSERT INTO class_periods\(/, 'QR replication must not auto-create class schedules');
});

test('cross-school student IDs remain rejected rather than reassigned', () => {
  assert.match(receive, /if \(!student\.rowCount\)/);
  assert.match(receive, /Learner is missing, archived, inactive, or belongs to another school/);
  assert.match(receive, /Cloud learner enrollment differs from this scan/);
  assert.match(receive, /results\.push\(\{ eventId:event\.eventId,status:'REJECTED'/);
});

test('attendance event identities remain replay-safe', () => {
  assert.match(receive, /SELECT school_id FROM attendance_events WHERE event_id=\$1/);
  assert.match(receive, /'ALREADY_SYNCED'/);
  assert.match(receive, /ON CONFLICT DO NOTHING RETURNING event_id/);
});
