# Blindspot Data Notes

Este archivo no documenta todo el schema físico del sistema. Su alcance actual es acotado: notas de uso sobre estructuras JSONB que suelen generar drift o consultas erróneas.

La fuente operativa del modelo real sigue siendo:

- migraciones en `supabase/migrations/`
- contratos y restricciones resumidos en `context/ARCHITECTURE.md`
- convenciones de datos relevantes en `context/FUTURE.md`

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
- `digital_footprint->'social_search'->>'source'`: origen de social search, por ejemplo `duckduckgo`, `duckduckgo-fallback` o `playwright`.
- `digital_footprint->'social_search'->'facebook'`: resultado de búsqueda/extracción de Facebook.
- `digital_footprint->'social_search'->'instagram'`: resultado de búsqueda/extracción de Instagram.
- `digital_footprint->'heuristic_discovery'`: resultado de descubrimiento heurístico de website/social/WhatsApp.
- `digital_footprint->'heuristic_discovery'->'selected'->'website'->>'url'`: URL de website heurístico seleccionado.
- `digital_footprint->'whatsapp'`: señales de WhatsApp parseadas desde HTML.
- `digital_footprint->'pixels'`: señales Meta/GA/GTM.
- `digital_footprint->'stack'`: plataforma/stack detectado.
- `digital_footprint->'ssl'`: señal HTTPS derivada de la URL final.
- `digital_footprint->'viewport'`: señal de viewport responsive.
