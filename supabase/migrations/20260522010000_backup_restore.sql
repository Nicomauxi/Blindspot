BEGIN;

ALTER TABLE backup_config
  ADD COLUMN IF NOT EXISTS maintenance_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS maintenance_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS restore_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS restore_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS restore_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS restore_error_message text;

ALTER TABLE backup_runs
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'standard';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'backup_runs_purpose_check'
  ) THEN
    ALTER TABLE backup_runs
      ADD CONSTRAINT backup_runs_purpose_check
      CHECK (purpose IN ('standard', 'restore_checkpoint'));
  END IF;
END; $$;

CREATE TABLE IF NOT EXISTS backup_restores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_run_id uuid,
  checkpoint_backup_run_id uuid,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  backup_path text,
  backup_filename text,
  checkpoint_path text,
  checkpoint_filename text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_message text,
  triggered_by_user_id uuid,
  maintenance_started_at timestamptz,
  maintenance_finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS backup_restores_started_at_idx
  ON backup_restores(started_at DESC);
CREATE INDEX IF NOT EXISTS backup_restores_status_idx
  ON backup_restores(status, started_at DESC);

COMMIT;
