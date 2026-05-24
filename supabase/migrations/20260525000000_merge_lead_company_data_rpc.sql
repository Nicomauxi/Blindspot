-- RPC for atomic server-side merge of lead_company_data jsonb.
-- Replaces the SELECT+merge+UPDATE round-trip in updateLeadCompanyData,
-- eliminating the read-modify-write race window between concurrent enrichers.

BEGIN;

CREATE OR REPLACE FUNCTION merge_lead_company_data(p_lead_id uuid, p_patch jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE leads
  SET lead_company_data = COALESCE(lead_company_data, '{}'::jsonb) || p_patch
  WHERE id = p_lead_id;
END;
$$;

COMMIT;
