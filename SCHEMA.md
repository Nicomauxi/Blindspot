# Blindspot Data Schema

## score_breakdown

`leads.score_breakdown` is a JSONB object written by the scoring module.

Example:

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

Use `rules` arrays for match-rate queries. There is no `matched` object.

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

## digital_footprint JSONB paths

- `digital_footprint->'contact_emails'`: JSON array of useful contact emails.
- `digital_footprint->'social_search'`: social discovery result.
- `digital_footprint->'social_search'->>'source'`: social search source, such as `duckduckgo`, `duckduckgo-fallback`, or `playwright`.
- `digital_footprint->'social_search'->'facebook'`: Facebook search/extraction result.
- `digital_footprint->'social_search'->'instagram'`: Instagram search/extraction result.
- `digital_footprint->'heuristic_discovery'`: heuristic website/social/WhatsApp discovery result.
- `digital_footprint->'heuristic_discovery'->'selected'->'website'->>'url'`: selected heuristic website URL.
- `digital_footprint->'whatsapp'`: WhatsApp signals parsed from website HTML.
- `digital_footprint->'pixels'`: Meta/GA/GTM tracking signals.
- `digital_footprint->'stack'`: detected website platform/stack.
- `digital_footprint->'ssl'`: HTTPS signal derived from final URL.
- `digital_footprint->'viewport'`: responsive viewport signal.
