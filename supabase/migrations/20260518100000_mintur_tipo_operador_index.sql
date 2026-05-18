-- Migration 021: Index on lead_company_data->>'tipo_operador' for MINTUR TipoOperador
CREATE INDEX IF NOT EXISTS leads_tipo_operador
  ON leads ((lead_company_data->>'tipo_operador'))
  WHERE lead_company_data->>'tipo_operador' IS NOT NULL;
