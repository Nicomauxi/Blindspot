# Blindspot — Future Architecture

> Este archivo define el diseño objetivo del sistema backend (`blindspot`), no el estado actual.
> No documenta código implementado — para eso existe `ARCHITECTURE.md`.
> Su función es servir de norte compartido para que cada fase se construya
> en dirección correcta y los datos recopilados se usen a su máximo potencial.
>
> **Para el diseño del frontend:** ver `ARCHITECTURE_FRONTEND.md` (proyecto separado `blindspot-ui`).
>
> Antes de implementar cualquier fase nueva: leer este archivo para verificar
> que la implementación sea coherente con el diseño objetivo.

---

## Arquitectura de dos proyectos

Este sistema está compuesto por dos proyectos separados:

```
┌─────────────────────────────────┐     REST API      ┌──────────────────────────┐
│  blindspot  (este repo)         │ ◄───────────────► │  blindspot-ui            │
│                                 │                   │                          │
│  • Pipeline CLI                 │                   │  • Next.js 15            │
│  • Scoring engine               │                   │  • Tailwind + shadcn/ui  │
│  • Discovery providers          │                   │  • Zustand               │
│  • Enrichment                   │                   │  • No acceso directo a DB│
│  • API HTTP (Express/Fastify)   │                   │                          │
│  • Cron / scheduler             │                   │  Diseño: ver             │
│  • PostgreSQL (Supabase)        │                   │  ARCHITECTURE_FRONTEND.md│
└─────────────────────────────────┘                   └──────────────────────────┘
```

**Este proyecto (`blindspot`)** es el backend completo: recopila datos, los enriquece, calcula scores, y expone los resultados vía API REST. También corre los procesos programados (cron). Vive en un servidor.

**`blindspot-ui`** es un frontend puro: consume la API, no tiene acceso directo a la DB, no implementa lógica de scoring. Todo el diseño de pantallas, componentes y flujos UX está en `ARCHITECTURE_FRONTEND.md`.

---

## Diseño objetivo — API HTTP (capa nueva en este proyecto)

La API vive en `src/api/` dentro de este repo. Se agrega al mismo proceso que el CLI, o como proceso separado en el mismo servidor.

### Stack recomendado

```typescript
// Fastify — bajo overhead, TypeScript nativo, sin magia
import Fastify from 'fastify'
const app = Fastify({ logger: true })

// Mismo acceso a DB que el CLI (comparten el módulo storage/)
import { getLeads } from './storage/leads.js'
```

### Endpoints que expone este proyecto

```
GET  /api/leads
     ?contact_tier=A,B,C
     &prospect_score_gte=40
     &niche=restaurant
     &urgency_signal=high
     &primary_offer=web_nuevo
     &contacted=false
     &source=google_places,mintur
     &order=prospect_score:desc
     &limit=50&cursor=<id>
     → LeadCard[] paginado (cursor-based)

GET  /api/leads/:id
     → Lead completo con score_breakdown + buyer_type_scores + corroborating_sources

PATCH /api/leads/:id/contact
     body: { contacted_at, channel, notes }

GET  /api/outreach?status=pending,responded
POST /api/outreach  body: { lead_id, channel, offer_type?, offer_text?, offer_source? }
PATCH /api/outreach/:id  body: { status, responded, outcome, ... }
POST /api/outreach/generate-offer  body: { lead_id, offer_type?, channel }

GET  /api/discovery/jobs?status=running,queued
POST /api/discovery/jobs  body: { source, location, niche, profile, max_results, cpu_budget }
PATCH /api/discovery/jobs/:id  body: { action: 'pause'|'resume'|'cancel' }
GET  /api/discovery/suggestions
GET  /api/discovery/coverage

GET  /api/stats/overview
GET  /api/stats/outreach
GET  /api/stats/pipeline
```

### View `lead_dashboard` (materializada en DB)

Desnormaliza todos los campos de `LeadCard` para evitar joins en cada request de la UI:

```sql
CREATE VIEW lead_dashboard AS
SELECT
  l.id, l.name, l.address, l.niche, l.source,
  jsonb_array_length(l.corroborating_sources) AS sources_count,
  l.score_breakdown->>'contact_tier'           AS contact_tier,
  l.canonical_fields->'email'->>'value'        AS contact_email,
  l.canonical_fields->'phone'->>'value'        AS contact_phone,
  l.whatsapp                                   AS contact_whatsapp,
  l.prospect_score,
  l.score_breakdown->'sub_scores'->>'primary_offer'  AS primary_offer,
  l.score_breakdown->>'pitch_hook'             AS pitch_hook,
  l.score_breakdown->>'urgency_signal'         AS urgency_signal,
  l.inferred_state->>'digitalization_level'    AS digitalization_level,
  (l.inferred_state->'has_delivery'->>'value')::boolean   AS has_delivery,
  (l.inferred_state->'has_pos'->>'value')::boolean        AS has_pos,
  (l.inferred_state->'has_reservations'->>'value')::boolean AS has_reservations,
  l.data_confidence_score,
  l.contact_reliability_score,
  l.contacted_at, l.created_at,
  lbs_top.buyer_type AS top_buyer_type,
  lbs_top.score      AS top_buyer_score
FROM leads l
LEFT JOIN LATERAL (
  SELECT buyer_type, score FROM lead_buyer_scores
  WHERE lead_id = l.id ORDER BY score DESC LIMIT 1
) lbs_top ON true
WHERE l.passed_filter = true
  AND l.score_breakdown->>'contact_tier' != 'X';
```

---

## Principio rector

**El sistema tiene un objetivo comercial concreto:**
> Identificar negocios uruguayos contactables con una oferta de servicio específica y cuantificable.

Toda decisión de arquitectura se evalúa contra ese objetivo. Un lead sin forma de contacto no tiene valor, sin importar su score. Una señal que no alimenta una oferta concreta no debería estar en el pipeline.

---

## El problema central que resuelve la arquitectura futura

Hoy el sistema recopila datos de 5 fuentes, calcula scores, pero tiene tres inconsistencias que reducen su utilidad:

1. **Scoring**: `external_source_quality=70` suma puntos al score viejo (`business_quality_score`) que la fórmula actual ignora. Miles de leads de MINTUR, OSM y Yelu tienen score real de 1–18 aunque el sistema "debería" compensarlos.

2. **Contactabilidad**: el sistema trata todos los `passed_filter=true` como leads accionables. La realidad es que el 67% de OSM no tiene forma de contacto. El multiplicador de contactabilidad solo bonifica email (×1.2) pero no penaliza la ausencia de todo contacto.

3. **Cross-source**: el modelo de evidencias (`lead_field_evidences`, `corroborating_sources`) está migrado en DB pero no se alimenta porque `findCrossSourceMatch` no se llama al insertar. Cada fuente crea leads separados en lugar de enriquecer el mismo lead.

---

## Diseño objetivo — scoring

### Fórmula corregida

```
prospect_score = min(100,
  floor(
    (max(sub_scores) + source_quality_bonus(lead))
    × contactability_multiplier(lead)
    × review_multiplier(lead)
  )
  + rating_bonus(lead)
)
```

**Cambios respecto al estado actual:**

#### `source_quality_bonus(lead)` — reemplaza `external_source_quality`

Bonus aditivo que se suma a `max(sub_scores)` antes de los multiplicadores.
Compensa la ausencia de rating/reviews en fuentes externas con datos reales.

| Fuente | Bonus base | Condición |
|--------|-----------|-----------|
| google_places | 0 | siempre |
| mintur | +20 | dataset oficial, confianza 0.80 |
| yelu | +10 | directorio privado, confianza 0.65 |
| osm | +8 | colaborativo, confianza 0.60 |
| pedidosya | +15 | confirma actividad comercial activa |

Razón: si un negocio existe en MINTUR (registro oficial) con phone y niche conocido, eso vale más que zero aunque no tenga rating de Google.

#### `contactability_multiplier(lead)` — reemplaza el binario actual

Hoy: `if (email) ×1.2 else ×1.0` — el teléfono no cuenta.

Diseño objetivo:

| Canal disponible | Multiplicador | Razón |
|-----------------|--------------|-------|
| email verificado | ×1.3 | outreach async inmediato, escalable |
| whatsapp confirmado | ×1.2 | directo al dueño, alta respuesta UY |
| email + whatsapp | ×1.4 (cap) | multicanal |
| phone solamente | ×1.0 | requiere llamada, accionable |
| sin ningún contacto | ×0.5 | penalización explícita |

Razón: un lead sin contacto no es un lead, es un dato. El multiplicador debe reflejar esto, no tratarlo igual que uno con teléfono.

#### `contact_reliability_score` → entra en la fórmula

Hoy se calcula y se persiste pero no se usa. En el diseño objetivo:

```
contactability_multiplier(lead) *= (0.7 + 0.3 × contact_reliability_score)
```

Efecto: un lead con email verificado en 3 fuentes (reliability=0.9) multiplica ×1.3 × 0.97 ≈ ×1.26. Uno con email de baja confianza (reliability=0.3) multiplica ×1.3 × 0.79 ≈ ×1.03. La diferencia es real.

### Sub-scores — completar el modelo

Los sub-scores actuales funcionan bien para Google Places (tiene señales digitales) pero colapsan para fuentes externas (sin URL que analizar). Diseño objetivo:

| Sub-score | Estado actual | Diseño objetivo |
|-----------|--------------|----------------|
| web_nuevo | Bien definido | Mantener |
| rediseno | Bien definido | Mantener |
| marketing | Bien definido | Mantener |
| software | Bien definido | Mantener |
| catalogo | Bien definido | Mantener |
| **contacto_directo** | **No existe** | **Agregar** |

**`contacto_directo` (nuevo):** sub-score para leads con buena información de contacto pero sin señales digitales analizables. Señales: tiene phone verificado + niche con alta probabilidad de gap + no en ninguna plataforma digital conocida. Cap: 40. Este sub-score evita que fuentes como MINTUR y Yelu (que tienen phone pero no web) colapsen a 0.

---

## Diseño objetivo — contactabilidad honesta

### Tiers de contacto

Cada lead en el sistema debe tener un `contact_tier` explícito. Este campo es la señal más honesta sobre el valor inmediato del lead.

| Tier | Criterio | Acción posible |
|------|---------|---------------|
| **A — Digital** | email verificado | Secuencia de email automatizable |
| **B — Directo** | whatsapp confirmado | Mensaje directo, alta tasa respuesta UY |
| **C — Telefónico** | phone solamente | Llamada en frío, requiere tiempo humano |
| **D — Presencial** | solo address | Visita física — no escala |
| **X — Incontactable** | nada | Excluir de reportes de ventas |

El `contact_tier` se deriva en scoring/index.ts y se persiste en `score_breakdown.contact_tier`.

### Distribución real de contactabilidad (snapshot 2026-05-15)

| Fuente | A (email) | B (WA) | C (phone) | D/X (nada) | Total |
|--------|-----------|--------|-----------|------------|-------|
| google_places | 19 | 66 | 99 | 7 | 191 |
| mintur | 89 | 212 | 1.645 | 157 | 2.027 |
| osm | 58 | 56 | 131 | **414 (67%)** | 659 |
| yelu | 30 | 29 | 610 | 33 | 702 |

**Implicación:** el pool real accionable hoy es ~2.900 leads (tiers A+B+C). Los 414 OSM sin contacto y los 157 MINTUR sin contacto son datos para investigación, no leads para ventas.

---

## Diseño objetivo — pitch generation

### El pitch no es el score, es la intersección de tres señales

```
pitch = f(primary_offer, inferred_state, contact_tier)
```

Un lead con `primary_offer = "software"` pero `inferred_state.has_pos = true` no necesita un POS. El pitch correcto es el siguiente nivel (CRM, analytics, integración). El sistema debe computar esto explícitamente.

### Mapa oferta → pitch concreto

| primary_offer | inferred_state override | Pitch resultante | Buyer type |
|--------------|------------------------|-----------------|------------|
| web_nuevo | — | "No tienen web, están perdiendo clientes que buscan online" | agencia_web |
| web_nuevo | has_delivery=true | "Están pagando 30% a PedidosYa — con su propia web de pedidos, recuperan ese margen" | delivery_propio |
| rediseno | — | "Su web existe pero no convierte — responsive + SEO moderno" | agencia_web |
| marketing | — | "Tienen web pero no redes activas — community management" | marketing_social |
| software | has_delivery=false | "Sin sistema de pedidos propio — están atados a comisiones" | delivery_propio |
| software | has_delivery=true, has_pos=false | "Ya tienen delivery, les falta el sistema de gestión central" | software_pos |
| catalogo | niche=restaurant | "Sin carta digital — el 70% de sus clientes la busca antes de ir" | catalogo_digital |
| — | has_reservations=false, niche=gym | "Sin sistema de reservas — pierden alumnos que no saben cómo agendar" | reservas_online |

