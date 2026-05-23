-- Bridge missing legacy schema steps into the Supabase migration chain.
-- This keeps fresh installs aligned with the API/UI contracts without
-- requiring a destructive reset of existing databases.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- runs parity
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'runs' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE runs RENAME COLUMN created_at TO started_at;
  END IF;
END; $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'runs' AND column_name = 'completed_at'
  ) THEN
    ALTER TABLE runs RENAME COLUMN completed_at TO finished_at;
  END IF;
END; $$;

ALTER TABLE runs ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS stats jsonb;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'runs' AND column_name = 'max_results'
  ) THEN
    UPDATE runs
    SET config = jsonb_build_object(
      'max_results', max_results,
      'min_rating', min_rating
    );
  END IF;
END; $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'runs' AND column_name = 'discovered'
  ) THEN
    UPDATE runs
    SET stats = jsonb_build_object(
      'places_requests', discovered,
      'leads_discovered', filtered,
      'leads_new', created_new,
      'leads_updated', updated_existing
    );
  END IF;
END; $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'runs' AND column_name = 'error'
  ) THEN
    UPDATE runs
    SET stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('error', error)
    WHERE error IS NOT NULL;
  END IF;
END; $$;

ALTER TABLE runs DROP COLUMN IF EXISTS max_results;
ALTER TABLE runs DROP COLUMN IF EXISTS min_rating;
ALTER TABLE runs DROP COLUMN IF EXISTS discovered;
ALTER TABLE runs DROP COLUMN IF EXISTS filtered;
ALTER TABLE runs DROP COLUMN IF EXISTS created_new;
ALTER TABLE runs DROP COLUMN IF EXISTS updated_existing;
ALTER TABLE runs DROP COLUMN IF EXISTS error;

ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_profile_check;
ALTER TABLE runs ADD CONSTRAINT runs_profile_check
  CHECK (profile IN ('a', 'b', 'c', 'd'));

-- leads parity
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leads' AND column_name = 'formatted_address'
  ) THEN
    ALTER TABLE leads RENAME COLUMN formatted_address TO address;
  END IF;
END; $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leads' AND column_name = 'user_rating_count'
  ) THEN
    ALTER TABLE leads RENAME COLUMN user_rating_count TO review_count;
  END IF;
END; $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leads' AND column_name = 'website_uri'
  ) THEN
    ALTER TABLE leads RENAME COLUMN website_uri TO website;
  END IF;
END; $$;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS niche text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS whatsapp text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS google_data jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS digital_footprint jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS reviews_sample jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS business_quality_score smallint;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS digital_gap_score smallint;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS prospect_score smallint;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS score_breakdown jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contacted_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS passed_filter boolean NOT NULL DEFAULT true;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS rejection_reasons text[] NOT NULL DEFAULT '{}';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS systems_gap_score smallint;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS systems_gap_breakdown jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'google_places'
  CHECK (source IN ('google_places','mintur','pedidosya','imm_habilitaciones','yelu','osm','infonegocios','dgi'));
ALTER TABLE leads ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_confidence numeric(3,2);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_data jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS data_confidence_score numeric(3,2);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contact_reliability_score numeric(3,2);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS canonical_source text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS owner_group_id uuid;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS canonical_fields jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS corroborating_sources jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_company_data jsonb;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leads' AND column_name = 'raw_place_data'
  ) THEN
    UPDATE leads
    SET google_data = raw_place_data
    WHERE raw_place_data IS NOT NULL
      AND google_data IS NULL;
  END IF;
END; $$;

UPDATE leads
SET source = 'google_places',
    external_id = place_id,
    source_confidence = coalesce(source_confidence, 0.90)
WHERE source = 'google_places'
  AND external_id IS NULL;

ALTER TABLE leads DROP COLUMN IF EXISTS score;
ALTER TABLE leads DROP COLUMN IF EXISTS raw_place_data;
ALTER TABLE leads DROP COLUMN IF EXISTS discovery_profile;

