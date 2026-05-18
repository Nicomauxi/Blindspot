BEGIN;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS owner_group_id uuid;
CREATE INDEX IF NOT EXISTS leads_owner_group ON leads(owner_group_id) WHERE owner_group_id IS NOT NULL;

COMMIT;
