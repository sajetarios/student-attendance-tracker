'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Client } = require('pg');
const { teacherRecentClassAttendanceSql: sql } = require('../recent-class-attendance');

const html = fs.readFileSync('public/portal.html', 'utf8');
const ui = fs.readFileSync('public/portal.js', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');
const css = fs.readFileSync('public/recent-class-attendance.css', 'utf8');
const worker = fs.readFileSync('public/sw.js', 'utf8');

test('teacher class preview is read-only, school-scoped and reconciled per class date', () => {
  assert.match(server, /const \{ teacherRecentClassAttendanceSql \} = require\('\.\/recent-class-attendance'\)/);
  assert.match(server, /const recentSql = isSchoolWideViewer[\s\S]*?: teacherRecentClassAttendanceSql;/);
  assert.match(sql, /e\.attendance_scope = 'CLASS'/);
  assert.match(sql, /e\.event_type = 'TIME_IN'/);
  assert.match(sql, /e\.sync_status = 'ACCEPTED'/);
  assert.match(sql, /m\.school_id = \$1/);
  assert.match(sql, /e\.school_id = \$1/);
  assert.match(sql, /q\.period_id = m\.period_id/);
  assert.match(sql, /q\.student_id = m\.student_id/);
  assert.match(sql, /q\.school_date = m\.school_date/);
  assert.match(sql, /COALESCE\(m\.status, q\.status\)/);
  assert.match(sql, /m\.status IN \('ABSENT', 'EXCUSED'\)/);
  for (const owner of ['teacher_period_assignments','teacher_period_substitutions',
    'schedule_day_adjustments','class_adviser_assignments'])
    assert.ok(sql.includes(owner), 'scope must include ' + owner);
  assert.match(sql, /a\.teacher_user_id = \$2/);
  assert.match(sql, /ts\.substitute_teacher_user_id = \$2/);
  assert.match(sql, /da\.teacher_user_id = \$2/);
  assert.match(sql, /ca\.adviser_user_id = \$2/);
  assert.match(sql, /LIMIT 20/);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
});

test('recent attendance presents all requested fields without mixing unsynced drafts', () => {
  for (const col of ['Learner','Class','Date','Status','Source','Recorded time'])
    assert.ok(html.includes('<th>' + col + '</th>'), col + ' table column');
  assert.ok(html.includes('id="recentRows" aria-live="polite"'));
  assert.match(ui, /row\.source === 'MANUAL' \? 'Manual' : 'QR'/);
  assert.match(ui, /row\.needsReview/);
  assert.match(ui, /recent-conflict-note/);
  assert.match(ui, /No synced manual marks or accepted QR class check-ins/);
  assert.match(ui, /data\.recentLoadFailed/);
  assert.match(ui, /timeZone: 'Asia\/Manila'/);
  assert.match(ui, /classSection/);
  assert.match(ui, /recordedTime/);
  assert.match(ui, /esc\(row\.fullName/);
  assert.match(ui, /status\.charAt\(0\)/);
  assert.match(css, /@container \(max-width:710px\)/);
  assert.match(css, /html\[data-ui-theme=dark\]/);
  assert.ok(html.includes('/recent-class-attendance.css?v=2'));
  assert.ok(worker.includes('/recent-class-attendance.css?v=2'));
  const versionedPortal = html.match(/\/portal\.js\?v=\d+/)?.[0];
  assert.ok(versionedPortal, 'portal JS must have a version');
  assert.ok(worker.includes(versionedPortal), 'worker must cache the actual portal JS version');
});

const localDb = /^postgres(?:ql)?:\/\/[^@]+@(?:localhost|127\.0\.0\.1):5432\/school_attendance_test(?:\?|$)/.test(process.env.DATABASE_URL || '');
test('PostgreSQL preview deduplicates QR + manual, preserves corrections and excludes other schools/classes', {
  skip: !localDb && 'Requires the isolated local CI PostgreSQL test database'
}, async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  const s1 = '11111111-1111-4111-8111-111111111111';
  const s2 = '22222222-2222-4222-8222-222222222222';
  const teacher = '33333333-3333-4333-8333-333333333333';
  const other = '44444444-4444-4444-8444-444444444444';
  const p1 = '55555555-5555-4555-8555-555555555555';
  const p2 = '66666666-6666-4666-8666-666666666666';
  const p3 = '77777777-7777-4777-8777-777777777777';
  const p4 = '88888888-8888-4888-8888-888888888888';
  const p5 = '99999999-9999-4999-8999-999999999999';
  await db.connect();
  try {
    await db.query('BEGIN');
    // TEMP shadow tables guarantee no persistent user records are read or changed.
    await db.query([
      'CREATE TEMP TABLE attendance_events (event_id uuid, school_id uuid, period_id uuid, student_id text, school_date date, late boolean, occurred_at_device timestamptz, sync_status text, attendance_scope text, event_type text) ON COMMIT DROP;',
      'CREATE TEMP TABLE manual_attendance_marks (school_id uuid, period_id uuid, student_id text, school_date date, status text, updated_at timestamptz) ON COMMIT DROP;',
      'CREATE TEMP TABLE students (school_id uuid, student_id text, full_name text) ON COMMIT DROP;',
      'CREATE TEMP TABLE class_periods (school_id uuid, period_id uuid, subject_name text, period_name text, grade_level text, section text) ON COMMIT DROP;',
      'CREATE TEMP TABLE teacher_period_assignments (school_id uuid, period_id uuid, teacher_user_id uuid) ON COMMIT DROP;',
      'CREATE TEMP TABLE teacher_period_substitutions (school_id uuid, period_id uuid, substitute_teacher_user_id uuid, status text, start_date date, end_date date) ON COMMIT DROP;',
      'CREATE TEMP TABLE schedule_day_adjustments (school_id uuid, period_id uuid, teacher_user_id uuid, school_date date) ON COMMIT DROP;',
      'CREATE TEMP TABLE class_adviser_assignments (school_id uuid, adviser_user_id uuid, grade_level text, section text) ON COMMIT DROP;'
    ].join('\n'));
    await db.query("INSERT INTO students VALUES ($1,'A','Alpha Learner'),($1,'B','Beta Learner'),($1,'C','Charlie Learner'),($1,'D','Dana Learner'),($1,'E','Echo Learner'),($1,'F','Foxtrot Learner'),($1,'G','Golf Learner'),($1,'H','Hotel Learner'),($1,'I','India Learner'),($2,'Z','Other School Learner')",[s1,s2]);
    await db.query('INSERT INTO class_periods VALUES ($1,$3,\'Mathematics\',\'Period 1\',\'9\',\'Rizal\'),($1,$4,\'Science\',\'Period 2\',\'9\',\'Rizal\'),($1,$5,\'Hidden subject\',\'Period 3\',\'10\',\'Mabini\'),($1,$6,\'Advisory\',\'Period 4\',\'9\',\'Jade\'),($1,$7,\'Day adjustment\',\'Period 5\',\'11\',\'Jade\'),($2,$3,\'Other school\',\'Period 1\',\'9\',\'Rizal\')',[s1,s2,p1,p2,p3,p4,p5]);
    await db.query('INSERT INTO teacher_period_assignments VALUES ($1,$2,$3),($1,$4,$3),($1,$5,$6)',[s1,p1,teacher,p2,p3,other]);
    await db.query('INSERT INTO class_adviser_assignments VALUES ($1,$2,\'9\',\'Jade\')',[s1,teacher]);
    await db.query('INSERT INTO schedule_day_adjustments VALUES ($1,$2,$3,\'2026-11-23\')',[s1,p5,teacher]);
    await db.query("INSERT INTO manual_attendance_marks VALUES ($1,$2,'A','2026-11-23','ABSENT','2026-11-23T09:00:00Z'),($1,$2,'A','2026-11-22','PRESENT','2026-11-22T09:00:00Z'),($1,$2,'B','2026-11-23','LATE','2026-11-23T09:00:00Z'),($1,$2,'D','2026-11-23','PRESENT','2026-11-23T09:00:00Z'),($1,$3,'G','2026-11-23','EXCUSED','2026-11-23T09:00:00Z'),($1,$4,'H','2026-11-23','PRESENT','2026-11-23T09:00:00Z'),($1,$5,'I','2026-11-23','PRESENT','2026-11-23T09:00:00Z')",[s1,p1,p3,p4,p5]);
    const addScan = async (id,school,period,student,date,late,time,scope='CLASS',sync='ACCEPTED') => {
      await db.query('INSERT INTO attendance_events VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,\'TIME_IN\')',
        [id,school,period,student,date,late,time,sync,scope]);
    };
    await addScan('10000000-0000-4000-8000-000000000001',s1,p1,'A','2026-11-23',false,'2026-11-23T08:00:00Z');
    await addScan('10000000-0000-4000-8000-000000000002',s1,p1,'A','2026-11-23',true,'2026-11-23T08:10:00Z');
    await addScan('10000000-0000-4000-8000-000000000003',s1,p1,'C','2026-11-23',false,'2026-11-23T08:00:00Z');
    await addScan('10000000-0000-4000-8000-000000000004',s1,p1,'C','2026-11-23',true,'2026-11-23T08:10:00Z');
    await addScan('10000000-0000-4000-8000-000000000005',s1,p1,'D','2026-11-23',true,'2026-11-23T08:30:00Z');
    await addScan('10000000-0000-4000-8000-000000000006',s1,p2,'A','2026-11-23',true,'2026-11-23T10:30:00Z');
    await addScan('10000000-0000-4000-8000-000000000007',s1,p1,'E','2026-11-23',false,'2026-11-23T08:30:00Z','SCHOOL');
    await addScan('10000000-0000-4000-8000-000000000008',s1,p1,'F','2026-11-23',false,'2026-11-23T08:30:00Z','CLASS','PENDING');
    await addScan('10000000-0000-4000-8000-000000000009',s2,p1,'Z','2026-11-23',false,'2026-11-23T08:00:00Z');
    const { rows } = await db.query(sql,[s1,teacher]);
    const lookup = (student,period,date='2026-11-23') => rows.filter(r=>r.studentId===student && r.periodId===period && r.schoolDate===date);
    assert.equal(lookup('A',p1).length,1,'one row despite duplicate accepted QR and manual');
    assert.equal(lookup('A',p1)[0].status,'ABSENT');
    assert.equal(lookup('A',p1)[0].source,'MANUAL');
    assert.equal(lookup('A',p1)[0].needsReview,true);
    assert.equal(lookup('A',p1,'2026-11-22').length,1,'separate school date remains separate');
    assert.equal(lookup('A',p2).length,1,'a different class is not collapsed into first class');
    assert.equal(lookup('A',p2)[0].source,'QR');
    assert.equal(lookup('B',p1)[0].status,'LATE','manual-only marks appear');
    assert.equal(lookup('B',p1)[0].source,'MANUAL');
    assert.equal(lookup('C',p1)[0].status,'PRESENT','first accepted QR scan is authoritative');
    assert.equal(lookup('C',p1)[0].source,'QR');
    assert.equal(lookup('D',p1)[0].status,'PRESENT','manual correction overrides accepted QR late');
    assert.equal(lookup('D',p1)[0].needsReview,false,'matching presence is not a conflict');
    assert.equal(lookup('G',p3).length,0,'an unrelated class stays hidden');
    assert.equal(lookup('H',p4).length,1,'adviser-authorized manual record visible');
    assert.equal(lookup('I',p5).length,1,'date-specific adjustment visible');
    assert.equal(lookup('E',p1).length,0,'gate events not shown');
    assert.equal(lookup('F',p1).length,0,'unaccepted scans not shown');
    assert.equal(rows.some(r=>r.studentId==='Z'),false,'different school excluded');
  } finally {
    await db.query('ROLLBACK').catch(()=>{});
    await db.end();
  }
});
