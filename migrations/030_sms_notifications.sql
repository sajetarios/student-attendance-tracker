CREATE TABLE IF NOT EXISTS school_sms_settings (
 school_id UUID PRIMARY KEY REFERENCES schools(school_id) ON DELETE CASCADE,
 enabled BOOLEAN NOT NULL DEFAULT FALSE,
 school_events BOOLEAN NOT NULL DEFAULT TRUE,
 class_events BOOLEAN NOT NULL DEFAULT FALSE,
 advisory_events BOOLEAN NOT NULL DEFAULT FALSE,
 time_in BOOLEAN NOT NULL DEFAULT TRUE,
 time_out BOOLEAN NOT NULL DEFAULT TRUE,
 enabled_at TIMESTAMPTZ,
 updated_by UUID REFERENCES school_users(user_id),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE sms_outbox ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE sms_outbox ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE sms_outbox ADD COLUMN IF NOT EXISTS status_checked_at TIMESTAMPTZ;
-- Existing test/history queues are never activated by installing this module.
UPDATE sms_outbox SET status='FAILED',last_error='LEGACY_QUEUE: Not sent. Predates SMS notification activation.'
 WHERE status IN ('PENDING','SENDING');
CREATE OR REPLACE FUNCTION queue_attendance_sms() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cfg school_sms_settings%ROWTYPE; learner students%ROWTYPE; phone TEXT; context TEXT; msg TEXT;
BEGIN
 IF NEW.sync_status <> 'ACCEPTED' THEN RETURN NEW; END IF;
 SELECT * INTO cfg FROM school_sms_settings WHERE school_id=NEW.school_id;
 IF NOT FOUND OR NOT cfg.enabled THEN RETURN NEW; END IF;
 IF (NEW.attendance_scope='SCHOOL' AND NOT cfg.school_events)
 OR (NEW.attendance_scope='CLASS' AND NOT cfg.class_events)
 OR (NEW.attendance_scope='ADVISORY' AND NOT cfg.advisory_events)
 OR (NEW.event_type='TIME_IN' AND NOT cfg.time_in)
 OR (NEW.event_type='TIME_OUT' AND NOT cfg.time_out) THEN RETURN NEW; END IF;
 SELECT * INTO learner FROM students WHERE school_id=NEW.school_id AND student_id=NEW.student_id;
 IF NOT FOUND OR NOT learner.active THEN RETURN NEW; END IF;
 phone := regexp_replace(COALESCE(learner.parent_mobile,''),'[[:space:]()+-]','','g');
 IF phone ~ '^09[0-9]{9}$' THEN phone := '63'||substring(phone from 2);
 ELSIF phone ~ '^9[0-9]{9}$' THEN phone := '63'||phone; END IF;
 context := CASE NEW.attendance_scope WHEN 'SCHOOL' THEN 'school' WHEN 'ADVISORY' THEN 'advisory class' ELSE 'class' END;
 IF NEW.attendance_scope='CLASS' THEN
  SELECT COALESCE(NULLIF(subject_name,''),period_name) INTO context FROM class_periods WHERE school_id=NEW.school_id AND period_id=NEW.period_id;
 END IF;
 msg := 'Attendigo: '||learner.full_name||CASE NEW.event_type WHEN 'TIME_IN' THEN ' checked in at ' ELSE ' checked out from ' END||COALESCE(context,'class')||' on '||to_char(NEW.occurred_at_device AT TIME ZONE 'Asia/Manila','Mon DD, YYYY HH12:MI AM')||' (PH).'||CASE WHEN NEW.late THEN ' Late arrival.' ELSE '' END;
 INSERT INTO sms_outbox(event_id,recipient,message,status,last_error)
 VALUES(NEW.event_id,phone,msg,CASE WHEN phone ~ '^639[0-9]{9}$' THEN 'PENDING' ELSE 'FAILED' END,
 CASE WHEN phone ~ '^639[0-9]{9}$' THEN NULL ELSE 'INVALID_RECIPIENT: Add a valid Philippine mobile number to the approved student guardian record.' END)
 ON CONFLICT(event_id) DO NOTHING;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS attendance_sms_enqueue ON attendance_events;
CREATE TRIGGER attendance_sms_enqueue AFTER INSERT ON attendance_events FOR EACH ROW EXECUTE FUNCTION queue_attendance_sms();
