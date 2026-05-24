BEGIN;

ALTER TABLE backup_config
  ADD COLUMN IF NOT EXISTS max_manual_backups integer,
  ADD COLUMN IF NOT EXISTS max_scheduled_backups integer;

UPDATE backup_config
SET
  max_manual_backups = COALESCE(max_manual_backups, max_backups),
  max_scheduled_backups = COALESCE(max_scheduled_backups, max_backups)
WHERE id = 'singleton';

ALTER TABLE backup_config
  ALTER COLUMN max_manual_backups SET DEFAULT 7,
  ALTER COLUMN max_scheduled_backups SET DEFAULT 7,
  ALTER COLUMN max_manual_backups SET NOT NULL,
  ALTER COLUMN max_scheduled_backups SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'backup_config_max_manual_backups_check'
  ) THEN
    ALTER TABLE backup_config
      ADD CONSTRAINT backup_config_max_manual_backups_check
      CHECK (max_manual_backups >= 1 AND max_manual_backups <= 365);
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'backup_config_max_scheduled_backups_check'
  ) THEN
    ALTER TABLE backup_config
      ADD CONSTRAINT backup_config_max_scheduled_backups_check
      CHECK (max_scheduled_backups >= 1 AND max_scheduled_backups <= 365);
  END IF;
END; $$;


CREATE OR REPLACE FUNCTION public.get_database_size_bytes()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT pg_database_size(current_database());
$$;

COMMIT;