Este mapa debe vivir en `config/scoring.yaml` como `pitch_hooks`, no en código. El campo `score_breakdown.pitch_hook` persiste el hook seleccionado para que la UI lo muestre al agente de ventas.

### Urgency como priorización de outreach

`urgency_signal` no cambia el score pero define el orden de contacto:

| Signal | Criterio real | Acción |
|--------|--------------|--------|
| high | web ≤ 2020 OR zona turística activa | Contactar esta semana |
| medium | lead < 90 días OR reviews recientes | Contactar este mes |
| low | default | Contactar cuando convenga |

---

## Diseño objetivo — cross-source como motor de confianza

### Flujo de inserción correcto (hoy roto, diseño a implementar)

```
DiscoveryCandidate nuevo
  ↓
findCrossSourceMatch(candidate, existingLeads, threshold=0.85)
  ↓
  ┌─── Match encontrado ───────────────────────────────┐
  │   addCorroboratingSource(existingLead, candidate)  │
  │   reconcileCanonicalFields(existingLead)           │
  │   recalculateDataConfidence(existingLead)          │
  │   → NO insertar lead nuevo                        │
  └───────────────────────────────────────────────────┘
  ↓
  Sin match → insertExternalLead(candidate) como nuevo
```

**Efecto buscado:** un restaurant que aparece en Google Places + MINTUR + Yelu debe ser UN lead con `corroborating_sources` de 3 entradas y `data_confidence_score` alto, no 3 leads separados. Hoy los 3 leads existen por separado.

### `canonical_fields` — el registro ganador por campo

Cuando un lead tiene múltiples fuentes, `canonical_fields` debe ser el resultado de resolver conflictos:

```json
{
  "phone": {
    "value": "+59899123456",
    "confidence": 0.95,
    "sources": ["google_places", "mintur"],
    "conflict": false
  },
  "email": {
    "value": "hola@restaurante.com",
    "confidence": 0.72,
    "sources": ["yelu"],
    "conflict": false
  },
  "website": {
    "value": "restaurante.com.uy",
    "confidence": 0.90,
    "sources": ["google_places"],
    "conflict": false
  }
}
```

**Reglas de resolución:**
- Mismo valor en 2+ fuentes → `confidence += 0.15` por fuente adicional, cap 0.95
- Valores distintos en 2+ fuentes → `conflict: true`, mantener el de mayor confianza, tag `phone-conflict` o `email-conflict`
- Solo en 1 fuente → `confidence = source_confidence × field_detection_confidence`

---

## Diseño objetivo — pipeline de datos

### Flujo completo con todos los datos usados

```
[Discovery]
  Fuente → DiscoveryCandidate normalizado
       ↓
  findCrossSourceMatch
       ↓ (sin match)
  insertExternalLead → lead con source, external_id, source_confidence

[Enrich]
  digital_footprint: {
    website, contact_emails, contact_phones, whatsapp,
    heuristic_discovery, social_channels,
    operational_systems (delivery, booking, ecommerce, pos, chat),
    ssl, domain_age, responsive, copyright_year,
    inferred_state: { has_delivery, has_pos, has_reservations,
                      has_ecommerce, has_online_catalog, has_chat_support,
                      digitalization_level }
  }
       ↓
  contact_reliability_score ← f(email_mx_valid, email_type, phone_confirmed, sources_count)
  data_confidence_score ← f(coverage, source_confidence, corroboration)

[Score]
  sub_scores ← f(tags, digital_footprint, inferred_state)
  source_quality_bonus ← f(source)
  contactability_multiplier ← f(contact_tier, contact_reliability_score)
  review_multiplier ← f(review_count)
  rating_bonus ← f(rating)
  prospect_score ← fórmula corregida
       ↓
  contact_tier ← derivado de canales disponibles
  primary_offer ← argmax(sub_scores)
  pitch_hook ← f(primary_offer, inferred_state, niche)
  urgency_signal ← f(copyright_year, created_at, review_recency, niche, zona)
  buyer_type_scores ← f(sub_scores, inferred_state, niche)
       ↓
  score_breakdown: {
    sub_scores, primary_offer, pitch_hook,
    urgency_signal, contact_tier,
    source_quality_bonus, contactability_multiplier,
    review_multiplier, rating_bonus
  }
```

### Qué hace cada dato en el resultado final

| Dato | De dónde viene | Alimenta |
|------|---------------|---------|
| rating, review_count | Google Places | review_multiplier, rating_bonus, sub_scores |
| phone, whatsapp | Todas las fuentes | contact_tier, contactability_multiplier |
| email | Enrich heurístico, fuentes | contact_tier, contactability_multiplier |
| email_type (generic/personal) | Parser email-quality (Fase 15) | contact_reliability_score |
| mx_valid | DNS check (Fase 15) | contact_reliability_score |
| tags (no-website, ssl-missing, etc.) | Enrich + heurístico | sub_scores |
| inferred_state | Enrich (inferred-state.ts) | sub_scores penalties, buyer_types, pitch_hook |
| source | Discovery | source_quality_bonus, contact_tier weight |
| corroborating_sources | Cross-source dedup | data_confidence_score, contact_reliability_score |
| copyright_year | Parser | urgency_signal (high si ≤ 2020) |
| niche + zona turística | Discovery + geo | urgency_signal, buyer_type eligibility |
| digitalization_level | inferred_state | pitch_hook redirection |

---

## Diseño objetivo — passed_filter semántico

Hoy `passed_filter=true` significa cosas diferentes según la fuente:
- Google Places: pasó filtro de calidad (rating, reviews, perfil)
- Externas: existe en el directorio

Diseño objetivo: agregar `contact_ready: boolean` como campo derivado.

```
contact_ready = (contact_tier IN ('A', 'B', 'C'))
             AND (prospect_score >= 30 OR buyer_type_score_max >= 50)
             AND NOT franchise_detected
```

Este campo es el filtro real para reportes de ventas. `passed_filter` se mantiene para compatibilidad.

---

## Diseño objetivo — inferred_state como columna propia

Hoy: `digital_footprint->'inferred_state'` — JSONB anidado, sin índice.

Diseño objetivo: columna propia `inferred_state jsonb` en `leads`.

```sql
ALTER TABLE leads ADD COLUMN inferred_state jsonb;
-- Migración: UPDATE leads SET inferred_state = digital_footprint->'inferred_state'
--            WHERE digital_footprint->'inferred_state' IS NOT NULL;
-- Después: eliminar de digital_footprint (un UPDATE por lote).
```

Razón: la UI filtrará por `digitalization_level`, `has_delivery`, `has_pos`, etc. Sin columna propia, cada query requiere JSON parsing completo. Con columna propia se puede indexar:
```sql
CREATE INDEX leads_digitalization_level ON leads ((inferred_state->>'digitalization_level'));
CREATE INDEX leads_has_delivery ON leads ((inferred_state->'has_delivery'->>'value'));
```

---

## Fases pendientes ordenadas por impacto

Las fases del FUTURE.md, reordenadas según impacto en el objetivo comercial:

| Prioridad | Fase | Descripción | Desbloquea |
|-----------|------|-------------|-----------|
| **1** | Fix scoring formula | `source_quality_bonus` en fórmula, `contactability_multiplier` multifactor | Scores reales para 3.000+ leads externos |
| **2** | Fase 6 — cross-source dedup activo | Llamar `findCrossSourceMatch` al insertar | Modelo de evidencias activo, `data_confidence` real |
| **3** | `contact_tier` + `pitch_hook` en score_breakdown | Derivar y persistir en scoring/index.ts | UI puede filtrar por contactabilidad y pitch |
| **4** | Fase 15 — email quality | Parser personal/generic/role + MX check | `contact_reliability_score` real, no estimado |
| **5** | `inferred_state` → columna propia | Migración + actualizar accesos | Queries e índices eficientes en UI |
| **6** | Fase 13 — PedidosYa escape | `commission_estimate` en buyer_type delivery_propio | Pitch cuantificado (ahorro en comisiones) |
| **7** | Fase 11 — IMM Habilitaciones | CSV Montevideo → teléfonos para MINTUR | Desbloquea 1.600 leads MINTUR hoy inaccionables |
| **8** | Fase 18 — cruce MINTUR × IMM | Join por nombre+dirección | 1.600 leads MINTUR pasan de tier X a tier C |
| **9** | `contact_ready` field | Derivar en scoring, persistir | Filtro de ventas honesto |
| **10** | UI web — primera versión | Lista de leads filtrable por tier + pitch | Producto usable |

---

## Contrato de datos para la UI

Cuando se construya la UI, cada lead debe exponer este conjunto mínimo sin joins:

```typescript
interface LeadCard {
  // Identidad
  id: string
  name: string
  address: string
  niche: string
  source: string
  corroborating_sources_count: number   // cuántas fuentes confirman

  // Contacto — honesto
  contact_tier: 'A' | 'B' | 'C' | 'D' | 'X'
  contact_email?: string                // canonical_fields.email.value
  contact_phone?: string                // canonical_fields.phone.value
  contact_whatsapp?: string

  // Score y oferta
  prospect_score: number
  primary_offer: string                 // 'web_nuevo' | 'rediseno' | 'marketing' | 'software' | 'catalogo'
  pitch_hook: string                    // texto concreto del pitch
  urgency_signal: 'high' | 'medium' | 'low'
  buyer_type_scores: BuyerTypeScore[]   // top 3

  // Estado operativo
  digitalization_level: 'none' | 'basic' | 'intermediate' | 'advanced'
  has_delivery: boolean
  has_pos: boolean
  has_reservations: boolean

  // Confianza en los datos
  data_confidence_score: number         // 0.0–1.0
  contact_reliability_score: number     // 0.0–1.0

  // Meta
  contact_ready: boolean
  contacted_at?: string
}
```

Todo esto debe estar disponible en `leads` sin tocar tablas auxiliares para que la UI pueda paginar y filtrar eficientemente.

---

## Invariantes de calidad del sistema

Estos invariantes deben verificarse al inicio de cada sesión. Si alguno falla, resolverlo antes de continuar.

```sql
-- 1. Leads passed sin enrich (siempre debe ser 0)
SELECT COUNT(*) FROM leads WHERE passed_filter = true AND digital_footprint IS NULL;

-- 2. Tags contradictorios (siempre debe ser 0)
SELECT COUNT(*) FROM leads WHERE 'no-website' = ANY(tags) AND 'website-heuristic' = ANY(tags) AND passed_filter = true;

-- 3. email-found sin datos (siempre debe ser 0)
SELECT COUNT(*) FROM leads WHERE 'email-found' = ANY(tags)
  AND (digital_footprint->>'contact_emails' = '[]' OR digital_footprint->>'contact_emails' IS NULL)
  AND passed_filter = true;

-- 4. Leads passed sin score (siempre debe ser 0)
SELECT COUNT(*) FROM leads WHERE passed_filter = true AND prospect_score IS NULL;

-- 5. Leads con contact_tier X pero prospect_score >= 50 (señal de scoring roto)
-- Diseño futuro: SELECT COUNT(*) FROM leads WHERE score_breakdown->>'contact_tier' = 'X' AND prospect_score >= 50;

-- 6. Leads sin buyer_type_scores (debe ser 0 post Fase 12)
SELECT COUNT(DISTINCT l.id) FROM leads l
LEFT JOIN lead_buyer_scores lbs ON lbs.lead_id = l.id
WHERE l.passed_filter = true AND lbs.lead_id IS NULL;
```

---

## Decisiones de diseño fijas (no cambiar sin análisis)

