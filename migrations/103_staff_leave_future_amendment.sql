-- Permit signed, future-only date/session revisions with the original type/account.
ALTER TABLE staff_leave_revisions DROP CONSTRAINT staff_leave_revisions_decision_check;
ALTER TABLE staff_leave_revisions ADD CONSTRAINT staff_leave_revisions_decision_check CHECK(decision IN ('CANCEL','SHORTEN','AMEND'));
