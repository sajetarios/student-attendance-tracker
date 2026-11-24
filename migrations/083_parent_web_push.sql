-- 083: secure, opt-in Web Push for verified parent accounts (staging pilot).
-- Subscriptions are private and are never exposed through Supabase's Data API.
CREATE TABLE IF NOT EXISTS parent_push_subscriptions (
 subscription_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 school_id UUID NOT NULL,
 parent_user_id UUID NOT NULL,
 endpoint TEXT NOT NULL CHECK (char_length(endpoint) BETWEEN 30 AND 2048),
 endpoint_hash TEXT NOT NULL UNIQUE CHECK (char_length(endpoint_hash)=64),
 p256dh TEXT NOT NULL,
 auth_secret TEXT NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 last_test_at TIMESTAMPTZ,
 last_success_at TIMESTAMPTZ,
 failure_count INT NOT NULL DEFAULT 0,
 CONSTRAINT parent_push_school_user_fk FOREIGN KEY(school_id,parent_user_id)
 REFERENCES school_users(school_id,user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS parent_push_owner_idx
 ON parent_push_subscriptions(school_id,parent_user_id,active);
ALTER TABLE parent_push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON parent_push_subscriptions FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS parent_push_deliveries (
 delivery_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 notification_id UUID NOT NULL REFERENCES user_notifications(notification_id) ON DELETE CASCADE,
 subscription_id UUID NOT NULL REFERENCES parent_push_subscriptions(subscription_id) ON DELETE CASCADE,
 notification_revision TIMESTAMPTZ NOT NULL,
 state TEXT NOT NULL DEFAULT 'PENDING'
   CHECK(state IN ('PENDING','SENDING','ACCEPTED','RETRY','EXPIRED','FAILED')),
 attempts INT NOT NULL DEFAULT 0,
 next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 lease_until TIMESTAMPTZ,
 accepted_at TIMESTAMPTZ,
 last_error TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT parent_push_delivery_unique UNIQUE(notification_id,subscription_id,notification_revision)
);
CREATE INDEX IF NOT EXISTS parent_push_outbox_idx
 ON parent_push_deliveries(state,next_attempt_at,created_at);
ALTER TABLE parent_push_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON parent_push_deliveries FROM anon, authenticated;

-- The existing class register finalization creates in-app notifications.
-- Queue a phone delivery only to devices that previously opted in, and only
-- for genuinely new or corrected subject status (never marking an item read).
CREATE OR REPLACE FUNCTION attendigo_queue_subject_push()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.recipient_kind<>'SCHOOL_USER' OR NEW.category<>'SYSTEM'
    OR NEW.event_key NOT LIKE 'subject:%' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.title IS NOT DISTINCT FROM OLD.title
    AND NEW.body IS NOT DISTINCT FROM OLD.body
    AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
 IF NOT EXISTS (SELECT 1 FROM school_settings
   WHERE school_id=NEW.school_id AND setting_key='parent_subject_notifications'
   AND setting_value='true'::jsonb) THEN RETURN NEW; END IF;

 INSERT INTO parent_push_deliveries(notification_id,subscription_id,notification_revision)
 SELECT NEW.notification_id,sub.subscription_id,NEW.updated_at
 FROM parent_push_subscriptions sub
 JOIN school_users u ON u.school_id=sub.school_id
   AND u.user_id=sub.parent_user_id AND u.role='PARENT' AND u.active
 JOIN parent_student_links l ON l.school_id=sub.school_id
   AND l.parent_user_id=sub.parent_user_id AND l.status='APPROVED'
   AND l.student_id=split_part(NEW.event_key,':',5)
 WHERE sub.active AND sub.school_id=NEW.school_id AND sub.parent_user_id=NEW.recipient_id
 ON CONFLICT(notification_id,subscription_id,notification_revision) DO NOTHING;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS queue_parent_subject_push ON user_notifications;
CREATE TRIGGER queue_parent_subject_push
 AFTER INSERT OR UPDATE OF title,body,status ON user_notifications
 FOR EACH ROW EXECUTE FUNCTION attendigo_queue_subject_push();

COMMENT ON TABLE parent_push_subscriptions IS
 'Explicit parent device subscriptions. API-only; tenant and parent ownership enforced server-side.';
COMMENT ON TABLE parent_push_deliveries IS
 'Durable, idempotent Web Push outbox for finalized subject notices; phone delivery is best effort.';
