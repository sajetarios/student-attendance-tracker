-- Additive trusted campus registry; existing department points and attendance are untouched.
CREATE TABLE staff_lunch_campuses (
 campus_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
 name TEXT NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 100),
 latitude DOUBLE PRECISION NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude DOUBLE PRECISION NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 radius_meters INTEGER NOT NULL CHECK(radius_meters BETWEEN 100 AND 5000),
 evidence_reference TEXT NOT NULL CHECK(length(btrim(evidence_reference)) BETWEEN 10 AND 500),
 authorized_by UUID NOT NULL,
 authorized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 active BOOLEAN NOT NULL DEFAULT TRUE,
 retired_at TIMESTAMPTZ,
 FOREIGN KEY(school_id,authorized_by) REFERENCES school_users(school_id,user_id) ON DELETE RESTRICT,
 UNIQUE(school_id,campus_id),
 CHECK((active AND retired_at IS NULL) OR (NOT active AND retired_at IS NOT NULL))
);
CREATE UNIQUE INDEX staff_lunch_active_campus_name ON staff_lunch_campuses(school_id,lower(name)) WHERE active;
CREATE INDEX staff_lunch_campus_school_active ON staff_lunch_campuses(school_id,active,campus_id);
CREATE INDEX staff_lunch_challenge_department_active ON staff_attendance_challenges(school_id,department_id,expires_at) WHERE revoked_at IS NULL;
