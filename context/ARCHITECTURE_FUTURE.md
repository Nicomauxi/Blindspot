# Blindspot — Future Architecture

> Este archivo define el diseño objetivo del sistema backend (`blindspot`), no el estado actual.
> No documenta código implementado — para eso existe `ARCHITECTURE.md`.
> Su función es servir de norte compartido para que cada fase se construya
> en dirección correcta y los datos recopilados se usen a su máximo potencial.
>
> **Modelo de uso (decidido 2026-05-16):** herramienta interna privada. 1 admin + 2–8 socios con accesos delimitados (`lead_filter`). NO se comercializa, NO hay self-registration. Ver `PROJECT_MASTER.md § Modelo de uso` para detalles.
>
> **Fuente canónica de ejecución:** `ROADMAP_CANONICAL.md`. Este archivo describe diseño objetivo; si contradice el roadmap canónico, gana `ROADMAP_CANONICAL.md`.
>
> **Documentos relacionados:**
> - `ARCHITECTURE_FRONTEND.md` — pantallas de uso normal de la UI (`ui/`).
> - `ADMIN_PANEL.md` — pantallas y endpoints específicos del panel admin (user management, costos, performance, audit log, system status).
> - `FUTURE.md` — backlog priorizado de fases.
>
> Antes de implementar cualquier fase nueva: leer este archivo para verificar
> que la implementación sea coherente con el diseño objetivo.
>
> **Schemas canónicos consolidados (octava auditoría 2026-05-16):**
> - `accessibility_factor` valores: X=0.30, D=0.65, C=0.90, B=1.15, A=1.30 — **tiers mutuamente excluyentes, no existe combinación A+B**. Un solo set en `§ Componente 4 — accessibility_factor`. Ajuste por reliability: `× (0.75 + 0.25 × contact_reliability_score)`.
> - `lead_outreach`: ver `§ Tabla lead_outreach — diseño final`. **Creada en Fase API-0** (movida desde Fase 25 por octava auditoría) para desbloquear la matriz de autorización de Fase API sin esperar a Bloque 7. Fase 25 ahora cubre solo trigger de `contacted_by` + CLI stats + verificación end-to-end.
> - `pipeline_runs` / `pipeline_config` / `discovery_jobs` / `audit_log` / `lead_outreach`: todos creados en Fase API-0 con el schema canónico — sin stubs reducidos. Naming canónico: `triggered_by` (no `trigger`), `phases` (no `phase_config`), `user_id` (no `created_by` en discovery_jobs), `log_lines jsonb` (no `text[]`).
> - `audit_log.action` lista canónica en FUTURE.md Fase API-0 step 7 (sincronizada con ADMIN_PANEL.md tabla de endpoints).
> - `lead_filter = '{}'` requiere flag `acknowledge_unrestricted: true` en el body de `POST /api/v1/users` o `PATCH /api/v1/users/:id`. Ver `§ Validaciones en API antes de PATCH /users/:id`.

---

## Arquitectura: un repo, dos procesos

El sistema vive en un único repositorio con tres directorios de código y dos procesos en producción.
Contexto de uso: herramienta personal + acceso a usuarios seleccionados (baja concurrencia, 2–8 usuarios).

```
blindspot/                   ← repo único
├── src/                     ← core pipeline (ya existe)
├── api/                     ← NUEVO: Fastify + auth + REST endpoints
├── ui/                      ← NUEVO: Next.js 15 (workspace pnpm)
├── config/                  ← YAML compartido entre core y api
├── .env                     ← variables de entorno de todos los procesos (un solo .env en raíz)
└── pnpm-workspace.yaml
```

**`pnpm-workspace.yaml` (contenido):**
```yaml
packages:
  - 'src'        # core pipeline — package.json en src/
  - 'api'        # Fastify API
  - 'ui'         # Next.js
```

**Requisito crítico:** `pnpm --filter <name>` filtra por el campo `name` del `package.json`, NO por el nombre del directorio. Para que los comandos funcionen:
- `src/package.json` debe tener `"name": "core"` (no "blindspot" u otro)
- `api/package.json` debe tener `"name": "api"`
- `ui/package.json` debe tener `"name": "ui"`

**Comandos cross-workspace:**
```bash
pnpm --filter api run start      # arranca API (api/package.json "name": "api")
pnpm --filter core run start     # arranca core pipeline (src/package.json "name": "core")
pnpm --filter ui run dev         # Next.js dev server
pnpm --filter ui run build       # build estático para Nginx
```

**`.env` — un solo archivo en la raíz, cargado por todos los procesos:**
```
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_KEY=...
API_JWT_SECRET=...   # mínimo 32 chars aleatorios
GOOGLE_PLACES_API_KEY=...
LLM_PROVIDER=gemini  # gemini | ollama | openai-compatible
GEMINI_API_KEY=...
CORS_ORIGIN=http://localhost:3000   # en dev; en prod: https://blindspot.tudominio.com
PORT=3001            # puerto del servidor API
```

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ui/  (Next.js 15 · Tailwind + shadcn/ui · Zustand)                     │
│  Sin acceso a DB — solo consume REST API interna                         │
│  Build estático servido por Nginx en producción                          │
└────────────────────────────┬─────────────────────────────────────────────┘
                             │ REST /api/v1/ (HTTP · Puerto 3001)
┌────────────────────────────▼─────────────────────────────────────────────┐
│  api/  — proceso 1  (pnpm --filter api run start)                       │
│  Fastify · TypeScript · Puerto 3001                                      │
│  • JWT auth con roles (admin / cm)                                       │
│  • Endpoints REST filtrados por rol                                      │
│  • Lee leads, scores, pipeline_runs de la DB                             │
│  • Escribe pipeline_config, discovery_jobs, lead_outreach                │
│  • Dispara pipeline via pg_notify + pipeline_runs 'pending'              │
│  • Sin Playwright · Sin scoring logic · Sin discovery providers          │
└────────────────────────────┬─────────────────────────────────────────────┘
                             │ PostgreSQL compartido (Supabase)
┌────────────────────────────▼─────────────────────────────────────────────┐
│  src/  — proceso 2  (pnpm --filter core run start)                      │
│  Proceso long-running · Sin HTTP server                                  │
│  • LISTEN pipeline_trigger (pg_notify) → ejecución inmediata            │
│  • Poll pipeline_runs 'pending' cada 60s (fallback si NOTIFY se pierde) │
│  • Poll discovery_jobs 'queued' cada 30s → ejecuta discovery            │
│  • Lee pipeline_config → configura cron interno                          │
│  • Discovery providers (Playwright, scraping, APIs)                      │
│  • Enrichment (Playwright, parsers, heurístico)                          │
│  • Scoring engine (sub-scores, buyer_types, contact_tier)                │
│  • Escribe leads, pipeline_runs, lead_buyer_scores                       │
└──────────────────────────────────────────────────────────────────────────┘
```

**Regla de comunicación:** `api/` y `src/` nunca se llaman por HTTP entre sí. Toda coordinación ocurre via PostgreSQL:
- `api/` escribe → `src/` lee y ejecuta
- `src/` escribe resultados → `api/` los expone al frontend

**Ventaja del repo único:** una sola configuración de CI/CD, un solo deploy, migraciones de DB coordinadas sin sincronizar repos, config YAML compartida sin duplicación.

---

## Autenticación y roles

### Tabla `users`

```sql
CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text UNIQUE NOT NULL,
  password_hash   text NOT NULL,             -- bcrypt, cost 12
  role            text NOT NULL CHECK (role IN ('admin', 'cm')),
  lead_filter     jsonb,                     -- filtro configurable por admin para cada CM
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  last_login_at   timestamptz,              -- null = nunca ha hecho login
  active          boolean DEFAULT true
);
```

**`lead_filter`** permite que el admin defina qué ve cada CM sin tocar código. Schema canónico (todos los campos opcionales — ausentes ⇒ no se aplica el filtro):

```typescript
interface LeadFilter {
  primary_offer?: PrimaryOffer[];           // OR entre valores; intersección con filtros del request
  contact_tier?: ('A'|'B'|'C'|'D'|'X')[];   // tier permitido (típico: ['A','B','C'])
  niche?: string[];                          // niches permitidos
  detected_sub_niche?: string[];             // post-Fase 28 — coincide contra leads.lead_company_data->>'detected_sub_niche' (JSONB path, no FK)
  min_prospect_score?: number;               // 0–100
  max_prospect_score?: number;               // raro pero útil para pool intermedio
  geo_radius?: {                             // requiere PostGIS (Fase 21) — validar en API antes de guardar
    center: { lat: number; lng: number };
    meters: number;
  };
  source?: DiscoverySource[];                // limitar a ciertas fuentes
  exclude_franchises?: boolean;              // default true cuando se omite
  exclude_contacted?: boolean;               // si true, oculta leads con contacted_at != null
  max_leads_visible?: number | null;         // null = sin tope; aplica como LIMIT global
  require_inferred_state?: {                 // requiere Fase 47 (columna inferred_state)
    has_delivery?: boolean;
    has_pos?: boolean;
    has_reservations?: boolean;
  };
}
```

**Traducción a SQL (aplicada en `api/src/routes/leads.ts` antes de los filtros del request):**

```sql
-- Si lead_filter.contact_tier = ['A','B'] →
WHERE l.score_breakdown->>'contact_tier' = ANY(ARRAY['A','B'])

-- Si lead_filter.geo_radius = { center: { lat, lng }, meters } →
AND ST_DWithin(l.gps, ST_MakePoint($lng,$lat)::geography, $meters)

-- Si lead_filter.exclude_franchises = true →
AND NOT ('franchise-detected' = ANY(l.tags))

-- Si lead_filter.exclude_contacted = true →
AND l.contacted_at IS NULL

-- Si lead_filter.require_inferred_state.has_delivery = true →
AND (l.inferred_state->'has_delivery'->>'value')::boolean = true

