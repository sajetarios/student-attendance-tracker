-- Preserve only recognized catalog keys and normalized positions, never original PDF text.
ALTER TABLE school_locator_template_requests ADD COLUMN IF NOT EXISTS recognition_hints JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(recognition_hints) = 'array' AND jsonb_array_length(recognition_hints) <= 80);
