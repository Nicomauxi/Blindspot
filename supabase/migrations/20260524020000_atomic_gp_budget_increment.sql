-- Atomic GP budget increment with over-budget detection
CREATE OR REPLACE FUNCTION increment_gp_budget_spent(amount numeric)
RETURNS TABLE(google_places_budget_spent numeric, google_places_budget_total numeric, over_budget boolean)
LANGUAGE sql AS $$
  UPDATE pipeline_config
  SET google_places_budget_spent = google_places_budget_spent + amount
  WHERE id = 'singleton'
  RETURNING
    google_places_budget_spent,
    google_places_budget_total,
    google_places_budget_spent > google_places_budget_total AS over_budget;
$$;
