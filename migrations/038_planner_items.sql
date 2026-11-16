-- Personal and department-shared planning, separate from official class scheduling.
CREATE TABLE IF NOT EXISTS planner_items (
 item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
 owner_user_id UUID NOT NULL,
 department_id UUID,
 visibility TEXT NOT NULL DEFAULT 'PERSONAL' CHECK (visibility IN ('PERSONAL','DEPARTMENT')),
 item_type TEXT NOT NULL CHECK (item_type IN ('TASK','LESSON','MEETING','DEADLINE','REMINDER','ACTIVITY')),
 title TEXT NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 160),
 details TEXT NOT NULL DEFAULT '' CHECK (char_length(details) <= 3000),
 start_at TIMESTAMPTZ NOT NULL,
 end_at TIMESTAMPTZ NOT NULL,
 all_day BOOLEAN NOT NULL DEFAULT FALSE,
 priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH')),
 status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','DONE','CANCELLED')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT planner_items_valid_span CHECK(end_at > start_at),
 CONSTRAINT planner_items_department_required CHECK (
   (visibility='PERSONAL' AND department_id IS NULL) OR
   (visibility='DEPARTMENT' AND department_id IS NOT NULL)
 ),
 CONSTRAINT planner_items_owner_fk FOREIGN KEY(school_id,owner_user_id) REFERENCES school_users(school_id,user_id),
 CONSTRAINT planner_items_department_fk FOREIGN KEY(school_id,department_id) REFERENCES school_departments(school_id,department_id)
);
CREATE INDEX IF NOT EXISTS planner_items_owner_date_idx ON planner_items(school_id,owner_user_id,start_at);
CREATE INDEX IF NOT EXISTS planner_items_department_date_idx ON planner_items(school_id,department_id,start_at)
 WHERE visibility='DEPARTMENT';
