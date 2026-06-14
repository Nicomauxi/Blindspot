-- Cola de revisión de uniones cross-source dudosas.
-- El merge borra el lead secundario, así que la zona gris (mismo contacto pero ciudad
-- distinta, nombre dispar, o clave de cadena) no se auto-aplica: queda acá para que
-- un humano la apruebe o rechace.

CREATE TABLE IF NOT EXISTS lead_merge_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  secondary_lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  match_kind TEXT NOT NULL,            -- phone | domain | email
  match_key TEXT NOT NULL,             -- valor compartido normalizado
  same_city BOOLEAN NOT NULL DEFAULT false,
  name_similarity REAL NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,                -- city-mismatch | chain-suspected | shared-domain-low-name-sim | ...
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  CONSTRAINT lead_merge_candidates_status_check CHECK (status IN ('pending','approved','rejected')),
  CONSTRAINT lead_merge_candidates_pair_unique UNIQUE (primary_lead_id, secondary_lead_id)
);

CREATE INDEX IF NOT EXISTS lead_merge_candidates_status_idx
  ON lead_merge_candidates (status);

CREATE INDEX IF NOT EXISTS lead_merge_candidates_primary_idx
  ON lead_merge_candidates (primary_lead_id);
