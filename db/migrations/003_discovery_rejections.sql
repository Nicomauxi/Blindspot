-- Migration 003: persist all discovery candidates (passed + rejected)
-- Adds passed_filter flag and rejection_reasons array to leads.
-- Historical rows default to passed_filter=true (pre-migration leads were all accepted).

ALTER TABLE leads
  ADD COLUMN passed_filter boolean NOT NULL DEFAULT true;

ALTER TABLE leads
  ADD COLUMN rejection_reasons text[] NOT NULL DEFAULT '{}';

CREATE INDEX leads_passed_filter_idx ON leads(passed_filter);

COMMENT ON COLUMN leads.passed_filter IS
  'Whether the candidate passed the profile filter during discovery. '
  'False = rejected lead kept for audit/re-evaluation.';

COMMENT ON COLUMN leads.rejection_reasons IS
  'Reasons why this candidate failed the profile filter '
  '(e.g. rating-too-low, reviews-above-max, has-real-website). '
  'Empty array when passed_filter = true.';
