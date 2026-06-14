-- F2-ext Fase 4: knobs de velocidad del enrichment editables desde Variables.
-- La API settea estas columnas en el env del proceso al lanzar jobs (getters por llamada).
ALTER TABLE pipeline_config
  ADD COLUMN IF NOT EXISTS fetch_timeout_ms integer NOT NULL DEFAULT 8000,
  ADD COLUMN IF NOT EXISTS fetch_retries integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS enrich_heuristic_max_concurrency integer NOT NULL DEFAULT 2;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_config_speed_knobs_check') THEN
    ALTER TABLE pipeline_config ADD CONSTRAINT pipeline_config_speed_knobs_check CHECK (
      fetch_timeout_ms BETWEEN 1000 AND 15000
      AND fetch_retries BETWEEN 0 AND 3
      AND enrich_heuristic_max_concurrency BETWEEN 1 AND 32
    );
  END IF;
END $$;
