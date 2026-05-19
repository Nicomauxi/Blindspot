-- Migration 015: lead_dashboard VIEW
-- Creates the denormalized view for the leads UI endpoints.
-- Prerequisite: migrations 009 (canonical_fields, corroborating_sources, data_confidence_score,
--   contact_reliability_score), 010 (contact_ready), 012 (inferred_state),
--   014 (contacted_by on leads), and lead_buyer_scores table must exist.

CREATE OR REPLACE VIEW lead_dashboard AS
SELECT
  l.id,
  l.name,
  l.address,
  l.niche,
  l.source,
  l.canonical_source,
  jsonb_array_length(l.corroborating_sources)       AS sources_count,
  COALESCE(l.canonical_fields->'email'->>'value', NULL)      AS contact_email,
  COALESCE(l.canonical_fields->'phone'->>'value', l.phone)   AS phone,
  l.whatsapp                                                  AS whatsapp,
  COALESCE(l.canonical_fields->'website'->>'value', l.website) AS website,
  l.rating,
  l.review_count,
  l.tags,
  l.state,
  l.owner_group_id,
  l.digital_footprint,
  l.inferred_state,
  l.score_breakdown,
  l.notes,
  l.business_status,
  l.source_confidence,
  l.score_breakdown->>'contact_tier'                AS contact_tier,
  l.prospect_score,
  l.score_breakdown->>'primary_offer'               AS primary_offer,
  l.score_breakdown->>'pitch_hook'                  AS pitch_hook,
  l.score_breakdown->>'urgency_signal'              AS urgency_signal,
  l.inferred_state->>'digitalization_level'         AS digitalization_level,
  (l.inferred_state->'has_delivery'->>'value')::boolean      AS has_delivery,
  (l.inferred_state->'has_pos'->>'value')::boolean           AS has_pos,
  (l.inferred_state->'has_reservations'->>'value')::boolean  AS has_reservations,
  l.data_confidence_score,
  l.contact_reliability_score,
  l.contact_ready,
  l.contacted_at,
  l.contacted_by,
  l.created_at,
  (l.source = 'osm'
    OR l.corroborating_sources @> '[{"source":"osm"}]'::jsonb) AS has_osm_source,
  l.corroborating_sources,
  lbs_top.buyer_type AS top_buyer_type,
  lbs_top.score      AS top_buyer_score,
  l.search_vector
FROM leads l
LEFT JOIN LATERAL (
  SELECT buyer_type, score FROM lead_buyer_scores
  WHERE lead_id = l.id ORDER BY score DESC LIMIT 1
) lbs_top ON true
WHERE l.passed_filter = true;
-- Tier X is NOT excluded from the VIEW base.
-- Endpoints apply default contact_tier=A,B,C,D filter; X only returned when explicitly requested.
-- passed_filter=false excluded: discarded leads are not actionable for CMs.
