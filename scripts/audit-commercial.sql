-- Auditoría post-curado: debilidades de LÓGICA y COMERCIALES (2026-06-12)
\echo '=== 1. Invariantes duros ==='
SELECT 'pool sin score' AS check, count(*) FROM leads WHERE passed_filter AND prospect_score IS NULL
UNION ALL SELECT 'pool geo fuera de UY', count_pool_geo_violations()
UNION ALL SELECT 'pool duplicate-secondary', count(*) FROM leads WHERE passed_filter AND 'duplicate-secondary' = ANY(tags)
UNION ALL SELECT 'pool sin ningún canal (cols)', count(*) FROM lead_dashboard WHERE phone IS NULL AND whatsapp IS NULL AND contact_email IS NULL AND website IS NULL
UNION ALL SELECT 'pool chain-branch', count(*) FROM leads WHERE passed_filter AND 'chain-branch' = ANY(tags)
UNION ALL SELECT 'pool vertical B2B', count(*) FROM leads WHERE passed_filter AND (tags && ARRAY['vertical-industrial','vertical-otro'])
UNION ALL SELECT 'scoring_version != 3', count(*) FROM leads WHERE passed_filter AND scoring_version IS DISTINCT FROM 3
UNION ALL SELECT 'external_id numérico legacy', count(*) FROM leads WHERE source IN ('mintur','miem_dei') AND external_id ~ '^[0-9]+$';

\echo '=== 2. Coherencia interna del breakdown ==='
SELECT 'primary_offer != top sub_score ajustado' AS check, count(*) FROM leads
WHERE passed_filter AND score_breakdown->'sub_scores'->>'primary_offer' IS DISTINCT FROM score_breakdown->>'primary_offer';
SELECT 'contact_tier breakdown != vista' AS check, count(*) FROM lead_dashboard d JOIN leads l ON l.id=d.id
WHERE d.contact_tier IS DISTINCT FROM l.score_breakdown->>'contact_tier';

\echo '=== 3. Distribuciones (señales degeneradas) ==='
SELECT 'urgency: '||coalesce(score_breakdown->>'urgency_signal','null') AS bucket, count(*) FROM leads WHERE passed_filter GROUP BY 1 ORDER BY 2 DESC;
SELECT 'breadth>0' AS check, count(*) FROM leads WHERE passed_filter AND (score_breakdown->>'commercial_breadth')::int > 0;
SELECT 'offer: '||coalesce(score_breakdown->>'primary_offer','null'), count(*), round(avg(prospect_score),1) FROM leads WHERE passed_filter GROUP BY 1 ORDER BY 2 DESC;
SELECT 'band: '||coalesce(score_breakdown->>'score_band','null'), count(*) FROM leads WHERE passed_filter GROUP BY 1 ORDER BY 2 DESC;

\echo '=== 4. Empates masivos en el ranking (top del pool) ==='
SELECT prospect_score, count(*) FROM lead_dashboard GROUP BY 1 ORDER BY 1 DESC LIMIT 10;

\echo '=== 5. Accionabilidad comercial del top ==='
SELECT 'hot (>=55) contactables' AS check, count(*) FROM lead_dashboard WHERE prospect_score >= 55 AND (phone IS NOT NULL OR whatsapp IS NOT NULL OR contact_email IS NOT NULL);
SELECT 'hot sin canal directo (solo web/social)', count(*) FROM lead_dashboard WHERE prospect_score >= 55 AND phone IS NULL AND whatsapp IS NULL AND contact_email IS NULL;
SELECT 'tier A con phone gestor (shared)', count(*) FROM leads WHERE passed_filter AND score_breakdown->>'contact_tier'='A' AND 'shared-phone-generic' = ANY(tags);
SELECT 'pool contact_ready', count(*) FILTER (WHERE contact_ready), count(*) FROM lead_dashboard;

\echo '=== 6. Calidad de contacto cosechado (post N0.3) ==='
SELECT 'pool con website seleccionado', count(*) FROM leads WHERE passed_filter AND digital_footprint->'heuristic_discovery'->'selected'->>'website' IS NOT NULL AND digital_footprint->'heuristic_discovery'->'selected'->'website' != 'null'::jsonb;
SELECT 'selected.website sin señal de identidad (regresión N47)', count(*) FROM leads
WHERE digital_footprint->'heuristic_discovery'->'selected'->'website' IS NOT NULL
  AND digital_footprint->'heuristic_discovery'->'selected'->'website' != 'null'::jsonb
  AND NOT (digital_footprint->'heuristic_discovery'->'selected'->'website'->'signals' @> '"name-match"'
        OR digital_footprint->'heuristic_discovery'->'selected'->'website'->'signals' @> '"name_in_schema"'
        OR digital_footprint->'heuristic_discovery'->'selected'->'website'->'signals' @> '"phone_in_schema"');
SELECT 'canonical email shape string (regresión N33)', count(*) FROM leads WHERE jsonb_typeof(canonical_fields->'email')='string';

\echo '=== 7. Buyer scores (vida de la señal) ==='
SELECT buyer_type, count(*) FILTER (WHERE score>0) AS nonzero, round(avg(score) FILTER (WHERE score>0),1) AS avg_nz, max(score) FROM lead_buyer_scores GROUP BY 1 ORDER BY 2 DESC;

\echo '=== 8. Cobertura de enrichment del pool vendible ==='
SELECT 'digitalization desconocida en pool', count(*) FROM leads WHERE passed_filter AND (inferred_state->>'digitalization_level' IS NULL);
SELECT 'pool sin digital_footprint', count(*) FROM leads WHERE passed_filter AND digital_footprint IS NULL;
SELECT 'IG con métricas (audience)', count(*) FROM leads WHERE passed_filter AND digital_footprint->'social_activity'->'profiles'->'instagram'->>'followers' IS NOT NULL;
