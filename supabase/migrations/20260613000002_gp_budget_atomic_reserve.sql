-- FD-03: el cap de presupuesto Google Places no serializaba entre la fase discovery del run
-- y el poll-timer: cada uno leía el mismo budget_remaining al inicio y decrementaba al final
-- (TOCTOU), por lo que dos jobs GP concurrentes podían gastar hasta N× el cap restante (USD
-- reales). Se agrega una RESERVA ATÓMICA: reserve_gp_budget reserva min(requested, remaining)
-- sumándolo a spent dentro de un UPDATE con FOR UPDATE (serializa reservas concurrentes), y
-- adjust_gp_budget_spent reconcilia el gasto real (delta puede ser negativo = refund de lo no
-- gastado) al terminar el job.

CREATE OR REPLACE FUNCTION public.reserve_gp_budget(requested numeric)
RETURNS TABLE(reserved numeric, google_places_budget_spent numeric, google_places_budget_total numeric)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_month text := to_char(now(), 'YYYY-MM');
  v_spent numeric;
  v_total numeric;
  v_remaining numeric;
  v_reserve numeric;
BEGIN
  -- FOR UPDATE: bloquea la fila singleton → dos reservas concurrentes se serializan y
  -- la segunda ve el spent ya incrementado por la primera (no doble-reserva).
  SELECT
    CASE WHEN google_places_budget_month = v_month THEN pc.google_places_budget_spent ELSE 0 END,
    pc.google_places_budget_total
  INTO v_spent, v_total
  FROM pipeline_config pc
  WHERE pc.id = 'singleton'
  FOR UPDATE;

  v_remaining := GREATEST(0, COALESCE(v_total, 0) - COALESCE(v_spent, 0));
  v_reserve := GREATEST(0, LEAST(COALESCE(requested, 0), v_remaining));

  UPDATE pipeline_config
  SET google_places_budget_spent = COALESCE(v_spent, 0) + v_reserve,
      google_places_budget_month = v_month
  WHERE id = 'singleton';

  RETURN QUERY SELECT v_reserve, COALESCE(v_spent, 0) + v_reserve, v_total;
END;
$function$;

CREATE OR REPLACE FUNCTION public.adjust_gp_budget_spent(delta numeric)
RETURNS TABLE(google_places_budget_spent numeric, google_places_budget_total numeric, over_budget boolean)
LANGUAGE sql
AS $function$
  UPDATE pipeline_config
  SET
    google_places_budget_spent = GREATEST(0,
      CASE
        WHEN google_places_budget_month = to_char(now(), 'YYYY-MM')
          THEN google_places_budget_spent + delta
        ELSE GREATEST(0, delta)
      END),
    google_places_budget_month = to_char(now(), 'YYYY-MM')
  WHERE id = 'singleton'
  RETURNING
    google_places_budget_spent,
    google_places_budget_total,
    google_places_budget_spent > google_places_budget_total AS over_budget;
$function$;
