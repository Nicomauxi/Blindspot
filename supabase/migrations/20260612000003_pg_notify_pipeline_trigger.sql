-- N44: el camino pg_notify estaba muerto — la RPC no existía en la DB y la API
-- tragaba el error. El core escucha 'pipeline_trigger' (PgListener) además del polling.
CREATE OR REPLACE FUNCTION pg_notify_pipeline_trigger(run_id uuid)
RETURNS void
LANGUAGE sql
AS $$
  SELECT pg_notify('pipeline_trigger', run_id::text);
$$;
