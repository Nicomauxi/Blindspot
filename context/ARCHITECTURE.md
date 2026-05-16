# Blindspot — Architecture

> Fuente de verdad técnica del proyecto. Se adjunta a todos los prompts de Claude Code.
> Solo documenta lo que está implementado hoy.
> Si algo se elimina del código → se elimina de acá.
> Si algo cambia → se actualiza antes de cerrar la sesión.

---

## Stack

- **Runtime:** Node.js 20 + TypeScript strict + pnpm
- **CLI:** Commander
- **HTTP:** undici ^7
- **DB:** Supabase PostgreSQL — Docker local (`supabase_db_gap-radar`) + cloud
- **Scraping:** Playwright
- **Tests:** Vitest — 865 passing, 7 skipped, 68 files
- **Dev:** tsx/esm
- **Config:** YAML en `config/` — fuente de verdad para parámetros de discovery y scoring
- **Repo:** https://github.com/Nicomauxi/Blindspot

---

## Pipeline

```
discover-* → enrich → score → social-enrich → re-score
```

**Principio:** el pipeline es agnóstico a la fuente. Cualquier lead en la DB — sin importar si
vino de Google Places, MINTUR, OSM u otra fuente — debe poder pasar por `enrich`, `score`,
`social-enrich` y `report`. Los comandos usan `--run <uuid>` para Google Places y
`--source <source>` / `--all` para fuentes externas.

### Comandos CLI disponibles

```
blindspot discover-google-places --niche <text> --location <text> --profile <a|b|c|d> [--max-results N]
blindspot discover-mintur   --location <text> [--niche <text>] [--limit N] [--dry-run]
blindspot discover-osm      --location <text> [--niche <text>] [--limit N] [--dry-run]
blindspot discover-external --source <yelu|pedidosya> --location <text> --niche <text> [--limit N] [--dry-run]
blindspot enrich            --run <uuid> [--force-refresh] [--with-heuristic]
                            --source <source> [--force-refresh] [--with-heuristic]
                            --all [--force-refresh] [--with-heuristic]
blindspot score             [--run <uuid> | --all] [--buyer-types [--buyer-type <type>]] [--dry-run]
blindspot social-enrich     [--run <uuid> | --all] [--limit N] [--force]
blindspot report            --run <uuid> [--format csv|html|md|all]
blindspot leads list        [--run <uuid>] [--passed-only] [--seen-in <uuid>]
blindspot vocabulary        rebuild [--niche <name> | --all]
blindspot heuristic-refresh [--run <uuid> | --all] [--force]
blindspot infer-state       --all [--passed-only] [--force] [--concurrency N]
blindspot run               --niche <text> --location <text> --profile <a|b|c|d|all>
                            [--max-results N] [--ram-mode conservative|auto|manual]
                            [--concurrency N] [--score-threshold N] [--no-social]
                            [--dry-run] [--override key=value]
blindspot maintenance       [--stale-days N] [--niche <text>] [--dry-run]
                            [--ram-mode conservative|auto|manual] [--concurrency N]
                            # Google Places: re-enriches stale runs (default: 30 días)
                            # External sources (MINTUR, OSM): detecta leads stale por source
                            #   y llama enrichCommand --source. Sin --stale-days usa source_refresh
                            #   de config/discovery.yaml por fuente. --stale-days lo overridea todo.
```

### Perfiles de discovery

| Perfil | Nombre | Criterio |
|--------|--------|---------|
| A | Joya escondida | rating ≥4.3, reviews 10-50, web social_or_missing |
| B | Saturado sin web | reviews 101+, web missing_only |
| C | Mercado medio | reviews 30-100, web missing_only |
| D | Profesional con web débil | rating ≥4.0, reviews 20+, web any |

---

## Estructura de módulos

