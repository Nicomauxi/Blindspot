-- Migration 009: multi-source architecture
-- Adds evidence-based data model: source tracking, field evidences, company data.
-- place_id UNIQUE constraint is preserved for backward compat — not removed.

-- ============================================================
-- NEW COLUMNS — leads
-- ============================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS source                   TEXT          NOT NULL DEFAULT 'google_places'
                                                    CHECK (source IN (
                                                      'google_places','mintur','pedidosya',
                                                      'imm_habilitaciones','yelu','osm',
                                                      'infonegocios','dgi'
                                                    )),
  ADD COLUMN IF NOT EXISTS external_id              TEXT,
  ADD COLUMN IF NOT EXISTS source_confidence        NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS source_data              JSONB,
  ADD COLUMN IF NOT EXISTS data_confidence_score    NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS contact_reliability_score NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS canonical_fields         JSONB,
  ADD COLUMN IF NOT EXISTS corroborating_sources    JSONB         NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS lead_company_data        JSONB;

-- Partial unique index: enforces (source, external_id) uniqueness only when
-- external_id is not null. Allows null external_id during backfill gaps.
CREATE UNIQUE INDEX IF NOT EXISTS leads_source_external_id_uniq
  ON leads (source, external_id)
  WHERE external_id IS NOT NULL;

-- ============================================================
-- BACKFILL — existing google_places leads
-- ============================================================

UPDATE leads
SET
  source            = 'google_places',
  external_id       = place_id,
  source_confidence = 0.90
WHERE source = 'google_places'
  AND external_id IS NULL;

-- ============================================================
-- TABLE: lead_source_references
-- One row per (lead × external source). Tracks where each lead
-- was seen and the raw payload from that source.
-- ============================================================

CREATE TABLE IF NOT EXISTS lead_source_references (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           uuid        NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  source            TEXT        NOT NULL
                                CHECK (source IN (
                                  'google_places','mintur','pedidosya',
                                  'imm_habilitaciones','yelu','osm',
                                  'infonegocios','dgi'
                                )),
  external_id       TEXT,
  source_confidence NUMERIC(3,2),
  raw_data          JSONB,
  seen_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS lead_source_references_lead_source_uniq
  ON lead_source_references (lead_id, source);

CREATE INDEX IF NOT EXISTS lead_source_references_lead_idx
  ON lead_source_references (lead_id);

CREATE INDEX IF NOT EXISTS lead_source_references_source_idx
  ON lead_source_references (source);

-- ============================================================
-- TABLE: lead_field_evidences
-- One row per (lead × field × value). Heart of the evidence model.
-- sources[] lists every DiscoverySource that reported this value.
-- ============================================================

CREATE TABLE IF NOT EXISTS lead_field_evidences (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid        NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  field_name  TEXT        NOT NULL,
  value       TEXT        NOT NULL,
  sources     TEXT[]      NOT NULL DEFAULT '{}',
  confidence  NUMERIC(3,2),
  first_seen  DATE,
  last_seen   DATE
);

CREATE UNIQUE INDEX IF NOT EXISTS lead_field_evidences_lead_field_value_uniq
  ON lead_field_evidences (lead_id, field_name, value);

CREATE INDEX IF NOT EXISTS lead_field_evidences_lead_idx
  ON lead_field_evidences (lead_id);

CREATE INDEX IF NOT EXISTS lead_field_evidences_field_idx
  ON lead_field_evidences (field_name);
