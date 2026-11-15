# v0.8.0 role and dashboard acceptance checklist

Use separate accounts for these checks. Run against the test database only.

## School Administrator
- [ ] Login opens School Administrator Dashboard.
- [ ] Can access Students, Staff/Teachers, Parents, Schedules and SF2.
- [ ] Can create Department Head, Gate Keeper and Teacher accounts.
- [ ] Teacher creation accepts Subject Teacher, Class Adviser or both designations.
- [ ] Can assign a Class Adviser to a specific grade and section.
- [ ] Can create student accounts from the Student roster and reset an existing student password.
- [ ] Can review, download and mark official SF2 submissions as collected.
- [ ] Can manage permanent subject schedules and teacher-period assignments.

## Department Head
- [ ] Login opens Department Head Dashboard.
- [ ] Can see learner attendance summaries and the teacher-coverage summary.
- [ ] Can open Teacher Monitoring; grade and section appear in separate columns.
- [ ] Can review leave/status and assigned schedules; can assign/cancel temporary substitute coverage.
- [ ] Can monitor class schedules without permanent schedule-edit controls.
- [ ] Can preview and view/download submitted SF2 reports read-only.
- [ ] Cannot see/load the full student roster or QR scanner.
- [ ] Cannot create/edit student or staff accounts, change permanent assignments, submit/collect SF2 or edit absence classifications.

## Subject Teacher
- [ ] Login opens Subject Teacher Dashboard.
- [ ] Sees only learners and periods in their assigned subjects/active substitutes.
- [ ] Can record class attendance only for assigned periods.
- [ ] Personal monthly SF2 export is clearly labelled NOT OFFICIAL SF2.
- [ ] NR/no personal record is not presented as a confirmed absence.
- [ ] Cannot submit the official consolidated SF2 unless also designated Class Adviser and assigned to the section.

## Class Adviser
- [ ] Login opens Class Adviser Dashboard.
- [ ] Sees only assigned advisory section(s).
- [ ] Can review daily attendance; missing scans remain Pending Review.
- [ ] Can confirm a full-day absence only after checking there is no accepted subject check-in.
- [ ] Can generate and submit official monthly SF2 only for assigned advisory section(s).
- [ ] Cannot manage staff accounts or permanent school schedules.

## Teacher with both designations
- [ ] One Teacher login shows both subject and adviser tools.
- [ ] Existing subject schedule assignments remain available.
- [ ] Advisory section roster and official SF2 tools are available only for assigned advisory sections.
- [ ] Personal SF2 mode remains separate from official SF2 mode.

## Gate Keeper
- [ ] Login opens the Gate Scanner workspace directly.
- [ ] Can look up one scanned QR at a time and verify the registered student photo.
- [ ] Gate attendance cannot be recorded until photo verification is confirmed.
- [ ] Cannot download the full roster, register/edit learners, or access class/subject attendance, schedules, SF2, teacher management or reports.

## Parent / Guardian
- [ ] School Account login for an approved Parent/Guardian opens the separate Parent Portal.
- [ ] Only approved linked children are displayed.
- [ ] Each linked child's attendance history is accessible; other learners are not accessible.
- [ ] Parent cannot edit attendance.

## Student
- [ ] Student Account login opens the separate Student Portal.
- [ ] Initial-password change is required before attendance history is shown.
- [ ] Student sees their own profile and own accepted attendance events only.
- [ ] Student cannot access staff/student roster APIs or another learner's history.

## Platform Super Administrator
- [ ] Platform admin login opens the separate Platform workspace.
- [ ] Workspace clearly indicates that onboarding/subscription APIs are a later milestone; no invented platform statistics appear.

## Cross-role / device verification
- [ ] Check dashboard navigation on desktop, tablet and narrow phone.
- [ ] Verify the correct role badge and landing page for every account.
- [ ] Try direct URL/API access to restricted modules; server-side access must reject it.
- [ ] Test trusted HTTPS, camera permission, physical QR/photo checks, offline sync and reconnection on each type of device.
- [ ] Test parent SMS/notification workflow and SMS provider only after provider configuration is confirmed.

## Known future milestones (not complete in v0.8.0)
- Teacher QR/photo identification and teacher gate time-in/time-out/DTR.
- Active SARDO triggers after five consecutive confirmed unexcused school days and school-calendar support.
- SF4 generation.
- Parent-teacher messaging.
- Platform school onboarding and subscription management APIs.