```
src/
├── cli/
│   ├── index.ts                     — registro de comandos
│   └── commands/
│       ├── discover.ts              — orquesta discovery via Google Places
│       ├── discover-external.ts     — orquesta provider externo → deduplica → persiste
│       │                              actualiza allLeads en memoria tras cada inserción (fix in-memory bug)
│       ├── enrich.ts                — enrich + llama retroactiveEmailCleanup post-seed
│       ├── score.ts
│       ├── social-enrich.ts         — Playwright FB/IG
│       ├── report.ts
│       ├── run.ts                   — pipeline completo, RAM-aware concurrency
│       └── maintenance.ts           — source-aware stale enrichment; GP via runs, externos via enrichCommand --source
│
├── modules/
│   ├── discovery/
│   │   ├── places.ts                — Google Places API (Text Search + Details)
│   │   ├── filters.ts               — applyProfileFilter, tagCandidate
│   │   ├── deduplication.ts         — levenshtein, normalizeName, nameSimilarity, findCrossSourceMatch, isFranchise(name, franchiseNames)
│   │   └── providers/
│   │       ├── google-places.ts     — GooglePlacesProvider: IDiscoveryProvider sobre places.ts
│   │       ├── mintur.ts            — MINTURProvider: IDiscoveryProvider sobre API CKAN catalogodatos.gub.uy
│   │       ├── osm.ts               — OSMProvider: IDiscoveryProvider sobre Overpass API (GPS nativo, interior UY)
│   │       ├── yelu.ts              — YeluProvider: IDiscoveryProvider scraping yelu.uy (31k listings, confianza 0.65)
│   │       └── pedidosya.ts         — PedidosYaProvider: IDiscoveryProvider Playwright-based,
│   │                                  pedidosya.com.uy, MAX_PAGES=5, expedition_type:delivery
│                                  Usa bbox predefinidos por ciudad (UY_BBOXES) en lugar de area["admin_level"]
│                                  Endpoint: http://overpass.openstreetmap.fr (IPv4 forzado via undici Agent)
│   │
│   ├── enrichment/
│   │   ├── index.ts                 — orquestador; exporta MAX_CONTACT_EMAILS = 3
│   │   ├── channel-detection.ts     — detectConfirmedChannels, buildHeuristicMode
│   │   ├── heuristic-discovery.ts   — getHeuristicConfig(), candidatos web/social
│   │   │                              lee config/enrichment.yaml (cacheado)
│   │   ├── directory-discovery.ts   — scraping yelu.uy en enrich-time
│   │   ├── inferred-state.ts        — computeInferredState(fp, lead): InferredState
│   │   │                              función pura, sin I/O; calcula has_reservations,
│   │   │                              has_delivery (señal PedidosYa → 0.95), has_ecommerce,
│   │   │                              has_online_catalog, has_pos, has_chat_support, digitalization_level
│   │   └── parsers/
│   │       ├── email.ts             — extracción y validación emails
│   │       ├── whatsapp.ts          — normalización UY; lee mobile_prefixes_uy
│   │       │                          de getHeuristicConfig() — NO hardcodeado
│   │       ├── ssl.ts
│   │       └── whois.ts             — domain age via WHOIS
│   │
│   ├── scoring/
│   │   ├── index.ts                 — prospect_score = min(100, floor(max(sub_scores) × contactabilityMultiplier × reviewMultiplier) + ratingBonus)
│   │   ├── sub-scores.ts            — calculateSubScores(lead, sgScore): SubScores
│   │   │                              5 sub-scores: web_nuevo, rediseno, marketing, software, catalogo
│   │   │                              primary_offer: oferta con mayor sub-score
│   │   ├── buyer-types.ts           — computeAllBuyerScores(lead): BuyerTypeScore[]
│   │   │                              7 tipos: agencia_web, software_pos, marketing_social,
│   │   │                              delivery_propio, reservas_online, catalogo_digital, whatsapp_business
│   │   │                              Configurados en config/scoring.yaml → buyer_types
│   │   ├── review-multiplier.ts     — getReviewCountMultiplier(lead, config): 0.75×–1.4× según review_count
│   │   │                              getRatingBonus(lead, config): +5 si rating ≥ 4.3
│   │   └── confidence.ts            — calculateDataConfidence(), calculateContactReliability()
│   │
│   └── social-enrich/
│       └── index.ts
│
├── storage/
│   ├── leads.ts                     — upsertLeads, loadAllLeads, loadLeadsByRunId, loadLeadsBySource, loadAllPassedLeads (paginado PostgREST)
│   │                                  tagDuplicates, tagFranchises(leads, franchiseNames)
│   │                                  importa MAX_CONTACT_EMAILS desde enrichment/index.ts
│   ├── external-leads.ts            — insertExternalLead(candidate, {dryRun?, extraTags?}), addCorroboratingSource
│   ├── runs.ts                      — createRun, completeRun
│   └── system-lists.ts              — loadAllRuntime, loadRuntimeLists, detectAndSeedEmailProviders,
│                                      retroactiveEmailCleanup (corre post-seed)
│                                      RuntimeLists incluye franchiseNames: ReadonlySet<string>
│                                      RuntimePatterns incluye ecommercePlatforms: readonly string[]
│
└── shared/
    ├── types.ts                     — tipos globales
    ├── logger.ts                    — pino
    ├── ram.ts                       — RAM-aware concurrency
    └── config/
        ├── discovery.yaml           — perfiles A/B/C/D, mobile_prefixes_uy (fuente canónica)
        │                              source_refresh: días por fuente (google_places:30, mintur:90, osm:90, yelu:90, pedidosya:90)
        │                              getSourceRefreshDays(source, fallback=30) en modules/discovery/config.ts
        └── scoring.yaml             — pesos de reglas de scoring
```

