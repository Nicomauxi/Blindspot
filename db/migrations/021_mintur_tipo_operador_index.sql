-- Migration 021: Index on lead_company_data->>'tipo_operador' for MINTUR TipoOperador
-- Enables efficient filtering by operator type after Fase 29 backfill.
CREATE INDEX IF NOT EXISTS leads_tipo_operador
  ON leads ((lead_company_data->>'tipo_operador'))
  WHERE lead_company_data->>'tipo_operador' IS NOT NULL;
