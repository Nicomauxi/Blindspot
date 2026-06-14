-- N33: canonical_fields.email persistido como string plano por external-leads.ts
-- (2.063 filas) era invisible para lead_dashboard (->>'value' devuelve NULL en strings),
-- KPIs y export. Normaliza al shape contractual {value, confidence, sources, conflict}.
-- confidence 0.5: el origen exacto se perdió; el merge canónico posterior la corrige.
UPDATE leads
SET canonical_fields = jsonb_set(
  canonical_fields,
  '{email}',
  jsonb_build_object(
    'value', canonical_fields->>'email',
    'confidence', 0.5,
    'sources', '[]'::jsonb,
    'conflict', false
  )
)
WHERE jsonb_typeof(canonical_fields->'email') = 'string';
