# Blindspot — Frontend Architecture

> Este archivo define el diseño del proyecto frontend `blindspot-ui`.
> Es un proyecto separado que consume la API REST expuesta por el proyecto `blindspot` (este repo).
> No documenta código implementado — para el estado actual del backend ver `ARCHITECTURE.md`.
> Para el diseño objetivo del backend ver `ARCHITECTURE_FUTURE.md`.

---

## Arquitectura: un repo, dos procesos

```
blindspot/
├── src/     ← core pipeline (Playwright, scoring, discovery)
├── api/     ← Fastify + JWT auth + REST endpoints
└── ui/      ← este directorio — Next.js 15 (workspace pnpm)
```

```
┌──────────────────────────────────────────────────────────┐
│  ui/  (Next.js 15 · Tailwind + shadcn/ui · Zustand)     │
│  Sin acceso a DB — solo consume REST API interna        │
│  Build estático servido por Nginx en producción         │
└──────────────────────────┬───────────────────────────────┘
                           │ REST /api/v1/ (HTTP · Puerto 3001)
┌──────────────────────────▼───────────────────────────────┐
│  api/  — proceso 1  (pnpm --filter api run start)       │
│  Fastify · TypeScript · Puerto 3001                      │
│  • JWT auth con roles (admin / cm)                       │
│  • Todos los endpoints REST del sistema                  │
│  • Lee leads, runs, scores de la DB                      │
│  • Escribe pipeline_config, discovery_jobs, outreach     │
│  • Dispara pipeline via pg_notify + pipeline_runs row    │
│  • Sin Playwright · Sin lógica de scoring               │
└──────────────────────────┬───────────────────────────────┘
                           │ PostgreSQL compartido (Supabase)
┌──────────────────────────▼───────────────────────────────┐
│  src/  — proceso 2  (pnpm --filter core run start)      │
│  Proceso long-running · Sin HTTP server                  │
│  • LISTEN pipeline_trigger → ejecuta pipeline           │
│  • Poll pipeline_runs 'pending' cada 60s (fallback)     │
│  • Lee pipeline_config → configura cron                  │
│  • Polls discovery_jobs → ejecuta discovery              │
│  • Discovery, Enrichment (Playwright), Scoring           │
│  • Escribe leads, pipeline_runs, scores                  │
└──────────────────────────────────────────────────────────┘
```

**Reglas de separación:**
- `ui/` solo habla con `api/` via HTTP.
- `api/` y `src/` nunca se llaman por HTTP — coordinación exclusiva via PostgreSQL.
- `src/` nunca expone endpoints HTTP.

**Beneficio del repo único:** un solo deploy, migraciones de DB coordinadas, config YAML compartida entre `api/` y `src/`, sin sincronización cross-repo.

**Usuarios y roles:**
- `admin`: acceso completo (pipeline, discovery, todos los leads, gestión de usuarios)
- `cm`: leads filtrados por `lead_filter` configurado por admin, outreach propio, generate-offer
- Ver `ARCHITECTURE_FUTURE.md § Autenticación y roles` para el diseño completo.

---

## Stack del frontend

```
Next.js 15 (App Router)   — SSR para carga inicial rápida, RSC para queries pesadas
Tailwind CSS + shadcn/ui  — componentes headless, sin diseño custom desde cero
Zustand                   — estado de filtros y selección (liviano, sin boilerplate)
```

**Principio de UX:** el agente de ventas que usa esta herramienta tiene 2 minutos por lead. La UI debe responder la pregunta "¿llamo a este o no?" en menos de 5 segundos de lectura.

---

## Contrato de API que consume el frontend

El proyecto `blindspot` expone estos endpoints. El frontend solo consume — no escribe lógica de scoring ni pipeline.

### Leads

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
     → Lead completo con score_breakdown expandido
       + buyer_type_scores ordenados por score DESC
       + corroborating_sources con labels

PATCH /api/leads/:id/contact
     body: { contacted_at, channel, notes }
     → actualiza estado de outreach en leads.contacted_at
```

### Outreach

```
GET  /api/outreach
     ?status=pending,responded
     &order=created_at:desc
     → LeadOutreach[]

POST /api/outreach
     body: { lead_id, channel, offer_type?, offer_text?, offer_source? }
     → crea registro en lead_outreach

