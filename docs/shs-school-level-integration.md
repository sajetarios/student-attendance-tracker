# SHS integration — school-level attendance and scheduling scope

## Available in this release
- School Admin → **School Years & Enrollment**: select JHS only, SHS only, or integrated. Existing learner, schedule, adviser, and enrollment records prevent disabling their grade levels.
- Student registration, editing, batch movement, roster filters, adviser section registration and regular class schedule forms use the school-offered grades.
- Existing school years, staff accounts and department-scoped teacher assignments apply to Grades 11 and 12. The regular weekly timetable and physical gate/QR identity code remain unchanged.
- SF1 preview/commit, standard CSV/Excel import and school-year enrollment validate the grade offering on the server; database triggers protect all insert/update paths for students, student_enrollments, sections, adviser assignments and scheduled classes.
- Grade 11 and Grade 12 curriculum version is stored **per school year**, independent of staff/learner attendance. For SY 2026–2027, Grade 11 must be Strengthened, Grade 12 defaults to Legacy unless the school confirms Grade 12 SSHS pilot authorization.
- SHS learner pathways store track and optional strand/cluster information for each enrollment without changing student ID, original records, or attendance events.

## Instructor workflow — integrated school
1. School Administrator chooses **Integrated JHS and SHS** in School Years & Enrollment.
2. School Administrator configures the active school year and Grade 11 Strengthened curriculum; confirm Grade 12 pilot status where applicable.
3. Assign departments and teachers as usual, including teachers with both JHS and SHS classes.
4. Create Grade 11–12 sections and class periods using existing timetable template, weekdays, conflict checks, and teacher/room restrictions.
5. Enroll learners or import SF1 Grade 11/12 into active school year; assign grade/section, then optionally record SHS track/strand.
6. Teachers open weekly timetable and their authorized classes, record class attendance using existing rules, and review learner attendance without changing staff Form 48 or OB.

## Explicit limitations; do not misrepresent as full SHS certification
- The existing class model enrolls learners by **grade and section**, not per-elective learner membership. **Mixed-section elective class rosters and elective-specific attendance are NOT implemented in this release.**
- **SHS instructional term boundaries, required hours by subject, work immersion placement, track-specific official LIS/DepEd exports and reporting are NOT certified**. Administrators should configure date-scoped classes based on their approved timetables and verify them during piloting.
- SF1 extraction and ordinary class attendance remain existing infrastructure, not a standalone SHS LIS sync.
- The Gatekeeper/student badge still uses its existing **internal `JHS:` QR token prefix** for backward compatibility; this is an identity protocol label, not the student's grade. Do NOT rewrite QR badges or automatically create physical gate/DTR records from class attendance.
- This release is **SHS foundational integration**, not a full DepEd SHS student-information or grading system.

## Security & release checklist
- All changes are **school-scoped**. Only School Admin can change academic levels, grade/year curriculum, or learner track; Department Heads and teachers can read permitted levels and use existing role-scoped classes.
- The 066 migration is additive, copies no production learner rows, and defaults existing schools with SHS records (including historical enrollment/adviser assignments) to INTEGRATED.
- Run `npm test`, isolated `npm run db:migrate`, then `node tests/shs-grade-offerings-postgres.cjs` against **localhost *_test only**; require green QR, Department Head, recovery, Gate/OB/DTR, and SARDO workflows.
- Never change production data or switch Render/Supabase databases during this integration without a verified backup and cutover.
- Validate with an actual integrated school's Grade 11 and Grade 12 timetable and device scans before declaring full SHS-readiness.