-- max_leads_visible se aplica como LIMIT MIN(request.limit, lead_filter.max_leads_visible)
```

**Validaciones en API antes de `POST /api/v1/users` y `PATCH /api/v1/users/:id`:**

Para body con `lead_filter`:
- Si `lead_filter` no está presente en `POST` → 400 con `error_code='lead_filter_required'` (CM sin filtro inválido — `IS NULL` también falla).
- Si `lead_filter = '{}'` (objeto vacío) y el body NO incluye `acknowledge_unrestricted: true` → 400 con `error_code='lead_filter_empty_requires_ack'`, body de respuesta:
  ```json
  {
    "error": "lead_filter empty requires explicit acknowledgement",
    "error_code": "lead_filter_empty_requires_ack",
    "hint": "Include 'acknowledge_unrestricted: true' in the request body to confirm the CM should see all leads without restriction."
  }
  ```
  Con el flag presente, se guarda `lead_filter = '{}'` en DB y el CM queda sin restricciones. El flag NO se persiste — solo desbloquea el guardado en esa request específica.
- Si algún campo de `lead_filter` es array vacío (ej. `{ primary_offer: [] }`) → 400 con `error_code='lead_filter_array_empty'` (configuración de error: 0 leads visibles para el CM). Distinto del caso `{}` que sí permite ver todos.
- Si `geo_radius` está presente en el body, verificar que PostGIS esté activo (`SELECT extversion FROM pg_extension WHERE extname='postgis'`). Sino → 400 con `error_code='postgis_not_active'`.
- En `PATCH /api/v1/users/:id`, esta validación solo corre si el request intenta crear o modificar `lead_filter.geo_radius`. Un `geo_radius` ya persistido no debe bloquear updates no relacionados (password, role, active o cambios en otras partes del filtro).
- Si `detected_sub_niche` está presente, verificar que Fase 28 esté aplicada. `lead_company_data` es una columna JSONB en `leads`, no una tabla — usar `SELECT 1 FROM leads WHERE lead_company_data ? 'detected_sub_niche' LIMIT 1`. Si la query retorna 0 filas → 400 con `error_code='subniche_phase_pending'` y mensaje "Fase 28 pendiente — no hay leads con sub-niche detectado todavía".
- Si `require_inferred_state` está presente, verificar que `leads.inferred_state` exista como columna (Fase 47). Sino → 400 con `error_code='inferred_state_column_missing'`.

**Comportamiento canónico para CM (sincronizado con `ROADMAP_CANONICAL.md § Reglas de acceso`):**
- `role='admin'`: ve todo, ignora `lead_filter`.
- CM con `lead_filter IS NULL`: configuración inválida — `POST/PATCH` lo rechaza con `lead_filter_required`. Si existe por datos viejos, sus requests fallan cerrado (no ve ningún lead).
- CM con `lead_filter = '{}'`: sin restricciones — equivale a ver todos los leads. Solo se persiste si fue creado/actualizado con `acknowledge_unrestricted: true`.
- CM con algún campo array vacío: rechazado con `lead_filter_array_empty`.
- CM con filtro válido: ve solo la intersección entre `lead_filter` y filtros del request.
- **`lead_filter` se carga desde DB en cada request protegido.** Si admin lo cambia con `PATCH /api/v1/users/:id`, el siguiente request del CM (sin re-login, con el mismo JWT) ya usa el filtro nuevo. Test obligatorio en la matriz de Fase API — ver `ROADMAP_CANONICAL.md § Criterio obligatorio para Fase API` (test "Live update de lead_filter").

### JWT

- Firmado con secret en `.env.API_JWT_SECRET`
- Payload: `{ user_id, email }` como identidad mínima. `role`, `active` y `lead_filter` se cargan desde DB en cada request protegido.
- Expiración: 24h
- Sin self-registration — admin crea cuentas vía `POST /api/v1/users`
- Revocación: `UPDATE users SET active=false`. El middleware verifica `active` en la DB en cada request para que la revocación sea inmediata. Para 2–8 usuarios este hit a la DB es aceptable.
- **No confiar en `lead_filter` dentro del JWT.** Si admin cambia el filtro de un CM, el siguiente request debe usar el filtro actualizado desde DB. Esto evita exposición accidental por tokens viejos sin necesidad de `token_version` en la etapa actual.

### Mapa de acceso por rol

| Endpoint | admin | cm |
|----------|:-----:|:--:|
| POST /auth/login | 🌐 público | 🌐 público |
| POST /auth/refresh | 🌐 público | 🌐 público |
| GET /api/v1/leads (filtrado por lead_filter) | ✅ todos | ✅ su filtro |
| GET /api/v1/leads/:id | ✅ | ✅ si pasa su filtro |
| GET /api/v1/outreach | ✅ todos | ✅ solo propios |
| POST /api/v1/outreach | ✅ | ✅ (user_id = suyo) |
| PATCH /api/v1/outreach/:id | ✅ | ✅ solo propios |
| POST /api/v1/outreach/generate-offer | ✅ | ✅ |
| GET /api/v1/stats/overview | ✅ global | ✅ solo su outreach |
| GET /api/v1/pipeline/config | ✅ | ❌ |
| PUT /api/v1/pipeline/config | ✅ | ❌ |
| POST /api/v1/pipeline/run | ✅ | ❌ |
| GET /api/v1/discovery/jobs | ✅ | ❌ |
| POST /api/v1/discovery/jobs | ✅ | ❌ |
| GET /api/v1/users | ✅ | ❌ |
| GET /api/v1/users/:id | ✅ | ❌ |
| POST /api/v1/users | ✅ | ❌ |
| PATCH /api/v1/users/:id | ✅ | ❌ |
| DELETE /api/v1/users/:id | ✅ | ❌ |
| GET /api/v1/campaigns | ✅ todas | ✅ solo propias |
| POST /api/v1/campaigns | ✅ | ✅ (user_id = suyo) |
| GET /api/v1/campaigns/:id/stats | ✅ | ✅ solo propia |
| GET /api/v1/admin/costs/overview | ✅ | ❌ |
| GET /api/v1/admin/costs/history | ✅ | ❌ |
| GET /api/v1/admin/performance/overview | ✅ | ❌ |
| GET /api/v1/admin/performance/errors | ✅ | ❌ |
| GET /api/v1/admin/performance/quality | ✅ | ❌ |
| GET /api/v1/admin/system/status | ✅ | ❌ |
| POST /api/v1/admin/system/restart-core | ✅ | ❌ |
| POST /api/v1/admin/system/restart-api | ✅ | ❌ |
| GET /api/v1/admin/audit-log | ✅ | ❌ |
| GET /api/v1/health | 🌐 público | 🌐 público |

**Regla `/api/v1/admin/*`:** todos requieren `role=admin` en el JWT. El middleware de Fastify (en `api/src/auth/middleware.ts`) rechaza con 403 antes de invocar el handler. Specs detalladas en `ADMIN_PANEL.md`.

**Disponibilidad real de datos en endpoints admin:** que el endpoint exista desde Fase API no implica que todas sus métricas estén listas desde ese momento. `GET /api/v1/admin/costs/*` queda plenamente operativo recién con `Fase 44-pre` + `Fase 44`; `GET /api/v1/admin/performance/*` recién con `Fase 45-pre` + `Fase 45`. Antes de esos prerequisitos, el handler puede devolver métricas parciales derivables de tablas existentes o una respuesta explícita de "data not ready", pero no debe fabricar valores ni asumir tablas futuras.

**`POST /auth/login`**: `body: { email, password }` → `{ token, user: { id, email, role, lead_filter } }`. Sin JWT — este endpoint lo emite.

**`POST /auth/refresh`**: `body: { token }` (token válido o recién expirado, hasta 7 días desde emisión) → `{ token }` nuevo con 24h más. Antes de emitir, volver a cargar `users.active` desde DB; si `active=false` → 401 con `error_code='account_inactive'`. El CM no necesita re-autenticarse si usa la app diariamente. Si el token tiene más de 7 días → 401, re-login.

**Rate limiting canónico para auth:** `POST /auth/login` = 10 req/min por IP, `POST /auth/refresh` = 30 req/min por IP, resto de endpoints = 100 req/min por IP salvo override más restrictivo.

**Nota — CM y su propia contraseña:** los CMs no tienen endpoint para cambiar su propia contraseña (decisión de diseño: uso interno, admin lo gestiona via `PATCH /api/v1/users/:id`). Si se requiere auto-servicio en el futuro, agregar `PATCH /api/v1/users/me` con body `{ current_password, new_password }` limitado al usuario autenticado.

---

## Diseño objetivo — `api/` (directorio en el mismo repo)

Directorio `api/` dentro del repo único. Stack mínimo: Fastify + TypeScript + cliente Supabase (mismo connection string que `src/`). Sin lógica de negocio — solo traducir requests HTTP a queries SQL y viceversa, con auth JWT + roles.

### Stack

```typescript
// api/src/server.ts
import Fastify from 'fastify'
import { createClient } from '@supabase/supabase-js'

const app = Fastify({ logger: true })
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
// acceso a la misma DB que src/ (core pipeline)
// lectura de leads/runs + escritura de pipeline_config, discovery_jobs, lead_outreach
```

### Endpoints que expone

```
GET  /api/v1/leads
     ?contact_tier=A,B,C  &prospect_score_gte=40  &niche=restaurant
     &urgency_signal=high  &primary_offer=web_nuevo  &contacted=false
     &q=veterinaria  &source=google_places,mintur
     &order=prospect_score:desc  &limit=50&cursor=<id>
     → LeadCard[] desde lead_dashboard VIEW

GET  /api/v1/leads/:id
     → Lead completo con score_breakdown + buyer_type_scores + corroborating_sources

// ELIMINADO: PATCH /api/v1/leads/:id/contact — endpoint residual eliminado por auditoría.
// Razón: se solapaba con POST /api/v1/outreach + trigger SQL contacted_by (Fase 25). El
// único path para registrar contacto es POST /api/v1/outreach. El trigger SQL actualiza
// leads.contacted_at y leads.contacted_by automáticamente al primer outreach del lead.
// Mantener dos paths producía contacted_at inconsistente con lead_outreach.

GET  /api/v1/outreach?status=contacted,responded
     // status values del enum canónico de lead_outreach.status:
     //   contacted | responded | interested | closed_won | closed_lost | no_response
POST /api/v1/outreach  body: { lead_id, channel, offer_type, offer_package? }
     → offer_package: { text: string, source_llm: string|null, generated_at: string }
     → NO usar offer_text como campo separado — todo va dentro de offer_package
     → IMPLEMENTACIÓN REAL desde Fase API (no stub): la tabla lead_outreach se crea
       en Fase API-0 con schema canónico completo. El handler valida user_id contra
       el JWT del CM y rechaza outreach de otros usuarios.
PATCH /api/v1/outreach/:id  body: { status, outcome, service_sold, price_sold, notes }
     → CM solo puede modificar sus propios outreach (filtra por user_id en el SELECT
       previo al UPDATE; si el row pertenece a otro CM, retorna 404).
POST /api/v1/outreach/generate-offer  body: { lead_id, offer_type?, channel }
     → En Fase API: stub que devuelve template fijo (OfferPackage).
       Los templates viven en `api/src/offer-templates.ts` (creado en Fase API), exportando
       una función `renderTemplate(lead, offerType, channel): OfferPackage` que mapea
       primary_offer → texto canónico (definido en `ARCHITECTURE_FRONTEND.md § Templates de oferta`
       y `ARCHITECTURE_FUTURE.md § Estructura del OfferPackage`).
     → En Fase 26: el handler intenta primero el LLMProvider; en caso de fallo cae a
       `renderTemplate()` del mismo archivo (sin duplicación). El archivo no se mueve a `src/`.

GET  /api/v1/campaigns
POST /api/v1/campaigns  body: { name, segment_filter }
GET  /api/v1/campaigns/:id/stats
-- STUB hasta Fase 43: estos endpoints requieren tabla outreach_campaigns (Fase 43).
-- En Fase API implementar como stubs que retornan:
--   HTTP/1.1 501 Not Implemented
--   { "error": "Not implemented until Fase 43",
--     "error_code": "not_implemented_until_phase_43" }
-- La matriz de auth de Fase API valida que estos endpoints respondan 501 con ese
-- error_code (no falla — es stub esperado). Fase 43 reemplaza los handlers con
-- la implementación real contra outreach_campaigns + lead_outreach.campaign_id.

GET  /api/v1/discovery/jobs?status=running,queued
POST /api/v1/discovery/jobs  body: { source, location, niche, profile, max_results }
PATCH /api/v1/discovery/jobs/:id  body: { action: 'pause'|'resume'|'cancel' }

GET  /api/v1/discovery/suggestions
     → DiscoverySuggestion[] — zonas + niche con baja cobertura, ordenados por exploration_priority DESC
     → Schema canónico (paginación cursor-based opcional):
       {
         location:             string,    // ej. "salto"
         niche:                string,    // ej. "restaurant"
         exploration_priority: number,    // AVG(prospect_score) × sources_gap, donde sources_gap = GREATEST(0, active_sources_count - COUNT(DISTINCT source))
         estimated_new_leads:  number|null, // proyección basada en zonas similares ya exploradas
         last_explored_at:     string|null, // ISO timestamp del último discovery_job ejecutado
         sources_available:    string[]   // fuentes que pueden cubrir esta combinación
       }[]

GET  /api/v1/discovery/coverage
     → DiscoveryCoverage[] — gauge de cobertura por (location, niche, source)
     → Schema canónico:
       {
         location:       string,
         niche:          string,
         source:         string,         // 'google_places' | 'mintur' | 'osm' | 'yelu' | ...
         leads_count:    number,         // leads existentes en esta combinación
         passed_count:   number,         // leads con passed_filter=true
         hot_count:      number,         // leads con prospect_score >= hot threshold
         last_run_at:    string|null,    // último discovery_job completado para esta tupla
         coverage_score: number          // 0–1, derivado de density + recency
       }[]

GET  /api/v1/stats/overview
GET  /api/v1/stats/outreach
GET  /api/v1/stats/pipeline

GET  /api/v1/pipeline/config
PUT  /api/v1/pipeline/config   body: PipelineConfig completa → guarda en DB
PATCH /api/v1/pipeline/config  body: campos parciales

POST /api/v1/pipeline/run      body: { overrides? } → inserta pipeline_runs 'pending' + pg_notify
POST /api/v1/pipeline/run/dry  body: { overrides? } → plan sin ejecutar
POST /api/v1/pipeline/abort    → UPDATE pipeline_runs SET abort_requested=true WHERE status='running'
POST /api/v1/pipeline/pause-phase  body: { phase: 'refresh'|'discovery'|'enrich'|'score' }

GET  /api/v1/pipeline/runs?status=completed,failed&limit=20&cursor=<id>
GET  /api/v1/pipeline/runs/active
GET  /api/v1/pipeline/runs/:id
GET  /api/v1/pipeline/runs/:id/log?since=<iso>

POST /auth/login   body: { email, password }
     → 200: { token: string, user: { id, email, role, lead_filter } }
     → 401: credenciales incorrectas | cuenta inactiva
POST /auth/refresh body: { token: string }
     → 200: { token: string } (nuevo token 24h) si el token tiene < 7 días desde emisión
     → 401: token expirado > 7 días — requiere re-login

GET  /api/v1/users
     → [{ id, email, role, lead_filter, active, last_login_at, created_at }]
     → cursor-based: ?limit=50&cursor=<id>
     → Solo admin. Response: { data: User[], next_cursor: string|null, total: number }
POST /api/v1/users body: { email, password, role, lead_filter? }
     → 201: { id, email, role } — crea cuenta CM, password se hashea internamente (bcrypt cost 12)
PATCH /api/v1/users/:id body: { password?, active?, lead_filter?, role? }
     → Solo admin. Si incluye password → re-hashea (bcrypt cost 12)

GET  /api/v1/health
```

### View `lead_dashboard` (VIEW normal — no MATERIALIZED)

Desnormaliza todos los campos de `LeadCard` para evitar joins en cada request de la UI. Ver decisión en `§ lead_dashboard — VIEW normal` de este mismo archivo.

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
  l.score_breakdown->>'primary_offer'           AS primary_offer,
  l.score_breakdown->>'pitch_hook'             AS pitch_hook,
  l.score_breakdown->>'urgency_signal'         AS urgency_signal,
  l.inferred_state->>'digitalization_level'    AS digitalization_level,
  (l.inferred_state->'has_delivery'->>'value')::boolean   AS has_delivery,
  (l.inferred_state->'has_pos'->>'value')::boolean        AS has_pos,
  (l.inferred_state->'has_reservations'->>'value')::boolean AS has_reservations,
  l.data_confidence_score,
  l.contact_reliability_score,
  l.contact_ready,
  l.contacted_at, l.created_at,
  -- Atribución OSM: la UI debe mostrar "© Colaboradores de OpenStreetMap"
  -- cuando este flag es true. Cubre tanto fuente primaria OSM como corroboración.
  (l.source = 'osm'
    OR l.corroborating_sources @> '[{"source":"osm"}]'::jsonb) AS has_osm_source,
  l.corroborating_sources,
  lbs_top.buyer_type AS top_buyer_type,
  lbs_top.score      AS top_buyer_score
FROM leads l
LEFT JOIN LATERAL (
  SELECT buyer_type, score FROM lead_buyer_scores
  WHERE lead_id = l.id ORDER BY score DESC LIMIT 1
) lbs_top ON true
WHERE l.passed_filter = true;
-- No excluir tier X en la VIEW base. Los endpoints/UI aplican default contact_tier=A,B,C,D
-- y solo muestran X cuando el request lo pide explícitamente.
--
-- passed_filter=false EXCLUIDO de la VIEW: los leads descartados no son accionables y
-- aparecerían como ruido en la UI principal. Para auditar descartados (debug pipeline,
-- entender por qué un lead concreto no llegó al pool), usar el endpoint directo
-- GET /api/v1/leads/:id con flag ?include_rejected=true que consulta tabla `leads`
-- directamente, no la VIEW. Ese flag NO es accesible para CMs — solo admin.
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

## Diseño objetivo — scoring (ANÁLISIS — superado por la fórmula v2)

> **Esta sección documenta el análisis que llevó al diseño de la fórmula v2.**
> La fórmula de implementación es la **fórmula comercial v2** que está en la sección
> `§ Diseño objetivo — fórmula de scoring comercial (v2)` de este archivo.
> Lo que sigue es el razonamiento de por qué se cambió cada componente, no el código a implementar.

### Fórmula de transición (v1.5 — NO implementar)

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

Hoy se calcula y se persiste pero no se usa. En el diseño objetivo sí entra en la fórmula, pero **la definición canónica está en `§ Componente 4 — accessibility_factor`**. No reutilizar los coeficientes de esta sección analítica para implementación; sirven solo como razonamiento histórico de por qué la reliability debe afectar el score.

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

**Estructura canónica mínima en `config/scoring.yaml`:**
```yaml
pitch_hooks:
  web_nuevo:
    default: "No tienen web, están perdiendo clientes que buscan online."
    overrides:
      - when:
          has_delivery: true
        text: "Están pagando 30% a PedidosYa — con su propia web de pedidos, recuperan ese margen."
  rediseno:
    default: "Su web existe pero no convierte — responsive + SEO moderno."
  marketing:
    default: "Tienen web pero no redes activas — community management."
  software:
    default: "El negocio ya opera, pero sin sistema propio pierde control y eficiencia."
  catalogo:
    default: "Hoy obligan al cliente a preguntar lo básico; un catálogo claro reduce fricción de compra."
  contacto_directo:
    default: "El negocio existe y es contactable, pero no tiene activos digitales que lo ayuden a vender mejor."
```
`computePitchHook(primary_offer, inferred_state, niche)` debe resolver primero `overrides` por señales de `inferred_state` y luego caer al `default`.

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
    source_quality_bonus,
    commercial_breadth,
    business_quality_pts,
    accessibility_factor,
    timing_factor,
    urgency_bonus,
    inferred_state_summary  // { has_delivery, has_pos, has_reservations, has_ecommerce, digitalization_level }
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

Diseño objetivo: agregar `contact_ready: boolean` y `contacted_by` como campos derivados en `leads`.

```
contact_ready = contact_tier IN ('A','B','C')
             AND prospect_score >= 30
             AND NOT franchise_detected
```

**Definición canónica** (no hay condición `OR buyer_type_score_max >= 50` — se descartó por complejidad: buyer_type_scores no siempre están disponibles en el momento del upsert, y `prospect_score >= 30` ya filtra leads sin valor comercial real).

```sql
-- Migración para leads (Fase 22-pre)
ALTER TABLE leads ADD COLUMN contact_ready boolean;
-- NO usar GENERATED ALWAYS AS: la expresión mezcla JSONB (score_breakdown->>'contact_tier'),
-- integer (prospect_score) y array (tags) — puede fallar en Supabase según versión de PostgreSQL.
-- Se calcula como columna regular, actualizada por el scoring engine en el mismo upsert
-- que actualiza prospect_score y score_breakdown.

ALTER TABLE leads ADD COLUMN contacted_by uuid REFERENCES users(id);
-- null = nunca contactado. SET al crear el primer lead_outreach para este lead.
CREATE INDEX leads_contacted_by ON leads(contacted_by) WHERE contacted_by IS NOT NULL;
CREATE INDEX leads_contact_ready ON leads(contact_ready) WHERE contact_ready = true;
```

**Lógica de `contact_ready` en el scoring engine (TypeScript):**
```typescript
const contactTier = computeContactTier(lead)
const isFranchise = lead.tags.includes('franchise-detected')
const contactReady = ['A','B','C'].includes(contactTier) && lead.prospectScore >= 30 && !isFranchise
// Incluir en el upsert al actualizar prospect_score:
// UPDATE leads SET ..., contact_ready = $contactReady WHERE id = $leadId
```

`contacted_by` no reemplaza `lead_outreach` (historial completo) — es una referencia rápida al usuario propietario del lead para la UI de CM (filtra "mis leads"). `passed_filter` se mantiene para compatibilidad.

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
| **1** | **Fase 22** — Scoring v2 completo | `gap_depth + commercial_breadth + business_quality_pts × accessibility_factor × timing_factor`. Incluye `contact_tier`, `pitch_hook`, `contact_ready` | Scores reales para 3.000+ leads externos |
| **2** | **Fase 6** — Cross-source dedup activo | Llamar `findCrossSourceMatch` al insertar | Modelo de evidencias activo, `data_confidence` real |
| **3** | **Fase 15** — Email quality + tipo teléfono | Parser personal/generic/role + MX check + mobile-phone tag | `contact_reliability_score` real, no estimado |
| **4** | **Fase 47** — `inferred_state` → columna propia | Migración + actualizar accesos | Queries e índices eficientes en UI |
| **5** | **Fase 21** — PostGIS | GPS indexable | Competitive density, mapa de leads, urgency geográfica |
| **6** | **Fase API-0** — Tabla `users` | Schema + roles JWT | Base de la API autenticada |
| **7** | **Fase API** — Servidor Fastify | Todos los endpoints REST | Frontend puede consumir datos reales |
| **8** | **Fase 13** — PedidosYa escape | `commission_estimate` en buyer_type delivery_propio | Pitch cuantificado (ahorro en comisiones) |
| **9** | **Fase 11+18** — IMM Habilitaciones + MINTUR×IMM | CSV Montevideo → teléfonos para MINTUR | Desbloquea 1.600 leads MINTUR hoy inaccionables |
| **10** | **UI** — Next.js `ui/` | Lead Explorer, Lead Detail, Outreach Tracker | Producto usable para CMs |

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
  primary_offer: 'web_nuevo' | 'rediseno' | 'marketing' | 'software' | 'catalogo' | 'contacto_directo' | 'none'
  pitch_hook: string                    // texto concreto del pitch
  urgency_signal: 'high' | 'medium' | 'low'
  buyer_type_scores: BuyerTypeScore[]   // top 3
  detected_sub_niche?: string           // post-Fase 28; visible solo si lead.niche === 'other' y se detectó

  // Score breakdown v2 (post-Fase 22 — campos para el panel de Lead Detail)
  gap_depth?: number                    // 0–60
  commercial_breadth?: number           // 0–12
  business_quality_pts?: number         // 0–15
  accessibility_factor?: number         // 0.225–1.30
  timing_factor?: number                // 0.85–1.20
  urgency_bonus?: number                // 0–5

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

Todo esto debe estar disponible en `leads` sin tocar tablas auxiliares para que la UI pueda paginar y filtrar eficientemente. Los campos opcionales de `Score breakdown v2` vienen de `leads.score_breakdown` (jsonb) — la API los aplana en la respuesta.

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

-- 5. Leads con contact_tier X pero prospect_score >= 55 (señal de scoring roto, v2)
-- Activar post-Fase 22 (hot threshold v2 = 55):
-- SELECT COUNT(*) FROM leads WHERE score_breakdown->>'contact_tier' = 'X' AND prospect_score >= 55;
-- Tolerancia: < 5 según ROADMAP_CANONICAL.md § Criterio obligatorio para Scoring v2.

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
rating ≥ 4.3:                                   pts += 5
rating ≥ 4.0 (y < 4.3):                         pts += 2
review_count ≥ 50:                              pts += 3
review_count ≥ 20 (y < 50):                     pts += 1
data_confidence:    floor(data_confidence_score × 3)     → 0–3 pts
contact_reliability: floor(contact_reliability_score × 2) → 0–2 pts
corroboration:      +2 si jsonb_array_length(corroborating_sources) >= 2
cap: 15
```

**Componentes y maxima individuales (suma = 15 cuando todos al tope):**
| Componente | Max | Origen |
|---|---|---|
| rating | 5 | Google Places rating |
| review_count | 3 | Google Places review_count |
| data_confidence | 3 | `data_confidence_score` (Fase 6 lo eleva con corroboración) |
| contact_reliability | 2 | `contact_reliability_score` (Fase 15 lo calibra con email/phone quality) |
| corroboration | 2 | `corroborating_sources >= 2` |

Car dealer con rating 4.6 + 312 reviews + data_confidence=0.9 + reliability=1.0 + 2 fuentes: 5+3+2+2+2 = 14/15.
Restaurant OSM sin rating ni reviews ni corroboración: 0/15.

### Componente 4 — `accessibility_factor` (0.225–1.30)

Penalización dura por inaccesibilidad. La clave: tier X nunca llega a hot.

```
base_mult (tiers MUTUAMENTE EXCLUYENTES — un lead cae en exactamente uno):
  X (sin contacto): 0.30
  D (solo dirección): 0.65
  C (phone):         0.90
  B (whatsapp):      1.15
  A (email):         1.30

ajuste por reliability (multiplicativo, aplicado SIEMPRE):
  × (0.75 + 0.25 × contact_reliability_score)

Rango efectivo: base × [0.75, 1.00] → mínimo X×0.75=0.225, máximo A×1.00=1.30.
```

**Por qué tiers excluyentes:** `contact_tier` se computa como prioridad: A > B > C > D > X. Si un lead tiene email Y whatsapp, el tier es A (el más fuerte). El `contact_reliability_score` ya captura la riqueza multi-canal (más canales corroborados ⇒ reliability más alta ⇒ ajuste multiplicativo más cercano a 1.00). No hace falta una categoría A+B separada.

**Doble rol de `contact_reliability_score`** (intencional, no redundante):
1. **Aditivo en `business_quality_pts`**: `floor(contact_reliability_score × 2)` → 0–2 pts. Captura "confiamos en este dato".
2. **Multiplicativo aquí**: escala la efectividad del canal. Captura "este canal probablemente funcione".

Ambos efectos compuestos: lead con tier A pero reliability=0.0 → `1.30 × 0.75 = 0.975` (penalización efectiva) y +0 pts. Tier A con reliability=1.0 → `1.30 × 1.00 = 1.30` (máximo) y +2 pts.

Con base X=0.30 y reliability máxima: 0.30. La suma gap+breadth+quality = 60+12+15=87. 87×0.30=26. Un lead tier X nunca supera 26, muy por debajo de hot (55).

**Riesgo de saturación del techo:** con `gap_depth + commercial_breadth + business_quality_pts = 87`, `accessibility_factor=1.30`, `timing_factor=1.20` y `urgency_bonus=5`, el máximo teórico supera 100 antes del cap. Por eso Fase 22-eval debe verificar explícitamente que `prospect_score = 100` aparezca en `< 5%` del pool activo; si no, recalibrar antes de aplicar.

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
    # rating: 5 si >=4.3, 2 si >=4.0 (excluyentes — gana el tier más alto)
    rating_tiers: [[4.0, 4.3, 2], [4.3, 5.01, 5]]
    # review_count: 3 si >=50, 1 si >=20 (excluyentes)
    review_tiers: [[20, 50, 1], [50, null, 3]]
    # data_confidence: floor(score × 3) → 0–3 pts (continuo, no binario)
    data_confidence_multiplier: 3
    # contact_reliability: floor(score × 2) → 0–2 pts (Fase 15 lo calibra)
    contact_reliability_multiplier: 2
    # corroboration: +2 si corroborating_sources >= 2
    corroboration_bonus: 2
    cap: 15
  accessibility:
    # Tiers mutuamente excluyentes: A > B > C > D > X
    tier_base: { X: 0.30, D: 0.65, C: 0.90, B: 1.15, A: 1.30 }
    reliability_adjustment: { base: 0.75, weight: 0.25 }   # × (0.75 + 0.25 × reliability)
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

### Tabla `lead_outreach`

> **El schema canónico está en `§ Tabla lead_outreach — diseño final` más abajo.** Esta sección sólo lista los campos que la pipeline de contacto consume del schema final — para el SQL de creación de la tabla, ver la sección "diseño final".

Campos relevantes para la pipeline de contacto (lectura desde aquí):
- `id`, `lead_id`, `user_id`, `created_at`, `updated_at`
- `offer_type`, `channel`, `offer_package` — la oferta generada
- `status`, `responded`, `outcome`, `lost_reason`
- `service_sold`, `price_sold`, `notes`
- `contacted_at`, `responded_at`, `closed_at`
- `lead_quality_signal` — feedback `-1/0/+1`

`campaign_id` se agrega en Fase 43 via `ALTER TABLE` (FK a `outreach_campaigns`, que no existe en Fase 25).

### API de outreach (Fastify `api/`)

```
GET  /api/v1/outreach?status=contacted&order=created_at.desc
     // status values del enum canónico de lead_outreach.status:
     //   contacted | responded | interested | closed_won | closed_lost | no_response
POST /api/v1/outreach                    — crear registro al generar oferta
PATCH /api/v1/outreach/:id               — actualizar status, notas, outcome

POST /api/v1/outreach/generate-offer
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
  user_id      uuid REFERENCES users(id),  -- null = disparado por cron/sistema
  
  -- Parámetros
  source       text NOT NULL,
  location     text NOT NULL,
  niche        text,
  profile      text,                    -- A/B/C/D o null para externos
  max_results  integer DEFAULT 200,
  concurrency  integer,
  cpu_budget   text,                    -- 'conservative'|'balanced'|'aggressive'
  
  -- Estado
  status       text NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued','running','completed','failed','cancelled','paused')),
  progress     integer DEFAULT 0,       -- 0–100
  
  -- Resultados
  leads_found        integer DEFAULT 0,
  leads_new          integer DEFAULT 0,
  leads_corroborated integer DEFAULT 0,
  leads_hot_new      integer DEFAULT 0,
  error_message      text,
  
  -- Meta
  triggered_by text NOT NULL DEFAULT 'manual'
               CHECK (triggered_by IN ('manual','scheduled','gap_analysis'))
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
  AVG(prospect_score) * GREATEST(0, active_sources_count - COUNT(DISTINCT source)) AS exploration_priority
FROM leads
WHERE passed_filter = true
GROUP BY city, niche
HAVING COUNT(DISTINCT source) < 3
ORDER BY exploration_priority DESC;
```

`active_sources_count` no debe ser un literal fijo si se agregan nuevas fuentes al sistema. Derivarlo de las fuentes realmente habilitadas para esa combinación o del set activo en configuración.

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
GET  /api/v1/discovery/jobs            — lista jobs con estado
POST /api/v1/discovery/jobs            — crear nuevo job (encola, src/ lo ejecuta via poll)
PATCH /api/v1/discovery/jobs/:id       — pause/resume/cancel
GET  /api/v1/discovery/suggestions     — zonas sugeridas (gap analysis)
GET  /api/v1/discovery/coverage        — mapa de cobertura por zona+fuente
```

**Ejecución de jobs — modelo correcto:** `api/` solo escribe el registro en `discovery_jobs` con `status='queued'`. `src/` (core pipeline) pollea `discovery_jobs WHERE status='queued'` cada 30s y ejecuta el job. `api/` NUNCA llama código de discovery ni usa execa — viola la separación de procesos. El progress bar de la UI consulta `GET /api/v1/discovery/jobs/:id` que lee el campo `progress` que `src/` actualiza en la DB mientras ejecuta.

---

## Diseño — Generación de ofertas con IA (Fase futura)

En primera versión, las ofertas se generan desde templates fijos (ver sección pipeline de contacto). En segunda versión, el sistema usa un `LLMProvider` configurable para generar textos personalizados; no acoplar a un proveedor específico.

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

  [Google Places únicamente] ANTES de llamar al provider:
    Leer pipeline_config.google_places_budget_spent + google_places_budget_total
    Si (budget_total - budget_spent) < 5.00 USD → abortar con error claro:
    "Google Places budget crítico: quedan $X.XX de $200.00. Usar otra fuente."

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

  accessibility_factor(lead): number              [v2 — canonical, ver § Componente 4]
    contact_tier (mutuamente excluyente: A > B > C > D > X):
    → X (sin contacto): ×0.30
    → D (solo address): ×0.65
    → C (phone):        ×0.90
    → B (WA):           ×1.15
    → A (email):        ×1.30
    × (0.75 + 0.25 × contact_reliability_score)   [ajuste por reliability, siempre activo]
    │
    ▼

  // Fórmula v2 — ver §Diseño objetivo — fórmula de scoring comercial (v2) para detalle completo
  gap_depth = min(60, max(sub_scores) + source_quality_bonus)
  commercial_breadth = (sorted_subs[1] >= 30 ? 8 : 0) + (sorted_subs[2] >= 30 ? 4 : 0)
  business_quality_pts = min(15,
    ratingPts + reviewPts + dataConfidencePts + contactReliabilityPts + corroborationPts
  )
  // ratingPts: ≥4.3 → 5, ≥4.0 → 2, else 0
  // reviewPts: ≥50 → 3, ≥20 → 1, else 0
  // dataConfidencePts: floor(data_confidence_score × 3) → 0–3
  // contactReliabilityPts: floor(contact_reliability_score × 2) → 0–2
  // corroborationPts: jsonb_array_length(corroborating_sources) >= 2 → 2, else 0
    │
    ▼

  accessibility_factor(contact_tier, contact_reliability_score): 0.225–1.30
  timing_factor(urgency, new_business, competitive_pressure, franchise_penalty): 0.85–1.20
    │
    ▼

  commercial_score = min(100,
    floor((gap_depth + commercial_breadth + business_quality_pts)
          × accessibility_factor × timing_factor)
    + urgency_bonus   // high=+5, medium=+2
  )
    │
    ▼

  computeUrgencySignal(lead): 'high'|'medium'|'low'
  computePitchHook(primary_offer, inferred_state, niche): string
  computeAllBuyerScores(lead): BuyerTypeScore[]
  contact_ready = ['A','B','C'].includes(contact_tier) && score >= 30 && !franchise
    │
    ▼

  score_breakdown: {
    sub_scores, primary_offer,
    source_quality_bonus,
    contact_tier,
    pitch_hook,
    urgency_signal,
    commercial_breadth,
    business_quality_pts,
    accessibility_factor,
    timing_factor,
    urgency_bonus,
    inferred_state_summary          ← { has_delivery, has_pos, has_reservations, has_ecommerce, digitalization_level }
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
GET /api/v1/leads?contact_tier=A,B&prospect_score_gte=40&niche=restaurant
  → paginado (cursor-based, 50/página)
  → campos del LeadCard contract (sin joins)
  → sort: prospect_score DESC, urgency_signal DESC

GET /api/v1/leads/:id
  → lead completo con score_breakdown expandido
  → buyer_type_scores ordenados por score DESC
  → corroborating_sources con labels
  → si CM no pasa su lead_filter: 404 (no 403)

// Registrar contacto: usar POST /api/v1/outreach (no hay PATCH /leads/:id/contact).
// El trigger SQL contacted_by (Fase 25) actualiza leads.contacted_at automáticamente
// al primer outreach del lead.
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
    "monthly_orders_est": 200,            // estimado por review_count + niche
    "avg_ticket_uyu": 500,                // estimado por niche
    "monthly_revenue_est": 100000,        // monthly_orders_est × avg_ticket_uyu
    "commission_rate": 0.30,              // fijo PedidosYa
    "commission_monthly_uyu": 30000,      // revenue_est × commission_rate
    "system_cost_monthly_uyu": null,      // <lookup: service_pricing.delivery_system.monthly_fee
                                          //         para user_id=$auth.user_id — Fase 27>.
                                          // El ejemplo "3000" es ilustrativo de mock UI.
    "monthly_savings_est": null,          // commission_monthly_uyu - system_cost_monthly_uyu
    "pitch_hook": "Estás pagando ~$30.000 UYU/mes a PedidosYa"
  }
}
```

**Resolución de `system_cost_monthly_uyu`:** el valor no se infiere ni se hardcodea — viene de `service_pricing` (Fase 27) consultando con `user_id` del CM autenticado y `service_type='delivery_system'`. Si la fila no existe (Fase 27 sin seed completo), `system_cost_monthly_uyu = null` y la UI muestra "Configurar precio en Settings → Pricing" en lugar de un número falso. Los `3000` del ejemplo son solo para mocks visuales.

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

## Diseño objetivo — infraestructura y operaciones

### Mecanismo de trigger: DB como bus de mensajes

Los procesos `api/` y `src/` (core) nunca se comunican por HTTP entre sí. Todo se coordina via PostgreSQL usando dos mecanismos complementarios:

**1. pg_notify para ejecución inmediata (manual runs):**

```sql
-- api/ (proceso 1): al recibir POST /api/v1/pipeline/run
INSERT INTO pipeline_runs (status, triggered_by, config_snapshot, overrides)
VALUES ('pending', 'manual', $config, $overrides)
RETURNING id;

SELECT pg_notify('pipeline_trigger', $run_id::text);

-- src/ (core, proceso 2): al arrancar
LISTEN pipeline_trigger;
-- Callback inmediato al recibir NOTIFY:
client.on('notification', async (msg) => {
  const runId = msg.payload
  await executePipeline(runId)   -- actualiza status: pending → running → completed/failed
})
```

**2. Polling de `pipeline_config` para el cron:**

```typescript
// src/ (core) — loop principal cada 60s
async function configWatcher() {
  const config = await loadPipelineConfig()
  if (config.updated_at > lastKnownUpdatedAt) {
    reconfigureCron(config.cron_expression)
    lastKnownUpdatedAt = config.updated_at
  }
}
setInterval(configWatcher, 60_000)
```

**3. Polling de `discovery_jobs` para jobs de exploración:**

```typescript
// src/ (core) — loop cada 30s
async function jobWatcher() {
  const job = await db
    .from('discovery_jobs')
    .select()
    .eq('status', 'queued')
    .order('created_at')
    .limit(1)
    .single()
  if (job) {
    await executeDiscoveryJob(job)
  }
}
```

**Abort y pause:** `api/` escribe `pipeline_runs.abort_requested = true`. `src/` (core) verifica este flag entre cada lead procesado y termina limpiamente si está activo.

**Regla absoluta:** `api/` nunca importa módulos de `src/` (excepto types compartidos en `shared/`). Si `api/` necesita saber si el pipeline está corriendo, lee `pipeline_runs WHERE status='running'`. Si necesita el resultado, lee `leads`. Nunca invoca código de scoring o discovery directamente.

**Única excepción documentada:** los handlers `POST /api/v1/admin/system/restart-{core,api}` usan `child_process.exec('pm2 restart …')` para gestionar el ciclo de vida del proceso `src/`. Esto NO es importar módulos — es controlar el supervisor externo (pm2). Gated por `NODE_ENV='production'` (Fase 48 aplicada); en dev devuelve 501. Ver `ADMIN_PANEL.md § Pantalla F — Health & System Status` para forma canónica de respuesta y códigos de error tipados. No usar este patrón para ningún otro endpoint.

---

### Schema completo — `pipeline_runs`

```sql
CREATE TABLE pipeline_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz DEFAULT now(),
  started_at       timestamptz,
  completed_at     timestamptz,

  -- Control
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','running','completed','failed','partial','aborted')),
  triggered_by     text NOT NULL DEFAULT 'manual'
                   CHECK (triggered_by IN ('manual','cron','startup-recovery','api')),
  abort_requested  boolean DEFAULT false,
  dashboard_stale  boolean DEFAULT false,  -- warning UI si un run falló; no refresca VIEW

  -- Config usada en este run
  config_snapshot  jsonb,   -- copia de pipeline_config al momento de iniciar
  overrides        jsonb,   -- overrides opcionales del POST /pipeline/run

  -- Resultados por fase
  phase_results    jsonb,
  -- {
  --   refresh:   { leads_processed: N, by_source: {gp: N, mintur: N, ...}, duration_ms: N },
  --   discovery: { jobs_run: N, leads_new: N, leads_corroborated: N },
  --   enrich:    { leads_processed: N, duration_ms: N },
  --   score:     { leads_scored: N, new_hot: N, score_up_15: N, score_down_15: N }
  -- }

  -- Log para el monitor de UI
  log_lines        jsonb DEFAULT '[]',
  -- [{ ts: "ISO", msg: "texto", level: "info"|"warn"|"error" }, ...]

  -- Invariantes post-run
  invariant_details jsonb,
  -- { passed_not_enriched: 0, tags_contradictorios: 0, passed_sin_score: 0, contact_tier_x_hot: 0 }

  -- Notificaciones
  webhook_status   text DEFAULT 'not_configured'
                   CHECK (webhook_status IN ('not_configured','sent','failed'))
);

CREATE INDEX pipeline_runs_status ON pipeline_runs(status);
CREATE INDEX pipeline_runs_created_at ON pipeline_runs(created_at DESC);
```

---

### Schema completo — `pipeline_config`

```sql
CREATE TABLE pipeline_config (
  id                    text PRIMARY KEY DEFAULT 'singleton'
                        CHECK (id = 'singleton'),  -- impide múltiples filas
  updated_at            timestamptz DEFAULT now(),

  -- Schedule
  enabled               boolean DEFAULT false,
  cron_expression       text DEFAULT '0 2 * * 0',  -- domingos 02:00
  scheduled_for         timestamptz,               -- próxima ejecución calculada al guardar
  last_completed_at     timestamptz,               -- última ejecución completada OK

  -- Recursos
  cpu_budget            text DEFAULT 'balanced',   -- 'conservative'|'balanced'|'aggressive'
  timeout_per_lead_sec  integer DEFAULT 120,
  max_retries           integer DEFAULT 2,

  -- Config por fase (jsonb para flexibilidad sin migraciones adicionales)
  phases                jsonb DEFAULT '{
    "refresh":   { "enabled": true,  "sources": ["google_places","mintur","yelu","osm"], "priority_tiers_first": true },
    "discovery": { "enabled": true,  "max_jobs": 5 },
    "enrich":    { "enabled": true,  "with_heuristic": false, "concurrency": 5 },
    "score":     { "enabled": true,  "recalculate_buyer_types": true }
  }'::jsonb,

  -- Presupuesto Google Places
  google_places_budget_total     numeric(8,2) DEFAULT 200.00,
  google_places_budget_spent     numeric(8,2) DEFAULT 0.00,
  google_places_alert_threshold  numeric(8,2) DEFAULT 10.00,

  -- Costos manuales editables por admin (Cost Dashboard avanzado)
  infra_monthly_cost_usd         numeric(8,2) DEFAULT 0.00,
  backup_monthly_cost_usd        numeric(8,2) DEFAULT 0.00,

  -- Notificaciones
  notify_webhook_url     text,
  notify_webhook_secret  text,
  notify_webhook_events  text[] DEFAULT ARRAY['run_completed','new_hot_leads']
);

-- Solo existe una fila — singleton enforced por PK fijo 'singleton'.
-- ON CONFLICT DO NOTHING permite que la migración sea idempotente (replay seguro).
INSERT INTO pipeline_config (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING;

CREATE TRIGGER pipeline_config_updated_at BEFORE UPDATE ON pipeline_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

### `lead_dashboard` — VIEW normal (suficiente para 2–8 usuarios)

Para la concurrencia esperada (2–8 usuarios), una VIEW normal es suficiente. PostgreSQL optimiza el plan de query para las condiciones de filtro del request. Una MATERIALIZED VIEW agrega complejidad de refresh sin beneficio real a esta escala.

```sql
-- Crear como VIEW simple — sin MATERIALIZED
CREATE VIEW lead_dashboard AS
  SELECT ...   -- mismo SQL definido en § View lead_dashboard arriba
  FROM leads l
  LEFT JOIN LATERAL (...) lbs_top ON true
  WHERE l.passed_filter = true;
  -- La VIEW base incluye tier X para auditoría y filtros explícitos.
  -- Los endpoints aplican default contact_tier=A,B,C,D cuando el request no especifica tiers.

-- Índices en la tabla leads (no en la view) — son los que importan para performance:
CREATE INDEX leads_contact_tier ON leads ((score_breakdown->>'contact_tier'));
CREATE INDEX leads_prospect_score ON leads(prospect_score DESC) WHERE passed_filter = true;
CREATE INDEX leads_primary_offer ON leads ((score_breakdown->>'primary_offer')) WHERE passed_filter = true;
```

**Cuándo reconsiderar:** si en el futuro hay >20 usuarios concurrentes o el dashboard tarda >500ms → migrar a MATERIALIZED VIEW con `REFRESH CONCURRENTLY`. Por ahora, VIEW normal.

**Nota para implementación:** la VIEW no se autoactualiza — siempre refleja el estado real de `leads` en el momento de la query, que es exactamente lo que queremos.

---

### Versionado de API — `/api/v1/`

Todos los endpoints bajo `/api/v1/` desde el inicio. Permite introducir `/api/v2/` para breaking changes sin romper el frontend que usa v1.

```
CORRECTO:   GET /api/v1/leads
INCORRECTO: GET /api/leads
```

El servidor redirige `/api/leads` → `/api/v1/leads` con 301 para transición inicial, pero el frontend siempre usa `/api/v1/`.

**Headers de versión en cada respuesta:**
```
X-API-Version: 1
X-Scoring-Version: 2   // versión del algoritmo activo
```

---

### Endpoint `/api/v1/health` — observabilidad básica

```typescript
GET /api/v1/health
→ {
    status: 'ok' | 'degraded' | 'error',
    db: 'ok' | 'error',
    cron: {
      status: 'scheduled' | 'running' | 'missed' | 'disabled',
      last_run_at: string | null,
      next_run_at: string | null,
      missed: boolean   // true si el cron debía haber corrido y no corrió (±15 min margen)
    },
    pipeline_running: boolean,
    leads_count: number,
    hot_leads_count: number,
    version: string     // git SHA o package.json version
  }
```

Sin autenticación. Compatible con uptimerobot, healthchecks.io o cualquier monitor externo.

---

### Detección de cron missed runs

`node-cron` es in-memory. Si el servidor se reinicia en el momento en que debía correr el pipeline, el run se pierde silenciosamente. Para un cron semanal, eso es una semana sin datos frescos.

**Diseño:**

```sql
-- Columna en pipeline_config:
scheduled_for timestamptz   -- próxima ejecución esperada, calculada al guardar config
```

```typescript
// En startup del servidor (onReady hook de Fastify):
async function checkMissedRun(config: PipelineConfig) {
  if (!config.enabled || !config.scheduled_for) return
  const overdue = differenceInMinutes(new Date(), config.scheduled_for) > 15
  const notRun = !config.last_completed_at || config.last_completed_at < config.scheduled_for
  if (overdue && notRun) {
    logger.warn('Missed pipeline run detected — triggering recovery')
    await triggerPipelineRun({ triggered_by: 'startup-recovery' })
  }
}
```

**Crash recovery complementario al arrancar `src/`:**
- Antes de `LISTEN pipeline_trigger` y antes de registrar el cron, ejecutar un cleanup de `pipeline_runs` huérfanos:
  - `status='running'` → `status='aborted'`
  - `dashboard_stale=true`
  - append a `log_lines`: `"startup-crash-recovery"`
- Sin este paso, la UI puede mostrar runs eternos y el operador no distingue un job activo de un zombie.

---

### Estrategia anti-detección en scraping

Para runs automáticos en producción, la misma IP hace el mismo scraping periódicamente. Sin gestión activa, el riesgo de bloqueo crece con el tiempo.

**Config en `config/discovery.yaml`:**

```yaml
scraping:
  yelu:
    rate_limit_ms: 1000        # 1 req/s máximo
    retry_attempts: 3
    retry_backoff_ms: 2000     # exponential: 2s, 4s, 8s
    user_agents:
      - "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0"
      - "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36..."
  pedidosya:
    rate_limit_ms: 2000
    retry_attempts: 2
    on_block: stop              # 'stop' | 'skip' | 'retry_24h'
  overpass:
    rate_limit_ms: 60000        # Fair Use: 1 req/min para queries grandes
    retry_attempts: 2
```

---

## Diseño objetivo — calidad de datos y detección

### `canonical_source` — fuente de mayor confianza

El campo `source` refleja la fuente de descubrimiento, no necesariamente la más confiable. Un lead que empezó en OSM (0.60) y fue corroborado por Google Places (0.90) sigue con `source = 'osm'`.

**Nuevo campo `canonical_source`:**

```sql
ALTER TABLE leads ADD COLUMN canonical_source text;
```

Calculado al reconciliar `canonical_fields`: es la fuente con mayor `source_confidence` entre la fuente primaria y todas las corroborantes.

La UI muestra `canonical_source` como "Fuente principal" y lista `corroborating_sources` como "También encontrado en".

---

### Deduplicación con coordenadas geográficas

`findCrossSourceMatch` usa solo similitud de nombre. Dos negocios con el mismo nombre en ciudades distintas se matchearían erróneamente cuando la cobertura se expanda.

**Diseño de `findCrossSourceMatch` v2:**

```typescript
function findCrossSourceMatch(
  candidate: DiscoveryCandidate,
  leads: Lead[],
  options: {
    nameThreshold?: number       // default 0.85
    geoRadiusMeters?: number     // default 500 — solo si ambos tienen GPS
    requireNicheMatch?: boolean  // default true
  }
): Lead | null
```

**Lógica:**
1. Filtrar por niche exacto (si `requireNicheMatch=true`)
2. Si el candidato tiene `lat/lng`: filtrar por distancia Haversine < `geoRadiusMeters` — O(n) sin PostGIS
3. Buscar mejor similitud de nombre sobre el conjunto filtrado
4. Retornar match si similarity ≥ `nameThreshold`

Sin GPS: fall back al threshold de nombre solo (comportamiento actual). Con GPS: match es nombre+geo, drásticamente menos falsos positivos.

---

### Change detection en re-enrich

El sistema re-enriquece leads stale pero no detecta si algo cambió. Si un negocio lanzó una web nueva, debería moverse de `web_nuevo` a `rediseno` sin intervención manual.

**Campos críticos que triggean re-score automático:**
- `has_website` false → true
- `contact_email` apareció (contact_tier sube de C a A)
- `contact_tier` cambió
- `inferred_state.has_delivery` apareció (pitch_hook cambia)

**Implementación:**

```typescript
interface EnrichmentDiff {
  lead_id: string
  changed_at: string
  changes: Array<{
    field: string
    from: unknown
    to: unknown
    significance: 'critical' | 'high' | 'low'
  }>
}
```

Persiste en `digital_footprint.last_change_diff`. Si hay cambios críticos → tag `state-changed-significant` + re-score automático en el mismo run. El monitor de ejecución muestra "N leads con cambios significativos" post-run.

---

### Detección de mismo propietario (`owner_group`)

En Uruguay, muchas PyMEs tienen el mismo dueño con 2–3 negocios distintos. Contactarlos por separado es redundante y puede generar fricción.

**Señales de mismo propietario:**
- Mismo número de teléfono en 2+ leads
- Mismo email en 2+ leads
- Mismo RUT (solo si en el futuro existiera una fuente oficial nueva y explícitamente aprobada; hoy no es una señal disponible)

**Schema:**

```sql
ALTER TABLE leads ADD COLUMN owner_group_id uuid;
CREATE INDEX leads_owner_group ON leads(owner_group_id) WHERE owner_group_id IS NOT NULL;
```

Detección: corre post-enrich. Si dos leads tienen el mismo phone o email canónico → asignar el mismo `owner_group_id` (o crear nuevo UUID si no existe).

**UI:** badge "2 negocios del mismo propietario" en Lead Explorer, con link al otro lead. El agente puede preparar un pitch conjunto.

---

### `scoring_version` en `lead_buyer_scores` y `leads`

Al cambiar la fórmula de scoring, los scores históricos quedan obsoletos sin forma de identificarlos.

```sql
ALTER TABLE lead_buyer_scores ADD COLUMN scoring_version smallint NOT NULL DEFAULT 1;
ALTER TABLE leads          ADD COLUMN scoring_version smallint NOT NULL DEFAULT 1;
```

**Comportamiento:**
- Al correr `score --all` con v2: `scoring_version = 2` en todos los registros actualizados
- La API retorna `X-Scoring-Version: 2` en headers
- Invariante post-run: `SELECT COUNT(*) FROM leads WHERE scoring_version < 2` debe ser 0
- Invariante post-run: `SELECT COUNT(*) FROM lead_buyer_scores WHERE scoring_version < 2` debe ser 0

---

### `days_in_pool` — recency como señal de timing

Un lead recién descubierto tiene ventaja competitiva: nadie lo ha contactado todavía. Esta señal no existe en la fórmula actual.

**Adición al `timing_factor` de scoring v2 en `config/scoring.yaml`:**

```yaml
commercial_score:
  timing:
    # ... campos existentes ...
    days_in_pool:
      fresh_threshold_days: 7
      fresh_bonus: 0.05          # leads < 7 días en pool → +5% timing_factor
      stale_threshold_days: 90
      stale_penalty: -0.05       # leads > 90 días sin contactar → -5%
```

Persiste en `score_breakdown.days_in_pool` para que la UI lo pueda mostrar ("Nuevo — hace 3 días").

---

## Diseño objetivo — producto y engagement

### Webhook de notificaciones externas

Cuando el pipeline termina con nuevos hot leads, el equipo de ventas debería ser notificado sin tener la UI abierta.

**Config en `pipeline_config`:**

```sql
notify_webhook_url    text,          -- URL del receptor (Slack, Make.com, Zapier, n8n)
notify_webhook_secret text,          -- HMAC-SHA256 para verificación
notify_webhook_events text[]         -- ['run_completed', 'hot_leads_found', 'invariant_failed']
```

**Payload al terminar un run:**

```json
POST {notify_webhook_url}
Header: X-Blindspot-Signature: sha256={hmac}

{
  "event": "run_completed",
  "run_id": "uuid",
  "completed_at": "2026-05-18T06:01:00Z",
  "duration_minutes": 252,
  "new_hot_leads": 3,
  "leads_enriched": 127,
  "invariants_ok": true,
  "summary_url": "http://localhost:3001/api/v1/pipeline/runs/{run_id}"
}
```

Implementación: `src/modules/pipeline/notifications.ts` → `notifyWebhook(run)`. Llamada como último paso en `completePipelineRun()` dentro del proceso core. Resultado persiste en `pipeline_runs.webhook_status`.

---

### Full-text search de leads

Con 2034 leads "other" y sub-niches no mapeados, el usuario no tiene forma de buscar por texto.

**Schema:**

```sql
ALTER TABLE leads ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('spanish',
      COALESCE(name,'') || ' ' || COALESCE(address,'') || ' ' || COALESCE(niche,''))
  ) STORED;

CREATE INDEX leads_fts ON leads USING gin(search_vector);
```

**Endpoint:**

```
GET /api/v1/leads?q=veterinaria&contact_tier=A,B
→ WHERE search_vector @@ plainto_tsquery('spanish', $q)
→ ORDER BY ts_rank(search_vector, query) DESC, prospect_score DESC
```

El parámetro `q` se combina con todos los filtros existentes. Compatible con cursor pagination.

---

### Scoring estacional

Uruguay tiene patrones de receptividad predecibles por niche y mes.

**Config en `config/scoring.yaml`:**

```yaml
seasonal_modifiers:
  - months: [1, 1]
    niche: gym
    urgency_note: "enero-resoluciones"    # pico de altas de gimnasio en enero
    urgency_boost: 0.10                   # no cambia prospect_score, sí el sort en UI
  - months: [11, 3]
    zones: ["punta del este", "rocha", "colonia del sacramento"]
    urgency_note: "temporada-turistica"
    urgency_boost: 0.15
  - months: [11, 12]
    niche: restaurant
    urgency_note: "temporada-alta-pedidos" # más pedidos → más comisión PedidosYa
    urgency_boost: 0.10
```

El modificador estacional NO altera `prospect_score`. Añade `score_breakdown.seasonal_note` para el agente y afecta el sort secundario de la UI (leads con seasonal boost aparecen antes en el mismo tier).

---

### Campañas de outreach

El modelo natural del agente es por campaña: "esta semana llamo a todos los restaurantes de Pocitos tier B". Sin entidad "campaña", no hay forma de medir qué segmentos convierten.

**Tabla `outreach_campaigns`:**

```sql
CREATE TABLE outreach_campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,          -- "Restaurantes Pocitos mayo 2026"
  created_at      timestamptz DEFAULT now(),
  closed_at       timestamptz,
  user_id         uuid REFERENCES users(id) NOT NULL,  -- quién creó la campaña
  segment_filter  jsonb NOT NULL,         -- {contact_tier: ['B'], niche: ['restaurant'], ...}
  status          text DEFAULT 'active',  -- 'active' | 'paused' | 'closed'
  notes           text
);

ALTER TABLE lead_outreach ADD COLUMN campaign_id uuid REFERENCES outreach_campaigns(id);
```

**Stats por campaña:**

```
GET /api/v1/campaigns/:id/stats
→ {
    total_in_segment: number,
    contacted: number,
    responded: number,
    closed_won: number,
    conversion_rate: number,    // closed_won / contacted
    avg_score_contacted: number
  }
```

Permite comparar "¿qué segmento convierte mejor?" y construir el feedback loop real del sistema.

---

### Presupuesto Google Places — trazabilidad en UI

El saldo de Google Places existe solo en SECURITY.md como texto. La UI debe mostrar el consumo en tiempo real.

**Campos en `pipeline_config`:**

```sql
google_places_budget_total     numeric(8,2) DEFAULT 200.00,
google_places_budget_spent     numeric(8,2) DEFAULT 5.16,
google_places_alert_threshold  numeric(8,2) DEFAULT 20.00
```

**Actualización automática:** el worker incrementa `google_places_budget_spent += 0.02 × requests_made` al finalizar cada run con `source=google_places`.

El Pipeline Manager muestra barra de presupuesto y emite alerta (badge rojo) si `budget_remaining < alert_threshold`. También incluye en el payload del webhook cuando `budget_remaining < alert_threshold`.

---

## Diseño de UI

> El diseño completo de la UI (pantallas, wireframes, componentes, templates de oferta, orden de construcción)
> está en `context/ARCHITECTURE_FRONTEND.md` — directorio `ui/` en el mismo repo.
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
│  📷 IG: no detectado                    contacto_d  ░░░░░░   0      │
│  ⚠️  Web vía heurístico (score 0.71)                                │
│  🗓  Copyright 2019 detectado          Fórmula v2 (Fase 22):        │
│  ⭐ Rating 4.4 · 87 reviews              gap_depth:        41/60    │
│                                          breadth:          +8       │
│                                          quality_pts:     12/15     │
│                                          accessibility:   ×1.30     │
│                                          timing:          ×1.05     │
│                                          urgency_bonus:    +5       │
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

### API contract y UI

> **El contrato de API y el diseño completo de la UI están en `context/ARCHITECTURE_FRONTEND.md`.**
> La UI consume la API REST de `api/` (Fastify, puerto 3001) — nunca accede a la DB directamente.
> Esta sección existía como diseño previo con PostgREST directo, que fue reemplazado por la arquitectura de `api/` Fastify.
>
> Ver `ARCHITECTURE_FRONTEND.md` para: pantallas completas, contrato de endpoints, `LeadCard` interface, componentes reutilizables, orden de construcción.

El contrato mínimo de datos que el backend debe exponer para la UI (sin joins) está definido en `§ Contrato de datos para la UI` más arriba en este archivo.

**View `lead_dashboard`** (VIEW normal — no MATERIALIZED para 2–8 usuarios): desnormaliza todos los campos del LeadCard para evitar joins en cada request del frontend. Definida en `§ View lead_dashboard` arriba.

---

## Diseño — Generación de ofertas con IA (proveedor genérico)

### Principio de diseño

El generador de ofertas no debe acoplarse a ningún proveedor de IA específico. La misma funcionalidad debe correr con Gemini si el plan/límites vigentes lo permiten, con un modelo local vía Ollama (sin API key), o con cualquier API OpenAI-compatible.

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

**GeminiProvider** — proveedor posible, elegido por configuración
```typescript
// El modelo y los límites se revalidan al implementar.
// No hardcodear modelos deprecated; leer LLM_MODEL desde env/config.
class GeminiProvider implements LLMProvider {
  name = 'gemini'
  // POST https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent
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

**Creada en Fase API-0** (movida desde Fase 25 por octava auditoría 2026-05-16). Fase 25 ahora cubre solo el trigger de `contacted_by`, CLI stats y verificación end-to-end. Razón del movimiento: la matriz de auth de Fase API exige tests sobre `lead_outreach` (CM solo puede leer/modificar el propio) y Fase 25 vive dos bloques después de Fase API en el orden canónico — antes del movimiento, la matriz era inalcanzable.

```sql
-- NOTA: campaign_id NO entra en el CREATE TABLE de Fase API-0 — se agrega en Fase 43 via ALTER TABLE
-- (outreach_campaigns no existe en Fase API-0; la FK fallaría en la creación)
CREATE TABLE lead_outreach (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- ON DELETE RESTRICT: borrar un user con outreach asociado falla con FK error.
  -- DELETE /api/v1/users/:id ya está gated en el handler (ADMIN_PANEL.md) — "solo si no tiene
  -- lead_outreach registrado". El RESTRICT es la red de seguridad a nivel DB.
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),

  -- Oferta generada (null si fue contacto manual sin oferta generada)
  offer_type    text,
  channel       text NOT NULL,     -- 'email' | 'whatsapp' | 'phone'
  offer_package jsonb,
  -- { text: string, source_llm: string|null, generated_at: string }
  -- nullable: permite registrar un contacto sin oferta generada formalmente
  -- source_llm: 'gemini' | 'ollama' | null (= template o manual)

  -- Estado del pipeline
  status        text NOT NULL DEFAULT 'contacted'
                CHECK (status IN ('contacted','responded','interested','closed_won','closed_lost','no_response')),
  -- semántica: status es el "tablero" del lead — el estado actual en el funnel.

  -- Resultado (todos opcionales — capturan detalles de cómo se llegó al status)
  responded     boolean,
  outcome       text                          -- detalle granular cuando hay cierre o pausa
                CHECK (outcome IS NULL OR outcome IN ('closed_won','closed_lost','not_now','has_provider')),
  lost_reason   text                          -- 'price' | 'timing' | 'no_interest' | 'competitor' | other
                CHECK (lost_reason IS NULL OR lost_reason IN ('price','timing','no_interest','competitor','other')),
  service_sold  text,              -- descripción libre del servicio vendido
  price_sold    integer,           -- precio en UYU (opcional)
  notes         text,              -- notas libres

  -- Invariante de consistencia (enforced en el handler API, no en SQL):
  -- - Si status='closed_won', outcome debe ser 'closed_won' o NULL.
  -- - Si status='closed_lost', outcome debe ser 'closed_lost' o NULL; lost_reason puede tener valor.
  -- - Si status NOT IN ('closed_won','closed_lost'), outcome puede ser 'not_now' o 'has_provider' o NULL.
  -- El API PATCH /api/v1/outreach/:id valida esta consistencia antes de guardar — un mismatch devuelve 400.

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
CREATE INDEX lead_outreach_user_id    ON lead_outreach(user_id);
CREATE INDEX lead_outreach_status     ON lead_outreach(status);
CREATE INDEX lead_outreach_outcome    ON lead_outreach(outcome) WHERE outcome IS NOT NULL;
CREATE INDEX lead_outreach_closed_at  ON lead_outreach(closed_at) WHERE closed_at IS NOT NULL;

-- Fase 43 agrega: ALTER TABLE lead_outreach ADD COLUMN campaign_id uuid REFERENCES outreach_campaigns(id);
-- CREATE INDEX lead_outreach_campaign ON lead_outreach(campaign_id) WHERE campaign_id IS NOT NULL;
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
  │  Para cada job en discovery_jobs WHERE status='queued'            │
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
  │  score --changed-since <pipeline_start_timestamp>                 │
  │  score --buyer-types --changed-since <pipeline_start_timestamp>   │
  │  (Fase 23 debe implementar --changed-since si no existe todavía)  │
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

### Tablas `pipeline_config` y `pipeline_runs`

> **Los schemas canónicos están en `§ Schema completo — pipeline_runs` y `§ Schema completo — pipeline_config` más arriba.** Esta sección sólo documenta la forma esperada de `phase_results` (jsonb) y la semántica de los campos que la UI consume — no duplica el SQL.

**`pipeline_runs.phase_results` (forma esperada del jsonb):**
```jsonc
{
  "refresh": {
    "by_source": {
      "google_places": { "leads": 45, "duration_ms": 1380000, "cost_usd": 0.90 },
      "mintur":         { "leads": 32, "duration_ms": 1680000, "cost_usd": 0    },
      "yelu":           { "leads": 28, "duration_ms": 2460000, "cost_usd": 0    },
      "osm":            { "leads": 22, "duration_ms":  360000, "cost_usd": 0    }
    },
    "total_leads": 127, "duration_ms": 5880000, "total_cost_usd": 0.90
  },
  "discovery": {
    "jobs": [{ "source": "yelu", "location": "salto", "niche": "restaurant",
               "leads_new": 12, "leads_corroborated": 3, "cost_usd": 0 }],
    "total_new": 14, "total_corroborated": 8, "total_cost_usd": 0
  },
  "enrich":  { "leads_processed": 14, "duration_ms": 1080000 },
  "score":   { "leads_scored": 3141, "new_hot": 3, "score_changes_up": 28, "score_changes_down": 12 }
}
```

**Quién escribe `cost_usd`:** los workers de `refresh` y `discovery` calculan `requests_made × 0.02` (rate Google Places) por source/job y lo persisten en `phase_results`. Para fuentes sin costo (mintur/osm/yelu/pedidosya scraping local) el valor es `0`. Fase 44 conecta este campo con `pipeline_config.google_places_budget_spent` (sumando `total_cost_usd` al final del run). El Cost Dashboard (item 26 del canónico) lee este campo para mostrar costo por fuente histórico.

**Notas para implementación (no en el schema):**
- `log_lines` se rota a máximo 200 entradas en el worker — más viejas se descartan en memoria, no se borra de la DB hasta que el run completa.
- `dashboard_stale=true` indica warning operativo en UI. No dispara refresh de `lead_dashboard`: la vista es normal y refleja DB actual.
- `phase_results` se va poblando mientras el run corre — la UI lee este campo cada 3s para mostrar progreso parcial.

**Diferencias con el snapshot anterior de esta sección (eliminado, marzo 2026):**
- Antes había duplicación con `§ Schema completo` arriba en este mismo documento. Se consolidó.
- Naming canónico: `triggered_by` (no `trigger`), `notify_webhook_url/secret/events` (no `notify_ui_badge`/`notify_email`), `phases` (no `phase_config`).

### API de pipeline (backend)

```typescript
// api/src/routes/pipeline.ts

GET  /api/v1/pipeline/config         → PipelineConfig desde tabla pipeline_config
PUT  /api/v1/pipeline/config         → guardar config; `src/` detecta el cambio y reconfigura cron
PATCH /api/v1/pipeline/config        → actualización parcial

POST /api/v1/pipeline/run
     body: { overrides?: Partial<PhaseConfig & { cpu_budget, phases }> }
     → inserta pipeline_runs row (status='pending'), emite pg_notify; `src/` ejecuta en background
     → responde { run_id } inmediatamente

POST /api/v1/pipeline/run/dry
     body: { overrides? }
     → calcula qué haría: cuántos leads refreshearía, qué jobs discovery correría
     → responde { plan: { refresh_count, discovery_jobs, enrich_estimate, duration_estimate } }

POST /api/v1/pipeline/abort          → setea abort_requested=true en el run activo; `src/` deja status='aborted'
POST /api/v1/pipeline/pause-phase
     body: { phase: 'refresh'|'discovery'|'enrich'|'score' }    → pausa la fase, continúa con la siguiente al retomar
     // Naming alineado con phase_results jsonb keys. Fase 5 (report) no es pausable.

GET  /api/v1/pipeline/runs?status=completed,failed&limit=20&cursor=<id>
GET  /api/v1/pipeline/runs/active    → run con status='running', null si no hay
GET  /api/v1/pipeline/runs/:id       → run completo con phase_results
GET  /api/v1/pipeline/runs/:id/log?since=<iso> → log_lines nuevas desde timestamp
```

### Configuración del cron en el servidor

El cron se configura en memoria al arrancar el proceso `src/` (core). Si `pipeline_config.enabled=true`, `src/` registra el job con la expresión cron guardada. Cuando el frontend actualiza la config vía `PUT /api/v1/pipeline/config`, `api/` solo guarda la config; `src/` detecta el cambio con `configWatcher()` y reregistra el cron en memoria sin reiniciar.

```typescript
// src/modules/pipeline/scheduler.ts
import { schedule } from 'node-cron'

let currentCronJob: ScheduledTask | null = null

export function reconfigureCron(config: PipelineConfig): void {
  currentCronJob?.stop()
  if (!config.enabled) return
  currentCronJob = schedule(config.cron_expression, () => {
    triggerPipelineRun({ triggered_by: 'cron', config })
  })
}
```

### CLI para el pipeline completo

```bash
# Run manual completo (usa config guardada en DB)
blindspot pipeline --run-all [--cpu-budget balanced] [--dry-run]

# Con overrides
blindspot pipeline --run-all --phases refresh,score --source yelu

# Solo refresh de fuentes stale
blindspot pipeline --refresh-only [--source yelu]

# Solo discovery de la cola
blindspot pipeline --discovery-only [--limit 3]

# Ver estado del último run
blindspot pipeline --status
```

---

## Diseño — RUT / enriquecimiento fiscal

### Estado canónico al 2026-05-18

La antigua línea de trabajo `DGI/BPS` quedó descartada permanentemente por decisión de producto/legal y no forma parte del roadmap ejecutable. No asumir que MINTUR aporta RUT: `context/research/mintur.md` documenta que el RUT no está expuesto públicamente.

Reglas vigentes:
- no implementar parser RUT ni scraping/ingesta de DGI/BPS;
- no inferir RUT por nombre comercial;
- no dejar features futuras dependiendo de una fase DGI/BPS inexistente.

Si en el futuro apareciera una fuente oficial nueva, permitida y explícitamente aprobada, deberá abrirse como decisión de producto nueva y no como reactivación automática de esta documentación.

### Nota histórica sobre valor fiscal para scoring

Esta tabla se conserva solo como referencia histórica de diseño. No hay fase activa que la implemente mientras DGI/BPS permanezca descartado.

### Nota histórica sobre CIIU → sub-niche

El mapeo siguiente queda como referencia teórica. No debe tratarse como dependencia activa del roadmap actual:

| CIIU4 range | Sub-niche | Sub-scores activados |
|-------------|-----------|---------------------|
| 4711–4719 | retail_general | catalogo, software |
| 4751–4759 | retail_specialty | catalogo, marketing |
| 5610–5630 | restaurant | catalogo, software, marketing |
| 8621–8699 | health_services | reservas_online, software |
| 9311–9329 | gym_sports | reservas_online, software |
| 9511–9529 | repair_services | marketing, web_nuevo |
| 6910–6920 | legal_accounting | web_nuevo, marketing |

### Parser RUT

No implementar mientras la decisión de descarte siga vigente.

---

## Diseño — Sub-niche detection para leads "other"

### El problema

2.034 leads clasificados como "other" (59% del total passed). Rating promedio 4.57, 225 reviews. Cero hot leads. El sistema no tiene sub-score logic para este niche porque no sabemos qué tipo de negocio son.

Muchos pueden resolverse con CIIU (si tienen RUT). Para los que no, usamos clasificación por nombre vía LLM liviano.

### Flujo de sub-niche detection

```
Al enriquecer un lead con niche='other':

  1. Si en un futuro existiera una fuente aprobada con RUT y CIIU resuelto → sub_niche del mapa CIIU

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
- Costo/límites se revalidan al implementar según `LLM_PROVIDER`/`LLM_MODEL`; no hardcodear un modelo específico en el roadmap.
- Ollama local: sin costo, ~2 segundos por lead con Mistral 7B → ~68 minutos total
- Resultado: 2.034 leads potencialmente activados

### CLI para activar la clasificación

```bash
# Clasificar sub-niche para todos los leads 'other'
blindspot enrich --sub-niche-detection --niche other [--dry-run] [--concurrency 5]
```
