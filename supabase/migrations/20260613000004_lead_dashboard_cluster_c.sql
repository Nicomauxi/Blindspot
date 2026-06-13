-- Cluster C — lead_dashboard consolidado (vista derivada, aditiva, sin re-score).
-- Reemplaza 20260613000001_lead_dashboard_social_filters.sql con las correcciones de calidad.
-- CREATE OR REPLACE preserva el orden/tipo de columnas existentes (redefine expresiones in-place)
-- y agrega columnas nuevas SOLO al final (requisito de Postgres + conserva los GRANTs).
--   FS-02: has_social ahora exige perfil IG real (url no nula). El tag 'ig-discovered' sin
--          métricas se expone aparte como has_social_candidate (no se pierde la señal de discovery).
--   FS-19: social_platform desde el summary (best_platform), no hardcodeado a instagram.
--   FS-13: best_contact_email — elige el email de mejor calidad (digital_footprint->email_quality:
--          personal > role > unknown > generic vía reliability_multiplier, priorizando mx válido).
--   FS-14: website_kind agrega 'directory' (booking/pedidosya/mercadolibre/tripadvisor/…), portando
--          la denylist NON_OWN_SITE_RE de serper-provider.ts:223. opportunity_no_web y demand_gap_score
--          tratan 'directory' como ausencia de web propia.
--   FS-15: sources_count_real — corroborantes excluyendo SIGNAL_ONLY_SOURCES (pedidosya) + la primaria.
--   FS-07: deal_value_monthly_uyu — ingreso mensual estimado crudo (para mostrar rango en UI).