---

## Base de datos

**Conexión local:**
```bash
docker exec supabase_db_gap-radar psql -U postgres -d postgres -c "..."
```

### Tabla: leads

| Campo | Tipo | Notas |
|-------|------|-------|
| id | uuid PK | |
| place_id | text UNIQUE | ID Google Places — clave de identidad actual |
| name | text | nombre comercial |
| address | text | |
| rating | numeric | |
| review_count | integer | |
| website | text | URL real de Google Maps |
| phone | text | |
| niche | text | restaurant, gym, hairdresser, car_dealer, other |
| tags | text[] | sistema de etiquetas semánticas |
| passed_filter | boolean | true = lead calificado para pipeline |
| rejection_reasons | text[] | |
| first_seen_run_id / last_seen_run_id | uuid FK | |
| whatsapp | text | número normalizado +598xx |
| google_data | jsonb | snapshot raw Google API |
| digital_footprint | jsonb | resultado del enrich (heuristic, social, emails, etc.) |
| prospect_score | smallint | score final |
| score_breakdown | jsonb | detalle de reglas que matchearon |
| business_quality_score / digital_gap_score | smallint | componentes del score |
| systems_gap_score / systems_gap_breakdown | smallint / jsonb | |
| contacted_at | timestamptz | |
| created_at / updated_at | timestamptz | |

### Columnas multi-source en leads (migración 009)

| Columna | Tipo | Notas |
|---------|------|-------|
| source | text NOT NULL DEFAULT 'google_places' | CHECK en DiscoverySource válidos |
| external_id | text | place_id migró acá para google_places; backfill completo (1432 leads) |
| source_confidence | numeric(3,2) | confianza base de la fuente (0.90 para google_places) |
| source_data | jsonb | payload raw de la fuente (reemplaza semánticamente google_data) |
| data_confidence_score | numeric(3,2) | resultado de calculateDataConfidence() |
| contact_reliability_score | numeric(3,2) | resultado de calculateContactReliability() |
| canonical_fields | jsonb | valores ganadores por campo tras reconciliación |
| corroborating_sources | jsonb NOT NULL DEFAULT '[]' | fuentes adicionales que corroboran |
| lead_company_data | jsonb | rut, razon_social, ciiu, etc. |

**Constraint de identidad nueva:**
```sql
UNIQUE INDEX leads_source_external_id_uniq ON leads(source, external_id)
WHERE external_id IS NOT NULL
```
`place_id` UNIQUE se mantiene para backward compat.

### Tabla: lead_buyer_scores (migración 20260516)

| Campo | Tipo | Notas |
|-------|------|-------|
| lead_id | uuid FK | ON DELETE CASCADE |
| buyer_type | text | agencia_web, software_pos, etc. |
| score | smallint | CHECK 0–100 |
| computed_at | timestamptz | DEFAULT now() |
| breakdown | jsonb | base, adjustments, applied_modifiers |

