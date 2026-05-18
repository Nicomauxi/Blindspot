-- Fase API-0: users, pipeline_runs, pipeline_config, discovery_jobs, audit_log,
-- lead_outreach, contacted_by
-- Prerequisito: set_updated_at() ya existe (creada en 009_multi_source.sql)

BEGIN;

-- ─── users ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text UNIQUE NOT NULL,
  password_hash   text NOT NULL,
  role            text NOT NULL DEFAULT 'cm'
                  CHECK (role IN ('admin','cm')),
  lead_filter     jsonb,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  last_login_at   timestamptz
);

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Admin inicial (password: admin_local_2026 — cambiar antes de producción)
INSERT INTO users (email, password_hash, role)
VALUES (
  'admin@blindspot.local',
  crypt('admin_local_2026', gen_salt('bf', 12)),
  'admin'
)
ON CONFLICT (email) DO NOTHING;

-- ─── pipeline_runs ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz DEFAULT now(),
  started_at       timestamptz,
  completed_at     timestamptz,

  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','running','completed','failed','partial','aborted')),
  triggered_by     text NOT NULL DEFAULT 'manual'
                   CHECK (triggered_by IN ('manual','cron','startup-recovery','api')),
  abort_requested  boolean DEFAULT false,
  dashboard_stale  boolean DEFAULT false,

  config_snapshot  jsonb,
  overrides        jsonb,
  phase_results    jsonb,
  log_lines        jsonb DEFAULT '[]',
  invariant_details jsonb,

  webhook_status   text DEFAULT 'not_configured'
                   CHECK (webhook_status IN ('not_configured','sent','failed'))
);

CREATE INDEX IF NOT EXISTS pipeline_runs_status     ON pipeline_runs(status);
CREATE INDEX IF NOT EXISTS pipeline_runs_created_at ON pipeline_runs(created_at DESC);

-- ─── pipeline_config (singleton) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pipeline_config (
  id                    text PRIMARY KEY DEFAULT 'singleton'
                        CHECK (id = 'singleton'),
  updated_at            timestamptz DEFAULT now(),

  enabled               boolean DEFAULT false,
  cron_expression       text DEFAULT '0 2 * * 0',
  scheduled_for         timestamptz,
  last_completed_at     timestamptz,

  cpu_budget            text DEFAULT 'balanced'
                        CHECK (cpu_budget IN ('conservative','balanced','aggressive')),
  timeout_per_lead_sec  integer DEFAULT 120,
  max_retries           integer DEFAULT 2,

  phases                jsonb DEFAULT '{
    "refresh":   { "enabled": true,  "sources": ["google_places","mintur","yelu","osm"], "priority_tiers_first": true },
    "discovery": { "enabled": true,  "max_jobs": 5 },
    "enrich":    { "enabled": true,  "with_heuristic": false, "concurrency": 5 },
    "score":     { "enabled": true,  "recalculate_buyer_types": true }
  }'::jsonb,

  google_places_budget_total     numeric(8,2) DEFAULT 200.00,
  google_places_budget_spent     numeric(8,2) DEFAULT 0.00,
  google_places_alert_threshold  numeric(8,2) DEFAULT 10.00,

  infra_monthly_cost_usd         numeric(8,2) DEFAULT 0.00,
  backup_monthly_cost_usd        numeric(8,2) DEFAULT 0.00,

  notify_webhook_url     text,
  notify_webhook_secret  text,
  notify_webhook_events  text[] DEFAULT ARRAY['run_completed','new_hot_leads']
);

INSERT INTO pipeline_config (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING;

CREATE TRIGGER pipeline_config_updated_at BEFORE UPDATE ON pipeline_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── discovery_jobs ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS discovery_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz DEFAULT now(),
  started_at   timestamptz,
  completed_at timestamptz,
  user_id      uuid REFERENCES users(id),

  source       text NOT NULL,
  location     text NOT NULL,
  niche        text,
  profile      text,
  max_results  integer DEFAULT 200,
  concurrency  integer,
  cpu_budget   text DEFAULT 'balanced'
               CHECK (cpu_budget IN ('conservative','balanced','aggressive')),

  status       text NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued','running','completed','failed','cancelled','paused')),
  progress     integer DEFAULT 0,

  leads_found        integer DEFAULT 0,
  leads_new          integer DEFAULT 0,
  leads_corroborated integer DEFAULT 0,
  leads_hot_new      integer DEFAULT 0,
  error_message      text,

  triggered_by text NOT NULL DEFAULT 'manual'
               CHECK (triggered_by IN ('manual','scheduled','gap_analysis'))
);

CREATE INDEX IF NOT EXISTS discovery_jobs_status ON discovery_jobs(status) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS discovery_jobs_user   ON discovery_jobs(user_id) WHERE user_id IS NOT NULL;

-- ─── audit_log ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  actor_role    text NOT NULL,
  action        text NOT NULL,
  target_type   text,
  target_id     text,
  diff          jsonb,
  ip_address    inet,
  user_agent    text
);

CREATE INDEX IF NOT EXISTS audit_log_actor      ON audit_log(actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_target     ON audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS audit_log_occurred_at ON audit_log(occurred_at DESC);

-- ─── lead_outreach ───────────────────────────────────────────────────────────

DO $$
BEGIN
  IF to_regclass('lead_outreach') IS NULL THEN
    CREATE TABLE lead_outreach (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id       uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      user_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at    timestamptz DEFAULT now(),
      updated_at    timestamptz DEFAULT now(),

      offer_type    text,
      channel       text NOT NULL,
      offer_package jsonb,

      status        text NOT NULL DEFAULT 'contacted'
                    CHECK (status IN ('contacted','responded','interested','closed_won','closed_lost','no_response')),

      responded     boolean,
      outcome       text
                    CHECK (outcome IS NULL OR outcome IN ('closed_won','closed_lost','not_now','has_provider')),
      lost_reason   text
                    CHECK (lost_reason IS NULL OR lost_reason IN ('price','timing','no_interest','competitor','other')),
      service_sold  text,
      price_sold    integer,
      notes         text,

      contacted_at  timestamptz DEFAULT now(),
      responded_at  timestamptz,
      closed_at     timestamptz,

      lead_quality_signal smallint DEFAULT 0
    );

    CREATE INDEX lead_outreach_lead_id   ON lead_outreach(lead_id);
    CREATE INDEX lead_outreach_user_id   ON lead_outreach(user_id);
    CREATE INDEX lead_outreach_status    ON lead_outreach(status);
    CREATE INDEX lead_outreach_outcome   ON lead_outreach(outcome) WHERE outcome IS NOT NULL;
    CREATE INDEX lead_outreach_closed_at ON lead_outreach(closed_at) WHERE closed_at IS NOT NULL;

    CREATE TRIGGER lead_outreach_updated_at BEFORE UPDATE ON lead_outreach
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ─── leads.contacted_by ──────────────────────────────────────────────────────

ALTER TABLE leads ADD COLUMN IF NOT EXISTS contacted_by uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS leads_contacted_by ON leads(contacted_by) WHERE contacted_by IS NOT NULL;

COMMIT;