DROP INDEX IF EXISTS leads_score_idx;
DROP INDEX IF EXISTS leads_rating_idx;
CREATE INDEX IF NOT EXISTS leads_prospect_score_idx ON leads(prospect_score DESC);
CREATE INDEX IF NOT EXISTS leads_tags_idx ON leads USING gin(tags);
CREATE INDEX IF NOT EXISTS leads_niche_idx ON leads(niche);
CREATE INDEX IF NOT EXISTS leads_passed_filter_idx ON leads(passed_filter);
CREATE INDEX IF NOT EXISTS leads_systems_gap_score_idx ON leads(systems_gap_score DESC);
CREATE INDEX IF NOT EXISTS leads_owner_group ON leads(owner_group_id) WHERE owner_group_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS leads_source_external_id_uniq
  ON leads(source, external_id)
  WHERE external_id IS NOT NULL;

-- evidence model
CREATE TABLE IF NOT EXISTS lead_source_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('google_places','mintur','pedidosya','imm_habilitaciones','yelu','osm','infonegocios','dgi')),
  external_id text,
  source_confidence numeric(3,2),
  raw_data jsonb,
  seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS lead_source_references_lead_source_uniq
  ON lead_source_references(lead_id, source);
CREATE INDEX IF NOT EXISTS lead_source_references_lead_idx
  ON lead_source_references(lead_id);
CREATE INDEX IF NOT EXISTS lead_source_references_source_idx
  ON lead_source_references(source);

CREATE TABLE IF NOT EXISTS lead_field_evidences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  value text NOT NULL,
  sources text[] NOT NULL DEFAULT '{}',
  confidence numeric(3,2),
  first_seen date,
  last_seen date
);

CREATE UNIQUE INDEX IF NOT EXISTS lead_field_evidences_lead_field_value_uniq
  ON lead_field_evidences(lead_id, field_name, value);
CREATE INDEX IF NOT EXISTS lead_field_evidences_lead_idx
  ON lead_field_evidences(lead_id);
CREATE INDEX IF NOT EXISTS lead_field_evidences_field_idx
  ON lead_field_evidences(field_name);

-- runtime support tables
CREATE TABLE IF NOT EXISTS niche_vocabulary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  niche text NOT NULL,
  word text NOT NULL,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  source text NOT NULL CHECK (source IN ('seed', 'computed')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (niche, word)
);

CREATE INDEX IF NOT EXISTS niche_vocabulary_niche_idx ON niche_vocabulary(niche);

CREATE TABLE IF NOT EXISTS system_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_name text NOT NULL,
  value text NOT NULL,
  scope text,
  reason text,
  source text NOT NULL CHECK (source IN ('seed', 'auto_detected', 'manual')),
  confidence numeric(3,2),
  enabled boolean NOT NULL DEFAULT true,
  first_seen_at timestamptz DEFAULT now(),
  last_seen_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS system_lists_list_name_value_scope_uniq
  ON system_lists(list_name, value, coalesce(scope, ''));
CREATE INDEX IF NOT EXISTS system_lists_list_name_idx
  ON system_lists(list_name) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS system_lists_name_scope_idx
  ON system_lists(list_name, scope) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS system_lists_auto_idx
  ON system_lists(list_name, source) WHERE source = 'auto_detected';

CREATE TABLE IF NOT EXISTS platform_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_type text NOT NULL,
  pattern text NOT NULL,
  match_type text NOT NULL CHECK (match_type IN ('domain', 'keyword', 'substring', 'regex')),
  flags text,
  niche text,
  enabled boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'seed',
  created_at timestamptz DEFAULT now(),
  UNIQUE (platform_type, pattern)
);

CREATE INDEX IF NOT EXISTS platform_patterns_type_idx
  ON platform_patterns(platform_type) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS platform_patterns_niche_idx
  ON platform_patterns(platform_type, niche) WHERE enabled = true;

CREATE TABLE IF NOT EXISTS niche_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  niche text NOT NULL,
  term text NOT NULL,
  mapping_type text NOT NULL CHECK (mapping_type IN ('niche_alias', 'descriptor_word', 'directory_category', 'niche_stop_word')),
  target_value text,
  match_type text NOT NULL DEFAULT 'contains' CHECK (match_type IN ('contains', 'exact', 'prefix', 'suffix')),
  source_system text,
  language text DEFAULT 'es',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE (niche, term, mapping_type)
);