PK: `(lead_id, buyer_type)`. Índice: `(buyer_type, score DESC)`.

### Nuevas tablas (migración 009)

| Tabla | Descripción |
|-------|-------------|
| `lead_source_references` | Una fila por (lead × fuente). Unique (lead_id, source). |
| `lead_field_evidences` | Una fila por (lead × field × value). Corazón del modelo de evidencias. |

### Tablas de configuración (migración 007)

| Tabla | Contenido |
|-------|-----------|
| system_lists | Todas las listas de negocio — ver sección "Sistema de listas" |
| platform_patterns | 42 filas: delivery, booking, chat_widget, ecommerce (fallback si vacío), etc. |
| niche_mappings | 76 filas: niche_alias, descriptor_word, directory_category |

---

## Sistema de listas (system_lists)

**Principio:** ninguna colección de palabras, dominios o patrones vive en código fuente.
Todo en DB via `loadAllRuntime()`. Fallbacks hardcodeados solo para resiliencia si DB no disponible.

Listas activas:

| list_name | Propósito |
|-----------|-----------|
| `free_email_domains` | Proveedores personales válidos: gmail, hotmail, yahoo, outlook, etc. Son contacto directo del dueño. NUNCA bloquear. |
| `blocked_email_domains` | Dominios que no pertenecen al negocio (agencias, hosting compartido, templates) |
| `blocked_email_prefixes` | Prefijos genéricos: noreply, ventasweb, web, etc. |
| `blocked_heuristic_domains` | Dominios compartidos que el heurístico no debe matchear (cafe.uy, flores.uy, etc.) |
| `stop_words` / `geographic_stop_words` | Palabras a ignorar en búsquedas |
| `foreign_tlds` / `foreign_geo_terms` / `foreign_phone_prefixes` | Filtros para descartar negocios no uruguayos |
| `social_domains` / `platform_hosts` | Plataformas sociales y de hosting conocidas |
| `mobile_prefixes_uy` | Prefijos móviles UY (91-99) — fuente canónica para whatsapp.ts |

**`retroactiveEmailCleanup()`** en `system-lists.ts`:
- Corre automáticamente después de `detectAndSeedEmailProviders()` en cada enrich
- Recorre leads con passed_filter=true
- Limpia emails que matcheen `blocked_email_domains`
- Excluye explícitamente `free_email_domains` — nunca limpiar gmail, hotmail, etc.
- Idempotente

---

## Scoring

```
prospect_score = min(100, floor(max(sub_scores) * contactabilityMultiplier * reviewCountMultiplier(lead)) + ratingBonus(lead))
```

**reviewCountMultiplier** (`src/modules/scoring/review-multiplier.ts`):
| review_count | Multiplicador |
|---|---|
| null (fuentes externas) | 1.0 — no penaliza |
| 0–10 | 0.75 |
| 11–50 | 1.0 |
| 51–200 | 1.2 |
| 201+ | 1.4 |

**ratingBonus**: +5 si `lead.rating >= 4.3`, 0 si null o menor. El `min(100)` externo envuelve el bonus.

### Sub-scores por tipo de oferta (Fase B)

`src/modules/scoring/sub-scores.ts` — `calculateSubScores(lead, sgScore): SubScores`

| Sub-score | Señales principales | Cap |
|-----------|--------------------|----|
| `web_nuevo` | `no-website`(35) + `high-reviews-no-web`(10) + `fb/ig-only-presence`/`social-link-only`(15) | 60 |
| `rediseno` | Requiere web. `site-unreachable`(15) + `ssl-missing`(10) + `not-responsive`(10) + `stack-obsolete`(10) + `web-outdated`(8) + `domain-old-stale`(5) | 58 |
| `marketing` | `web-only-no-social`(28) + `fb/ig-heuristic`(15 c/u, sin -confirmed/-only) + `pixel-missing`(5) + `analytics-missing`(5) | 68 |
| `software` | `systems_gap_score` + `whatsapp-missing`(10) + `chat-widget-missing`(3) | 100 |
| `catalogo` | `hours-missing-on-web`(3) + ausencia de `ecommerce_platforms`(25) + ausencia de `menu_links`(20) + niche bonus(15) | 63 |

