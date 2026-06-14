-- F0 del plan de monitoreo/recursos.
-- 1) Discriminador de tipo de run para el monitoreo unificado (enrichment/scoring/social/...).
ALTER TABLE runs ADD COLUMN IF NOT EXISTS kind text;

-- Backfill best-effort por la forma del config existente (no rompe filas viejas).
UPDATE runs SET kind = CASE
  WHEN config ? 'buyer_types' OR config->>'mode' = 'scoring' THEN 'scoring'
  WHEN config ? 'withHeuristic' OR config ? 'forceRefresh' OR config->>'mode' IN ('run','source','all','filter') THEN 'enrichment'
  ELSE 'enrichment'
END
WHERE kind IS NULL;

-- 2) Caps de recursos del host usables por el core (gobierna paralelismo).
ALTER TABLE pipeline_config
  ADD COLUMN IF NOT EXISTS max_concurrent_runs integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_cpu_pct integer NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS max_ram_pct integer NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS max_enrich_threads integer NOT NULL DEFAULT 4;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_config_resource_caps_check') THEN
    ALTER TABLE pipeline_config ADD CONSTRAINT pipeline_config_resource_caps_check CHECK (
      max_concurrent_runs BETWEEN 1 AND 8
      AND max_cpu_pct BETWEEN 10 AND 100
      AND max_ram_pct BETWEEN 10 AND 100
      AND max_enrich_threads BETWEEN 1 AND 32
    );
  END IF;
END $$;
