# Role and Dashboard Baseline — v0.8.0

This is the intended role contract for the Student Attendance Tracker. The account role determines the workspace. A Teacher account may have one or both teacher designations; designations do not turn the account into an administrator.

## Roles and dashboards

| Account role | Dashboard / workspace | Main allowed work | Not allowed |
|---|---|---|---|
| **School Administrator** (`SCHOOL_ADMIN`) | School Management Dashboard | School attendance overview; register and maintain learners; create and manage staff accounts; create teacher subject schedules; assign Class Advisers to sections; manage parent accounts; manage attendance devices; review corrections; generate school SF2 reports; review, download, and collect official SF2 submissions | Platform-wide school subscriptions and platform owner tasks |
| **Department Head** (`DEPARTMENT_HEAD`) | Department Head Dashboard | Monitor school-wide learner attendance summaries; monitor staff status, designations, leave and grade/section assignments; review schedules and coverage; assign/cancel temporary substitute coverage; preview and download submitted SF2 reports read-only | Student roster, QR scanning, student editing, staff account creation, permanent schedule changes, SF2 absence editing, official SF2 submission or collection |
| **Subject Teacher** (`TEACHER` + `SUBJECT_TEACHER`) | Subject Teacher Dashboard | See learners in assigned subjects; view assigned periods; record attendance for assigned class periods; generate a personal monthly SF2 copy marked **NOT OFFICIAL** | Other teachers' schedules, official section SF2 submission unless also a Class Adviser, school-wide roster or admin actions |
| **Class Adviser** (`TEACHER` + `CLASS_ADVISER`) | Class Adviser Dashboard | See learners in assigned advisory section(s); review and consolidate subject attendance; confirm absence only after reviewing the full scheduled day; generate and submit official monthly SF2 for assigned section(s) | Teacher/staff account management, permanent schedule changes, school-wide collection of SF2 |
| **Teacher with both designations** (`TEACHER` + both designations) | Combined Teacher Dashboard | All Subject Teacher functions for assigned periods plus Class Adviser functions for assigned sections; chooses personal or official SF2 mode where allowed | Administrator and Department Head functions |
| **Gate Keeper** (`GATE_KEEPER`) | Gate Scanner workspace (no general dashboard) | Scan one learner QR at a time; retrieve the registered photo for verification; record school gate time-in/time-out | Downloading the full learner roster, student edits, subject attendance, schedules, SF2, teacher management or reporting |
| **Parent / Guardian** (`PARENT`) | Separate Parent Portal | View only approved linked children; see linked-child attendance summaries and individual attendance history | Other learners, school staff views, attendance editing or reporting administration |
| **Student** (`STUDENT`) | Separate Student Portal | View own learner profile and own accepted attendance history; change initial password | Any other student's data, parent tools, class or school administration |
| **Platform Super Administrator** (`SUPER_ADMIN`) | Platform workspace | Authentication and the clearly labelled platform placeholder | School-level learner or attendance access through the school workspace. School onboarding/subscription APIs are a future platform milestone. |

## Teacher designation rules

- Teacher account role stays `TEACHER`.
- `teacher_designations` may contain `SUBJECT_TEACHER`, `CLASS_ADVISER`, or both.
- Existing subject-period assignments are preserved when designations change.
- Each Class Adviser must also have an explicit grade-level and section assignment. Having the designation alone does not assign a section.
- The School Administrator creates staff accounts and maintains designations and section assignments.

## Attendance and SF2 rules

1. Gate arrivals are not used to determine daily SF2 attendance.
2. Subject attendance is recorded independently for every assigned period.
3. An accepted subject check-in can confirm that a learner was present that day. A missing scan is **Pending confirmation**, not automatically Absent.
4. A Class Adviser may confirm a daily absence only after reviewing the learner's scheduled subjects and ensuring there was no accepted subject check-in.
5. A Subject Teacher can export a personal copy from their own period records. It is marked **NOT OFFICIAL**; `NR` means no record from that teacher and must not be treated as Absent.
6. A Class Adviser submits the official consolidated monthly SF2 for assigned section(s).
7. A School Administrator reviews, downloads, and marks official SF2 submissions as collected.
8. A Department Head can view/download submitted reports for monitoring but cannot alter, submit, or collect them.

## Dashboard contents

- **School Administrator:** school attendance statistics, learner attendance summary, recent attendance, student/staff/schedule/SF2 shortcuts, SARDO setup status, SF2 submission collection.
- **Department Head:** school-wide learner attendance summary, teacher account/availability and substitute coverage counts, recent attendance, Teacher Monitoring, Schedule Monitoring, SF2 Preview and read-only Submission Monitoring.
- **Subject Teacher:** assigned-learner count, confirmed present count, pending-confirmation count, own subject check-ins, assigned learners/schedules and personal SF2 shortcut.
- **Class Adviser:** assigned learner summary, advisory roster, official SF2 shortcut; when also a Subject Teacher, both sets of tools appear.
- **Gate Keeper:** single-learner QR/photo-verified gate scanner only; no roster download or general dashboard.
- **Parent:** linked children count, accepted time-ins today, children with an arrival, and each linked child's history.
- **Student:** profile plus counts of own accepted records, subject records and gate records; own attendance history. Attendance is hidden until an initial password is changed.
- **Platform Super Administrator:** placeholder only, with no invented platform metrics.

## Explicitly not represented as completed

- Teacher QR badge/face verification, teacher gate time-in/time-out and teacher DTR reports.
- SARDO trigger logic for five consecutive unexcused school days; the current dashboard shows setup status only.
- School-calendar integration for holidays, suspensions and special non-class days.
- SF4 generation and consolidation.
- Parent-teacher messaging/communication history.
- Platform school-onboarding and subscription APIs.

These are separate implementation milestones. The screens and permissions in this release must not be interpreted as proof that those workflows are live.
