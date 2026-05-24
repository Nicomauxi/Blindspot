BEGIN;

ALTER TABLE discovery_job_batches
  ADD COLUMN IF NOT EXISTS enrich_after_discovery boolean NOT NULL DEFAULT false;

ALTER TABLE discovery_jobs
  ADD COLUMN IF NOT EXISTS enrich_after_discovery boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enrich_status text NOT NULL DEFAULT 'skipped'
    CHECK (enrich_status IN ('queued','running','completed','failed','skipped')),
  ADD COLUMN IF NOT EXISTS linked_enrich_run_id uuid REFERENCES runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS enrich_error_message text;

UPDATE discovery_jobs
SET enrich_status = CASE WHEN enrich_after_discovery THEN 'queued' ELSE 'skipped' END
WHERE enrich_status IS NULL;

COMMIT;