| Decisión | Razón |
|----------|-------|
| `prospect_score` 0–100, no categorías | Permite ordenar y filtrar. Las categorías (hot/pitcheable) son thresholds sobre el número, no valores distintos |
| `sub_scores` = max determina el score, no suma | Un lead excelente para una sola oferta es más valioso que uno mediocre para todas |
| No penalizar score de leads sin email si tienen phone | La penalización es ×0.5 solo si no hay ningún canal, no por ausencia de email específicamente |
| `franchise-detected` no pasa a reportes de ventas | Una franquicia tiene decisores centrales, no locales. El pitch local no funciona |
| Datos de empresa (`lead_company_data`) en `leads`, no tabla separada | Denormalization intencional — la UI necesita esto sin join para cada card |
| `inferred_state` migrar a columna propia (pendiente) | Indexabilidad para queries de UI. El costo de migración es bajo, el beneficio es alto |

---

## Análisis crítico del scoring actual — problemas concretos con datos

> Snapshot 2026-05-16. Referencia para justificar el rediseño de la fórmula.

### Problema 1 — Leads incontactables llegan a hot

Los 65 hot leads de restaurant incluyen leads OSM con `contact_tier=X` (sin email, phone ni whatsapp) con score=75. El multiplicador actual para tier X es ×1.0 — mismo que un lead con phone. Un lead incontactable con score 75 ocupa el mismo lugar en la lista que uno contactable con score 74. El sistema dice "caliente" pero el agente de ventas no puede hacer nada con él.

**Causa:** `contactabilityMultiplier` solo bonifica email (×1.2), no penaliza ausencia total de contacto.

**Evidencia:**
```
"Comidas al Paso M y N" · OSM · score=75 · contact=none
"Abril"                 · OSM · score=75 · contact=none
"Coco Grill Cerro Pelado" · OSM · score=75 · contact=none
```

### Problema 2 — Corroboration baja el score (invertido)

Leads con 1+ fuente corroborante tienen avg_score=10.7 vs 13.6 sin corroboración. Debería ser al revés: más fuentes = más confianza = más valor. La causa es que los leads con corroboración son generalmente negocios establecidos que ya tienen algo digital (de ahí que aparecen en múltiples fuentes), lo que reduce su gap digital y por tanto su score. El sistema equipara "menor gap digital" con "menor valor comercial", ignorando que esos negocios tienen más probabilidad de pagar por servicios.

**Propuesta:** `data_confidence_score` alto debe bonificar el score, no ignorarse. Un lead confirmado en 2 fuentes es más confiable y por tanto más valioso para outreach.

### Problema 3 — Niche "other" tiene 2034 leads invisibles

2034 leads (59% del total passed), avg rating 4.57, avg reviews 225, zero hot. Son negocios con excelente reputación offline — probablemente ferreterías, veterinarias, estudios contables, ópticas. El sistema no tiene sub-score logic para "other": sin niche específico, los bonuses de catalogo y software no aplican. Resultado: negocios con presupuesto real son ignorados.

**Propuesta:** definir sub-nichos dentro de "other" o crear señales genéricas que apliquen a cualquier niche con rating alto + reviews.

### Problema 4 — Franquicias puntúan más alto que negocios independientes

Avg score franquicias: 17.4. Avg score no-franquicias: 13.2. Las franquicias tienen grandes gaps digitales (muchas no tienen web local) pero son invendibles localmente porque el dueño de la decisión está en casa central. El scoring las premia cuando debería ignorarlas desde el inicio.

**Propuesta:** aplicar `franchise-detected` como filtro en scoring (score=0) o al menos excluirlas del multiplicador review/rating.

### Problema 5 — Calidad del negocio (capacidad de pago) no entra en la fórmula

Car dealers tienen avg reviews=312, avg rating=4.60, avg score=30.8. Son los mejores negocios del dataset — establecidos, con facturación, con presupuesto — pero score promedio de 30.8. Hairdressers con avg rating=4.70 y avg reviews=167 también son ignorados. El sistema premia el gap digital pero ignora si el negocio puede pagar por cubrirlo.

**Propuesta:** `business_quality_score` debe tener un componente aditivo explícito en la fórmula.

### Problema 6 — max(sub_scores) ignora leads multi-oferta

Un lead con web_nuevo=40, marketing=38, software=35 es más valioso que uno con web_nuevo=55, otros=0. El primero puede convertirse en cliente de múltiples servicios, LTV más alto. El segundo es un deal de una sola oferta. La fórmula max() trata ambos igual en el segundo caso y peor al primero.

---

## Diseño objetivo — fórmula de scoring comercial (v2)

### Principio de la nueva fórmula

```
commercial_score = valor_del_gap × capacidad_del_negocio × accesibilidad × timing
```

Cada dimensión es independiente y cuantificable. Un score alto requiere las cuatro — no puede compensarse entre dimensiones (un negocio incontactable no puede ser "hot" aunque tenga el gap más grande del mundo).

### Fórmula completa

```
commercial_score = min(100,
  floor(
    (gap_depth + commercial_breadth + business_quality_pts)
    × accessibility_factor
    × timing_factor
  )
  + urgency_bonus
)
```

### Componente 1 — `gap_depth` (0–60)

Lo que podemos vender. Cap en 60 para que ninguna dimensión aislada llegue a hot.

```
gap_depth = min(60, max(sub_scores) + source_quality_bonus)
```

`source_quality_bonus`: mintur=+20, pedidosya=+15, yelu=+10, osm=+8, google_places=0.

### Componente 2 — `commercial_breadth` (0–12)

Bonus por leads con múltiples oportunidades vendibles. Premia LTV potencial.

```
sorted_subs = sub_scores ordenados DESC
commercial_breadth = 0
si sorted_subs[1] >= 30: commercial_breadth += 8   // segunda oferta fuerte
si sorted_subs[2] >= 30: commercial_breadth += 4   // tercera oferta fuerte
```

Un lead con una sola oferta fuerte (web_nuevo=55, resto=0) → breadth=0.
Un lead con tres ofertas (web=45, mkt=38, sw=35) → breadth=12.

### Componente 3 — `business_quality_pts` (0–15)

Capacidad de pago y confiabilidad del dato. Si el negocio no puede pagar, el gap no importa.

```
pts = 0
rating 4.0–4.39:  pts += 3
rating 4.4–4.89:  pts += 6
rating ≥ 4.9:     pts += 8
review_count 10–50:   pts += 1
review_count 51–200:  pts += 3
review_count 201+:    pts += 5
data_confidence ≥ 0.7: pts += 2
corroborating_sources ≥ 2: pts += 2   // negocio verificado en 2+ fuentes
cap: 15
```

Car dealer con rating 4.6 + 312 reviews + 2 fuentes: 6+5+2+2 = 15/15.
Restaurant OSM sin rating ni reviews: 0/15.

### Componente 4 — `accessibility_factor` (0.3–1.4)

Penalización dura por inaccesibilidad. La clave: tier X nunca llega a hot.

```
base_mult:
  X (sin contacto): 0.30
  D (solo dirección): 0.65
  C (phone):         0.90
  B (whatsapp):      1.15
  A (email):         1.30
  A+B combinado:     1.40 (cap)

ajuste por calidad:
  × (0.75 + 0.25 × contact_reliability_score)
```

Con base X=0.30 y quality ajuste máximo (×1.0): 0.30. La suma gap+breadth+quality = 60+12+15=87. 87×0.30=26. Un lead tier X nunca supera 26, muy por debajo de hot (50).

### Componente 5 — `timing_factor` (0.85–1.20)

Si el momento es bueno, el mismo lead vale más. No compensa mala accesibilidad.

```
factor = 1.0
urgency = high:               + 0.15
new_business_window (< 12m):  + 0.05
competitive_pressure isolated: + 0.05
franchise_detected:            - 0.15  // penaliza antes de llegar al accessibility
cap: 1.20, floor: 0.85
```

### `urgency_bonus` (0–5)

Bonus aditivo post-multiplicadores. Pequeño — no puede hacer hot a un lead que no lo es.

```
high:   +5
medium: +2
low:    0
```

### Thresholds con la nueva fórmula

| Threshold | Score | Significado real |
|-----------|-------|-----------------|
| Hot | ≥ 55 | Gap real + negocio con capacidad + contactable |
| Pitcheable | ≥ 40 | Contactable con oferta clara aunque negocio pequeño |
| Pool | ≥ 25 | Investigar más antes de contactar |
| Descartar | < 25 | Tier X o sin señal real de gap |

### Efecto esperado en datos actuales

| Lead tipo | Score actual | Score nuevo | Cambio |
|-----------|-------------|-------------|--------|
| OSM restaurant sin contacto (75 ahora) | 75 | ~20 | ✅ Correcto — incontactable |
| OSM restaurant con WA + catalog gap | 75 | ~58 | ✅ Hot real |
| Google Places restaurant 4.5⭐ 80 reviews email | ~55 | ~72 | ✅ Sube — negocio con capacidad |
| Car dealer 4.6⭐ 312 reviews phone | ~31 | ~52 | ✅ Hot real — establecido |
| MINTUR con phone + email | ~18 | ~45 | ✅ Ahora pitcheable |
| Franquicia (cualquiera) | ~17 | < 15 | ✅ Desaparece del radar |

### Migración de scoring.yaml para v2

```yaml
# Reemplaza prospect_formula existente
prospect_formula: "commercial_score_v2"

commercial_score:
  gap_depth_cap: 60
  commercial_breadth:
    secondary_threshold: 30
    secondary_bonus: 8
    tertiary_threshold: 30
    tertiary_bonus: 4
  business_quality:
    rating_tiers: [[4.0, 4.4, 3], [4.4, 4.9, 6], [4.9, 5.0, 8]]
    review_tiers: [[10, 50, 1], [51, 200, 3], [201, null, 5]]
    data_confidence_bonus: 2      # si data_confidence >= 0.7
    corroboration_bonus: 2        # si corroborating_sources >= 2
    cap: 15
  accessibility:
    tier_base: { X: 0.30, D: 0.65, C: 0.90, B: 1.15, A: 1.30 }
    ab_combined_cap: 1.40
    reliability_adjustment: { base: 0.75, weight: 0.25 }
  timing:
    urgency_high: 0.15
    new_business_window: 0.05
    competitive_pressure_isolated: 0.05
    franchise_penalty: -0.15
    cap: 1.20
    floor: 0.85
  urgency_bonus: { high: 5, medium: 2, low: 0 }

thresholds:
  hot: 55
  pitcheable: 40
  pool: 25
```

---

## Diseño — Pipeline de contacto automatizado

### Principio

Después de identificar un lead como pitcheable, el sistema debe generar automáticamente el material de outreach personalizado sin intervención manual. El agente de ventas aprueba, ajusta si quiere, y envía. No escribe desde cero.

### Flujo de la pipeline de contacto

```
Lead pitcheable (score >= 40, contact_tier A/B/C)
  │
  ▼
[1] QUALIFY
  Verificar criterios de entrada al pipeline:
  • contact_tier IN (A, B, C)
  • prospect_score >= umbral configurable (default: 40)
  • NOT franchise-detected
  • NOT contacted_at IS NOT NULL (no contactado antes)
  • Buyer type score más alto >= 50 (tiene oferta concreta)
  │
  ▼
[2] GENERATE OFFER
  offer_generator(lead): OfferPackage
  Inputs:
    • primary_offer + pitch_hook
    • buyer_type_scores (top 2)
    • inferred_state (lo que ya tiene)
    • contact_tier + canal preferido
    • niche + urgency_signal
    • commission_estimate (si delivery_propio)
    • business_quality_pts (para tono del pitch)
  
  Outputs:
    • subject_line: string             (asunto email / primer mensaje WA)
    • opening_hook: string             (frase de apertura personalizada)
    • gap_description: string          (qué problema tiene el negocio)
    • solution_proposal: string        (qué se ofrece)
    • value_quantification: string     (el número concreto: ahorro, ROI)
    • call_to_action: string           (qué queremos que haga)
    • channel_variant: 'email'|'whatsapp'|'phone_script'
  │
  ▼
[3] REVIEW (humano)
  UI muestra la oferta generada para revisión:
  • "Aprobar y enviar"
  • "Editar texto" (inline)
  • "Cambiar oferta" (seleccionar otra)
  • "Descartar este lead"
  │
  ▼
[4] SEND (manual o semi-auto)
  Primera versión: copiar al portapapeles / abrir Gmail / abrir WA Web
  Segunda versión: integración directa WA Business API / Resend (email)
  
  Al enviar: SET contacted_at = NOW(), SET outreach_channel = canal
  │
  ▼
[5] TRACK
  Estado del lead en pipeline:
  'pending' → 'contacted' → 'responded' → 'interested' → 'closed_won' | 'closed_lost'
  
  Follow-up automático: si no responde en N días → reminder en UI
  │
  ▼
[6] FEEDBACK LOOP
  Si cierra → señales del lead entran como datos de éxito
  Si rechaza → tag 'pitch-rejected-{tipo}' para mejorar scoring
```

