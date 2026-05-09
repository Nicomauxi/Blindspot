-- Migration 004: persist normalized discovery niche on leads

ALTER TABLE leads ADD COLUMN IF NOT EXISTS niche text;

CREATE INDEX IF NOT EXISTS leads_niche_idx ON leads(niche);
