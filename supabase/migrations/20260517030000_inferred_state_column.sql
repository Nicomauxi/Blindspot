ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS inferred_state JSONB;

UPDATE leads
SET inferred_state = digital_footprint->'inferred_state'
WHERE digital_footprint->'inferred_state' IS NOT NULL
  AND inferred_state IS NULL;

CREATE INDEX IF NOT EXISTS leads_digitalization_level
  ON leads ((inferred_state->>'digitalization_level'));

CREATE INDEX IF NOT EXISTS leads_has_delivery
  ON leads ((inferred_state->'has_delivery'->>'value'));

CREATE INDEX IF NOT EXISTS leads_has_pos
  ON leads ((inferred_state->'has_pos'->>'value'));