### Estructura del OfferPackage por tipo de oferta

**Template web_nuevo (sin web)**
```
subject_line:  "{name} — ¿Sabías que el {X}% de tus clientes te busca en Google antes de ir?"
opening_hook:  "Hola, te escribo porque vi que {name} tiene muy buenas reseñas pero no encontré
               su sitio web. Con {review_count} opiniones, claramente hacen las cosas bien."
gap:           "Hoy los clientes buscan en Google, ven que no hay web y eligen otro lugar."
solution:      "Web profesional con ficha de Google optimizada, menú/catálogo y WhatsApp integrado."
value:         "Un restaurante como el tuyo recupera en promedio 15-20% más de consultas en
               el primer mes con web propia."
cta:           "¿Tienen 15 minutos para que les muestre un ejemplo en su rubro?"
wa_variant:    "Hola! Vi {name} en Google y tienen muy buenas reseñas 👏 Notamos que no
               tienen web propia — preparé algo corto para mostrarles. ¿Les interesa verlo?"
```

**Template delivery_propio (PedidosYa escape)**
```
subject_line:  "{name} — Cuánto están pagando a PedidosYa por mes"
opening_hook:  "Hola, trabajo con restaurantes que venden por delivery y calculé cuánto
               puede costar PedidosYa a un negocio como {name}."
gap:           "Con ~{monthly_orders_est} pedidos mensuales y 30% de comisión, la plataforma
               se lleva ~${commission_monthly_uyu} UYU/mes."
solution:      "Sistema de pedidos propio: los clientes piden directo en su web o WhatsApp.
               Sin comisiones."
value:         "El sistema cuesta ${system_cost} UYU/mes. El ahorro neto desde el primer
               mes: ~${monthly_savings_est} UYU."
cta:           "¿Les interesa ver cómo funciona para restaurantes en Montevideo?"
```

**Template software (sin reservas) — gym/hairdresser**
```
subject_line:  "{name} — {X} clientes no pudieron reservar turno este mes"
opening_hook:  "Hola, noté que {name} no tiene sistema de reservas online."
gap:           "En {niche}, el 40% de los clientes nuevos elige el lugar que les permite
               reservar desde el celular. Sin reservas online, ese porcentaje elige otro."
solution:      "Sistema de turnos online con confirmación por WhatsApp. Sin app, desde
               el celular del cliente."
value:         "Los gimnasios y peluquerías que implementan esto reducen el ausentismo
               en un 30% porque los turnos quedan confirmados."
cta:           "¿Les muestro cómo quedó para una peluquería similar en Montevideo?"
```

### Tabla `lead_outreach` (nueva)

```sql
CREATE TABLE lead_outreach (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       uuid REFERENCES leads(id) ON DELETE CASCADE,
  created_at    timestamptz DEFAULT now(),
  
  -- Oferta generada
  offer_type    text NOT NULL,              -- 'web_nuevo' | 'delivery_propio' | etc.
  channel       text NOT NULL,             -- 'email' | 'whatsapp' | 'phone'
  offer_package jsonb NOT NULL,            -- OfferPackage completo generado
  
  -- Estado del pipeline
  status        text NOT NULL DEFAULT 'pending',
  -- 'pending' | 'approved' | 'sent' | 'responded' | 'interested' | 'closed_won' | 'closed_lost'
  
  -- Tracking
  sent_at       timestamptz,
  responded_at  timestamptz,
  response_text text,
  notes         text,
  outcome       text,                      -- 'won' | 'lost_price' | 'lost_timing' | 'lost_interest'
  
  -- Feedback para scoring
  lead_quality_feedback smallint           -- -1/0/+1: el lead era tan bueno como prometía el score?
);

CREATE INDEX lead_outreach_lead_id ON lead_outreach(lead_id);
CREATE INDEX lead_outreach_status ON lead_outreach(status);
```

### API de la pipeline (PostgREST)

```
GET  /rest/v1/lead_outreach?status=eq.pending&order=created_at.desc
POST /rest/v1/lead_outreach          — crear registro al generar oferta
PATCH /rest/v1/lead_outreach?id=eq.X — actualizar status, notas, outcome

-- Función RPC para generar oferta (en Supabase Edge Function o Next.js API route)
POST /api/generate-offer
  body: { lead_id: string, offer_type?: string, channel?: string }
  → OfferPackage generado
```

---

## Diseño — UI de Discovery / Exploración

### Concepto

El agente de ventas o el dueño del sistema puede lanzar exploraciones sin tocar la CLI. Define qué explorar, cuánta carga usar, y el sistema corre en background reportando resultados.

### Pantalla — Discovery Control Center

```
┌──────────────────────────────────────────────────────────────────────┐
│ EXPLORACIÓN                                    [Estado: 2 corriendo] │
├───────────────────────────┬──────────────────────────────────────────┤
│                           │                                          │
│  NUEVA EXPLORACIÓN        │  ZONAS SUGERIDAS (sin explorar)          │
│  ─────────────────────    │  ─────────────────────────────────────   │
│  Fuente:                  │  📍 Salto — restaurant      ~40 leads est│
│  ○ Google Places          │  📍 Maldonado — hairdresser ~25 leads est│
│  ● Yelu                   │  📍 Rivera — gym            ~15 leads est│
│  ○ OSM                    │  📍 Rocha — restaurant      ~30 leads est│
│  ○ PedidosYa              │  [Agregar a cola →]                      │
│  ○ MINTUR                 │                                          │
│                           │  ZONAS STALE (>90 días sin refresh)      │
│  Zona:  [Salto        ▼]  │  ─────────────────────────────────────   │
│  Niche: [restaurant   ▼]  │  ♻️  Montevideo restaurant (GP) — 94d    │
│  Perfil:[A/B          ▼]  │  ♻️  Montevideo hairdresser (Yelu) — 91d │
│  Límite:[200          ]   │  [Re-explorar →]                         │
│                           │                                          │
│  CARGA DEL SISTEMA        │  COLA ACTIVA                             │
│  ────────────────────     │  ─────────────────────────────────────   │
│  ○ Conservador (20%)      │  1. Yelu · Salto · restaurant   [⏸][✕]  │
│  ● Balanceado  (50%)      │  2. OSM  · Rivera · gym         [⏸][✕]  │
│  ○ Agresivo    (80%)      │  3. GP   · Rocha · restaurant   [▶][✕]  │
│  ○ Manual: [concurrency]  │                                          │
│                           │  [Agregar exploración manual →]          │
│  [▶ Iniciar exploración]  │                                          │
│                           │                                          │
├───────────────────────────┴──────────────────────────────────────────┤
│  CORRIENDO AHORA                                                      │
│  Yelu · Montevideo · restaurant · concurrency=10 · 134/200 leads     │
│  ████████████░░░░░░░  67%  ·  12 nuevos  ·  8 corroborados          │
│                                                                       │
│  ÚLTIMAS EXPLORACIONES                                                │
│  2026-05-15  GP · Durazno · restaurant    — 3 leads nuevos  score>40 │
│  2026-05-15  GP · Minas · gym             — 0 leads nuevos           │
│  2026-05-15  GP · Colonia · restaurant    — 0 leads nuevos           │
└──────────────────────────────────────────────────────────────────────┘
```

### Tabla `discovery_jobs` (nueva)

```sql
CREATE TABLE discovery_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz DEFAULT now(),
  started_at   timestamptz,
  completed_at timestamptz,
  
  -- Parámetros
  source       text NOT NULL,
  location     text NOT NULL,
  niche        text,
  profile      text,                    -- A/B/C/D o null para externos
  max_results  integer DEFAULT 200,
  concurrency  integer,
  cpu_budget   text,                    -- 'conservative'|'balanced'|'aggressive'
  
  -- Estado
  status       text DEFAULT 'queued',   -- 'queued'|'running'|'completed'|'failed'|'paused'
  progress     integer DEFAULT 0,       -- 0–100
  
  -- Resultados
  leads_found      integer DEFAULT 0,
  leads_new        integer DEFAULT 0,
  leads_corroborated integer DEFAULT 0,
  leads_hot_new    integer DEFAULT 0,
  error_message    text,
  
  -- Meta
  triggered_by text DEFAULT 'manual'   -- 'manual'|'scheduled'|'gap_analysis'
);
```

### Modos de exploración

**Modo manual:** el usuario define fuente + zona + niche + perfil. Comportamiento actual del CLI pero desde UI.

**Modo gap-guided (zonas sugeridas):** el sistema analiza la cobertura existente y sugiere dónde explorar.

```sql
-- Lógica de zonas sugeridas (query de gap analysis)
-- Zonas donde tenemos leads con buen score pero poca cobertura de fuentes:
SELECT 
  SPLIT_PART(address, ',', -1) AS city,
  niche,
  COUNT(*) AS leads_existentes,
  AVG(prospect_score) AS avg_score,
  COUNT(DISTINCT source) AS fuentes_cubiertas,
  -- Estimar potencial no descubierto: ciudades con score alto pero pocas fuentes
  AVG(prospect_score) * (5 - COUNT(DISTINCT source)) AS exploration_priority
FROM leads
WHERE passed_filter = true
GROUP BY city, niche
HAVING COUNT(DISTINCT source) < 3
ORDER BY exploration_priority DESC;
```

**Modo automated (cola con CPU budget):** el sistema ejecuta la cola de exploración en background usando el CPU budget elegido. Si `cpu_budget=balanced`, calcula `concurrency = floor(freeCPU_pct × 0.5 / cpu_per_request)`. Pausa si CPU supera el threshold. Retoma cuando baja.

```
cpu_budget → concurrency calculado:
  conservative (20%):  ~3–5 workers
  balanced     (50%):  ~8–12 workers
  aggressive   (80%):  ~15–20 workers
```

### Scheduled exploration (Fase futura)

```
CRON: cada domingo 03:00
  → Detectar fuentes stale (updated_at > source_refresh_days)
  → Crear discovery_jobs para cada fuente stale
  → Ejecutar con cpu_budget=conservative (no interrumpe trabajo humano)
  → Notificar resultados al día siguiente
```

### API de discovery jobs

```
GET  /api/discovery/jobs            — lista jobs con estado
POST /api/discovery/jobs            — crear nuevo job (encola)
PATCH /api/discovery/jobs/:id       — pause/resume/cancel
GET  /api/discovery/suggestions     — zonas sugeridas (gap analysis)
GET  /api/discovery/coverage        — mapa de cobertura por zona+fuente
POST /api/discovery/jobs/:id/run    — ejecutar job inmediatamente
```

El backend de cada job llama el mismo código que el CLI (`discover-external`, `enrich --source`, `score --source`) via `execa` o equivalente, capturando stdout para el progress bar.

---

## Diseño — Generación de ofertas con IA (Fase futura)

En primera versión, las ofertas se generan desde templates fijos (ver sección pipeline de contacto). En segunda versión, el sistema usa Claude API para generar textos personalizados.

### Input al modelo

```typescript
interface OfferGenerationInput {
  lead: LeadCard                  // datos del lead
  offer_type: string              // tipo de oferta primaria
  channel: 'email'|'whatsapp'|'phone_script'
  tone: 'formal'|'conversational' // configurable por usuario
  seller_name: string             // quién envía
  seller_company?: string
  examples?: string[]             // ejemplos de pitches exitosos anteriores
}
```

### Prompt estructura

```
Sos un agente de ventas uruguayo especializado en servicios digitales para pymes.
Tenés un lead: {lead.name}, {lead.niche} en {ciudad}.

Señales clave del negocio:
- {gap_signals: lista de tags relevantes en lenguaje natural}
- Estado operativo: {inferred_state resumen}
- Contactabilidad: {contact_tier} vía {channel}
- {commission_estimate si aplica}

Generá un {channel} para ofrecerles {offer_type}.
Tono: {tone}. Máximo {char_limit} caracteres.
Incluir: apertura personalizada, el problema específico, la solución concreta, un número si disponible, CTA claro.
No mencionar que usás IA. No prometas lo que no podés cumplir.
```

