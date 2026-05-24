-- CRM-2: add channel and reminder_at to lead_tracking_events

BEGIN;

ALTER TABLE lead_tracking_events
  ADD COLUMN IF NOT EXISTS channel text,
  ADD COLUMN IF NOT EXISTS reminder_at timestamptz;

COMMIT;
