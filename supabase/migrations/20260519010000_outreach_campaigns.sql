-- Migration 023: outreach_campaigns table + campaign_id on lead_outreach

BEGIN;

CREATE TABLE IF NOT EXISTS outreach_campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  user_id         uuid REFERENCES users(id) NOT NULL,
  segment_filter  jsonb NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'active',
  notes           text,
  created_at      timestamptz DEFAULT now(),
  closed_at       timestamptz
);

CREATE INDEX IF NOT EXISTS campaigns_user_id  ON outreach_campaigns(user_id);
CREATE INDEX IF NOT EXISTS campaigns_status   ON outreach_campaigns(status);

ALTER TABLE lead_outreach
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES outreach_campaigns(id);

CREATE INDEX IF NOT EXISTS lead_outreach_campaign
  ON lead_outreach(campaign_id)
  WHERE campaign_id IS NOT NULL;

COMMIT;