CREATE INDEX IF NOT EXISTS niche_mappings_type_idx
  ON niche_mappings(mapping_type) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS niche_mappings_niche_idx
  ON niche_mappings(niche, mapping_type) WHERE enabled = true;

-- API/auth/admin baseline
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'cm' CHECK (role IN ('admin', 'cm')),
  lead_filter jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_login_at timestamptz
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'users_updated_at'
  ) THEN
    CREATE TRIGGER users_updated_at
      BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END; $$;

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','completed','failed','partial','aborted')),
  triggered_by text NOT NULL DEFAULT 'manual'
    CHECK (triggered_by IN ('manual','cron','startup-recovery','api')),
  abort_requested boolean DEFAULT false,
  dashboard_stale boolean DEFAULT false,
  config_snapshot jsonb,
  overrides jsonb,
  phase_results jsonb,
  log_lines jsonb DEFAULT '[]'::jsonb,
  invariant_details jsonb,
  webhook_status text DEFAULT 'not_configured'
    CHECK (webhook_status IN ('not_configured','sent','failed'))
);

CREATE INDEX IF NOT EXISTS pipeline_runs_status ON pipeline_runs(status);
CREATE INDEX IF NOT EXISTS pipeline_runs_created_at ON pipeline_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS pipeline_config (
  id text PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),
  updated_at timestamptz DEFAULT now(),
  enabled boolean DEFAULT false,
  cron_expression text DEFAULT '0 2 * * 0',
  scheduled_for timestamptz,
  last_completed_at timestamptz,
  cpu_budget text DEFAULT 'balanced' CHECK (cpu_budget IN ('conservative','balanced','aggressive')),
  timeout_per_lead_sec integer DEFAULT 120,
  max_retries integer DEFAULT 2,
  phases jsonb DEFAULT '{
    "refresh":   { "enabled": true,  "sources": ["google_places","mintur","yelu","osm"], "priority_tiers_first": true },
    "discovery": { "enabled": true,  "max_jobs": 5 },
    "enrich":    { "enabled": true,  "with_heuristic": false, "concurrency": 5 },
    "score":     { "enabled": true,  "recalculate_buyer_types": true }
  }'::jsonb,
  google_places_budget_total numeric(8,2) DEFAULT 200.00,
  google_places_budget_spent numeric(8,2) DEFAULT 0.00,
  google_places_alert_threshold numeric(8,2) DEFAULT 10.00,
  infra_monthly_cost_usd numeric(8,2) DEFAULT 0.00,
  backup_monthly_cost_usd numeric(8,2) DEFAULT 0.00,
  notify_webhook_url text,
  notify_webhook_secret text,
  notify_webhook_events text[] DEFAULT ARRAY['run_completed','new_hot_leads']
);

INSERT INTO pipeline_config (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'pipeline_config_updated_at'
  ) THEN
    CREATE TRIGGER pipeline_config_updated_at
      BEFORE UPDATE ON pipeline_config
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END; $$;

CREATE TABLE IF NOT EXISTS discovery_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  user_id uuid REFERENCES users(id),
  source text NOT NULL,
  location text NOT NULL,
  niche text,
  profile text,
  max_results integer DEFAULT 200,
  concurrency integer,
  cpu_budget text DEFAULT 'balanced' CHECK (cpu_budget IN ('conservative','balanced','aggressive')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','completed','failed','cancelled','paused')),
  progress integer DEFAULT 0,
  leads_found integer DEFAULT 0,
  leads_new integer DEFAULT 0,
  leads_corroborated integer DEFAULT 0,
  leads_hot_new integer DEFAULT 0,
  error_message text,
  triggered_by text NOT NULL DEFAULT 'manual'
    CHECK (triggered_by IN ('manual','scheduled','gap_analysis'))
);

