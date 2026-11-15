-- Guardian requests do not modify approved Parent Portal links.
CREATE TABLE IF NOT EXISTS guardian_change_requests (
 request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 school_id UUID NOT NULL,
 student_id TEXT NOT NULL,
 requested_by_user_id UUID NOT NULL,
 request_type TEXT NOT NULL CHECK (request_type IN ('ADD','CHANGE_PRIMARY','CORRECT')),
 proposed_name TEXT NOT NULL,
 proposed_mobile TEXT NOT NULL,
 relationship TEXT NOT NULL,
 reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
 previous_name TEXT,
 previous_mobile TEXT,
 reviewed_by_user_id UUID,
 review_note TEXT,
 reviewed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 FOREIGN KEY (school_id,student_id) REFERENCES students(school_id,student_id)
);
CREATE INDEX IF NOT EXISTS guardian_requests_school_status_idx ON guardian_change_requests(school_id,status,created_at DESC);
CREATE TABLE IF NOT EXISTS student_guardians (
 guardian_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 school_id UUID NOT NULL,
 student_id TEXT NOT NULL,
 full_name TEXT NOT NULL,
 mobile TEXT NOT NULL,
 relationship TEXT NOT NULL,
 is_primary BOOLEAN NOT NULL DEFAULT FALSE,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 source_request_id UUID REFERENCES guardian_change_requests(request_id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 FOREIGN KEY (school_id,student_id) REFERENCES students(school_id,student_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS student_guardians_one_primary ON student_guardians(school_id,student_id) WHERE is_primary AND active;
INSERT INTO student_guardians(school_id,student_id,full_name,mobile,relationship,is_primary)
SELECT school_id,student_id,parent_name,parent_mobile,'Unspecified',TRUE FROM students s
WHERE NULLIF(TRIM(parent_name),'') IS NOT NULL AND NULLIF(TRIM(parent_mobile),'') IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM student_guardians g WHERE g.school_id=s.school_id AND g.student_id=s.student_id AND g.is_primary AND g.active);
