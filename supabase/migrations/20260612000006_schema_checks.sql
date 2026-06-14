-- N116-N118: dominios de schema sin constraint + kinds históricos mal etiquetados.

-- N116: re-etiquetar por la FORMA real del config (storage/runs.ts):
--   discovery: max_results sin command; social: command='social-enrich'; scoring: command='score'.
UPDATE runs SET kind = 'discovery'
WHERE kind = 'enrichment' AND config ? 'max_results' AND NOT (config ? 'command');
UPDATE runs SET kind = 'social'
WHERE kind <> 'social' AND config->>'command' = 'social-enrich';
UPDATE runs SET kind = 'scoring'
WHERE kind <> 'scoring' AND config->>'command' = 'score';

ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_kind_check;
ALTER TABLE runs ADD CONSTRAINT runs_kind_check
  CHECK (kind IN ('discovery', 'enrichment', 'social', 'scoring'));

-- N118: el path CLI necesita poder cerrar zombies — alinear status con pipeline_runs.
ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_status_check;
ALTER TABLE runs ADD CONSTRAINT runs_status_check
  CHECK (status IN ('running', 'completed', 'failed', 'aborted', 'partial'));

-- N117: dominio explícito para business_status (NULL = desconocido).
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_business_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_business_status_check
  CHECK (business_status IS NULL OR business_status IN ('OPERATIONAL', 'CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY'));
