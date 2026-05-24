-- CRM-1: lead_tracking and lead_tracking_events tables
-- New CRM tracking system alongside existing outreach_campaigns (bridge — old tables untouched).

BEGIN;

CREATE TABLE IF NOT EXISTS lead_tracking (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  owner_id    uuid        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status      text        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','validation','contact','observed','rejected','accepted')),
  campaign_id uuid        REFERENCES outreach_campaigns(id) ON DELETE SET NULL,
  notes       text,
  started_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- At most one active (non-terminal) tracking per lead at any time.
-- Terminal states (rejected, accepted) allow a future re-tracking of the same lead.
CREATE UNIQUE INDEX IF NOT EXISTS lead_tracking_lead_active_uniq
  ON lead_tracking(lead_id)
  WHERE status NOT IN ('rejected', 'accepted');

CREATE INDEX IF NOT EXISTS lead_tracking_owner_status_idx
  ON lead_tracking(owner_id, status, started_at DESC);

CREATE INDEX IF NOT EXISTS lead_tracking_lead_idx
  ON lead_tracking(lead_id, started_at DESC);

CREATE INDEX IF NOT EXISTS lead_tracking_campaign_idx
  ON lead_tracking(campaign_id)
  WHERE campaign_id IS NOT NULL;

CREATE TRIGGER lead_tracking_updated_at
  BEFORE UPDATE ON lead_tracking
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS lead_tracking_events (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_id    uuid        NOT NULL REFERENCES lead_tracking(id) ON DELETE CASCADE,
  from_status    text        CHECK (from_status IS NULL OR from_status IN ('pending','validation','contact','observed','rejected','accepted')),
  to_status      text        NOT NULL CHECK (to_status IN ('pending','validation','contact','observed','rejected','accepted')),
  actor_user_id  uuid        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_role     text        NOT NULL,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_tracking_events_tracking_idx
  ON lead_tracking_events(tracking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS lead_tracking_events_actor_idx
  ON lead_tracking_events(actor_user_id, created_at DESC);

COMMIT;
