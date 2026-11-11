$ErrorActionPreference = "Stop"
$server = Join-Path (Get-Location) "server.js"
if (!(Test-Path $server)) { throw "server.js was not found. Run this from C:\SchoolAttendance-Test." }
$content = Get-Content $server -Raw
if ($content.Contains("app.get('/api/sections'")) {
  Write-Host "The /api/sections route is already installed. No change made."
  exit 0
}
$marker = "// Roster: school-scoped for all principals;"
if (!$content.Contains($marker)) { throw "Could not find the student roster route marker. No change made." }
Copy-Item $server "$server.backup-before-sections-parent-invite" -Force
$route = @'
// Grade-to-section options for student registration. Sections are derived from active class schedules.
app.get('/api/sections', authenticateSchoolClient, requireSchoolUser, async (req, res) => {
  const gradeLevel = typeof req.query.gradeLevel === 'string' ? req.query.gradeLevel.trim() : '';
  if (!gradeLevel || gradeLevel.length > 40) return res.status(400).json({ error: 'Select a valid grade level.' });
  try {
    const params = [req.auth.schoolId, gradeLevel];
    let teacherScope = '';
    if (req.auth.role === 'TEACHER') {
      params.push(req.auth.userId);
      teacherScope = ` AND (
        EXISTS (SELECT 1 FROM teacher_period_assignments a
                WHERE a.school_id=p.school_id AND a.period_id=p.period_id AND a.teacher_user_id=$3)
        OR EXISTS (SELECT 1 FROM teacher_period_substitutions ts
                   WHERE ts.school_id=p.school_id AND ts.period_id=p.period_id
                     AND ts.substitute_teacher_user_id=$3 AND ts.status='ACTIVE'
                     AND (NOW() AT TIME ZONE 'Asia/Manila')::date BETWEEN ts.start_date AND ts.end_date)
      )`;
    }
    const result = await pool.query(
      `SELECT DISTINCT TRIM(p.section) AS section
       FROM class_periods p
       WHERE p.school_id=$1 AND p.grade_level=$2 AND p.active=TRUE
         AND p.section IS NOT NULL AND TRIM(p.section) <> ''${teacherScope}
       ORDER BY section`,
      params
    );
    return res.json({ sections: result.rows.map(row => row.section) });
  } catch (err) {
    console.error('Section options failed:', err.message);
    return res.status(500).json({ error: 'Could not load sections.' });
  }
});
'@
$content = $content.Replace($marker, $route + "`r`n" + $marker)
Set-Content -Path $server -Value $content -Encoding UTF8
Write-Host "Added secure /api/sections route. Backup: server.js.backup-before-sections-parent-invite"