### Feedback loop para mejorar templates

```
lead_outreach.outcome = 'closed_won'  → texto que funcionó entra al pool de ejemplos
lead_outreach.outcome = 'closed_lost' + reason → señal negativa
lead_outreach.lead_quality_feedback = -1 → el lead no era tan bueno como prometía el score
  → ajusta threshold del buyer_type / sub-score que lo clasificó
```

---

## Flujos detallados — diseño objetivo

### Flujo 1 — Discovery

```
blindspot discover-external --source <fuente> --location <ciudad> --niche <niche>

  Provider.discover(query: DiscoveryQuery)
    │
    ├─ [Google Places] Text Search API → Details API por place_id
    ├─ [MINTUR]        GET catalogodatos.gub.uy/api/... → parse CSV/JSON
    ├─ [OSM]           Overpass API → bbox predefinido → parse GeoJSON
    ├─ [Yelu]          Playwright scraping yelu.uy → parse HTML paginado
    └─ [PedidosYa]     Playwright → endpoint interno → parse JSON (MAX_PAGES=5)
    │
    ▼
  DiscoveryCandidate[] — campos normalizados:
    { source, external_id, source_confidence,
      name, address, phone, website, email,
      lat, lng, niche, raw }
    │
    ▼ para cada candidato:
  findCrossSourceMatch(candidate, allLeads, threshold=0.85)  ← [HOY FALTA LLAMAR ESTO]
    │
    ├─ MATCH (similitud nombre ≥ 0.85 en mismo área)
    │     addCorroboratingSource(existingLead, candidate)
    │     reconcileCanonicalFields(existingLead, candidate)
    │       → phone: mismo valor en 2+ fuentes → confidence +0.15
    │       → phone: valores distintos → tag 'phone-conflict', mantener mayor confidence
    │       → email: idem
    │     recalculateDataConfidence(existingLead)
    │     updateAllLeadsInMemory(existingLead)
    │
    └─ SIN MATCH
          deduplicateWithinRun(candidate, allLeads)  → isFranchise? → tag
          insertExternalLead(candidate)
          updateAllLeadsInMemory(newLead)

  Post-discovery:
    → Commit checkpoint en git
    → Verificar invariantes (passed_not_enriched, tags_contradictorios)
```

**Mejoras propuestas al flujo de discovery:**

1. **Geo-clustering antes de insertar**: si hay 3+ negocios del mismo niche a menos de 200m entre sí sin web → tag `high-density-gap-cluster`. Señal de zona con oportunidad concentrada.
2. **Validación de phone en discovery**: detectar si es celular (09x) vs fijo (02x, 043x) ya en el candidato. Los celulares llegan directo al dueño.
3. **Score de completitud del candidato**: cuántos campos tiene → candidatos muy incompletos (solo nombre y dirección) entran con `source_confidence` reducido automáticamente.

---

### Flujo 2 — Enrichment

```
blindspot enrich --source <fuente> [--with-heuristic] [--concurrency N]

  loadLeadsBySource(source) → Lead[]  (sin digital_footprint o force-refresh)
    │
    ▼ por cada lead (concurrencia controlada):

  buildHeuristicMode(lead)
    → detectConfirmedChannels(lead)
      ├─ website confirmado: URL real de source O heuristic_score ≥ 0.7
      ├─ facebook: tag 'fb-confirmed'
      ├─ instagram: tag 'ig-confirmed'
      ├─ whatsapp: tag 'whatsapp-confirmed'
      └─ email: siempre re-parsea (barato, evita falsos confirmados)
    │
    ▼ para canales NO confirmados:

  heuristic-discovery.ts  (si --with-heuristic)
    → buscar website via nombre + ciudad + niche
    → buscar FB/IG si no confirmados
    → score por candidato (0.0–1.0)
    → seleccionar winner si score ≥ 0.5

  directory-discovery.ts
    → buscar en yelu.uy si no tiene web confirmada
    │
    ▼ si hay website (confirmado o heurístico):

  Fetch HTML del website
    ├─ email.ts          → extraer emails → validar formato → clasificar tipo
    ├─ whatsapp.ts       → detectar links wa.me → normalizar +598xx
    ├─ ssl.ts            → HEAD request → check certificado
    ├─ whois.ts          → domain age → tag 'domain-old-stale' si > 5 años sin update
    ├─ copyright-year.ts → buscar © → tag 'web-outdated' si ≤ threshold (2022)
    └─ operational-systems.ts
         ├─ delivery_platforms:  detectar PedidosYa, Rappi, UberEats en links
         ├─ booking_platforms:   detectar Calendly, SimplyBook, Reservio
         ├─ ecommerce_platforms: detectar Shopify, WooCommerce, TiendaNube, MercadoShops
         ├─ payment_gateways:    detectar MercadoPago, Stripe, PayPal (señal has_pos)
         └─ chat_widget:         detectar Tidio, Intercom, LiveChat en DOM hidratado
    │
    ▼

  computeInferredState(digital_footprint, lead): InferredState
    → has_delivery, has_pos, has_reservations,
      has_ecommerce, has_online_catalog, has_chat_support
    → digitalization_level: none / basic / intermediate / advanced
    │
    ▼

  calculateDataConfidence(lead)   → 0.00–1.00
  calculateContactReliability(lead) → 0.00–1.00
    │
    ▼

  saveFootprint(lead, digital_footprint)
  → UPDATE leads SET digital_footprint = ..., updated_at = now()
    WHERE id = lead.id
```

**Mejoras propuestas al flujo de enrichment:**

1. **Clasificación de tipo de teléfono** (falta hoy): `09x` → móvil (owner-probable), `02x/04x` → fijo (recepción). Tag `mobile-phone` si es celular → sube `contact_reliability`.
2. **Clasificación de email** (Fase 15 pendiente): `info@`, `contacto@` → genérico ×0.5. `juan@` → personal ×1.5. `gerencia@` → rol ×1.2. Validación MX record → `email-no-mx` tag si falla.
3. **CMS detection** en el HTML: detectar WordPress, Wix, Squarespace, Webflow. Tag `cms-wix` o `cms-wordpress-old`. Esto alimenta el pitch de rediseño con especificidad ("tu web está en Wix 2018 — sin SEO real posible").
4. **Social activity scoring** (más allá de presencia): si tiene FB/IG confirmado, ¿cuándo fue el último post visible? → tag `social-inactive-90d` si el perfil no tiene actividad reciente. Hoy solo detectamos presencia, no actividad.
5. **Google My Business completeness** (para leads Google Places): si le faltan fotos, horarios, descripción, website en GMB → sub-pitch "optimizá tu ficha antes de hacer ads". Señales ya en `google_data`.

---

### Flujo 3 — Scoring

```
blindspot score --all

  loadAllPassedLeads() → Lead[]
    │
    ▼ por cada lead:

  calculateSubScores(lead, sgScore): SubScores
    ├─ web_nuevo:    tags no-website, high-reviews-no-web, fb/ig-only   (cap 60)
    ├─ rediseno:     tags site-unreachable, ssl-missing, not-responsive,
    │                stack-obsolete, web-outdated, domain-old-stale       (cap 58)
    ├─ marketing:    tags web-only-no-social, fb/ig-heuristic,
    │                pixel-missing, analytics-missing                     (cap 68)
    ├─ software:     systems_gap_score + whatsapp-missing + chat-missing  (cap 100)
    ├─ catalogo:     hours-missing, ausencia ecommerce/menu, niche bonus  (cap 63)
    └─ contacto_directo: [NUEVO] phone móvil + niche activo + sin plataformas (cap 40)
    │
    primary_offer = argmax(sub_scores)  → 'none' si todos 0
    │
    ▼

  source_quality_bonus(lead): number              [NUEVO]
    → google_places:0 | mintur:+20 | pedidosya:+15 | yelu:+10 | osm:+8
    │
    ▼

  computeContactTier(lead): 'A'|'B'|'C'|'D'|'X'  [NUEVO]
    → A: email en contact_emails (verified)
    → B: whatsapp confirmado (y no A)
    → C: phone disponible (y no A ni B)
    → D: solo address
    → X: nada

  contactabilityMultiplier(lead): number          [REVISADO]
    → X:         ×0.5
    → C (phone): ×1.0
    → B (WA):    ×1.2
    → A (email): ×1.3
    → A+B:       ×1.4 (cap)
    × (0.7 + 0.3 × contact_reliability_score)    [ajuste por calidad]
    │
    ▼

  reviewCountMultiplier(lead): 0.75–1.4×
  ratingBonus(lead): +5 si rating ≥ 4.3
    │
    ▼

  prospect_score = min(100,
    floor((max(sub_scores) + source_quality_bonus) × contactabilityMult × reviewMult)
    + ratingBonus
  )
    │
    ▼

  computeUrgencySignal(lead): 'high'|'medium'|'low'
  computePitchHook(primary_offer, inferred_state, niche): string  [NUEVO]
  computeAllBuyerScores(lead): BuyerTypeScore[]
    │
    ▼

  score_breakdown: {
    sub_scores, primary_offer,
    source_quality_bonus,           ← nuevo
    contact_tier,                   ← nuevo
    pitch_hook,                     ← nuevo
    urgency_signal,
    contactability_multiplier,
    review_multiplier,
    rating_bonus,
    inferred_state_summary          ← resumen de los booleanos que afectaron el score
  }

  upsert lead_buyer_scores(lead_id, buyer_type, score, breakdown)
```

---

### Flujo 4 — Maintenance (refresh cadence)

```
blindspot maintenance [--stale-days N] [--niche <text>]

  Por cada fuente configurada en config/discovery.yaml (source_refresh):
    google_places: 30 días
    mintur:        90 días
    osm:           90 días
    yelu:          90 días
    pedidosya:     90 días

  Detectar leads stale por fuente:
    WHERE source = <fuente>
      AND updated_at < NOW() - INTERVAL '<refresh_days> days'
      AND passed_filter = true

  Para google_places → re-enrich via runs (pipeline completo)
  Para externas      → enrichCommand --source <fuente> --force-refresh

  Post-refresh:
    → score --source <fuente>   (re-score solo los actualizados)
    → verificar invariantes
```

**Mejora propuesta:** el refresh hoy re-enriquece todos los leads stale de la fuente. Debería priorizar leads con `contact_tier A o B` primero — son los más valiosos y los que más importa mantener frescos.

---

### Flujo 5 — Reporting / Output (hoy y futuro)

**Hoy (CLI):**
```
blindspot report --run <uuid> --format csv|html|md|all
  → loadLeadsByRunId
  → filtrar passed_filter=true
  → exportar campos básicos
```

**Diseño objetivo (UI):**
```
GET /api/leads?contact_tier=A,B&prospect_score_gte=40&niche=restaurant
  → paginado (cursor-based, 50/página)
  → campos del LeadCard contract (sin joins)
  → sort: prospect_score DESC, urgency_signal DESC

GET /api/leads/:id
  → lead completo con score_breakdown expandido
  → buyer_type_scores ordenados por score DESC
  → corroborating_sources con labels

PATCH /api/leads/:id/outreach
  → { contacted_at, channel, notes }
  → actualiza estado de outreach
```

---

## Señales de valor no capturadas (backlog de enriquecimiento)

Datos que ya tenemos o podemos extraer con poco esfuerzo y que hoy no alimentan ningún score ni pitch.

### 1. Tipo de teléfono: celular vs fijo

**Por qué importa:** en Uruguay, `09x` es móvil — llega directo al dueño. `02x` es fijo de Montevideo — atiende la recepción. `04x` son fijos del interior. El pitch por llamada tiene probabilidad de éxito completamente distinta.

**Implementación:** regex en `whatsapp.ts` o nuevo `shared/phone.ts` (deuda técnica). Tag `mobile-phone` vs `landline-phone`. Sube `contact_reliability` en 0.15 si es móvil.

**Impacto en scoring:** `contact_reliability_score` más preciso → `contactabilityMultiplier` más preciso.

---

### 2. CMS detection en websites

**Por qué importa:** si el negocio tiene un Wix de 2018 o un WordPress sin actualizar desde 2020, el pitch de rediseño tiene argumento técnico concreto: "tu web no puede tener SEO real en Wix", "tu WordPress tiene vulnerabilidades sin parchear". Esto es mucho más convincente que "tu web es vieja".

