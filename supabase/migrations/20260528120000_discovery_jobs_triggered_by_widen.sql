-- Widen discovery_jobs.triggered_by CHECK to include values the app actually writes:
-- 'predictive_location' (batch + bulk routes with predictive_context)
-- 'admin_bulk' (bulkInsertDiscoveryJobs storage default)
ALTER TABLE discovery_jobs
  DROP CONSTRAINT IF EXISTS discovery_jobs_triggered_by_check;

ALTER TABLE discovery_jobs
  ADD CONSTRAINT discovery_jobs_triggered_by_check
  CHECK (triggered_by IN ('manual','scheduled','gap_analysis','predictive_location','admin_bulk'));
