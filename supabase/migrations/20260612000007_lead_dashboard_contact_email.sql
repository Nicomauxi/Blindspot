-- N89/N33: contact_email de la vista coalesca el shape objeto, el legacy string y el
-- primer email del footprint — el filtro missing_email mentía para 230 leads con
-- email solo en digital_footprint.contact_emails.
CREATE OR REPLACE VIEW lead_dashboard AS
SELECT l.id,
    l.name,
    l.address,
    l.niche,
    l.source,
    l.canonical_source,
    jsonb_array_length(l.corroborating_sources) AS sources_count,
    COALESCE(
        (l.canonical_fields -> 'email'::text) ->> 'value'::text,
        CASE WHEN jsonb_typeof(l.canonical_fields -> 'email'::text) = 'string'::text THEN l.canonical_fields ->> 'email'::text ELSE NULL::text END,
        l.digital_footprint -> 'contact_emails'::text ->> 0
    ) AS contact_email,
    COALESCE((l.canonical_fields -> 'phone'::text) ->> 'value'::text, l.phone) AS phone,
    l.whatsapp,
    COALESCE((l.canonical_fields -> 'website'::text) ->> 'value'::text, l.website) AS website,
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
    l.score_breakdown ->> 'contact_tier'::text AS contact_tier,
    l.prospect_score,
    l.score_breakdown ->> 'primary_offer'::text AS primary_offer,
    l.score_breakdown ->> 'pitch_hook'::text AS pitch_hook,
    l.score_breakdown ->> 'urgency_signal'::text AS urgency_signal,
    l.inferred_state ->> 'digitalization_level'::text AS digitalization_level,
    ((l.inferred_state -> 'has_delivery'::text) ->> 'value'::text)::boolean AS has_delivery,
    ((l.inferred_state -> 'has_pos'::text) ->> 'value'::text)::boolean AS has_pos,
    ((l.inferred_state -> 'has_reservations'::text) ->> 'value'::text)::boolean AS has_reservations,
    l.data_confidence_score,
    l.contact_reliability_score,
    l.contact_ready,
    l.contacted_at,
    l.contacted_by,
    l.created_at,
    l.source = 'osm'::text OR l.corroborating_sources @> '[{"source": "osm"}]'::jsonb AS has_osm_source,
    l.corroborating_sources,
    lbs_top.buyer_type AS top_buyer_type,
    lbs_top.score AS top_buyer_score,
    l.search_vector,
    l.gps
   FROM leads l
     LEFT JOIN LATERAL ( SELECT lead_buyer_scores.buyer_type,
            lead_buyer_scores.score
           FROM lead_buyer_scores
          WHERE lead_buyer_scores.lead_id = l.id
          ORDER BY lead_buyer_scores.score DESC
         LIMIT 1) lbs_top ON true
  WHERE l.passed_filter = true;
