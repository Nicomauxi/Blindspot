CREATE TABLE IF NOT EXISTS discovery_places_catalog (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_key   text NOT NULL,
  display_name   text NOT NULL,
  parent_location text,
  kind           text NOT NULL CHECK (kind IN ('departamento','ciudad','barrio','zona_turistica','polo_industrial','avenida')),
  lat_approx     numeric,
  lng_approx     numeric,
  commercial_score integer CHECK (commercial_score BETWEEN 0 AND 100),
  notes          text,
  source         text NOT NULL DEFAULT 'xls_import',
  imported_at    timestamptz NOT NULL DEFAULT now(),
  imported_by_user_id uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_discovery_places_catalog_key
  ON discovery_places_catalog (location_key);

CREATE INDEX IF NOT EXISTS idx_discovery_places_catalog_kind
  ON discovery_places_catalog (kind);

CREATE INDEX IF NOT EXISTS idx_discovery_places_catalog_parent
  ON discovery_places_catalog (parent_location);
