BEGIN;

CREATE TABLE IF NOT EXISTS discovery_job_batches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  started_at          timestamptz,
  completed_at        timestamptz,
  user_id             uuid REFERENCES users(id),
  location            text NOT NULL,
  location_key        text NOT NULL,
  niche               text,
  sources             text[] NOT NULL DEFAULT '{}',
  max_results         integer NOT NULL DEFAULT 200,
  cpu_budget          text NOT NULL DEFAULT 'balanced'
                      CHECK (cpu_budget IN ('conservative','balanced','aggressive')),
  google_places       jsonb,
  recommendation_origin jsonb,
  estimated_cost_usd  numeric(10,2),
  actual_cost_usd     numeric(10,2),
  cost_cap_usd        numeric(10,2),
  status              text NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued','running','partial','completed','failed','cancelled'))
);

CREATE INDEX IF NOT EXISTS discovery_job_batches_status_idx
  ON discovery_job_batches(status, created_at DESC);

CREATE INDEX IF NOT EXISTS discovery_job_batches_user_idx
  ON discovery_job_batches(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE TRIGGER discovery_job_batches_updated_at
  BEFORE UPDATE ON discovery_job_batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE discovery_jobs
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES discovery_job_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd numeric(10,2),
  ADD COLUMN IF NOT EXISTS actual_cost_usd numeric(10,2),
  ADD COLUMN IF NOT EXISTS cost_cap_usd numeric(10,2),
  ADD COLUMN IF NOT EXISTS linked_run_id uuid REFERENCES runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_params jsonb;

CREATE INDEX IF NOT EXISTS discovery_jobs_batch_id_idx
  ON discovery_jobs(batch_id)
  WHERE batch_id IS NOT NULL;

COMMIT;
