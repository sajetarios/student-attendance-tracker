-- A single public, immutable official template for the entire installation.
-- No employee PDFs, certification records, or request data are stored here.
CREATE TABLE IF NOT EXISTS shared_locator_slip_template (
 template_id TEXT PRIMARY KEY CHECK(template_id='DEPED_REVISED_ANNEX_E'),
 pdf_bytes BYTEA NOT NULL CHECK(octet_length(pdf_bytes)=109793)
);
