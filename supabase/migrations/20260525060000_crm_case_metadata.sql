-- CRM-3: visible case code, editable title, typed events, and per-stage details.

BEGIN;

CREATE SEQUENCE IF NOT EXISTS lead_tracking_case_code_seq;

ALTER TABLE lead_tracking
  ADD COLUMN IF NOT EXISTS case_code text,
  ADD COLUMN IF NOT EXISTS title text;

WITH generated_codes AS (
  SELECT
    id,
    'CRM-' || lpad(nextval('lead_tracking_case_code_seq')::text, 6, '0') AS next_code
  FROM lead_tracking
  WHERE case_code IS NULL
  ORDER BY started_at, id
)
UPDATE lead_tracking AS tracking
SET case_code = generated_codes.next_code
FROM generated_codes
WHERE tracking.id = generated_codes.id;

UPDATE lead_tracking AS tracking
SET title = COALESCE(NULLIF(btrim(leads.name), ''), tracking.case_code, 'Caso ' || left(tracking.id::text, 8))
FROM leads
WHERE tracking.lead_id = leads.id
  AND (tracking.title IS NULL OR btrim(tracking.title) = '');

UPDATE lead_tracking
SET title = COALESCE(title, case_code, 'Caso ' || left(id::text, 8))
WHERE title IS NULL OR btrim(title) = '';

ALTER TABLE lead_tracking
  ALTER COLUMN case_code SET DEFAULT ('CRM-' || lpad(nextval('lead_tracking_case_code_seq')::text, 6, '0')),
  ALTER COLUMN case_code SET NOT NULL,
  ALTER COLUMN title SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS lead_tracking_case_code_key
  ON lead_tracking(case_code);

CREATE INDEX IF NOT EXISTS lead_tracking_title_idx
  ON lead_tracking(title);

ALTER TABLE lead_tracking_events
  ADD COLUMN IF NOT EXISTS event_type text;

UPDATE lead_tracking_events
SET event_type = CASE
  WHEN from_status IS DISTINCT FROM to_status OR from_status IS NULL THEN 'system_status_change'
  ELSE 'manual_comment'
END
WHERE event_type IS NULL;

ALTER TABLE lead_tracking_events
  ALTER COLUMN event_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'lead_tracking_events_event_type_check'
  ) THEN
    ALTER TABLE lead_tracking_events
      ADD CONSTRAINT lead_tracking_events_event_type_check
      CHECK (event_type IN ('system_status_change', 'manual_comment'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS lead_tracking_events_type_idx
  ON lead_tracking_events(tracking_id, event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS lead_tracking_stage_details (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_id        uuid        NOT NULL REFERENCES lead_tracking(id) ON DELETE CASCADE,
  stage              text        NOT NULL CHECK (stage IN ('pending','validation','contact','observed','rejected','accepted')),
  summary            text,
  data               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_by_user_id uuid        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS lead_tracking_stage_details_tracking_stage_key
  ON lead_tracking_stage_details(tracking_id, stage);

CREATE INDEX IF NOT EXISTS lead_tracking_stage_details_updated_by_idx
  ON lead_tracking_stage_details(updated_by_user_id, updated_at DESC);

DROP TRIGGER IF EXISTS lead_tracking_stage_details_updated_at ON lead_tracking_stage_details;
CREATE TRIGGER lead_tracking_stage_details_updated_at
  BEFORE UPDATE ON lead_tracking_stage_details
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
