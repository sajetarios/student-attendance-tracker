-- Additive subscription and entitlement metadata. Existing schools retain access by default.
CREATE TABLE IF NOT EXISTS platform_plans (
 plan_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 code TEXT NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$'),
 name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 100),
 monthly_price_php NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (monthly_price_php >= 0),
 features JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(features)='object'),
 limits JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(limits)='object'),
 active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS school_subscriptions (
 school_id UUID PRIMARY KEY REFERENCES schools(school_id) ON DELETE CASCADE,
 plan_id UUID NOT NULL REFERENCES platform_plans(plan_id),
 status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','TRIAL','GRACE','EXPIRED','SUSPENDED')),
 starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 ends_at TIMESTAMPTZ,
 overrides JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(overrides)='object'),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK (ends_at IS NULL OR ends_at > starts_at)
);
INSERT INTO platform_plans(code,name,monthly_price_php,features,limits) VALUES
('pilot','Pilot',0,'{"student_management":true,"manual_attendance":true,"qr_attendance":true,"parent_portal":true,"timetable":true,"planner":true,"offline_sync":true,"advanced_analytics":true,"sms_notifications":false,"custom_branding":true}'::jsonb,'{"students":2000,"sms_monthly":0}'::jsonb),
('standard','Standard',999,'{"student_management":true,"manual_attendance":true,"qr_attendance":true,"parent_portal":true,"timetable":true,"planner":true,"offline_sync":true,"advanced_analytics":true,"sms_notifications":false,"custom_branding":false}'::jsonb,'{"students":2000,"sms_monthly":0}'::jsonb),
('premium','Premium',1999,'{"student_management":true,"manual_attendance":true,"qr_attendance":true,"parent_portal":true,"timetable":true,"planner":true,"offline_sync":true,"advanced_analytics":true,"sms_notifications":true,"custom_branding":true}'::jsonb,'{"students":5000,"sms_monthly":500}'::jsonb)
ON CONFLICT (code) DO NOTHING;