**Señales a detectar:**
- Wix: `wix.com` en assets, `<meta name="generator" content="Wix"`
- WordPress: `/wp-content/`, `/wp-json/`
- Webflow: `webflow.com` en assets
- Squarespace: `squarespace.com` en assets
- Tienda Nube: `tiendanube.com` en assets

**Tags resultantes:** `cms-wix`, `cms-wordpress`, `cms-webflow`, `cms-squarespace`, `cms-tiendanube`, `cms-custom`

**Impacto:** alimenta `score_breakdown.cms` y el `pitch_hook` puede decir "Rediseño desde Wix a web propia" en lugar del genérico "rediseño web".

---

### 3. Google My Business completeness score

**Por qué importa:** muchos negocios con presencia en Google Maps tienen la ficha incompleta. El pitch "optimizá tu ficha de Google antes de pagar ads" es de menor fricción que una venta de web completa — es el foot-in-the-door ideal.

**Señales ya disponibles en `google_data`:**
- `has_hours: false` → `-5` en score de completitud GMB
- `photos_count < 5` → `-3`
- `website IS NULL` → ya capturado como `no-website`
- `has_recent_reviews: false` → `-2`

**Output:** `score_breakdown.gmb_completeness: number` (0–10). Si ≤ 5 → pitch_hook adicional "ficha de Google incompleta — tus clientes no te encuentran bien".

---

### 4. Cuantificación del ahorro en comisiones PedidosYa

**Por qué importa:** "independizate de PedidosYa" es el pitch más concreto del sistema. Pero hoy no tiene número. Un negocio que vende 100 pedidos/mes a ticket promedio $500 UYU, pagando 30% de comisión = $15.000 UYU/mes a PedidosYa. Un sistema propio cuesta $3.000 UYU/mes. El ROI es inmediato.

**Cómo estimar sin datos reales:**
- `review_count` es proxy de volumen. Un negocio con 200 reviews en 2 años → ~8 reviews/mes si el 4% de clientes reseña → ~200 transacciones/mes.
- `niche` determina ticket promedio estimado.

**Output en buyer_type delivery_propio:**
```json
{
  "commission_estimate": {
    "monthly_orders_est": 200,
    "avg_ticket_uyu": 500,
    "monthly_revenue_est": 100000,
    "commission_rate": 0.30,
    "commission_monthly_uyu": 30000,
    "system_cost_monthly_uyu": 3000,
    "monthly_savings_est": 27000,
    "pitch_hook": "Estás pagando ~$30.000 UYU/mes a PedidosYa"
  }
}
```

---

### 5. Densidad competitiva por zona y niche

**Por qué importa:** si en 500m hay 10 restaurantes sin web, el pitch "nadie en tu zona tiene web" es más débil que si solo 1 de 10 no la tiene. Y viceversa: si todos los competidores tienen web menos este, la urgencia es real.

**Implementación:** requiere GPS (OSM lo provee nativamente). Query geoespacial con PostGIS:
```sql
-- Cuántos leads del mismo niche están a < 500m y sin website
SELECT COUNT(*) FROM leads
WHERE niche = $niche
  AND ST_DWithin(gps::geography, ST_MakePoint($lng,$lat)::geography, 500)
  AND 'no-website' = ANY(tags)
  AND id != $lead_id
```

**Tags resultantes:** `gap-cluster-high` (3+ sin web en 500m → oportunidad zona), `gap-cluster-isolated` (único sin web → urgencia pitch personal).

**Requiere:** activar PostGIS en Supabase local + migrar coordenadas lat/lng a columna `gps point`.

---

### 6. Actividad reciente en redes sociales

**Por qué importa:** hoy detectamos presencia (tiene FB / no tiene FB) pero no actividad. Una cuenta de FB con último post en 2022 es para todos los efectos un negocio sin redes sociales activas. El pitch de community management es mucho más fuerte con esta señal.

**Implementación:** en `social-enrich` (Playwright FB/IG), además de confirmar la existencia, registrar:
- Fecha del último post visible
- Frecuencia de posteo (posts en últimos 90 días)

**Tags resultantes:** `social-inactive-90d`, `social-inactive-365d`, `social-active` (< 30 días).

**Impacto en sub-score `marketing`:** `social-inactive-90d` suma puntos igual que ausencia parcial de social — no tienen community management efectivo.

---

### 7. Detección de WhatsApp Business vs WhatsApp personal

**Por qué importa:** WhatsApp Business tiene catálogo, respuestas automáticas, horarios. Un negocio con WhatsApp personal no está aprovechando la herramienta. El pitch de "pasá a WhatsApp Business + catálogo digital" es concreto.

**Implementación:** ya detectamos links `wa.me` y `api.whatsapp.com`. Además: el endpoint `https://api.whatsapp.com/send?phone=XXX` con `business` en el path indica Business API.

**Tags:** `whatsapp-business-api` (ya tiene WA Business), `whatsapp-personal` (link normal). El buyer_type `whatsapp_business` debería penalizar si ya tiene `whatsapp-business-api`.

---

### 8. Señal de negocio nuevo (oportunidad de ser el primero)

**Por qué importa:** un negocio recién abierto (< 12 meses en Google, < 30 reviews) todavía no tiene hábitos digitales establecidos. Es el momento ideal para ser el primer proveedor de web, redes o software. La resistencia al cambio es mínima.

**Señales disponibles:**
- `review_count < 20` AND `rating ≥ 4.0` → muy nuevo pero bueno
- `first_seen_run_id` con fecha reciente en nuestro sistema
- `google_data.years_in_business` si Google lo provee

**Tag:** `new-business-window`. `urgency_signal → high` si también tiene gap digital.

---

## Diseño de UI

> El diseño completo de la UI (pantallas, wireframes, componentes, templates de oferta, orden de construcción)
> está en `context/ARCHITECTURE_FRONTEND.md` — proyecto separado `blindspot-ui`.
>
> Este archivo solo define lo que el backend debe exponer para que la UI funcione.

---

### Pantallas, componentes y orden de construcción

> Ver `context/ARCHITECTURE_FRONTEND.md` — diseño completo de todas las pantallas,
> wireframes, componentes reutilizables, templates de oferta y orden de construcción.

---

#### Pantalla 1 — Lead Explorer (vista principal)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ BLINDSPOT                              [Búsqueda]  [Filtros ▼]  [Export]│
├─────────────┬───────────────────────────────────────────────────────────┤
│ FILTROS     │  342 leads · ordenados por: Score ▼                       │
│             │                                                            │
│ Tier        │  ┌──────────────────────────────────────────────────────┐ │
│ ☑ A email   │  │ [A] La Parrilla Don Carlos          Restaurante · MVD │ │
│ ☑ B WA      │  │     ████████░░ 74   📞 wa.me/598... 📧 carlos@...    │ │
│ ☑ C phone   │  │     🔴 URGENTE · Oferta: Web nueva                   │ │
│ ☐ D address │  │     "No tienen web, están perdiendo clientes online"  │ │
│ ☐ X nada    │  └──────────────────────────────────────────────────────┘ │
│             │                                                            │
│ Oferta      │  ┌──────────────────────────────────────────────────────┐ │
│ ☑ web_nuevo │  │ [B] Peluquería Estilo                Hair · Colonia   │ │
│ ☑ rediseno  │  │     █████░░░░░ 51   📞 +598 94 ...                   │ │
│ ☑ marketing │  │     🟡 MEDIO · Oferta: Software                      │ │
│ ☑ software  │  │     "Sin sistema de reservas — pierden turnos"        │ │
│ ☑ catalogo  │  └──────────────────────────────────────────────────────┘ │
│             │                                                            │
│ Urgencia    │  ┌──────────────────────────────────────────────────────┐ │
│ ☑ Alta      │  │ [C] Taller Mecánico Pérez           Auto · Interior   │ │
│ ☑ Media     │  │     ████░░░░░░ 42   📞 +598 43 ...                   │ │
│ ☐ Baja      │  │     ⚪ BAJA · Oferta: Marketing                      │ │
│             │  │     "Tiene web pero sin redes activas hace 2 años"    │ │
│ Score       │  └──────────────────────────────────────────────────────┘ │
│ [40] ──── [100]│                                                        │
│             │                                                    [1/7 →] │
│ Niche       │                                                            │
│ ☑ restaurant│                                                            │
│ ☑ gym       │                                                            │
│ ☑ hairdress │                                                            │
│ ☑ car_dealer│                                                            │
│ ☑ other     │                                                            │
│             │                                                            │
│ Fuente      │                                                            │
│ ☑ GP ☑ MINT │                                                            │
│ ☑ OSM ☑ Yelu│                                                            │
│             │                                                            │
│ Estado      │                                                            │
│ ☑ No contac │                                                            │
│ ☐ Contactado│                                                            │
│ ☐ Follow-up │                                                            │
└─────────────┴───────────────────────────────────────────────────────────┘
```

**Lead Card — campos visibles:**
- Badge tier (A/B/C) con color: A=verde, B=azul, C=amarillo, X=gris
- Nombre del negocio + niche + ciudad
- Barra de score (0–100) + número
- Icono de canal de contacto + valor (email o teléfono)
- Badge urgencia: 🔴 URGENTE / 🟡 MEDIO / ⚪ BAJA
- Oferta primaria en texto corto
- Pitch hook: la frase concreta de apertura

---

#### Pantalla 2 — Lead Detail

```
┌──────────────────────────────────────────────────────────────────────┐
│ ← Volver    La Parrilla Don Carlos                    [Marcar contactado]│
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  CONTACTO                              SCORE BREAKDOWN               │
│  ─────────────────────                 ──────────────────────────    │
│  📧 carlos@parrilla.com  [Copiar]      Prospect Score:  74/100      │
│  📱 +598 91 234 567      [Copiar]      ██████████░░░░               │
│     (móvil — directo al dueño)                                       │
│  📍 Rivera 1234, Montevideo            Sub-scores:                   │
│                                         web_nuevo   ██░░░░  32      │
│  SEÑALES CLAVE                          rediseno    ░░░░░░   0      │
│  ─────────────────────                  marketing   ██████  41      │
│  🚫 Sin web propia                      software    ████░░  28      │
│  📘 FB: presente, sin actividad 8m      catalogo    ██░░░░  18      │
│  📷 IG: no detectado                                                 │
│  ⚠️  Web vía heurístico (score 0.71)   Contactabilidad:  ×1.28     │
│  🗓  Copyright 2019 detectado          Review mult:       ×1.20     │
│  ⭐ Rating 4.4 · 87 reviews                                          │
│                                        Oferta principal:             │
│  ESTADO OPERATIVO                      Marketing social              │
│  ─────────────────────                                               │
│  Delivery:    ✅ PedidosYa             BUYER TYPES                   │
│  Reservas:    ❌ no detectado          ─────────────────────────     │
│  E-commerce:  ❌                       marketing_social  ████  78   │
│  POS propio:  ❌                       agencia_web       ███░  61   │
│  Chat:        ❌                       delivery_propio   █░░░  32   │
│  Nivel:       Básico                                                 │
│                                        PITCH SUGERIDO                │
│  DATOS DEL NEGOCIO                     ─────────────────────────     │
│  ─────────────────────                 "Tienen FB pero sin          │
│  Fuentes: Google Places + MINTUR       actividad en 8 meses.        │
│  Confianza datos: 0.84                 Están perdiendo clientes     │
│  Confianza contacto: 0.79             que preguntan por Instagram." │
│  Visto: 15/05/2026                                                   │
│  ID MINTUR: 12345                     [Anotaciones privadas...]      │
└──────────────────────────────────────────────────────────────────────┘
```

---

#### Pantalla 3 — Segment Explorer

Vista agregada para identificar oportunidades de campaña, no leads individuales.

```
┌──────────────────────────────────────────────────────────────────┐
│ SEGMENTOS                                                         │
│                                                                   │
│  Por oferta:                                                      │
│  Web nueva      ████████████████░░  189 leads contactables       │
│  Marketing      ██████████░░░░░░░░  134 leads contactables       │
│  Software       ████████░░░░░░░░░░   98 leads contactables       │
│  Rediseño       █████░░░░░░░░░░░░░   67 leads contactables       │
│  Catálogo       ████░░░░░░░░░░░░░░   45 leads contactables       │
│                                                                   │
│  Por zona:                   Por niche:                           │
│  Montevideo  1.240 leads     Restaurant  892 leads               │
│  Interior      823 leads     Hairdress   431 leads               │
│  Colonia        89 leads     Car dealer  298 leads               │
│                              Gym         156 leads               │
│                                                                   │
│  Hot clusters (zona con 5+ leads urgentes sin web):              │
│  📍 Pocitos · restaurant · 8 leads · avg score 61               │
│  📍 Malvín · hairdresser · 5 leads · avg score 58               │
│  📍 Salto centro · restaurant · 6 leads · avg score 54          │
│                                                                   │
│  PedidosYa escape (delivery sin sistema propio):                 │
│  23 leads · avg comisión estimada $28.000 UYU/mes               │
│  [Ver segmento →]                                                 │
└──────────────────────────────────────────────────────────────────┘
```

---

#### Pantalla 4 — Outreach Tracker

```
┌──────────────────────────────────────────────────────────────────┐
│ OUTREACH                                          Semana 20/2026  │
├──────────────────────────────────────────────────────────────────┤
│  Contactados esta semana: 12    Respuestas: 4    Interés: 2      │
│                                                                   │
│  Por contactar (urgentes):                                        │
│  ──────────────────────────                                       │
│  [A] Don Carlos Parrilla · 74 pts · "Sin web, alta urgencia"     │
│      📧 carlos@parrilla.com          [Marcar contactado]          │
│                                                                   │
│  [B] Gym Fitness Plus · 68 pts · "Sin reservas online"           │
│      📱 +598 91 XXX XXX              [Marcar contactado]          │
│                                                                   │
│  Contactados — esperando respuesta:                               │
│  ──────────────────────────────────                               │
│  Peluquería Estilo · contactado hace 3 días                       │
│  Canal: WhatsApp · Notas: "interesado, pidió presupuesto"         │
│  [Follow-up]                                                       │
└──────────────────────────────────────────────────────────────────┘
```

---

### API contract (PostgREST sobre Supabase)

La UI no necesita API propia en primera versión. PostgREST expone las tablas directamente con filtros.

**View `lead_dashboard`** (materializada o vista): desnormaliza todos los campos del LeadCard para evitar joins en cada request.

```sql
CREATE VIEW lead_dashboard AS
SELECT
  l.id,
  l.name,
  l.address,
  l.niche,
  l.source,
  jsonb_array_length(l.corroborating_sources) AS sources_count,

  -- Contacto
  l.score_breakdown->>'contact_tier'           AS contact_tier,
  l.canonical_fields->'email'->>'value'        AS contact_email,
  l.canonical_fields->'phone'->>'value'        AS contact_phone,
  l.whatsapp                                   AS contact_whatsapp,

  -- Score y oferta
  l.prospect_score,
  l.score_breakdown->'sub_scores'->>'primary_offer'  AS primary_offer,
  l.score_breakdown->>'pitch_hook'             AS pitch_hook,
  l.score_breakdown->>'urgency_signal'         AS urgency_signal,

  -- Estado operativo (cuando inferred_state sea columna propia)
  l.inferred_state->>'digitalization_level'    AS digitalization_level,
  (l.inferred_state->'has_delivery'->>'value')::boolean   AS has_delivery,
  (l.inferred_state->'has_pos'->>'value')::boolean        AS has_pos,
  (l.inferred_state->'has_reservations'->>'value')::boolean AS has_reservations,

  -- Confianza
  l.data_confidence_score,
  l.contact_reliability_score,

  -- Meta
  l.contacted_at,
  l.created_at,

  -- Top buyer type (join lateral)
  lbs_top.buyer_type AS top_buyer_type,
  lbs_top.score      AS top_buyer_score

