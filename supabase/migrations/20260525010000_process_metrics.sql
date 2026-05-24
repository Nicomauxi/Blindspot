-- Process metrics snapshots table for operations monitoring
CREATE TABLE IF NOT EXISTS process_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  process text NOT NULL,
  cpu_pct numeric,
  mem_bytes bigint,
  uptime_seconds integer
);

CREATE INDEX IF NOT EXISTS idx_process_metrics_recorded_at
  ON process_metrics (recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_process_metrics_process_ts
  ON process_metrics (process, recorded_at DESC);