`primary_offer: PrimaryOffer` = la oferta con mayor sub-score (`"none"` si todos son 0).
Penalizaciones por `inferred_state` (Fase F): **activas** — `has_ecommerce` × 0.3 en `web_nuevo`; `has_reservations` × 0.7 y `has_delivery` × 0.8 en `software`.

`score_breakdown.sub_scores: SubScores` — persiste los 5 valores + `primary_offer` en DB.

### InferredState (Fase F — activa)

`src/modules/enrichment/inferred-state.ts` — `computeInferredState(fp, lead): InferredState`

Función pura que corre al final del pipeline de enrichment (post-WHOIS). Resultado persistido en `digital_footprint.inferred_state`.

```typescript
interface InferredStateField { value: boolean; confidence: number; via: string[] }
interface InferredState {
  has_reservations, has_delivery, has_online_catalog,
  has_ecommerce, has_pos, has_chat_support: InferredStateField;
  digitalization_level: "none" | "basic" | "intermediate" | "advanced";
  computed_at: string;
}
```

`digitalization_level`: 0 activos = none, 1–2 = basic, 3 = intermediate, 4+ = advanced.

**Reglas de inferencia activas:**

| Conclusión | Señal | Confianza |
|---|---|---|
| `has_delivery` | `delivery_platforms` no vacío | 0.8 |
| `has_delivery` | `source === 'pedidosya'` o `corroborating_sources` incluye pedidosya | 0.95 |

Comando retroactivo: `blindspot infer-state --all [--force]` — vía `patchLeadInferredState` en `storage/leads.ts`.

### Operadores del evaluador de reglas

`src/modules/scoring/evaluator.ts` — soporta: `eq`, `neq`, `gte`, `lte`, `between`.
Nota: `neq` retorna `matched: false` cuando el campo es null (null-guard en línea 23).

### contactabilityMultiplier

`src/modules/scoring/index.ts` — función privada que aplica ×1.2 al `prospect_score`
si el lead tiene al menos un email en `digital_footprint.contact_emails` o en
`canonical_fields.email`. Aplica a todos los sources. Se combina con `reviewCountMultiplier`
antes del `min(100)` final.

### Regla external_source_quality

`config/scoring.yaml` — en `business_quality.rules`. Suma 70 puntos a leads con
`source != google_places` (operador `neq`). Compensa la ausencia de rating/reviews en
fuentes externas. Sin mutual_exclusion.

### Scoring escalonado — regla website_heuristic

Lee `digital_footprint.heuristic_discovery.selected.website.score`:

| Condición | Peso efectivo (base 20) |
|-----------|------------------------|
| Sin tag `website-heuristic` | no aplica |
| Tag presente, score ausente/null | 6 (30%) — fallback seguro |
| score < 0.5 | 6 (30%) |
| score 0.5–0.69 | 12 (60%) |
| score ≥ 0.7 | 20 (100%) |

### Thresholds comerciales

| Categoría | Score |
|-----------|-------|
| Hot lead | ≥ 50 |
| Pitcheable | ≥ 40 |
| Pool activo mínimo | ≥ 40 |

### Nichos activos / descartados

| Niche | Estado |
|-------|--------|
| restaurant, gym, hairdresser, car_dealer, other | Activos |
| dentist | Descartado — passed_filter=false en todos. 0 hot leads históricos, avg score 13.5 |

---

## Arquitectura de canales parciales

`src/modules/enrichment/channel-detection.ts`

El enrich detecta canales confirmados y solo corre heurísticos para los faltantes.

| Canal | Confirmado cuando |
|-------|------------------|
| website | URL real de Google Places OR heuristic score ≥ 0.7 |
| facebook | tag `fb-confirmed` |
| instagram | tag `ig-confirmed` |
| whatsapp | tag `whatsapp-confirmed` |
| email | siempre re-parsea — barato y evita falsos confirmados |

---

## RAM-aware concurrency

`src/shared/ram.ts`