FROM leads l
LEFT JOIN LATERAL (
  SELECT buyer_type, score
  FROM lead_buyer_scores
  WHERE lead_id = l.id
  ORDER BY score DESC
  LIMIT 1
) lbs_top ON true
WHERE l.passed_filter = true
  AND l.score_breakdown->>'contact_tier' != 'X';
```

Filtros vía PostgREST query params:
```
GET /rest/v1/lead_dashboard
  ?contact_tier=in.(A,B,C)
  &prospect_score=gte.40
  &niche=eq.restaurant
  &urgency_signal=eq.high
  &contacted_at=is.null
  &order=prospect_score.desc
  &limit=50&offset=0
```

---

### Componentes UI reutilizables clave

| Componente | Props | Función |
|-----------|-------|---------|
| `<ContactTierBadge tier="A" />` | tier: A/B/C/D/X | Badge con color y tooltip del canal |
| `<ScoreBar score={74} />` | score: 0–100 | Barra con color gradient |
| `<UrgencyBadge signal="high" />` | signal: high/medium/low | 🔴🟡⚪ |
| `<PitchHook text="..." />` | text: string | Frase destacada, copiable con 1 click |
| `<OperationalState state={...} />` | InferredState | Íconos ✅/❌ por dimensión |
| `<BuyerTypeBar types={[...]} />` | BuyerTypeScore[] | Barras horizontales top 3 |
| `<ContactActions lead={...} />` | Lead | Botones: copiar email, abrir WA, marcar contactado |
| `<SourcesBadges sources={[...]} />` | string[] | Chips: GP / MINTUR / Yelu / OSM |

---

### Orden de construcción de la UI

No construir todo de una vez. Orden recomendado:

| Etapa | Qué construir | Prerequisito en backend |
|-------|--------------|------------------------|
| 1 | Vista de lista básica (Lead Explorer sin filtros) | `lead_dashboard` view + contact_tier + pitch_hook en DB |
| 2 | Filtros por tier + oferta + urgencia | Scoring v2 completo (Fase 19 + 20) |
| 3 | Lead Detail completo | inferred_state como columna propia |
| 4 | Feedback Tracker (contacted/won/lost + precio) | Tabla `lead_outreach` + formulario UI |
| 5 | Generación de ofertas IA | LLMProvider configurado (Gemini/Ollama) |
| 6 | Segment Explorer (agregaciones) | PostGIS activado + geo-clustering |
| 7 | Discovery Control Center | `discovery_jobs` + cron pipeline |
| 8 | Cuantificación PedidosYa + DGI data | commission_estimate + CIIU en lead_company_data |

---

## Diseño — Generación de ofertas con IA (proveedor genérico)

### Principio de diseño

El generador de ofertas no debe acoplarse a ningún proveedor de IA específico. La misma funcionalidad debe correr con Gemini free tier (sin costo), con un modelo local vía Ollama (sin API key), o con cualquier API OpenAI-compatible.

### Interfaz `LLMProvider`

```typescript
// src/shared/llm/provider.ts
interface LLMGenerateOptions {
  maxTokens?: number    // default: 500
  temperature?: number  // default: 0.7
}

interface LLMProvider {
  name: string
  generate(prompt: string, options?: LLMGenerateOptions): Promise<string>
}
```

### Implementaciones

**GeminiProvider** — free tier recomendado para empezar
```typescript
// gemini-1.5-flash: 15 RPM, 1.000.000 tokens/día gratis
// Ideal para generar ~50 ofertas por sesión sin costo
class GeminiProvider implements LLMProvider {
  name = 'gemini'
  // POST https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent
  // Headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY }
}
```

**OllamaProvider** — local, sin costo API, requiere servidor propio
```typescript
// Modelos recomendados para esta tarea (generación de texto comercial corto):
//   llama3.1:8b  — buena calidad, ~4GB RAM
//   mistral:7b   — rápido, ~4GB RAM
//   qwen2.5:7b   — excelente en español, ~4GB RAM
class OllamaProvider implements LLMProvider {
  name = 'ollama'
  // POST http://localhost:11434/api/generate
  // body: { model, prompt, stream: false }
}
```

**OpenAICompatibleProvider** — cualquier API con formato OpenAI
```typescript
// Cubre: OpenAI, Groq, Together AI, LM Studio, etc.
class OpenAICompatibleProvider implements LLMProvider {
  name = 'openai-compatible'
  // POST {endpoint}/v1/chat/completions
}
```

### Configuración en `.env`

```bash
# Elegir uno:
LLM_PROVIDER=gemini           # o: ollama, openai-compatible
GEMINI_API_KEY=AIzaSy...      # si provider=gemini
OLLAMA_ENDPOINT=http://localhost:11434   # si provider=ollama
OLLAMA_MODEL=qwen2.5:7b
OPENAI_COMPATIBLE_ENDPOINT=https://...  # si provider=openai-compatible
OPENAI_COMPATIBLE_API_KEY=...
OPENAI_COMPATIBLE_MODEL=...
```

### Prompt de generación de ofertas

El prompt es el mismo independientemente del proveedor. Se diseña para modelos con 7B+ parámetros (funciona en Ollama local) y para Gemini flash.

```
Sos un agente de ventas uruguayo especializado en servicios digitales para negocios locales.
Escribís mensajes directos, sin frases corporativas, en español rioplatense.

NEGOCIO A CONTACTAR:
Nombre: {name}
Rubro: {niche_label}
Ciudad: {city}
Reputación: {review_count} reseñas, {rating} estrellas en Google

PROBLEMAS DETECTADOS EN EL NEGOCIO:
{gap_signals_human}   ← lista legible: "No tiene web propia", "Sin carta digital online", etc.

ESTADO OPERATIVO:
{inferred_state_human} ← "Está en PedidosYa", "No tiene sistema de reservas", etc.

CANAL DE CONTACTO: {channel}  ← 'email' o 'whatsapp'
OFERTA A HACER: {offer_type_label}
{commission_estimate_section}  ← solo si aplica (delivery_propio)

INSTRUCCIONES:
- Canal email: asunto + cuerpo (máximo 120 palabras). Tono profesional pero cercano.
- Canal whatsapp: un solo mensaje (máximo 60 palabras). Tono conversacional.
- Incluir el problema específico detectado, no genérico.
- Si hay número concreto (ahorro, ROI), usarlo.
- Terminar con una pregunta o CTA claro.
- No mencionar que usás inteligencia artificial.
- No inventar datos que no están en el contexto.

Generá solo el texto del mensaje, sin explicaciones adicionales.
```

### Fallback a templates si IA no disponible

Si el proveedor de IA falla (sin internet, rate limit, servicio caído), el sistema cae automáticamente a templates fijos. El usuario ve una advertencia: "Oferta generada desde template — IA no disponible".

```typescript
async function generateOffer(lead, offerType, channel): Promise<OfferPackage> {
  try {
    const provider = getLLMProvider()  // lee LLM_PROVIDER de .env
    const text = await provider.generate(buildPrompt(lead, offerType, channel))
    return parseOffer(text, channel)
  } catch (err) {
    logger.warn('LLM unavailable, falling back to template', { err })
    return generateFromTemplate(lead, offerType, channel)
  }
}
```

---

## Diseño — Feedback loop de outreach (registro de resultados)

### Principio

El usuario registra qué pasó con cada lead que contactó. Todo es opcional — el objetivo ahora es acumular datos, no procesarlos. El algoritmo aprenderá de ellos cuando haya suficiente volumen.

### Flujo UI del feedback

```
Lead detail → [Marcar como contactado]
  ↓
  Formulario modal (todos los campos opcionales excepto canal):
  
  Canal usado: [Email] [WhatsApp] [Teléfono]
  ¿Respondió?  [Sí] [No]
  
  Si respondió:
    Resultado:  [Interesado] [No interesa ahora] [Ya tiene proveedor] [Cerrado ✅] [Perdido ❌]
    
    Si Cerrado:
      Servicio vendido: [texto libre o select]
      Precio acordado:  [número UYU] (opcional)
      
    Notas libres: [textarea]
  
  [Guardar]
```

El formulario es el mismo para todos los leads. No hay campos obligatorios más allá del canal — si el usuario solo quiere marcar "lo llamé y no respondió", con eso alcanza.

### Tabla `lead_outreach` — diseño final

```sql
CREATE TABLE lead_outreach (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),

  -- Oferta generada (null si fue contacto manual sin oferta generada)
  offer_type    text,
  channel       text NOT NULL,     -- 'email' | 'whatsapp' | 'phone'
  offer_text    text,              -- texto exacto enviado o generado
  offer_source  text,              -- 'llm_gemini' | 'llm_ollama' | 'template' | 'manual'

  -- Estado del pipeline
  status        text NOT NULL DEFAULT 'contacted',
  -- 'contacted' | 'responded' | 'interested' | 'closed_won' | 'closed_lost' | 'no_response'

  -- Resultado (todos opcionales)
  responded     boolean,
  outcome       text,              -- 'closed_won' | 'closed_lost' | 'not_now' | 'has_provider'
  lost_reason   text,              -- 'price' | 'timing' | 'no_interest' | 'competitor' | other
  service_sold  text,              -- descripción libre del servicio vendido
  price_sold    integer,           -- precio en UYU (opcional)
  notes         text,              -- notas libres

  -- Timestamps
  contacted_at  timestamptz DEFAULT now(),
  responded_at  timestamptz,
  closed_at     timestamptz,

  -- Señal de calidad del lead para el algoritmo (futuro)
  -- -1 = el lead era peor de lo que prometía el score
  --  0 = neutral / no evaluado
  -- +1 = el lead era tan bueno o mejor de lo esperado
  lead_quality_signal smallint DEFAULT 0
);

