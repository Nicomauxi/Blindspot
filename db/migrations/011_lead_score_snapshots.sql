-- Migration 011: lead score snapshots
-- Snapshot table for scoring rollouts and rollback support.

CREATE TABLE IF NOT EXISTS lead_score_snapshots (
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  snapshot_label TEXT NOT NULL,
  scoring_version SMALLINT NOT NULL,
  prospect_score SMALLINT,
  score_breakdown JSONB,
  contact_ready BOOLEAN,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_label, lead_id)
);

CREATE INDEX IF NOT EXISTS lead_score_snapshots_lead_id_idx
  ON lead_score_snapshots (lead_id);

CREATE INDEX IF NOT EXISTS lead_score_snapshots_captured_at_idx
  ON lead_score_snapshots (captured_at DESC);
