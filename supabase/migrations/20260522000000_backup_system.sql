BEGIN;

CREATE TABLE IF NOT EXISTS backup_config (
  id text PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  enabled boolean NOT NULL DEFAULT false,
  cron_expression text NOT NULL DEFAULT '0 3 * * *',
  scheduled_for timestamptz,
  directory text,
  max_backups integer NOT NULL DEFAULT 7 CHECK (max_backups >= 1 AND max_backups <= 365),
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_successful_at timestamptz,
  last_error_at timestamptz,
  last_error_message text,
  scheduler_heartbeat_at timestamptz
);

INSERT INTO backup_config (id)
VALUES ('singleton')
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'backup_config_updated_at'
  ) THEN
    CREATE TRIGGER backup_config_updated_at
      BEFORE UPDATE ON backup_config
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END; $$;

CREATE TABLE IF NOT EXISTS backup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger text NOT NULL CHECK (trigger IN ('manual', 'scheduled')),
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  path text,
  filename text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  error_message text,
  cleanup_deleted_count integer NOT NULL DEFAULT 0 CHECK (cleanup_deleted_count >= 0),
  cleanup_error_message text,
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS backup_runs_created_at_idx
  ON backup_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS backup_runs_status_idx
  ON backup_runs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS backup_runs_trigger_idx
  ON backup_runs(trigger, created_at DESC);
CREATE INDEX IF NOT EXISTS backup_runs_deleted_at_idx
  ON backup_runs(deleted_at, created_at DESC);

COMMIT;