CREATE OR REPLACE VIEW lead_dashboard AS
 SELECT l.id,
    l.name,
    l.address,
    l.niche,
    l.source,
    l.canonical_source,
    jsonb_array_length(l.corroborating_sources) AS sources_count,
    COALESCE((l.canonical_fields -> 'email'::text) ->> 'value'::text,
        CASE
            WHEN jsonb_typeof(l.canonical_fields -> 'email'::text) = 'string'::text THEN l.canonical_fields ->> 'email'::text
            ELSE NULL::text
        END, (l.digital_footprint -> 'contact_emails'::text) ->> 0) AS contact_email,
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
    l.gps,
    (l.score_breakdown ->> 'primary_offer'::text) IS NOT NULL AND (l.score_breakdown ->> 'primary_offer'::text) <> 'none'::text AS sellable,
    -- FS-14: clasificación de website. 'directory' = listing de terceros (ni web propia ni red social).
        CASE
            WHEN COALESCE((l.canonical_fields -> 'website'::text) ->> 'value'::text, l.website) IS NULL OR COALESCE((l.canonical_fields -> 'website'::text) ->> 'value'::text, l.website) = ''::text THEN 'none'::text
            WHEN COALESCE((l.canonical_fields -> 'website'::text) ->> 'value'::text, l.website) ~* '(facebook|instagram|linktr\.ee|beacons\.ai|wa\.me|whatsapp|tiktok|twitter|x\.com|linktree)'::text THEN 'social'::text
            WHEN COALESCE((l.canonical_fields -> 'website'::text) ->> 'value'::text, l.website) ~* '(tripadvisor|yelp|booking\.com|foursquare|google\.|goo\.gl|waze|maptons|saliracomer|alacarta|guiaost|mercadolibre|paginasamarillas|guialocal|guiaclarin|cylex|opentable|booksy|pedidosya|rappi|ubereats|justeat|glovo|wikipedia|maps\.app|gps\.|gpsmycity|restaurants-us|restaurantes-uy|restaurantguru|youtube|youtu\.be|calengoo|frontdeskmaster)'::text THEN 'directory'::text
            ELSE 'real'::text
        END AS website_kind,
    -- FS-14: oportunidad sin web propia = tracción (reviews≥50) pero website_kind != 'real'.
    COALESCE(l.review_count, 0) >= 50 AND
        (COALESCE((l.canonical_fields -> 'website'::text) ->> 'value'::text, l.website) IS NULL
         OR COALESCE((l.canonical_fields -> 'website'::text) ->> 'value'::text, l.website) = ''::text
         OR COALESCE((l.canonical_fields -> 'website'::text) ->> 'value'::text, l.website) ~* '(facebook|instagram|linktr\.ee|beacons\.ai|wa\.me|whatsapp|tiktok|twitter|x\.com|linktree)'::text
         OR COALESCE((l.canonical_fields -> 'website'::text) ->> 'value'::text, l.website) ~* '(tripadvisor|yelp|booking\.com|foursquare|google\.|goo\.gl|waze|maptons|saliracomer|alacarta|guiaost|mercadolibre|paginasamarillas|guialocal|guiaclarin|cylex|opentable|booksy|pedidosya|rappi|ubereats|justeat|glovo|wikipedia|maps\.app|gps\.|gpsmycity|restaurants-us|restaurantes-uy|restaurantguru|youtube|youtu\.be|calengoo|frontdeskmaster)'::text
        ) AS opportunity_no_web,
    LEAST(100, GREATEST(0, LEAST(60, COALESCE(l.review_count, 0) / 3) +
        CASE
            WHEN COALESCE(l.rating, 0::numeric) >= 4.3 THEN 15
            WHEN COALESCE(l.rating, 0::numeric) >= 4.0 THEN 8
            ELSE 0
        END +
        CASE
            WHEN COALESCE((l.canonical_fields -> 'website'::text) ->> 'value'::text, l.website) IS NULL
              OR COALESCE((l.canonical_fields -> 'website'::text) ->> 'value'::text, l.website) = ''::text
              OR COALESCE((l.canonical_fields -> 'website'::text) ->> 'value'::text, l.website) ~* '(facebook|instagram|linktr\.ee|beacons\.ai|wa\.me|whatsapp|tiktok|twitter|x\.com|linktree)'::text
              OR COALESCE((l.canonical_fields -> 'website'::text) ->> 'value'::text, l.website) ~* '(tripadvisor|yelp|booking\.com|foursquare|google\.|goo\.gl|waze|maptons|saliracomer|alacarta|guiaost|mercadolibre|paginasamarillas|guialocal|guiaclarin|cylex|opentable|booksy|pedidosya|rappi|ubereats|justeat|glovo|wikipedia|maps\.app|gps\.|gpsmycity|restaurants-us|restaurantes-uy|restaurantguru|youtube|youtu\.be|calengoo|frontdeskmaster)'::text
            THEN 25
            ELSE 0
        END))::smallint AS demand_gap_score,
        CASE
            WHEN COALESCE(l.review_count, 0) <= 0 THEN 'unknown'::text
            ELSE ( WITH dv AS (
                     SELECT l.review_count * 2 *
                            CASE l.niche
                                WHEN 'restaurant'::text THEN 350
                                WHEN 'cafe'::text THEN 250
                                WHEN 'bakery'::text THEN 200
                                WHEN 'pharmacy'::text THEN 400
                                WHEN 'supermarket'::text THEN 600
                                WHEN 'pizzeria'::text THEN 300
                                WHEN 'sushi'::text THEN 450
                                WHEN 'burger'::text THEN 320
                                ELSE 300
                            END AS rev
                    )
             SELECT
                    CASE
                        WHEN dv.rev >= 200000 THEN 'high'::text
                        WHEN dv.rev >= 50000 THEN 'medium'::text
                        ELSE 'low'::text
                    END AS "case"
               FROM dv)
        END AS deal_value_tier,
    -- FS-02: has_social ahora exige perfil IG real (con url); el tag 'ig-discovered' sin perfil
    -- resuelto NO enciende has_social (se expone como has_social_candidate más abajo).
    (((l.digital_footprint -> 'social_activity') -> 'profiles') -> 'instagram') ->> 'url'::text IS NOT NULL AS has_social,
    (((l.digital_footprint -> 'social_activity') -> 'profiles') -> 'instagram') ->> 'url'::text AS social_instagram_url,
    ((((l.digital_footprint -> 'social_activity') -> 'profiles') -> 'instagram') ->> 'followers'::text)::integer AS social_followers,
    (((l.digital_footprint -> 'social_activity') -> 'profiles') -> 'instagram') ->> 'audience_tier'::text AS social_audience_tier,
    (((l.digital_footprint -> 'social_activity') -> 'profiles') -> 'instagram') ->> 'activity_status'::text AS social_status,
    -- === Columnas nuevas (agregadas al final por requisito de CREATE OR REPLACE VIEW) ===
    -- FS-15: fuentes "reales" = corroborantes sin pedidosya (signal-only) + la primaria si cuenta.
    ( SELECT count(*)::integer
        FROM jsonb_array_elements(l.corroborating_sources) cs
       WHERE cs ->> 'source'::text <> 'pedidosya'::text )
    + CASE WHEN l.source <> 'pedidosya'::text THEN 1 ELSE 0 END AS sources_count_real,
    -- FS-13: email recomendado. Solo "ascendemos" al email_quality cuando es NO-genérico (personal/role/
    -- unknown con buena señal) y entregable; nunca degradamos un email canónico personal a un info@/ventas@.
    -- Si no hay candidato no-genérico, se conserva el contact_email canónico.
    COALESCE(
        ( SELECT eq ->> 'email'::text
            FROM jsonb_array_elements(l.digital_footprint -> 'email_quality'::text) eq
           WHERE eq ->> 'quality'::text <> 'generic'::text
             AND NOT (jsonb_typeof(eq -> 'mx_valid'::text) = 'boolean'::text AND NOT (eq ->> 'mx_valid'::text)::boolean)
           ORDER BY
                -- calidad manda: reliability_multiplier (personal>role>unknown, +domain_match).
                COALESCE((eq ->> 'reliability_multiplier'::text)::numeric, 0::numeric) DESC,
                -- a igual calidad, preferir MX confirmado.
                CASE WHEN jsonb_typeof(eq -> 'mx_valid'::text) = 'boolean'::text
                          AND (eq ->> 'mx_valid'::text)::boolean THEN 1 ELSE 0 END DESC
           LIMIT 1),
        COALESCE((l.canonical_fields -> 'email'::text) ->> 'value'::text,
            CASE
                WHEN jsonb_typeof(l.canonical_fields -> 'email'::text) = 'string'::text THEN l.canonical_fields ->> 'email'::text
                ELSE NULL::text
            END, (l.digital_footprint -> 'contact_emails'::text) ->> 0)
    ) AS best_contact_email,
    -- FS-02: señal de discovery preservada (tag ig-discovered pero perfil aún sin resolver).
    ((((l.digital_footprint -> 'social_activity') -> 'profiles') -> 'instagram') ->> 'url'::text IS NULL
        AND l.tags @> ARRAY['ig-discovered']::text[]) AS has_social_candidate,
    -- FS-19: plataforma con mejor presencia (instagram|facebook) desde el summary.
    (l.digital_footprint -> 'social_activity' -> 'summary') ->> 'best_platform'::text AS social_platform,
    -- FS-07: ingreso mensual estimado crudo (review_count × 2 órdenes × ticket de nicho), para rango en UI.
    CASE
        WHEN COALESCE(l.review_count, 0) <= 0 THEN NULL::integer
        ELSE (l.review_count * 2 *
            CASE l.niche
                WHEN 'restaurant'::text THEN 350
                WHEN 'cafe'::text THEN 250
                WHEN 'bakery'::text THEN 200
                WHEN 'pharmacy'::text THEN 400
                WHEN 'supermarket'::text THEN 600
                WHEN 'pizzeria'::text THEN 300
                WHEN 'sushi'::text THEN 450
                WHEN 'burger'::text THEN 320
                ELSE 300
            END)::integer
    END AS deal_value_monthly_uyu

   FROM leads l
     LEFT JOIN LATERAL ( SELECT lead_buyer_scores.buyer_type,
            lead_buyer_scores.score
           FROM lead_buyer_scores
          WHERE lead_buyer_scores.lead_id = l.id
          ORDER BY lead_buyer_scores.score DESC
         LIMIT 1) lbs_top ON true
  WHERE l.passed_filter = true;