| Modo | Lógica | Cap |
|------|--------|-----|
| conservative | floor(freeRam × 0.40 / 200MB) | 8 |
| auto | floor(freeRam × 0.80 / 200MB) | 16 |
| manual | valor exacto del flag --concurrency | error si >95% RAM |

---

## Señales capturadas relevantes para múltiples ofertas

El pipeline captura señales que hoy se usan para scoring digital, pero que también clasifican otros tipos de oportunidades comerciales:

| Señal (tag) | Oferta primaria | También indica |
|-------------|----------------|----------------|
| `no-website` | Web desde cero | Software sin punto de entrada digital |
| `domain-old-stale` | Rediseño web | Negocio establecido, posible presupuesto |
| `not-responsive` | Rediseño responsive | 70% visitas mobile sin conversión |
| `web-only-no-social` | Redes sociales | Community management |
| `ig-confirmed` / `fb-confirmed` sin web | Web + integración social | Marketing integrado |
| `hours-missing-on-web` | SEO local | Gestión de perfil Google |
| `operational_systems` (PedidosYa, etc.) | — | Ya digitalizó → receptivo a más software |
| `pixel-missing` | Marketing digital | Sin tracking = sin datos de conversión |
| `analytics-missing` | Marketing digital | Sin métricas de visitas |
| `chat-widget-missing` | Conversión web | Sin canal de contacto directo en web |
| `alternative-phone-found` | Contactabilidad | Múltiples canales disponibles |
| `ecommerce_platforms` | E-commerce | Detección de MercadoPago, Stripe, Shopify, WooCommerce, Tienda Nube |
| `whatsapp_web_link` | WhatsApp Business | Links wa.me / api.whatsapp.com en HTML (complementa parser de teléfono) |
| `franchise-detected` | Clasificación | Cadena/franquicia — mal prospecto para agencias. Vía lista `franchise_names` en system_lists o heurístico (mismo nombre en 3+ direcciones distintas). |

---

## Arquitectura multi-source (Fases 1–4 completas)

> Fases 1–4 implementadas. Ver FUTURE.md para lo que resta (Fase 5+).
> Los tipos base, el provider adapter, la migración DB y las funciones de confidence están activos.

### Modelo Evidence-Based Data

Cada campo clave pasa de valor escalar a conjunto de evidencias con origen y confianza:

```typescript
// Un campo puede tener múltiples candidatos de múltiples fuentes
email_evidences: [
  {
    value: "hola@restaurante.com",
    sources: ["google_places", "yelu", "mintur"],  // corroborado en 3 fuentes
    first_seen: "2026-03-01",
    last_seen: "2026-05-13",
    confidence: 0.94
  },
  {
    value: "contacto@restaurante.com",  // candidato alternativo — dato más viejo
    sources: ["pedidosya"],
    first_seen: "2024-01-15",
    last_seen: "2024-06-20",
    confidence: 0.41
  }
]
```

### Tipos base implementados (`shared/types.ts`)

| Tipo | Descripción |
|------|-------------|
| `DiscoverySource` | Union de 8 fuentes: google_places, mintur, pedidosya, imm_habilitaciones, yelu, osm, infonegocios, dgi |
| `DiscoveryQuery` | `{ niche, location, maxResults? }` — parámetros agnósticos de fuente |
| `DiscoveryCandidate` | Candidato normalizado: source, external_id, source_confidence, name, address, phone, website, email, lat, lng, niche, raw |
| `IDiscoveryProvider` | `source`, `sourceConfidence`, `discover(query): Promise<DiscoveryCandidate[]>` |
| `CorroboratingSource` | `{ source, external_id?, seen_at, confidence }` |
| `FieldEvidence` | `{ value, sources: CorroboratingSource[], first_seen, last_seen, confidence }` |
| `LeadCompanyData` | rut, razon_social, nombre_comercial, ciiu, tamano_empresa, registro_mintur, habilitacion_imm, fecha_fundacion |

### Scores del modelo multi-source

| Score | Función | Rango |
|-------|---------|-------|
| `prospect_score` | `scoreLead()` en scoring/index.ts — sin cambios | 0–100 |
| `data_confidence_score` | `calculateDataConfidence()` — coverage × source × corroboración | 0.00–1.00 |
| `contact_reliability_score` | `calculateContactReliability()` — phone + whatsapp + email + alt_phones | 0.00–1.00 |

