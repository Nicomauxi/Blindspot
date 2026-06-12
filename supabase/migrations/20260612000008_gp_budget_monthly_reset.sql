-- N79/N4.4: el contador de presupuesto GP era acumulativo de por vida — al ritmo de
-- junio (~$83/mes) el cap de $200 bloqueaba discovery permanentemente en ~5 semanas.
-- Se agrega clave de mes y el RPC resetea spent al cambiar de mes.
ALTER TABLE pipeline_config
  ADD COLUMN IF NOT EXISTS google_places_budget_month text NOT NULL DEFAULT to_char(now(), 'YYYY-MM');

CREATE OR REPLACE FUNCTION public.increment_gp_budget_spent(amount numeric)
RETURNS TABLE(google_places_budget_spent numeric, google_places_budget_total numeric, over_budget boolean)
LANGUAGE sql
AS $function$
  UPDATE pipeline_config
  SET
    google_places_budget_spent = CASE
      WHEN google_places_budget_month = to_char(now(), 'YYYY-MM')
        THEN google_places_budget_spent + amount
      ELSE amount
    END,
    google_places_budget_month = to_char(now(), 'YYYY-MM')
  WHERE id = 'singleton'
  RETURNING
    google_places_budget_spent,
    google_places_budget_total,
    google_places_budget_spent > google_places_budget_total AS over_budget;
$function$;
