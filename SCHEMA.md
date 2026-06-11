# Blindspot Data Notes

Este archivo no documenta todo el schema físico del sistema. Su alcance actual es acotado: notas de uso sobre estructuras JSONB que suelen generar drift o consultas erróneas.

La fuente operativa del modelo real sigue siendo:

- migraciones en `supabase/migrations/`
- contratos y restricciones resumidos en `context/ARCHITECTURE.md`
- convenciones de datos relevantes en `context/FUTURE.md`

## Contratos frágiles (leer ANTES de tocar schema, scoring o geo)

Estos tres contratos rompen silenciosamente (sin error de compilación) si un agente
los asume mal. Son la causa raíz de varios bugs históricos.

### 1. La vista `lead_dashboard` deriva columnas de claves jsonb

La vista (recreada por migración) expone como columnas cosas que NO son columnas de `leads`:

| Columna de la vista | Derivada de |
|---|---|
| `contact_tier`, `primary_offer`, `pitch_hook`, `urgency_signal` | `score_breakdown ->> '<clave>'` |
| `digitalization_level`, `has_delivery`, `has_pos`, `has_reservations` | `inferred_state` |
| `contact_email` | **SOLO** `canonical_fields->'email'->>'value'` (sin fallback a `digital_footprint.contact_emails` — por eso hay emails "invisibles" para la UI) |
| `phone`, `website` | `COALESCE(canonical_fields[...].value, columna física)` |
| `has_osm_source` | `source='osm' OR corroborating_sources @> ...` |
| `top_buyer_type`, `top_buyer_score` | LATERAL sobre `lead_buyer_scores` (max score) |

Renombrar/mover una clave dentro de `score_breakdown`, `inferred_state` o `canonical_fields`
rompe la vista y la UI sin que `tsc` ni los tests unitarios lo detecten. El health check
`invariants.lead_dashboard_schema_current` (GET /api/v1/health) detecta drift vista↔migraciones.

### 2. Los campos de scoring viven DENTRO de `score_breakdown` (jsonb)

`contact_tier`, `primary_offer`, `pitch_hook`, `urgency_signal` y `commercial_offers_summary`
**no existen como columnas físicas**; solo `prospect_score` es columna. Toda query/UI nueva
debe pasar por `lead_dashboard` o extraer del jsonb. Ojo: `score_breakdown.sub_scores` persiste
valores PRE-ajuste; la oferta oficial es `score_breakdown->>'primary_offer'` (post-ajuste).

### 3. `gps` es `geography(Point,4326)` y PostgREST lo devuelve como hex EWKB

- `lat`/`lng` **no son columnas**: viven en `source_data` jsonb (solo Google las trae). Para
  geolocalización usable, usar `gps`.
- Un `SELECT *` vía supabase-js devuelve `gps` como hex EWKB, p.ej. el valor real
  `0101000020E610000039C8900832FA4CC0A79DF58480633FC0` ≡ `POINT(-57.9546519 -31.3886798)`
  (header `0101000020E6100000` = Point little-endian + SRID 4326; siguen 8 bytes `lng` y
  8 bytes `lat` como float64 LE). `parseLeadGps` (geo-text.ts) hoy espera `POINT(...)` y
  por eso el guard GPS≤radio está inactivo con datos reales (fix planificado).
- Escritura: string `SRID=4326;POINT(lng lat)`. Lectura en SQL: `ST_X(gps::geometry)`,
  `ST_Y(gps::geometry)` o `ST_AsText(gps)`.

## Liveness de redes (FB/IG)

`digital_footprint.heuristic_discovery.selected.{facebook,instagram}.liveness` guarda si la
red realmente existe: `{ state: alive|dead|unverified, reason, http_status, final_url,
checked_at, detector_version }`. **hard-dead** (`deleted`/`redirected_home`/`generic_title`/
`http_error`) descarta la red y limpia los tags `*-confirmed`/`*-heuristic`, agregando `*-dead`.
**soft-dead** (`private`/`login_wall`) solo atenúa. Una red `*-dead` no cuenta como contacto
accionable (`qualifyExternalLead`) ni muestra actividad social.

## `leads.favorite_contacts`

