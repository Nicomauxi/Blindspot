-- Manual Places API estimated cost summary.
-- Replace :from_ts and :to_ts with timestamptz-compatible values.
--
-- Example:
--   :from_ts = '2026-05-09T00:00:00Z'
--   :to_ts   = '2026-05-10T00:00:00Z'

select
  count(*) as runs_count,
  coalesce(sum(coalesce((stats->>'estimated_cost_usd')::numeric, 0)), 0) as estimated_cost_usd,
  coalesce(sum(coalesce((stats->>'places_requests')::int, 0)), 0) as places_requests
from runs
where started_at >= :from_ts
  and started_at < :to_ts;
