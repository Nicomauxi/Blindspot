-- N18/N37: el gate geo solo corre en discovery — el stock nunca se re-valida.
-- RPC para que el invariant_check del pipeline cuente leads del pool con GPS
-- fuera del bbox de Uruguay (PostGIS no es expresable vía PostgREST).
CREATE OR REPLACE FUNCTION count_pool_geo_violations()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT count(*)::integer
  FROM leads
  WHERE passed_filter
    AND gps IS NOT NULL
    AND NOT (
      ST_Y(gps::geometry) BETWEEN -35.5 AND -30
      AND ST_X(gps::geometry) BETWEEN -58.5 AND -53
    );
$$;
