-- Migration 002: align runs/leads schema to spec
-- Idempotent — safe to re-run. Preserves all existing data.

BEGIN;

-- ============================================================
-- RUNS TABLE
-- ============================================================

-- Rename created_at → started_at
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'runs' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE runs RENAME COLUMN created_at TO started_at;
  END IF;
END; $$;

-- Rename completed_at → finished_at
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'runs' AND column_name = 'completed_at'
  ) THEN
    ALTER TABLE runs RENAME COLUMN completed_at TO finished_at;
  END IF;
END; $$;

-- Add JSONB columns
ALTER TABLE runs ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS stats  jsonb;

-- Migrate scalar run inputs → config
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'runs' AND column_name = 'max_results'
  ) THEN
    UPDATE runs SET config = jsonb_build_object(
      'max_results', max_results,
      'min_rating',  min_rating
    );
  END IF;
END; $$;

-- Migrate scalar run outputs → stats
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'runs' AND column_name = 'discovered'
  ) THEN
    UPDATE runs SET stats = jsonb_build_object(
      'places_requests', discovered,
      'leads_discovered', filtered,
      'leads_new',        created_new,
      'leads_updated',    updated_existing
    );
  END IF;
END; $$;

-- Fold error into stats for failed runs
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'runs' AND column_name = 'error'
  ) THEN
    UPDATE runs
    SET stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('error', error)
    WHERE error IS NOT NULL;
  END IF;
END; $$;

-- Drop old scalar columns
ALTER TABLE runs DROP COLUMN IF EXISTS max_results;
ALTER TABLE runs DROP COLUMN IF EXISTS min_rating;
ALTER TABLE runs DROP COLUMN IF EXISTS discovered;
ALTER TABLE runs DROP COLUMN IF EXISTS filtered;
ALTER TABLE runs DROP COLUMN IF EXISTS created_new;
ALTER TABLE runs DROP COLUMN IF EXISTS updated_existing;
ALTER TABLE runs DROP COLUMN IF EXISTS error;

-- ============================================================
-- LEADS TABLE
-- ============================================================

-- Rename columns
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leads' AND column_name = 'formatted_address'
  ) THEN
    ALTER TABLE leads RENAME COLUMN formatted_address TO address;
  END IF;
END; $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leads' AND column_name = 'user_rating_count'
  ) THEN
    ALTER TABLE leads RENAME COLUMN user_rating_count TO review_count;
  END IF;
END; $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leads' AND column_name = 'website_uri'
  ) THEN
    ALTER TABLE leads RENAME COLUMN website_uri TO website;
  END IF;
END; $$;

-- Add new columns
ALTER TABLE leads ADD COLUMN IF NOT EXISTS whatsapp               text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS google_data            jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS digital_footprint      jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS reviews_sample         jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS business_quality_score smallint;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS digital_gap_score      smallint;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS prospect_score         smallint;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS score_breakdown        jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contacted_at           timestamptz;

-- Migrate raw_place_data → google_data
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leads' AND column_name = 'raw_place_data'
  ) THEN
    UPDATE leads SET google_data = raw_place_data WHERE raw_place_data IS NOT NULL;
  END IF;
END; $$;

-- Drop old columns
ALTER TABLE leads DROP COLUMN IF EXISTS score;
ALTER TABLE leads DROP COLUMN IF EXISTS raw_place_data;
ALTER TABLE leads DROP COLUMN IF EXISTS discovery_profile;

-- ============================================================
-- INDEXES
-- ============================================================

DROP INDEX IF EXISTS leads_score_idx;
DROP INDEX IF EXISTS leads_rating_idx;
CREATE INDEX IF NOT EXISTS leads_prospect_score_idx ON leads(prospect_score DESC);
CREATE INDEX IF NOT EXISTS leads_tags_idx ON leads USING gin(tags);

COMMIT;