### Deduplicación cross-source (Fase 5 — implementada)

`src/modules/discovery/deduplication.ts` — funciones puras, sin dependencias externas.

| Función | Descripción |
|---------|-------------|
| `levenshtein(a, b)` | Distancia Wagner-Fischer O(m·n) |
| `normalizeName(name)` | NFD + strip diacríticos + colapso de espacios → string ASCII normalizado |
| `nameSimilarity(a, b)` | `1 - levenshtein(normA, normB) / max(len)` → [0.0, 1.0] |
| `findCrossSourceMatch(candidate, leads, threshold=0.85)` | Retorna el lead existente con mayor similitud de nombre sobre el threshold; excluye self-match (mismo source + external_id); tiebreak por prospect_score |

**Uso esperado (Fase 6+):** antes de insertar un `DiscoveryCandidate` de MINTUR u otra fuente, llamar `findCrossSourceMatch` contra leads existentes. Si retorna un lead → agregar corroborating source en lugar de crear lead nuevo.

### Fuentes planificadas

| Fuente | Tipo | Confianza base | Estado |
|--------|------|---------------|--------|
| Google Places | API oficial | 0.90 | ✅ Activo |
| MINTUR | Dataset oficial UY, actualización diaria, incluye email + GPS | 0.80 | ✅ Activo |
| PedidosYa | Marketplace — confirma delivery activo, Playwright-based, MAX_PAGES=5 | 0.70 | ✅ Activo |
| IMM Habilitaciones | CSV oficial Montevideo | 0.75 | Planificado |
| Yelu | Directorio privado UY, 31k+ listings — scraping HTML, sin GPS ni email en listado | 0.65 | ✅ Activo |
| OSM / Overpass Turbo | Colaborativo, gratuito, GPS nativo, cubre interior | 0.60 | ✅ Activo |
| InfoNegocios | Directorio B2B ejecutivos, decisores | 0.65 | Futuro |
| DGI | RUT + razón social (requiere resolución a nombre comercial) | 0.35 | Futuro |

### Datos de empresa a persistir cuando las fuentes los proveen

Campo `lead_company_data` JSONB en tabla `leads`:
```typescript
{
  rut?: string,
  razon_social?: string,
  nombre_comercial?: string,
  ciiu?: string,              // código actividad económica CIIU4
  tamano_empresa?: string,    // monotributo / pequeña / régimen general
  registro_mintur?: string,
  habilitacion_imm?: string,
  fecha_fundacion?: string
}
```

### Tres scores del modelo completo

| Score | Mide | Rango |
|-------|------|-------|
| `prospect_score` | Oportunidad comercial — sin cambios al modelo actual | 0–100 |
| `data_confidence_score` | Calidad y cobertura de datos (cobertura × fuente × corroboración) | 0.0–1.0 |
| `contact_reliability_score` | Confiabilidad del canal de contacto específico | 0.0–1.0 |

### Nuevas tablas — migración 009

```sql
-- Una fila por (lead × source)
lead_source_references(lead_id, source, external_id, source_confidence, raw_data, seen_at)

-- Una fila por (lead × field × value) — el corazón del modelo de evidencias
lead_field_evidences(lead_id, field_name, value, sources[], confidence, first_seen, last_seen)
```

**Campos nuevos en `leads`:**
```sql
source                  TEXT DEFAULT 'google_places'
external_id             TEXT        -- place_id migra acá para Google
source_confidence       NUMERIC(3,2)
source_data             JSONB       -- reemplaza semánticamente google_data
data_confidence_score   NUMERIC(3,2)
contact_reliability_score NUMERIC(3,2)
canonical_fields        JSONB       -- valores ganadores por campo
corroborating_sources   JSONB DEFAULT '[]'
lead_company_data       JSONB
```

**Nueva constraint de identidad:**
```sql
UNIQUE INDEX leads_source_external_id_uniq ON leads(source, external_id)
WHERE external_id IS NOT NULL
```
`place_id` UNIQUE se mantiene para backward compat — no se elimina.
