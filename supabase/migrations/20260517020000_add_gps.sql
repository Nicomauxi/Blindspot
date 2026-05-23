CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS gps geography(Point, 4326);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'leads'
      AND column_name = 'source'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'leads'
      AND column_name = 'source_data'
  ) THEN
    UPDATE leads
    SET gps = ST_MakePoint(
        (source_data->>'lon')::double precision,
        (source_data->>'lat')::double precision
      )::geography
    WHERE source = 'osm'
      AND source_data ? 'lat'
      AND source_data ? 'lon'
      AND NULLIF(source_data->>'lat', '') IS NOT NULL
      AND NULLIF(source_data->>'lon', '') IS NOT NULL
      AND gps IS NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS leads_gps_gist
  ON leads
  USING GIST (gps);
