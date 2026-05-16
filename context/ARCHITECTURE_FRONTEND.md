# Blindspot — Frontend Architecture

> Este archivo define el diseño del proyecto frontend `blindspot-ui`.
> Es un proyecto separado que consume la API REST expuesta por el proyecto `blindspot` (este repo).
> No documenta código implementado — para el estado actual del backend ver `ARCHITECTURE.md`.
> Para el diseño objetivo del backend ver `ARCHITECTURE_FUTURE.md`.

---

## Arquitectura de dos proyectos

```
┌─────────────────────────────────┐     REST API      ┌──────────────────────────┐
│  blindspot  (este repo)         │ ◄───────────────► │  blindspot-ui            │
│                                 │                   │                          │
│  • Pipeline CLI                 │                   │  • Next.js 15 (App Router│
│  • Scoring engine               │                   │  • Tailwind + shadcn/ui  │
│  • Discovery providers          │                   │  • Zustand               │
│  • Enrichment                   │                   │  • No acceso directo a DB│
│  • API HTTP (Express/Fastify)   │                   │                          │
│  • Cron / scheduler             │                   │  Repo: blindspot-ui      │
│  • PostgreSQL (Supabase)        │                   └──────────────────────────┘
└─────────────────────────────────┘
```

**Regla crítica:** `blindspot-ui` nunca accede directamente a la base de datos. Toda interacción ocurre vía la API REST que expone el proyecto `blindspot`. La API es la única fuente de verdad.

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
- `GET /api/stats/overview` para los números de leads por oferta/niche/zona
- `GET /api/leads?primary_offer=web_nuevo&contact_tier=A,B,C` para ver el segmento
- Hot clusters: requiere PostGIS activo en el backend (Fase 21)

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
└──────────────────────────────────────────────────────────────────┘
```

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

| Etapa | Qué construir | Prerequisito en backend |
|-------|--------------|------------------------|
| 1 | Vista de lista básica (Lead Explorer sin filtros avanzados) | API `/api/leads` + `contact_tier` en score_breakdown |
| 2 | Filtros por tier + oferta + urgencia | Scoring v2 completo (Fase 22) |
| 3 | Lead Detail completo con sub-scores y señales | `inferred_state` como columna propia |
| 4 | Modal de registro de outreach (contacted/won/lost) | Tabla `lead_outreach` + API `/api/outreach` |
| 5 | Generación de ofertas IA | LLMProvider configurado (Gemini/Ollama) |
| 6 | Segment Explorer (agregaciones y stats) | `GET /api/stats/overview` + PostGIS para clusters |
| 7 | Discovery Control Center + progress en tiempo real | `discovery_jobs` + API `/api/discovery` |
| 8 | Cuantificación PedidosYa + datos fiscales | commission_estimate + CIIU en lead_company_data |

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
    page.tsx              → /leads   — Lead Explorer
    [id]/
      page.tsx            → /leads/:id   — Lead Detail
  outreach/
    page.tsx              → /outreach   — Outreach Tracker
  segments/
    page.tsx              → /segments   — Segment Explorer
  discovery/
    page.tsx              → /discovery  — Discovery Control Center
  api/
    (no aplica — la API vive en el proyecto blindspot)
```

---

## Decisiones de diseño del frontend

| Decisión | Razón |
|----------|-------|
| No acceso directo a DB | Toda lógica de negocio vive en blindspot. El frontend es pure presentation. |
| URL params para filtros | Estado de filtros compartible, funciona con back del browser, recargable. |
| Cursor-based pagination | Los leads se actualizan constantemente — offset-based pierde items entre páginas. |
| Polling para discovery jobs | SSE o WebSockets son overkill para jobs que duran minutos. Polling cada 2s es suficiente. |
| shadcn/ui headless | Sin decisiones de estilo forzadas. Tailwind para customización. |
| No Redux/React Query | Zustand para filtros + fetch nativo con SWR para las queries a la API. |
| SSR solo en carga inicial | La lista de leads cambia con filtros del usuario → CSR después de la carga inicial. |