CREATE INDEX IF NOT EXISTS discovery_jobs_status
  ON discovery_jobs(status) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS discovery_jobs_user
  ON discovery_jobs(user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  actor_role text NOT NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  diff jsonb,
  ip_address inet,
  user_agent text
);

CREATE INDEX IF NOT EXISTS audit_log_actor ON audit_log(actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_target ON audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS audit_log_occurred_at ON audit_log(occurred_at DESC);

DO $$
BEGIN
  IF to_regclass('lead_outreach') IS NULL THEN
    CREATE TABLE lead_outreach (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      offer_type text,
      channel text NOT NULL,
      offer_package jsonb,
      status text NOT NULL DEFAULT 'contacted'
        CHECK (status IN ('contacted','responded','interested','closed_won','closed_lost','no_response')),
      responded boolean,
      outcome text CHECK (outcome IS NULL OR outcome IN ('closed_won','closed_lost','not_now','has_provider')),
      lost_reason text CHECK (lost_reason IS NULL OR lost_reason IN ('price','timing','no_interest','competitor','other')),
      service_sold text,
      price_sold integer,
      notes text,
      contacted_at timestamptz DEFAULT now(),
      responded_at timestamptz,
      closed_at timestamptz,
      lead_quality_signal smallint DEFAULT 0
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS lead_outreach_lead_id ON lead_outreach(lead_id);
CREATE INDEX IF NOT EXISTS lead_outreach_user_id ON lead_outreach(user_id);
CREATE INDEX IF NOT EXISTS lead_outreach_status ON lead_outreach(status);
CREATE INDEX IF NOT EXISTS lead_outreach_outcome ON lead_outreach(outcome) WHERE outcome IS NOT NULL;
CREATE INDEX IF NOT EXISTS lead_outreach_closed_at ON lead_outreach(closed_at) WHERE closed_at IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'lead_outreach_updated_at'
  ) THEN
    CREATE TRIGGER lead_outreach_updated_at
      BEFORE UPDATE ON lead_outreach
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END; $$;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS contacted_by uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS leads_contacted_by ON leads(contacted_by) WHERE contacted_by IS NOT NULL;

CREATE OR REPLACE FUNCTION set_lead_contacted_by()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE leads
  SET contacted_by = NEW.user_id,
      contacted_at = coalesce(contacted_at, NEW.contacted_at, now()),
      state = 'contacted'
  WHERE id = NEW.lead_id
    AND contacted_by IS NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lead_outreach_set_contacted_by ON lead_outreach;
CREATE TRIGGER trg_lead_outreach_set_contacted_by
  AFTER INSERT ON lead_outreach
  FOR EACH ROW
  EXECUTE FUNCTION set_lead_contacted_by();

CREATE TABLE IF NOT EXISTS llm_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  provider text NOT NULL,
  model text NOT NULL,
  operation text NOT NULL,
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer GENERATED ALWAYS AS (prompt_tokens + completion_tokens) STORED,
  cost_usd numeric(10, 6) NOT NULL DEFAULT 0,
  duration_ms integer,
  success boolean NOT NULL DEFAULT true,
  error text
);

CREATE INDEX IF NOT EXISTS llm_usage_log_created_at ON llm_usage_log(created_at DESC);
CREATE INDEX IF NOT EXISTS llm_usage_log_provider_model ON llm_usage_log(provider, model);
CREATE INDEX IF NOT EXISTS llm_usage_log_lead_id ON llm_usage_log(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS llm_usage_log_operation ON llm_usage_log(operation);

CREATE TABLE IF NOT EXISTS service_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_type text NOT NULL,
  monthly_fee integer NOT NULL CHECK (monthly_fee >= 0),
  currency text NOT NULL DEFAULT 'UYU',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id, service_type)
);

CREATE INDEX IF NOT EXISTS service_pricing_user_id ON service_pricing(user_id);
CREATE INDEX IF NOT EXISTS service_pricing_service_type ON service_pricing(service_type);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'service_pricing_updated_at'
  ) THEN
    CREATE TRIGGER service_pricing_updated_at
      BEFORE UPDATE ON service_pricing
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END; $$;

COMMIT;