PATCH /api/outreach/:id
     body: { status, responded, outcome, lost_reason, service_sold, price_sold, notes }
     → actualiza estado del outreach

POST /api/outreach/generate-offer
     body: { lead_id, offer_type?, channel }
     → OfferPackage generado (LLM o template)
```

### Discovery

```
GET  /api/discovery/jobs?status=running,queued → DiscoveryJob[]
POST /api/discovery/jobs  body: { source, location, niche, profile, max_results, cpu_budget }
PATCH /api/discovery/jobs/:id  body: { action: 'pause'|'resume'|'cancel' }
GET  /api/discovery/suggestions → zonas sugeridas con exploration_priority
GET  /api/discovery/coverage    → mapa de cobertura por zona+fuente
```

### Stats

```
GET /api/stats/overview → { total_leads, hot, pitcheables, by_tier, by_niche, by_source }
GET /api/stats/outreach → { contacted, responded, closed_won, conversion_rate, avg_price }
GET /api/stats/pipeline → { last_run, next_run, phase_results }
```

### Pipeline

```
GET  /api/pipeline/config
     → PipelineConfig completa (schedule, fases, cpu_budget, notificaciones)

PUT  /api/pipeline/config
     body: PipelineConfig completa
     → guarda config en DB (tabla pipeline_config), reconfigura el cron en el servidor

PATCH /api/pipeline/config
     body: campos parciales de PipelineConfig
     → actualización parcial

POST /api/pipeline/run
     body: { overrides?: Partial<PipelineConfig> }
     → dispara ejecución inmediata, responde con { run_id }
     → el servidor inicia el pipeline en background

POST /api/pipeline/run/dry
     body: { overrides?: Partial<PipelineConfig> }
     → simula la ejecución: qué leads refresheará, qué jobs correrá, estimado de tiempo
     → NO ejecuta nada, responde con { plan: PipelinePlan }

POST /api/pipeline/abort
     → aborta el run activo (si lo hay), espera a que el lead actual termine limpiamente

POST /api/pipeline/pause-phase
     body: { phase: 1 | 2 | 3 | 4 }
     → pausa la fase indicada, continúa con la siguiente

GET  /api/pipeline/runs
     ?status=completed,failed,partial
     &limit=20&cursor=<id>
     → PipelineRun[] con stats resumidos

GET  /api/pipeline/runs/active
     → PipelineRun activo con phase_results parciales + job actual
     → null si no hay run corriendo

GET  /api/pipeline/runs/:id
     → PipelineRun completo con phase_results detallados por fuente

GET  /api/pipeline/runs/:id/log
     ?since=<iso_timestamp>
     → líneas de log nuevas desde `since` (para polling del monitor en tiempo real)
```

---

## Tipo `LeadCard` — dato central de la UI

```typescript
interface LeadCard {
  // Identidad
  id: string
  name: string
  address: string
  niche: string
  source: string
  corroborating_sources_count: number

  // Contacto — honesto
  contact_tier: 'A' | 'B' | 'C' | 'D' | 'X'
  contact_email?: string
  contact_phone?: string
  contact_whatsapp?: string

