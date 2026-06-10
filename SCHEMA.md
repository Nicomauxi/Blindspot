# Blindspot Data Notes

Este archivo no documenta todo el schema físico del sistema. Su alcance actual es acotado: notas de uso sobre estructuras JSONB que suelen generar drift o consultas erróneas.

La fuente operativa del modelo real sigue siendo:

- migraciones en `supabase/migrations/`
- contratos y restricciones resumidos en `context/ARCHITECTURE.md`
- convenciones de datos relevantes en `context/FUTURE.md`

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
