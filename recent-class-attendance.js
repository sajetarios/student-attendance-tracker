'use strict';

/*
 * Teacher dashboard preview only. The attendance register, QR events, SF2,
 * conflict-resolution endpoint and official attendance calculations are not
 * changed here. One learner + class period + school date yields one preview row.
 *
 * The interactive manual register uses manual marks before QR presence;
 * apply that same precedence and surface unresolved ABSENT/EXCUSED vs verified
 * QR presence explicitly. Only server-persisted manual marks and accepted
 * class TIME_INs are eligible. Gate events never enter this preview.
 */
const teacherRecentClassAttendanceSql = `
WITH accepted_qr AS (
  SELECT DISTINCT ON (e.school_id, e.period_id, e.student_id, e.school_date)
    e.school_id, e.period_id, e.student_id, e.school_date,
    CASE WHEN e.late THEN 'LATE' ELSE 'PRESENT' END AS status,
    e.occurred_at_device AS recorded_at
  FROM attendance_events e
  WHERE e.school_id = $1
    AND e.period_id IS NOT NULL
    AND e.attendance_scope = 'CLASS'
    AND e.event_type = 'TIME_IN'
    AND e.sync_status = 'ACCEPTED'
  ORDER BY e.school_id, e.period_id, e.student_id, e.school_date,
           e.occurred_at_device ASC, e.event_id ASC
),
manual AS (
  SELECT m.school_id, m.period_id, m.student_id, m.school_date,
         m.status, m.updated_at AS recorded_at
  FROM manual_attendance_marks m
  WHERE m.school_id = $1
),
reconciled AS (
  SELECT
    COALESCE(m.school_id, q.school_id) AS school_id,
    COALESCE(m.period_id, q.period_id) AS period_id,
    COALESCE(m.student_id, q.student_id) AS student_id,
    COALESCE(m.school_date, q.school_date) AS school_date,
    COALESCE(m.status, q.status) AS status,
    CASE WHEN m.student_id IS NOT NULL THEN 'MANUAL' ELSE 'QR' END AS source,
    CASE WHEN m.student_id IS NOT NULL THEN m.recorded_at ELSE q.recorded_at END AS recorded_at,
    (m.student_id IS NOT NULL AND q.student_id IS NOT NULL
      AND m.status IN ('ABSENT', 'EXCUSED')) AS needs_review
  FROM manual m
  FULL OUTER JOIN accepted_qr q
    ON q.school_id = m.school_id
   AND q.period_id = m.period_id
   AND q.student_id = m.student_id
   AND q.school_date = m.school_date
)
SELECT
  r.student_id AS "studentId",
  s.full_name AS "fullName",
  r.period_id AS "periodId",
  r.school_date::text AS "schoolDate",
  COALESCE(NULLIF(BTRIM(p.subject_name::text), ''),
           NULLIF(BTRIM(p.period_name::text), ''), 'Class') AS "className",
  CONCAT_WS(' · ', p.grade_level, p.section) AS "classSection",
  r.status, r.source, r.recorded_at AS "recordedAt",
  r.needs_review AS "needsReview"
FROM reconciled r
JOIN students s ON s.school_id = r.school_id AND s.student_id = r.student_id
JOIN class_periods p ON p.school_id = r.school_id AND p.period_id = r.period_id
WHERE r.school_id = $1
  AND (
    EXISTS (
      SELECT 1 FROM teacher_period_assignments a
      WHERE a.school_id = r.school_id AND a.period_id = r.period_id
        AND a.teacher_user_id = $2
    )
    OR EXISTS (
      SELECT 1 FROM teacher_period_substitutions ts
      WHERE ts.school_id = r.school_id AND ts.period_id = r.period_id
        AND ts.substitute_teacher_user_id = $2
        AND ts.status = 'ACTIVE'
        AND r.school_date BETWEEN ts.start_date AND ts.end_date
    )
    OR EXISTS (
      SELECT 1 FROM schedule_day_adjustments da
      WHERE da.school_id = r.school_id AND da.period_id = r.period_id
        AND da.teacher_user_id = $2 AND da.school_date = r.school_date
    )
    OR EXISTS (
      SELECT 1 FROM class_adviser_assignments ca
      WHERE ca.school_id = r.school_id AND ca.adviser_user_id = $2
        AND ca.grade_level = p.grade_level AND ca.section = p.section
    )
  )
ORDER BY r.recorded_at DESC NULLS LAST, r.school_date DESC,
         r.student_id, r.period_id
LIMIT 20
`;

module.exports = { teacherRecentClassAttendanceSql };
