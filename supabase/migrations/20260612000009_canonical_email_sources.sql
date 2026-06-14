-- Follow-up de 20260612000001 (review de sesión): los emails migrados quedaron con
-- sources: [] — indistinguible de "sin origen". Se etiqueta el origen legacy para que
-- la cadena de evidencia sea auditable.
UPDATE leads
SET canonical_fields = jsonb_set(canonical_fields, '{email,sources}', '["legacy-string-migration"]'::jsonb)
WHERE jsonb_typeof(canonical_fields->'email') = 'object'
  AND canonical_fields->'email'->'sources' = '[]'::jsonb
  AND (canonical_fields->'email'->>'confidence')::numeric = 0.5;