Array JSONB `[{ kind, value, marked_by, marked_at }]` de contactos/redes marcados como
favoritos para seguimiento. Reemplazo total vía `PATCH /leads/:id/favorite-contacts`.

## `lead_feedback.rejection_reason` / `reassign_to_lead_id`

Al marcar un dato incorrecto: `rejection_reason` (CHECK: `no_pertenece_al_lead` |
`dato_desactualizado` | `fuera_de_servicio` | `otro`) y, solo con `no_pertenece_al_lead`,
`reassign_to_lead_id` (FK) como **señal auditada** — no muta el lead destino.

## `gps` en fuentes externas

`leads.gps` (`geography(Point,4326)`) ahora se persiste también para fuentes externas
cuando la fuente trae coordenadas (hoy: OSM). Antes solo Google escribía GPS; los externos
quedaban en `NULL`, lo que cegaba el matching geográfico cruzado. Formato de escritura:
`SRID=4326;POINT(lng lat)`. Para fuentes sin coordenadas (yelu, mintur, pedidosya) sigue en
`NULL` hasta que un corroborante con GPS lo complete.

## `canonical_fields` cross-source

Al corroborar/reconciliar, `phone`/`website`/`email` se consolidan en `canonical_fields`
como `{ value, confidence, sources[], conflict }`. `conflict: true` marca valores
divergentes entre fuentes (no se pisan a ciegas; gana mayor `source_confidence`).

## `score_breakdown`

`leads.score_breakdown` es un objeto JSONB escrito por el módulo de scoring.

Ejemplo:

```json
{
  "computed_at": "2026-05-11T13:00:00.000Z",
  "config_version": 1,
  "business_quality": {
    "total": 85,
    "rules": [
      { "name": "rating_excellent", "weight": 25, "matched_value": 4.8 },
      { "name": "reviews_high", "weight": 25, "matched_value": 120 }
    ]
  },
  "digital_gap": {
    "total": 55,
    "rules": [
      { "name": "no_website", "weight": 35, "matched_value": "no-website" },
      { "name": "high_reviews_no_web", "weight": 10, "matched_value": "high-reviews-no-web" },
      { "name": "whatsapp_derived", "weight": 10, "matched_value": "whatsapp-derived" }
    ]
  },
  "systems_gap": {
    "total": 0,
    "rules": []
  },
  "prospect": {
    "formula": "business_quality * digital_gap / 100",
    "total": 46
  }
}
```

Usar arrays `rules` para consultas de match-rate. No existe un objeto `matched`.

```sql
SELECT
  rule->>'name' AS rule_name,
  rule->>'weight' AS weight,
  count(*) AS matched
FROM leads
CROSS JOIN LATERAL
  jsonb_array_elements(score_breakdown->'digital_gap'->'rules') AS rule
WHERE passed_filter = true
GROUP BY rule->>'name', rule->>'weight'
ORDER BY matched DESC;
```

## `digital_footprint` JSONB paths

- `digital_footprint->'contact_emails'`: JSON array de emails útiles.
- `digital_footprint->'social_search'`: resultado de descubrimiento social.
- `digital_footprint->'social_search'->>'source'`: origen de social search, por ejemplo `duckduckgo`, `duckduckgo-fallback`, `searxng` o `playwright`.
- `digital_footprint->>'social_enrich_status'`: `ok` | `blocked` | `no_data` (métricas IG vía `ig-snippet-enrich`).
- `digital_footprint->'social_search'->'facebook'`: resultado de búsqueda/extracción de Facebook.
- `digital_footprint->'social_search'->'instagram'`: resultado de búsqueda/extracción de Instagram.
- `digital_footprint->'heuristic_discovery'`: resultado de descubrimiento heurístico de website/social/WhatsApp.
- `digital_footprint->'heuristic_discovery'->'selected'->'website'->>'url'`: URL de website heurístico seleccionado.
- `digital_footprint->'whatsapp'`: señales de WhatsApp parseadas desde HTML.
- `digital_footprint->'pixels'`: señales Meta/GA/GTM.
- `digital_footprint->'stack'`: plataforma/stack detectado.
- `digital_footprint->'ssl'`: señal HTTPS derivada de la URL final.
- `digital_footprint->'viewport'`: señal de viewport responsive.
