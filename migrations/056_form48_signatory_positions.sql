-- Add printed position/designation for each Form 48 signatory; do not change prior draft names.
-- Stored details are for printed paper signatures, not electronic approval.
ALTER TABLE staff_form48_monthly_reviews
  ADD COLUMN IF NOT EXISTS verified_by_position TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS approved_by_position TEXT NOT NULL DEFAULT '';
ALTER TABLE staff_form48_monthly_reviews
  ADD CONSTRAINT staff_form48_verified_position_max_length CHECK (length(verified_by_position)<=120),
  ADD CONSTRAINT staff_form48_approved_position_max_length CHECK (length(approved_by_position)<=120);
