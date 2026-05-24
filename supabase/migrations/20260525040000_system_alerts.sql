-- system_alerts: persistent alert store for admin/commercial users
CREATE TABLE IF NOT EXISTS system_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL,
  severity        text NOT NULL CHECK (severity IN ('info', 'warn', 'critical')),
  title           text NOT NULL,
  description     text NOT NULL,
  payload         jsonb,
  target_user_id  uuid REFERENCES auth.users(id) ON DELETE CASCADE,  -- null = broadcast
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'read', 'archived')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  read_at         timestamptz,
  read_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  dedup_key       text  -- optional: (kind || ':' || payload_hash) to suppress duplicates
);

CREATE INDEX IF NOT EXISTS idx_system_alerts_user_status
  ON system_alerts (target_user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_alerts_broadcast_status
  ON system_alerts (status, created_at DESC)
  WHERE target_user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_system_alerts_dedup
  ON system_alerts (dedup_key, created_at DESC)
  WHERE dedup_key IS NOT NULL;

-- Auto-archive alerts older than 30 days (applied lazily by the list query)
-- Actual TTL cleanup is handled in application layer or a cron job
