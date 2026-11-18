'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sql = fs.readFileSync(path.join(__dirname,'../migrations/050_staff_smart_attendance_foundation.sql'),'utf8');
test('new staff ledger preserves four DTR slots distinct from physical gate events',()=>{
 assert.match(sql,/AM_IN','AM_OUT','PM_IN','PM_OUT/);
 assert.match(sql,/event_kind IN \('DTR_SLOT','GATE_MOVEMENT'\)/);
 assert.match(sql,/staff_dtr_one_verified_slot_per_day/);
 assert.match(sql,/verification_status='VERIFIED'/);
 assert.doesNotMatch(sql,/ALTER TABLE teacher_gate_events/i);
 assert.doesNotMatch(sql,/UPDATE (students|attendance_events|teacher_gate_events)\b/i);
});
test('rotating challenges are short lived and one redemption per staff member',()=>{
 assert.match(sql,/challenge_hash TEXT NOT NULL UNIQUE/);
 assert.match(sql,/INTERVAL '5 minutes'/);
 assert.match(sql,/PRIMARY KEY\(school_id,challenge_id,staff_user_id\)/);
});
test('official business retains two-stage approval and scoped coverage relationships',()=>{
 assert.match(sql,/PENDING_HEAD','PENDING_ADMIN','APPROVED','REJECTED','CANCELLED/);
 assert.match(sql,/FOREIGN KEY\(school_id,department_id\)/);
 assert.match(sql,/FOREIGN KEY\(school_id,period_id\)/);
 assert.match(sql,/NEEDS_COVERAGE','SUBSTITUTE_ASSIGNED','RESCHEDULED','CANCELLED/);
});
test('offline unverified events cannot be mistaken for verified by default',()=>{
 assert.match(sql,/verification_status TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION'/);
 assert.match(sql,/client_event_key UUID NOT NULL/);
 assert.match(sql,/received_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
});

test('staff event ledger enforces school-scoped identities and idempotent capture',()=>{
 assert.match(sql,/UNIQUE\(school_id,client_event_key\)/);
 assert.match(sql,/FOREIGN KEY\(school_id,staff_user_id\) REFERENCES school_users\(school_id,user_id\)/);
 assert.match(sql,/FOREIGN KEY\(school_id,actor_user_id\) REFERENCES school_users\(school_id,user_id\)/);
 assert.match(sql,/CHECK \(verification_status <> 'VERIFIED' OR verification_method IS NOT NULL\)/);
 assert.match(sql,/WHERE event_kind='DTR_SLOT' AND verification_status='VERIFIED'/);
});
test('staff challenge redemption and OB coverage cannot cross school boundaries',()=>{
 for(const relationship of [
  'FOREIGN KEY(school_id,challenge_id) REFERENCES staff_attendance_challenges(school_id,challenge_id)',
  'FOREIGN KEY(school_id,event_id) REFERENCES staff_attendance_events(school_id,event_id)',
  'FOREIGN KEY(school_id,request_id) REFERENCES staff_official_business_requests(school_id,request_id)',
  'FOREIGN KEY(school_id,period_id) REFERENCES class_periods(school_id,period_id)'
 ]) assert.ok(sql.includes(relationship), 'Missing school-scoped reference: '+relationship);
});
test('staff audit trail rejects edits and deletion at the database level',()=>{
 assert.match(sql,/CREATE TRIGGER staff_attendance_audit_immutable/);
 assert.match(sql,/BEFORE UPDATE OR DELETE ON staff_attendance_audit/);
 assert.match(sql,/RAISE EXCEPTION 'Staff attendance audit history is append-only'/);
});
