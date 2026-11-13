# Student Attendance Tracker

School attendance, class scheduling, teacher assignment, and SF2 reporting platform.

## Department scheduling and teacher coverage

The School Administrator creates the school departments and assigns teachers and Department Head accounts to their departments. Existing accounts and schedules are retained in the **Unassigned** department after migration until the School Administrator classifies them.

Department Heads can:
- View the timetable and teacher coverage status across all departments.
- Create class schedules for their own department.
- Assign and remove permanent teachers only from schedules in their department.
- Assign temporary coverage for a teacher on approved leave or a class period whose grace time has passed without a verified teacher gate time-in.
- View a missing time-in alert without the system automatically declaring the teacher absent.

A Department Head cannot create departments, reassign staff to another department, change another department's schedules, or manage school-wide accounts.

## Apply the database update

On application startup, the server checks and applies pending database migrations before it begins listening. You can also run the migration command manually during a planned release:

```bash
npm run db:migrate
```

Back up the target database before deploying. This applies migration `013_departments_and_classroom_assignment.sql`. The migration creates the department table, adds department ownership to staff and class schedules, adds the classroom field, and backfills existing rows into **Unassigned**. It does not delete or replace existing attendance records.

After the migration, sign in as the School Administrator, create the school's departments, and reassign existing teachers and Department Heads from **Unassigned**. Review existing class schedules and move them to the correct departments before making new teacher assignments.

## Teacher attendance alerts

The coverage monitor refreshes while the administrator or Department Head portal is open. It can display browser notifications after the user enables them. A missing gate time-in is a follow-up alert—not definitive proof of absence. Notifications require the portal to remain open in a supported browser.