CREATE INDEX lead_outreach_lead_id    ON lead_outreach(lead_id);
CREATE INDEX lead_outreach_status     ON lead_outreach(status);
CREATE INDEX lead_outreach_outcome    ON lead_outreach(outcome) WHERE outcome IS NOT NULL;
CREATE INDEX lead_outreach_closed_at  ON lead_outreach(closed_at) WHERE closed_at IS NOT NULL;
```

### Datos que habilita para el algoritmo (fase futura)

Cuando haya suficiente volumen (estimado: 100+ outcomes registrados):

| Señal | Cómo usarla |
|-------|------------|
| `service_sold` frecuente por `primary_offer` | Validar que el sub-score predice la oferta correcta |
| `price_sold` promedio por niche | Calibrar el deal size estimado en cuantificaciones |
| `lead_quality_signal = -1` + `buyer_type` | Reducir peso de ese buyer_type para leads similares |
| `lost_reason = 'has_provider'` | Tag `already-served` — excluir de futuras exploraciones |
| `outcome = 'closed_won'` + features del lead | Train data para threshold calibration |

---

## Diseño — Pipeline de automatización completo (cron)

### Orden de ejecución — el principio que no debe romperse

```
SIEMPRE: Refrescar lo que tenemos ANTES de buscar lo nuevo.
```

Razón: descubrir 200 leads nuevos mientras los 3.000 existentes tienen datos de hace 6 meses es acumular deuda de calidad. Un lead stale con score calculado en datos viejos es peor que útil — puede enviar al agente a contactar un negocio que ya cerró.

### Flujo completo del pipeline automatizado

```
PIPELINE COMPLETO (cron configurable, ej: domingo 02:00)

  ┌─ FASE 1: REFRESH ENRICHMENT (siempre primero) ──────────────────┐
  │                                                                   │
  │  Para cada source activo (google_places, mintur, osm, yelu):     │
  │    stale = leads WHERE source=X                                   │
  │            AND updated_at < NOW() - source_refresh_days           │
  │            AND passed_filter = true                               │
  │    Si stale.length > 0:                                           │
  │      enrich --source X --force-refresh --concurrency N            │
  │      infer-state --source X (solo los re-enriquecidos)            │
  │      score --source X (solo los re-enriquecidos)                  │
  │                                                                   │
  └───────────────────────────────────────────────────────────────────┘
              ↓ cuando termina
  ┌─ FASE 2: DISCOVERY (nuevos leads) ──────────────────────────────┐
  │                                                                   │
  │  Para cada job en discovery_queue WHERE status='queued'           │
  │  (ordenado por exploration_priority DESC):                        │
  │    discover-external --source X --location Y --niche Z            │
  │    updateAllLeads() + cross-source dedup                          │
  │                                                                   │
  └───────────────────────────────────────────────────────────────────┘
              ↓ cuando termina
  ┌─ FASE 3: ENRICH NEW DISCOVERIES ────────────────────────────────┐
  │                                                                   │
  │  Para cada source que tuvo discovery en Fase 2:                   │
  │    new_leads = leads WHERE source=X AND digital_footprint IS NULL  │
  │    enrich --source X --new-only [--with-heuristic]                │
  │    infer-state --source X --new-only                              │
  │                                                                   │
  └───────────────────────────────────────────────────────────────────┘
              ↓ cuando termina
  ┌─ FASE 4: SCORE ALL UPDATED ─────────────────────────────────────┐
  │                                                                   │
  │  score --all --changed-since <pipeline_start_timestamp>           │
  │  score --buyer-types --changed-since <pipeline_start_timestamp>   │
  │                                                                   │
  └───────────────────────────────────────────────────────────────────┘
              ↓ cuando termina
  ┌─ FASE 5: REPORT ────────────────────────────────────────────────┐
  │                                                                   │
  │  Generar resumen del pipeline:                                    │
  │    - Leads re-enriquecidos: N                                     │
  │    - Leads nuevos descubiertos: N                                 │
  │    - Leads nuevos enriquecidos: N                                 │
  │    - Nuevos hot leads (score >= 55): N                            │
  │    - Score changes relevantes (subió/bajó > 15 puntos): N        │
  │    - Invariantes: passed_not_enriched=0, tags_contradictorios=0  │
  │                                                                   │
  │  Guardar en pipeline_runs. Notificar vía UI (badge en header).   │
  └───────────────────────────────────────────────────────────────────┘
```

### Tabla `pipeline_runs` (nueva)

```sql
CREATE TABLE pipeline_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz DEFAULT now(),
  started_at      timestamptz,
  completed_at    timestamptz,
  trigger         text DEFAULT 'manual',  -- 'manual' | 'cron' | 'ui'
  cpu_budget      text,                   -- 'conservative' | 'balanced' | 'aggressive'
  status          text DEFAULT 'queued',  -- 'queued'|'running'|'completed'|'failed'|'partial'

  -- Configuración de fases (cuáles correr)
  run_refresh     boolean DEFAULT true,
  run_discovery   boolean DEFAULT true,
  run_enrich_new  boolean DEFAULT true,
  run_score       boolean DEFAULT true,

  -- Resultados por fase
  phase_results   jsonb DEFAULT '{}',
  -- {
  --   refresh:   { leads_processed, duration_ms, errors },
  --   discovery: { jobs_run, leads_found, leads_new, leads_corroborated },
  --   enrich:    { leads_processed, duration_ms },
  --   score:     { leads_scored, new_hot, score_changes }
  -- }

  -- Invariantes post-run
  invariants_ok   boolean,
  invariant_details jsonb,

  error_message   text
);
```

### Configuración del cron

```yaml
# config/pipeline.yaml
automation:
  enabled: true
  cron: "0 2 * * 0"       # domingo 02:00 UYU
  cpu_budget: "conservative"  # no interrumpir trabajo humano nocturno

  phases:
    refresh:
      enabled: true
      priority_tiers: ["A", "B"]  # refrescar primero los leads más valiosos
    discovery:
      enabled: true
      max_jobs_per_run: 5         # no más de 5 discovery jobs por cron
    enrich_new:
      enabled: true
      with_heuristic: false       # heurístico solo en runs manuales (lento)
    score:
      enabled: true

  notifications:
    ui_badge: true
    # email: false  (futuro)
```

### CLI para el pipeline completo

```bash
# Run manual completo
blindspot pipeline --run-all [--cpu-budget balanced] [--dry-run]

# Solo refresh de fuentes stale
blindspot pipeline --refresh-only [--source yelu]

# Solo discovery de la cola
blindspot pipeline --discovery-only [--limit 3]

# Ver estado del último run
blindspot pipeline --status
```

---

## Diseño — DGI + RUT (enriquecimiento fiscal)

### Estrategia: traer datos primero, procesar después

El procesamiento es costoso de implementar, pero traer y guardar los datos es gratis. MINTUR ya incluye RUT en muchos registros. La estrategia en fases:

**Fase inmediata (costo: 0):**
- Extraer RUT de `source_data` de leads MINTUR durante el enrich
- Guardar en `lead_company_data.rut`
- No procesar nada todavía

**Fase mediano plazo (costo: bajo):**
- Dataset DGI en datos.gub.uy: descarga única de RUT → razón social → CIIU
- Script de resolución batch: para cada lead con RUT → buscar en dataset → guardar
  - `lead_company_data.razon_social`
  - `lead_company_data.ciiu` (código de actividad económica CIIU4)
- CIIU → `niche` refinado automáticamente para leads "other"

**Fase largo plazo (costo: medio, alto valor):**
- Régimen fiscal (monotributo / IRAE / IVA mínimo) como señal de deal size
- Fuente: BPS dataset o DGI API (requiere gestión de acceso)
- Resultado: `lead_company_data.regimen_fiscal` → factor en `business_quality_pts`

### Tabla de valor del régimen fiscal para scoring

| Régimen | Proxy de facturación | `business_quality` ajuste |
|---------|---------------------|--------------------------|
| Monotributo | < $200.000 UYU/mes | ×0.7 — presupuesto limitado |
| IVA mínimo | $200k–$500k/mes | ×1.0 — neutro |
| IRAE pequeña empresa | $500k–$2M/mes | ×1.3 — tiene presupuesto real |
| IRAE régimen general | > $2M/mes | ×1.5 — deal size alto |

### CIIU → sub-niche para leads "other"

El código CIIU4 resuelve el problema del niche "other" para leads con RUT:

| CIIU4 range | Sub-niche | Sub-scores activados |
|-------------|-----------|---------------------|
| 4711–4719 | retail_general | catalogo, software |
| 4751–4759 | retail_specialty | catalogo, marketing |
| 5610–5630 | restaurant | catalogo, software, marketing |
| 8621–8699 | health_services | reservas_online, software |
| 9311–9329 | gym_sports | reservas_online, software |
| 9511–9529 | repair_services | marketing, web_nuevo |
| 6910–6920 | legal_accounting | web_nuevo, marketing |

### Diseño del parser RUT en enrich

```typescript
// src/modules/enrichment/parsers/rut.ts
// Extrae RUT del source_data de MINTUR y normaliza formato
function parseRutFromMintur(sourceData: Record<string, unknown>): string | null {
  // MINTUR usa campo "RUT" o "rut" en distintas versiones del dataset
  const raw = sourceData['RUT'] ?? sourceData['rut'] ?? sourceData['Rut']
  if (!raw) return null
  // Formato UY: 12 dígitos o con guiones XX.XXX.XXX-X
  return normalizeRut(String(raw))
}

function normalizeRut(raw: string): string {
  // Eliminar puntos, guiones, espacios → solo dígitos
  return raw.replace(/[\.\-\s]/g, '').padStart(12, '0')
}
```

---

## Diseño — Sub-niche detection para leads "other"

### El problema

2.034 leads clasificados como "other" (59% del total passed). Rating promedio 4.57, 225 reviews. Cero hot leads. El sistema no tiene sub-score logic para este niche porque no sabemos qué tipo de negocio son.

Muchos pueden resolverse con CIIU (si tienen RUT). Para los que no, usamos clasificación por nombre vía LLM liviano.

### Flujo de sub-niche detection

```
Al enriquecer un lead con niche='other':

  1. Si tiene RUT y CIIU resuelto → sub_niche del mapa CIIU (ver sección DGI)

  2. Si no tiene RUT o CIIU:
     → Llamar LLMProvider.generate(subNichePrompt(lead))
     → Prompt: "Dado el nombre '{name}' y dirección '{address}' en Uruguay,
               ¿cuál es el rubro de este negocio? Responder con una de estas
               categorías: veterinaria, farmacia, optica, ferreteria, estudio_contable,
               salon_belleza, spa, clinica, escuela, other. Solo la categoría, nada más."
     → Resultado: guardar en lead.niche (si confianza > 0.8) o en
                  lead_company_data.detected_sub_niche (si menor confianza)

  3. Con sub_niche resuelto:
     → Sub-scores específicos según tabla de mapeo sub-niche → buyer_types
     → pitch_hook específico al rubro
```

### Costo estimado de la clasificación batch

- 2.034 leads "other" × ~50 tokens input + 5 tokens output = ~112k tokens total
- Gemini free tier: 1M tokens/día → procesable en 1 corrida sin costo
- Ollama local: sin costo, ~2 segundos por lead con Mistral 7B → ~68 minutos total
- Resultado: 2.034 leads potencialmente activados

### CLI para activar la clasificación

```bash
# Clasificar sub-niche para todos los leads 'other'
blindspot enrich --sub-niche-detection --niche other [--dry-run] [--concurrency 5]
```
