'use strict';

/**
 * SARDO is based on adviser-confirmed whole-day SF2 absences, never on a missed
 * scan or a subject-specific absence alone. Teacher QR/manual presence overrides
 * a conflicting absence until it is reconciled.
 */
const MIN_STREAK = 5;
const LOOKBACK_CALENDAR_DAYS = 180;
const RECENT_SCHOOL_DAYS = 30;

function manilaToday(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function schoolDays(today, operatingRows, exceptionRows, lookback = LOOKBACK_CALENDAR_DAYS) {
  if (!isValidDate(today)) throw new Error('Invalid school date');
  const configured = new Map(operatingRows.map(row => [Number(row.weekday), Boolean(row.isOperatingDay)]));
  const exceptions = new Map(exceptionRows.map(row => [String(row.date).slice(0, 10), row.type]));
  const current = new Date(today + 'T00:00:00Z');
  const days = [];
  for (let offset = lookback; offset >= 1; offset--) {
    const date = new Date(current);
    date.setUTCDate(date.getUTCDate() - offset);
    const day = date.toISOString().slice(0, 10);
    const rule = exceptions.get(day);
    const operates = configured.has(date.getUTCDay())
      ? configured.get(date.getUTCDay()) : date.getUTCDay() >= 1 && date.getUTCDay() <= 5;
    if (rule === 'CLOSED') continue;
    if (rule === 'OPEN' || rule === 'SPECIAL_CLASS' || rule === 'SHORTENED_DAY' || operates) days.push(day);
  }
  return days;
}

function computeAlerts(days, absenceRows, recentSchoolDays = RECENT_SCHOOL_DAYS) {
  const byStudent = new Map();
  let conflicts = 0;
  for (const item of absenceRows) {
    const id = String(item.studentId);
    if (!byStudent.has(id)) byStudent.set(id, { info: item, daily: new Map() });
    if (item.hasPresence) conflicts++;
    byStudent.get(id).daily.set(String(item.date).slice(0, 10),
      item.hasPresence ? 'CONFLICT' : item.absenceType);
  }
  const alertThreshold = days[Math.max(0, days.length - recentSchoolDays)] || '';
  const alerts = [];
  for (const [studentId, entry] of byStudent) {
    let start = '', length = 0, streak = null;
    const saveStreak = (end) => {
      if (length >= MIN_STREAK && end >= alertThreshold) {
        streak = { studentId, fullName: entry.info.fullName,
          gradeLevel: entry.info.gradeLevel, section: entry.info.section,
          streakStart: start, streakEnd: end, consecutiveDays: length };
      }
    };
    let previous = '';
    for (const date of days) {
      if (entry.daily.get(date) === 'UNEXCUSED') {
        if (!length) start = date;
        length++;
      } else {
        if (length) saveStreak(previous);
        start = '';
        length = 0;
      }
      previous = date;
    }
    if (length) saveStreak(previous);
    if (streak) alerts.push(streak);
  }
  alerts.sort((a, b) => b.streakEnd.localeCompare(a.streakEnd)
    || b.consecutiveDays - a.consecutiveDays || a.fullName.localeCompare(b.fullName));
  return { alerts, conflicts };
}

function registerSardoRoutes(app, pool, { authenticateSchoolClient, requireSchoolRoles }) {
  const monitor = [authenticateSchoolClient, requireSchoolRoles('SCHOOL_ADMIN', 'DEPARTMENT_HEAD')];

  async function readSardo(schoolId) {
    const today = manilaToday();
    const cutoff = new Date(today + 'T00:00:00Z');
    cutoff.setUTCDate(cutoff.getUTCDate() - LOOKBACK_CALENDAR_DAYS);
    const from = cutoff.toISOString().slice(0, 10);
    const [operating, exceptions, absences] = await Promise.all([
      pool.query(`SELECT weekday, is_operating_day AS "isOperatingDay"
                  FROM school_operating_days WHERE school_id=$1`, [schoolId]),
      pool.query(`SELECT calendar_date::text AS date, exception_type AS type
                  FROM school_calendar_exceptions
                  WHERE school_id=$1 AND calendar_date >= $2::date AND calendar_date < $3::date`,
        [schoolId, from, today]),
      pool.query(`SELECT o.student_id AS "studentId",o.school_date::text AS date,
                        o.absence_type AS "absenceType",s.full_name AS "fullName",
                        COALESCE(en.grade_level,s.grade_level) AS "gradeLevel",
                        COALESCE(en.section,s.section) AS section,
                        (
                          EXISTS (SELECT 1 FROM attendance_events a
                                  WHERE a.school_id=o.school_id AND a.student_id=o.student_id
                                    AND a.school_date=o.school_date
                                    AND a.attendance_scope IN ('CLASS','ADVISORY')
                                    AND a.event_type='TIME_IN'
                                    AND COALESCE(a.sync_status,'ACCEPTED')='ACCEPTED')
                          OR EXISTS (SELECT 1 FROM manual_attendance_marks m
                                     WHERE m.school_id=o.school_id AND m.student_id=o.student_id
                                       AND m.school_date=o.school_date
                                       AND m.status IN ('PRESENT','LATE'))
                        ) AS "hasPresence"
                   FROM sf2_daily_overrides o
                   JOIN students s ON s.school_id=o.school_id AND s.student_id=o.student_id
                   LEFT JOIN LATERAL (
                     SELECT e.grade_level,e.section FROM student_enrollments e
                     JOIN school_years y ON y.school_id=e.school_id AND y.school_year_id=e.school_year_id
                     WHERE e.school_id=s.school_id AND e.student_id=s.student_id
                       AND y.status='ACTIVE' AND e.enrollment_status='ENROLLED'
                     ORDER BY e.created_at DESC LIMIT 1
                   ) en ON TRUE
                   WHERE o.school_id=$1 AND o.status='ABSENT' AND s.active=TRUE
                     AND o.school_date >= $2::date AND o.school_date < $3::date
                   ORDER BY o.student_id,o.school_date`, [schoolId, from, today])
    ]);
    const dates = schoolDays(today, operating.rows, exceptions.rows);
    const calculated = computeAlerts(dates, absences.rows);
    const followups = calculated.alerts.length
      ? await pool.query(`SELECT student_id AS "studentId",streak_start::text AS "streakStart",
                               state,note,updated_at AS "updatedAt"
                         FROM sardo_followups WHERE school_id=$1 AND streak_start >= $2::date`,
          [schoolId, from]) : { rows: [] };
    const followupMap = new Map(followups.rows.map(row => [row.studentId + '|' + row.streakStart, row]));
    const alerts = calculated.alerts.map(item => {
      const state = followupMap.get(item.studentId + '|' + item.streakStart);
      return { ...item, state: state?.state || 'OPEN', note: state?.note || '',
        updatedAt: state?.updatedAt || null };
    });
    return {
      monitoringEnabled: true, alerts, totalAlerts: alerts.length,
      openAlerts: alerts.filter(item => item.state !== 'RESOLVED').length,
      resolvedAlerts: alerts.filter(item => item.state === 'RESOLVED').length,
      conflictingDays: calculated.conflicts,
      throughDate: dates.at(-1) || null,
      lookbackSchoolDays: Math.min(dates.length, RECENT_SCHOOL_DAYS),
      message: alerts.length
        ? `${alerts.filter(item => item.state !== 'RESOLVED').length} learners have a recent confirmed five-day unexcused absence streak.`
        : 'No confirmed five-day unexcused absence streaks in the recent monitoring window.'
    };
  }

  app.get('/api/sardo', ...monitor, async (req, res) => {
    try {
      return res.json(await readSardo(req.auth.schoolId));
    } catch (error) {
      console.error('SARDO monitoring read failed:', error.message);
      return res.status(503).json({ error: 'Could not load SARDO alerts. Please check the attendance database and try again.' });
    }
  });

  app.post('/api/sardo/followup', ...monitor, async (req, res) => {
    const { studentId, streakStart, state, note } = req.body || {};
    const normalizedState = String(state || '').toUpperCase();
    const message = String(note || '').trim();
    if (typeof studentId !== 'string' || studentId.length > 160 || !isValidDate(streakStart)
      || !['OPEN','CONTACTED','MONITORING','RESOLVED'].includes(normalizedState)
      || message.length > 1000
      || (normalizedState !== 'OPEN' && !message)) {
      return res.status(400).json({ error: 'Choose a valid follow-up status and enter a note (1–1000 characters).' });
    }
    try {
      const current = await readSardo(req.auth.schoolId);
      if (!current.alerts.some(item => item.studentId === studentId && item.streakStart === streakStart))
        return res.status(409).json({ error: 'This alert has changed. Refresh SARDO monitoring before saving a follow-up.' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`INSERT INTO sardo_followups
            (school_id,student_id,streak_start,state,note,updated_by_user_id)
          VALUES($1,$2,$3::date,$4,$5,$6)
          ON CONFLICT(school_id,student_id,streak_start) DO UPDATE
          SET state=EXCLUDED.state,note=EXCLUDED.note,
              updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=NOW()`,
          [req.auth.schoolId, studentId, streakStart, normalizedState, message, req.auth.userId]);
        await client.query(`INSERT INTO sardo_followup_events
          (school_id,student_id,streak_start,state,note,actor_user_id)
          VALUES($1,$2,$3::date,$4,$5,$6)`,
          [req.auth.schoolId, studentId, streakStart, normalizedState, message, req.auth.userId]);
        await client.query('COMMIT');
        return res.json({ ok: true });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }
    } catch (error) {
      console.error('SARDO follow-up save failed:', error.message);
      return res.status(500).json({ error: 'Could not save SARDO follow-up.' });
    }
  });
}

module.exports = { registerSardoRoutes, manilaToday, schoolDays, computeAlerts };
