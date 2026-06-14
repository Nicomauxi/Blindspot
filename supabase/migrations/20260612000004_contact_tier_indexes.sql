-- N60: el filtro principal del CRM (contact_tier) forzaba seq scan + detoast de
-- score_breakdown sobre las 9444 filas. Índices por expresión sobre el pool.
CREATE INDEX IF NOT EXISTS leads_contact_tier_idx
  ON leads (((score_breakdown->>'contact_tier')))
  WHERE passed_filter;
CREATE INDEX IF NOT EXISTS leads_primary_offer_idx
  ON leads (((score_breakdown->>'primary_offer')))
  WHERE passed_filter;