  // Score y oferta
  prospect_score: number
  primary_offer: 'web_nuevo' | 'rediseno' | 'marketing' | 'software' | 'catalogo' | 'none'
  pitch_hook: string
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

---

## Pantallas

### Pantalla 1 — Lead Explorer (vista principal)

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

**Comportamiento de filtros:**
- Filtros se aplican en tiempo real (debounce 300ms) → re-query a API
- Estado de filtros persiste en URL params → compartible y recargable
- Default: tier A+B+C, score ≥ 40, no contactados
- Export → CSV con los leads visibles actualmente

**Búsqueda de texto libre (campo `q`):**
- Barra de búsqueda en el header de la lista: `[Buscar por nombre, dirección o rubro...]`
- Parámetro `?q=veterinaria` → FTS PostgreSQL sobre `search_vector` (Fase 40)
- Se combina con todos los filtros activos → "veterinarias en Montevideo tier A"
- Ordenamiento: `ts_rank` (relevancia) como criterio primario, `prospect_score` como secundario cuando `q` está activo
- Badge "X leads encontrados para '{q}'" en el contador de resultados

---

### Pantalla 2 — Lead Detail

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
│                                                                      │
│  ─────────────────────────────────────────────────────────────────  │
│  [Generar oferta →]   [Marcar contactado]   [Descartar este lead]   │
└──────────────────────────────────────────────────────────────────────┘
```

**Acciones del Lead Detail:**
- **Copiar** email/phone → clipboard con feedback visual
- **Generar oferta** → abre modal con texto generado (LLM o template)
- **Marcar contactado** → abre modal de registro de outreach
- **Descartar** → marca como no contactable (estado local, no borra de DB)

---

### Pantalla 3 — Segment Explorer

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

**Datos que consume:**
- `GET /api/v1/stats/overview` para los números de leads por oferta/niche/zona
- `GET /api/v1/leads?primary_offer=web_nuevo&contact_tier=A,B,C` para ver el segmento
- Hot clusters: requiere PostGIS activo en el backend (Fase 21)

**Mapa geográfico de leads (PostGIS activo — Fase 21):**

Con PostGIS y coordenadas disponibles, el Segment Explorer agrega una vista de mapa:

```
┌──────────────────────────────────────────────────────────────────┐
│  MAPA DE LEADS                              [Lista] [Mapa ●]     │
│                                                                   │
│  [   Mapa de calor — Montevideo — 1.240 leads   ]                │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  🔴🔴🔴    Pocitos (8 sin web)                             │  │
│  │  🔴🔴      Malvín  (5 sin web)                             │  │
│  │  🟡        Centro  (3 sin web)                             │  │
│  │  [mapa interactivo — Leaflet/MapLibre]                     │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  Al hacer click en un cluster → filter Lead Explorer por zona    │
└──────────────────────────────────────────────────────────────────┘
```

**Endpoint requerido:** `GET /api/v1/leads?fields=id,lat,lng,prospect_score,contact_tier&passed_only=true`
→ array liviano de coordenadas + score para renderizar el mapa sin cargar todo el LeadCard.

**Librería:** MapLibre GL JS (MIT, sin API key) o Leaflet con tiles de OpenStreetMap.
**Prerequisito:** PostGIS activado (Fase 21) y columna `gps` en `leads` con backfill de coordenadas.

---

### Pantalla 4 — Outreach Tracker

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
│  [Follow-up] [Cerrar como ganado] [Cerrar como perdido]           │
│                                                                   │
│  CAMPAÑAS ACTIVAS                               (Fase 43)         │
│  ────────────────────────────────────────────────────────         │
│  ● Restaurantes Pocitos mayo 2026                                 │
│    12 contactados · 4 respondieron · 2 interesados                │
│    Conversión: 17%   avg score: 67   [Ver] [Cerrar]               │
│                                                                   │
│  ○ Car dealers Interior — junio 2026                              │
│    0 contactados (recién creada)    [Ver]                         │
│                                                                   │
│  [+ Nueva campaña]                                                │
└──────────────────────────────────────────────────────────────────┘
```

**Comportamiento de campañas:**
- `POST /api/v1/campaigns` con `segment_filter` → crea campaña con leads del segmento actual
- Al registrar outreach desde una campaña activa → `lead_outreach.campaign_id` se auto-asigna
- Stats: `GET /api/v1/campaigns/:id/stats` → `{ conversion_rate, avg_score_contacted, ... }`

---

### Pantalla 5 — Discovery Control Center

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

**Comportamiento:**
- Progress bar en tiempo real vía polling `GET /api/discovery/jobs/:id` cada 2s
- Zonas sugeridas: `GET /api/discovery/suggestions` (gap analysis en backend)
- Cola: `GET /api/discovery/jobs?status=queued,running`
- Iniciar exploración: `POST /api/discovery/jobs`
- Pause/resume/cancel: `PATCH /api/discovery/jobs/:id`

---

### Pantalla 6 — Pipeline Manager

Control total sobre cuándo y cómo se ejecutan las pipelines en el servidor. El usuario configura el schedule, los parámetros de cada fase y puede disparar ejecuciones manuales con overrides.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ PIPELINE MANAGER                              [▶ Ejecutar ahora]        │
├──────────────────────────────────────┬──────────────────────────────────┤
│  SCHEDULE                            │  ESTADO DEL SERVIDOR             │
│  ─────────────────────────────────   │  ──────────────────────────────  │
│  ● Habilitado  ○ Deshabilitado        │  Último run:   hace 3 días       │
│                                      │  Próximo run:  dom 25 May 02:00  │
│  Expresión cron:                     │  Estado:       ✅ completado      │
│  [0  ] [2  ] [*  ] [*  ] [0  ]       │                                  │
│   min   hora  día   mes   dow         │  Stats último run:               │
│  "Domingos a las 02:00 UYU"           │    Re-enriquecidos:    127       │
│                                      │    Nuevos descubiertos: 14       │
│  Próximas 3 ejecuciones:             │    Nuevos hot leads:     3       │
│  Dom 25 May 2026  02:00              │    Invariantes:         ✅        │
│  Dom 01 Jun 2026  02:00              │                                  │
│  Dom 08 Jun 2026  02:00              │  Presupuesto Google Places:      │
│                                      │  ████████████████░░  $194/200   │
│                                      │  (Fase 44 — actualiza por run)  │
│                                      │                                  │
│                                      │  [Ver detalles del run →]        │
├──────────────────────────────────────┴──────────────────────────────────┤
│  FASES Y PARÁMETROS                                                      │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  ☑ Fase 1 — Refresh enrichment                                          │
│    Prioridad de refresh:  ● Tiers A+B primero  ○ Todas las fuentes igual│
│    Fuentes activas:  ☑ Google Places  ☑ MINTUR  ☑ Yelu  ☑ OSM          │
│                                                                          │
│  ☑ Fase 2 — Discovery (cola de jobs pendientes)                         │
│    Máx. jobs por run: [5   ]    Respetar prioridad: ● Sí  ○ No         │
│                                                                          │
│  ☑ Fase 3 — Enrich nuevos descubiertos                                  │
│    Modo heurístico:  ○ Sí (lento, más datos)  ● No (rápido)            │
│    Concurrencia:     [5   ] workers                                     │
│                                                                          │
│  ☑ Fase 4 — Score (todos los actualizados)                              │
│    Recalcular buyer types:  ● Sí  ○ No                                  │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│  PARÁMETROS GLOBALES                                                     │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  CPU Budget:                                                             │
│  ○ Conservador (~5 workers · 20% CPU · para horario laboral)            │
│  ● Balanceado  (~10 workers · 50% CPU · recomendado para cron nocturno) │
│  ○ Agresivo    (~20 workers · 80% CPU · solo si el servidor es dedicado)│
│                                                                          │
│  Timeout por lead:  [120 ] segundos    Reintentos:  [2  ]              │
│                                                                          │
│  Notificaciones al terminar:                                             │
│  ☑ Badge en UI (contador de nuevos hot leads)                           │
│  ☐ Email  [no configurado]                                               │
│                                                                          │
│                                         [Guardar configuración]         │
├──────────────────────────────────────────────────────────────────────────┤
│  EJECUCIÓN MANUAL                                                        │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  Modo:  ● Usar config guardada  ○ Override temporal                     │
│                                                                          │
│  [Override temporal]   CPU Budget: [Balanceado ▼]                       │
│  Fases:  ☑ Refresh  ☑ Discovery  ☑ Enrich  ☑ Score                    │
│  Scope:  ● Todas las fuentes  ○ Solo: [google_places ▼]                │
│                                                                          │
│  [▶ Ejecutar ahora]         [▶ Dry run — ver qué haría sin ejecutar]   │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│  HISTORIAL DE EJECUCIONES                                                │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  18 May 2026  02:01  cron    ✅  4h 12m  Re-enrich:127 Disc:14 Hot:+3  │
│  11 May 2026  02:00  cron    ✅  3h 55m  Re-enrich: 89 Disc: 8 Hot:+1  │
│  08 May 2026  14:32  manual  ✅  1h 23m  Solo refresh · source=yelu     │
│  04 May 2026  02:01  cron    ⚠️  2h 41m  Partial — Fase 3 timeout      │
│                                                                          │
│                                            [Ver más historial →]        │
└──────────────────────────────────────────────────────────────────────────┘
```

**Comportamiento:**
- Guardar config → `PUT /api/pipeline/config` — persiste en DB (`pipeline_config` table)
- Ejecutar ahora → `POST /api/pipeline/run` con optional overrides → abre monitor de ejecución
- Dry run → `POST /api/pipeline/run/dry` → muestra resumen de qué haría (sin ejecutar)
- Historial → `GET /api/pipeline/runs` paginado

---

### Pantalla 6b — Monitor de Ejecución Activa

Aparece automáticamente cuando hay un pipeline corriendo. También accesible desde el historial.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  PIPELINE EN EJECUCIÓN — iniciado hace 23 min              [Abortar ✕]  │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ✅ Fase 1 — Refresh enrichment                  completado · 1h 23m    │
│     google_places: 45 · mintur: 32 · yelu: 28 · osm: 22               │
│                                                                          │
│  ⏳ Fase 2 — Discovery                           corriendo · 3/5 jobs   │
│     ████████████░░░░░░░  60%                                            │
│     Job actual: Yelu · Salto · restaurant · 134/200 leads              │
│     12 nuevos · 4 corroborados hasta ahora                             │
│                                                                          │
│  ⏸  Fase 3 — Enrich nuevos                       esperando Fase 2      │
│  ⏸  Fase 4 — Score                               esperando Fase 3      │
│                                                                          │
│  [Pausar Fase 2]   [Saltear Fase 2 y continuar]                        │
│                                                                          │
│  Log en tiempo real:                                                    │
│  [14:23:41] Yelu Salto restaurant: lead "La Vieja Cocina" insertado    │
│  [14:23:44] Yelu Salto restaurant: lead "El Rancho" corroborado (OSM)  │
│  [14:23:47] Yelu Salto restaurant: 134/200 procesados                  │
│                                                     [▼ Scroll al final] │
└──────────────────────────────────────────────────────────────────────────┘
```

**Comportamiento:**
- Polling cada 3s a `GET /api/pipeline/runs/active` mientras hay un run activo
- Abortar → `POST /api/pipeline/abort` con confirmación
- Pausar fase → `POST /api/pipeline/pause-phase` (pausa el job actual, completa el lead en proceso)
- Log en tiempo real: polling a `GET /api/pipeline/runs/:id/log?since=<timestamp>` cada 3s

---

### Pantalla 6c — Detalle de Ejecución

Desde el historial, al hacer "Ver detalles" en un run completado.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ← Volver    Pipeline Run — 18 May 2026 · 02:01  (cron)                 │
│             ✅ Completado en 4h 12min                                   │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  FASE 1 — Refresh enrichment          1h 38min                          │
│  ────────────────────────────────────────────────────────────────────   │
│  google_places    45 leads    23 min                                    │
│  mintur           32 leads    28 min                                    │
│  yelu             28 leads    41 min (más lento — scraping)             │
│  osm              22 leads     6 min                                    │
│                                                                          │
│  FASE 2 — Discovery                   22min · 5 jobs                   │
│  ────────────────────────────────────────────────────────────────────   │
│  Yelu · Salto · restaurant      12 nuevos  3 corroborados              │
│  OSM  · Rivera · gym             0 nuevos  0 corroborados              │
│  GP   · Rocha · restaurant       2 nuevos  1 corroborado               │
│  Yelu · Maldonado · hairdresser  0 nuevos  0 corroborados              │
│  OSM  · Salto · car_dealer       0 nuevos  2 corroborados              │
│                                                                          │
│  FASE 3 — Enrich nuevos               18min · 14 leads                 │
│                                                                          │
│  FASE 4 — Score                       14min · 3.141 leads re-scoreados  │
│  Nuevos hot leads (≥55):  3                                             │
│  Score subió > 15pts:    28    Score bajó > 15pts:  12                 │
│                                                                          │
│  INVARIANTES POST-RUN                                                   │
│  passed_not_enriched:  0  ✅                                            │
│  tags_contradictorios: 0  ✅                                            │
│  passed_sin_score:     0  ✅                                            │
│  contact_tier_X_hot:   0  ✅                                            │
│                                                                          │
│  [Ver leads nuevos →]   [Ver cambios de score →]                        │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Modal — Registro de Outreach

Se abre desde Lead Explorer o Lead Detail al hacer "Marcar contactado".

```
┌─────────────────────────────────────────────┐
│  Registrar contacto — La Parrilla Don Carlos │
├─────────────────────────────────────────────┤
│                                             │
│  Canal:  [Email]  [WhatsApp]  [Teléfono]    │
│                                             │
│  ¿Respondió?   [Sí]  [No]                  │
│                                             │
│  Resultado:                                 │
│  ○ Interesado — pidió más info              │
│  ○ No le interesa ahora                     │
│  ○ Ya tiene proveedor                       │
│  ○ Cerrado — vendido ✅                     │
│  ○ Perdido ❌                               │
│                                             │
│  (si Cerrado)                               │
│  Servicio: [__________________________]     │
│  Precio UYU: [________]  (opcional)         │
│                                             │
│  Notas: [__________________________________]│
│                                             │
│  [Cancelar]                    [Guardar]    │
└─────────────────────────────────────────────┘
```

**Todos los campos opcionales excepto Canal.** `POST /api/outreach` al guardar.

---

## Modal — Generación de Oferta

```
┌──────────────────────────────────────────────────────┐
│  Oferta generada — La Parrilla Don Carlos             │
│  Tipo: Marketing social · Canal: WhatsApp             │
│  Fuente: Gemini Flash ✨                              │
├──────────────────────────────────────────────────────┤
│                                                      │
│  Hola! Vi La Parrilla en Google y tienen muy buenas  │
│  reseñas 👏 Notamos que su Facebook tiene 8 meses    │
│  sin actividad. Les preparé algo corto para mostrar  │
│  cómo podría verse con community management activo.  │
│  ¿Les interesa verlo?                                │
│                                                      │
│  [Editar texto]                    [Copiar ✓]        │
│                                                      │
│  ──────────────────────────────────────────────────  │
│  Canal email:                                        │
│  Asunto: "La Parrilla Don Carlos — sus clientes...  │
│  [Ver versión email →]                               │
│                                                      │
│  [Cambiar tipo de oferta ▼]        [Regenerar]       │
│                                                      │
│  [Cerrar]                [Marcar como contactado →]  │
└──────────────────────────────────────────────────────┘
```

`POST /api/outreach/generate-offer` con `{ lead_id, offer_type, channel }`.

---

## Componentes reutilizables

| Componente | Props | Función |
|-----------|-------|---------|
| `<ContactTierBadge tier="A" />` | tier: A/B/C/D/X | Badge con color y tooltip del canal |
| `<ScoreBar score={74} />` | score: 0–100 | Barra con color gradient |
| `<UrgencyBadge signal="high" />` | signal: high/medium/low | 🔴🟡⚪ |
| `<PitchHook text="..." />` | text: string | Frase destacada, copiable con 1 click |
| `<OperationalState state={...} />` | InferredState | Íconos ✅/❌ por dimensión |
| `<BuyerTypeBar types={[...]} />` | BuyerTypeScore[] | Barras horizontales top 3 |
| `<ContactActions lead={...} />` | LeadCard | Botones: copiar email, abrir WA, marcar contactado |
| `<SourcesBadges sources={[...]} />` | string[] | Chips: GP / MINTUR / Yelu / OSM |
| `<OutreachModal lead={...} />` | LeadCard | Modal de registro de contacto |
| `<OfferModal lead={...} />` | LeadCard | Modal de oferta generada |

---

## Orden de construcción de la UI

No construir todo de una vez. Prerequisito base: API server activo en `blindspot`.

| Etapa | Pantalla / Feature | Prerequisito en backend |
|-------|-------------------|------------------------|
| 1 | Lead Explorer básico (lista sin filtros avanzados) | API `/api/v1/leads` + `contact_tier` en score_breakdown |
| 2 | Filtros por tier + oferta + urgencia + score | Scoring v2 completo (Fase 22) |
| 3 | Lead Detail completo con sub-scores y señales | `inferred_state` como columna propia |
| 4 | Modal de registro de outreach (contacted/won/lost) | Tabla `lead_outreach` + API `/api/v1/outreach` |
| 5 | **Pipeline Manager** — config + ejecución manual + historial + budget tracker | Fase 23 + Fase 44 (budget tracker) |
| 6 | **Monitor de ejecución activa** (progress en tiempo real) | `GET /api/v1/pipeline/runs/active` + log endpoint |
| 7 | Generación de ofertas IA | LLMProvider configurado (Gemini/Ollama) |
| 8 | Segment Explorer + mapa geográfico | `GET /api/v1/stats/overview` + PostGIS (Fase 21) |
| 9 | Discovery Control Center (gestión de cola) | `discovery_jobs` + API `/api/v1/discovery/suggestions` |
| 10 | **Full-text search** en Lead Explorer | `search_vector` FTS (Fase 40) |
| 11 | **Campañas de outreach** en Outreach Tracker | Tabla `outreach_campaigns` (Fase 43) |
| 12 | Cuantificación PedidosYa + datos fiscales | commission_estimate + CIIU en lead_company_data |

---

## Templates de oferta por tipo

Usados como fallback cuando LLM no está disponible.

### web_nuevo — sin web

```
Canal WA:
"Hola! Vi {name} en Google y tienen muy buenas reseñas 👏 Notamos que no tienen
web propia — preparé algo corto para mostrarles. ¿Les interesa verlo?"

Canal email:
Asunto: "{name} — ¿Sabías que el 70% de tus clientes te busca en Google antes de ir?"
Cuerpo: "Hola, te escribo porque vi que {name} tiene muy buenas reseñas pero no encontré
su sitio web. Con {review_count} opiniones, claramente hacen las cosas bien.
Hoy los clientes buscan en Google, ven que no hay web y eligen otro lugar.
¿Tienen 15 minutos para que les muestre un ejemplo en su rubro?"
```

### delivery_propio — PedidosYa escape

```
Asunto: "{name} — Cuánto están pagando a PedidosYa por mes"
Cuerpo: "Con ~{monthly_orders_est} pedidos mensuales y 30% de comisión, la plataforma
se lleva ~${commission_monthly_uyu} UYU/mes. Sistema de pedidos propio: los clientes
piden directo en su web o WhatsApp. Sin comisiones.
El sistema cuesta ${system_cost} UYU/mes. Ahorro neto: ~${monthly_savings_est} UYU.
¿Les interesa ver cómo funciona para restaurantes en Montevideo?"
```

### software — sin reservas (gym/hairdresser)

```
Asunto: "{name} — {X} clientes no pudieron reservar turno este mes"
Cuerpo: "Noté que {name} no tiene sistema de reservas online.
En {niche}, el 40% de los clientes nuevos elige el lugar que les permite
reservar desde el celular. Sin reservas online, ese porcentaje elige otro.
¿Les muestro cómo quedó para una {niche} similar en Montevideo?"
```

---

## Diseño de rutas Next.js

```
app/
  layout.tsx              — navbar, sidebar de filtros persistente
  page.tsx                → /   — redirect a /leads
  leads/
    page.tsx              → /leads         — Lead Explorer
    [id]/
      page.tsx            → /leads/:id     — Lead Detail
  outreach/
    page.tsx              → /outreach      — Outreach Tracker
  segments/
    page.tsx              → /segments      — Segment Explorer
  discovery/
    page.tsx              → /discovery     — Discovery Control Center (cola de jobs)
  pipeline/
    page.tsx              → /pipeline      — Pipeline Manager (config + ejecución + historial)
    runs/
      [id]/
        page.tsx          → /pipeline/runs/:id — Detalle de ejecución
  api/
    (no aplica — la API vive en el proyecto blindspot)
```

---

## Decisiones de diseño del frontend

| Decisión | Razón |
|----------|-------|
| No acceso directo a DB | Toda lógica de negocio vive en blindspot. El frontend es pure presentation. |
| URL params para filtros | Estado de filtros compartible, funciona con back del browser, recargable. |
| Cursor-based pagination (todos los endpoints) | Los leads se actualizan constantemente — offset-based pierde items entre páginas. Aplica también a outreach y pipeline/runs. |
| Polling para discovery jobs y pipeline monitor | SSE o WebSockets son overkill para jobs que duran minutos. Polling cada 2–3s es suficiente. |
| shadcn/ui headless | Sin decisiones de estilo forzadas. Tailwind para customización. |
| No Redux/React Query | Zustand para filtros + SWR para queries a la API. |
| SSR solo en carga inicial | La lista de leads cambia con filtros del usuario → CSR después de la carga inicial. |
| API `/api/v1/` desde el inicio | Permite introducir `/api/v2/` para breaking changes sin romper el frontend en producción. |
| FTS con `plainto_tsquery` en backend | La búsqueda de texto ocurre en PostgreSQL — el frontend solo manda `?q=`. Sin Elasticsearch, sin infraestructura adicional. |
| Mapa con MapLibre GL JS (no Google Maps) | MIT license, sin API key, tiles de OpenStreetMap. Solo activo cuando PostGIS está disponible (Fase 21). |
| Campañas vinculadas a outreach (no a leads) | Un lead puede pertenecer a múltiples campañas en distintos momentos. El vínculo está en `lead_outreach.campaign_id`, no en `leads`. |
