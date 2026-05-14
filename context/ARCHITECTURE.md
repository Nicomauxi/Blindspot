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
- **Tests:** Vitest — 659 passing, 7 skipped, 61 files
- **Dev:** tsx/esm
- **Config:** YAML en `config/` — fuente de verdad para parámetros de discovery y scoring
- **Repo:** https://github.com/Nicomauxi/Blindspot

---

## Pipeline

```
discover → enrich (--with-heuristic) → score → social-enrich → re-score
```

### Comandos CLI disponibles

```
blindspot discover-google-places --niche <text> --location <text> --profile <a|b|c|d> [--max-results N]
blindspot discover-mintur   --location <text> [--niche <text>] [--limit N] [--dry-run]
blindspot enrich            --run <uuid> [--force-refresh] [--with-heuristic]
blindspot score             [--run <uuid> | --all]
blindspot social-enrich     [--run <uuid> | --all] [--limit N] [--force]
blindspot report            --run <uuid> [--format csv|html|md|all]
blindspot leads list        [--run <uuid>] [--passed-only] [--seen-in <uuid>]
blindspot vocabulary        rebuild [--niche <name> | --all]
blindspot heuristic-refresh [--run <uuid> | --all] [--force]
blindspot run               --niche <text> --location <text> --profile <a|b|c|d|all>
                            [--max-results N] [--ram-mode conservative|auto|manual]
                            [--concurrency N] [--score-threshold N] [--no-social]
                            [--dry-run] [--override key=value]
blindspot maintenance       [--stale-days N] [--niche <text>] [--dry-run]
                            [--ram-mode conservative|auto|manual] [--concurrency N]
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
│       ├── enrich.ts                — enrich + llama retroactiveEmailCleanup post-seed
│       ├── score.ts
│       ├── social-enrich.ts         — Playwright FB/IG
│       ├── report.ts
│       ├── run.ts                   — pipeline completo, RAM-aware concurrency
│       └── maintenance.ts           — stale enrichment detection
│
├── modules/
│   ├── discovery/
│   │   ├── places.ts                — Google Places API (Text Search + Details)
│   │   ├── filters.ts               — applyProfileFilter, tagCandidate
│   │   ├── deduplication.ts         — levenshtein, normalizeName, nameSimilarity, findCrossSourceMatch
│   │   └── providers/
│   │       ├── google-places.ts     — GooglePlacesProvider: IDiscoveryProvider sobre places.ts
│   │       └── mintur.ts            — MINTURProvider: IDiscoveryProvider sobre API CKAN catalogodatos.gub.uy
│   │
│   ├── enrichment/
│   │   ├── index.ts                 — orquestador; exporta MAX_CONTACT_EMAILS = 3
│   │   ├── channel-detection.ts     — detectConfirmedChannels, buildHeuristicMode
│   │   ├── heuristic-discovery.ts   — getHeuristicConfig(), candidatos web/social
│   │   │                              lee config/enrichment.yaml (cacheado)
│   │   ├── directory-discovery.ts   — scraping yelu.uy en enrich-time
│   │   └── parsers/
│   │       ├── email.ts             — extracción y validación emails
│   │       ├── whatsapp.ts          — normalización UY; lee mobile_prefixes_uy
│   │       │                          de getHeuristicConfig() — NO hardcodeado
│   │       ├── ssl.ts
│   │       └── whois.ts             — domain age via WHOIS
│   │
│   ├── scoring/
│   │   ├── index.ts                 — prospect_score + scoring escalonado heuristic
│   │   └── confidence.ts            — calculateDataConfidence(), calculateContactReliability()
│   │
│   └── social-enrich/
│       └── index.ts
│
├── storage/
│   ├── leads.ts                     — upsertLeads, loadAllLeads (paginado PostgREST)
│   │                                  importa MAX_CONTACT_EMAILS desde enrichment/index.ts
│   ├── external-leads.ts            — insertExternalLead, addCorroboratingSource
│   ├── runs.ts                      — createRun, completeRun
│   └── system-lists.ts              — loadAllRuntime, detectAndSeedEmailProviders,
│                                      retroactiveEmailCleanup (corre post-seed)
│
└── shared/
    ├── types.ts                     — tipos globales
    ├── logger.ts                    — pino
    ├── ram.ts                       — RAM-aware concurrency
    └── config/
        ├── discovery.yaml           — perfiles A/B/C/D, mobile_prefixes_uy (fuente canónica)
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

### Nuevas tablas (migración 009)

| Tabla | Descripción |
|-------|-------------|
| `lead_source_references` | Una fila por (lead × fuente). Unique (lead_id, source). |
| `lead_field_evidences` | Una fila por (lead × field × value). Corazón del modelo de evidencias. |

### Tablas de configuración (migración 007)

| Tabla | Contenido |
|-------|-----------|
| system_lists | Todas las listas de negocio — ver sección "Sistema de listas" |
| platform_patterns | 42 filas: delivery, booking, chat_widget, etc. |
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
prospect_score = floor(business_quality_score * digital_gap_score / 100)
```

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
| PedidosYa | Marketplace — confirma negocio operativo | 0.70 | Planificado |
| IMM Habilitaciones | CSV oficial Montevideo | 0.75 | Planificado |
| Yelu | Directorio privado UY, 31k+ listings | 0.65 | Planificado |
| OSM / Overpass Turbo | Colaborativo, gratuito, cubre interior | 0.60 | Planificado |
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
