-- Grouped special-program requests; preserve legacy individual requests and existing assignments.
CREATE TABLE IF NOT EXISTS special_program_request_batches (
  batch_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  requested_by_user_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('ASSIGN','REMOVE')),
  requested_program_type_id UUID,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  selected_count INTEGER NOT NULL CHECK (selected_count BETWEEN 1 AND 200),
  submitted_count INTEGER NOT NULL CHECK (submitted_count BETWEEN 1 AND 200 AND submitted_count<=selected_count),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id,batch_id),
  FOREIGN KEY (school_id,requested_by_user_id) REFERENCES school_users(school_id,user_id),
  FOREIGN KEY (school_id,requested_program_type_id) REFERENCES special_program_types(school_id,program_type_id),
  CHECK ((action='ASSIGN' AND requested_program_type_id IS NOT NULL) OR
         (action='REMOVE' AND requested_program_type_id IS NULL))
);
ALTER TABLE special_program_change_requests ADD COLUMN IF NOT EXISTS batch_id UUID;
ALTER TABLE special_program_change_requests
  ADD CONSTRAINT special_program_change_requests_batch_fk
  FOREIGN KEY (school_id,batch_id) REFERENCES special_program_request_batches(school_id,batch_id);
CREATE INDEX IF NOT EXISTS special_program_change_requests_batch_idx
 ON special_program_change_requests(school_id,batch_id,status,created_at);
CREATE INDEX IF NOT EXISTS special_program_request_batches_school_idx
 ON special_program_request_batches(school_id,created_at DESC);
