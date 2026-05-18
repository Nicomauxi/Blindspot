-- Fase 25: outreach feedback loop
-- Sets leads.contacted_by and leads.state='contacted' on first outreach for a lead.

BEGIN;

CREATE OR REPLACE FUNCTION set_lead_contacted_by()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE leads
  SET
    contacted_by = NEW.user_id,
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

COMMIT;
