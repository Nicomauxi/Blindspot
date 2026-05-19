CREATE OR REPLACE FUNCTION merge_corroborating_source(
  p_lead_id uuid,
  p_source text,
  p_external_id text,
  p_source_confidence numeric,
  p_raw_data jsonb,
  p_corroborating_sources jsonb,
  p_canonical_fields jsonb,
  p_data_confidence_score numeric,
  p_contact_reliability_score numeric
)
RETURNS leads
LANGUAGE plpgsql
AS $$
DECLARE
  v_lead leads%ROWTYPE;
BEGIN
  INSERT INTO lead_source_references (
    lead_id,
    source,
    external_id,
    source_confidence,
    raw_data,
    seen_at
  )
  VALUES (
    p_lead_id,
    p_source,
    p_external_id,
    p_source_confidence,
    p_raw_data,
    now()
  )
  ON CONFLICT (lead_id, source) DO UPDATE
    SET external_id = EXCLUDED.external_id,
        source_confidence = EXCLUDED.source_confidence,
        raw_data = EXCLUDED.raw_data,
        seen_at = EXCLUDED.seen_at;

  UPDATE leads
     SET corroborating_sources = COALESCE(p_corroborating_sources, '[]'::jsonb),
         canonical_fields = p_canonical_fields,
         data_confidence_score = p_data_confidence_score,
         contact_reliability_score = p_contact_reliability_score,
         updated_at = now()
   WHERE id = p_lead_id
   RETURNING * INTO v_lead;

  RETURN v_lead;
END;
$$;
