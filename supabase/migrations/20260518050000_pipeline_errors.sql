BEGIN;

CREATE TABLE IF NOT EXISTS pipeline_errors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  run_id      uuid REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  phase       text NOT NULL,
  source      text,
  lead_id     uuid REFERENCES leads(id) ON DELETE SET NULL,
  error_type  text NOT NULL,
  message     text NOT NULL,
  stack       text,
  recovered   boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS pipeline_errors_run
  ON pipeline_errors(run_id);
CREATE INDEX IF NOT EXISTS pipeline_errors_occurred_at
  ON pipeline_errors(occurred_at DESC);
CREATE INDEX IF NOT EXISTS pipeline_errors_phase
  ON pipeline_errors(phase, occurred_at DESC);
CREATE INDEX IF NOT EXISTS pipeline_errors_lead
  ON pipeline_errors(lead_id) WHERE lead_id IS NOT NULL;

COMMIT;
