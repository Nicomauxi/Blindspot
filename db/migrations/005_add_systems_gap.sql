-- Migration 005: persist systems_gap scoring dimension on leads

ALTER TABLE leads ADD COLUMN IF NOT EXISTS systems_gap_score smallint;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS systems_gap_breakdown jsonb;

CREATE INDEX IF NOT EXISTS leads_systems_gap_score_idx ON leads(systems_gap_score DESC);
