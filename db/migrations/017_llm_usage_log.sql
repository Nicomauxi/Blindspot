-- Fase 44-pre: llm_usage_log schema
-- Prerequisito de Fase 26 (LLM offers), Fase 44 (cost tracking) y Cost Dashboard.

BEGIN;

CREATE TABLE IF NOT EXISTS llm_usage_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz DEFAULT now(),

  provider        text NOT NULL,
  model           text NOT NULL,
  operation       text NOT NULL,
  lead_id         uuid REFERENCES leads(id) ON DELETE SET NULL,
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,

  prompt_tokens   integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens    integer GENERATED ALWAYS AS (prompt_tokens + completion_tokens) STORED,

  cost_usd        numeric(10, 6) NOT NULL DEFAULT 0,
  duration_ms     integer,

  success         boolean NOT NULL DEFAULT true,
  error           text
);

CREATE INDEX llm_usage_log_created_at    ON llm_usage_log(created_at DESC);
CREATE INDEX llm_usage_log_provider_model ON llm_usage_log(provider, model);
CREATE INDEX llm_usage_log_lead_id       ON llm_usage_log(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX llm_usage_log_operation     ON llm_usage_log(operation);

COMMIT;
