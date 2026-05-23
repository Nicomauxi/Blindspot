# Blindspot — Architecture

> Fuente de verdad técnica del estado implementado hoy.
> Este archivo describe lo que existe realmente en el repo al 2026-05-22.
> El diseño objetivo de mejoras futuras vive en `ARCHITECTURE_FUTURE.md`.

---

## Stack real

- Runtime: Node.js 20 + TypeScript strict + pnpm
- Core pipeline: `src/`
- API HTTP: `api/` con Fastify
- UI admin: `ui/` con Next.js App Router
- DB: PostgreSQL local vía Supabase/Docker
- Scraping/browser: Playwright
- Tests: Vitest + smoke API + validaciones UI build/typecheck

## Procesos reales

### `api/`

- expone auth, RBAC, leads, outreach, pipeline, discovery y admin endpoints
- centraliza validación de requests, guards y contratos UI/API
- incluye administración de backups y restore

**Rutas presentes:**
- `api/src/routes/leads.ts`
- `api/src/routes/outreach.ts`
- `api/src/routes/campaigns.ts`
- `api/src/routes/discovery.ts`
- `api/src/routes/discovery-insights.ts`
- `api/src/routes/pipeline.ts`
- `api/src/routes/stats.ts`
- `api/src/routes/health.ts`
- `api/src/routes/users.ts`
- `api/src/routes/service-pricing.ts`
- admin: `audit-log`, `backups`, `costs`, `performance`, `system`

### `src/`

- proceso long-running del pipeline
- polling/listener/scheduler
- discovery multi-source
- enrichment
- scoring
- webhook pipeline si aplica

**Módulos relevantes presentes:**
- `src/modules/pipeline/*`
- `src/modules/discovery/*`
- `src/modules/enrichment/*`
- `src/modules/scoring/*`

### `ui/`

Páginas admin implementadas hoy:
- `admin/page.tsx`
- `admin/leads`
- `admin/outreach`
- `admin/discovery`
- `admin/pipeline`
- `admin/backups`
- `admin/costs`
- `admin/performance`
- `admin/health`
- `admin/users`
- `admin/audit-log`
- `admin/help`

Shell admin implementado hoy:
- sidebar agrupado en `Operación`, `Comercial`, `Plataforma` y `Ayuda`
- grupos colapsables con persistencia por sesión y grupo activo abierto por defecto
- buscador superior para filtrar secciones
- iconografía consistente por destino
- la ruta `/admin/health` sigue vigente pero se presenta como `Monitoreo` en navegación
- dark mode persistido con script de hidratación temprana y toggle en el sidebar
- tokens globales y overrides compartidos para el dashboard admin

## Backups implementados hoy

- backup manual desde UI admin
- backups programados por cron
- restore desde UI con checkpoint previo y maintenance mode
- metadata persistida en DB
- listado de backups existentes en UI
- health/admin exponen estado de backups

**Gap conocido:**
- la retención máxima todavía usa un único límite operativo; el programa actual busca separarla en manual vs scheduled.

## Discovery implementado hoy

- Composer crea batches/jobs desde la UI
- discovery multi-source operativo
- Google Places, MINTUR, OSM, Yelu y PedidosYa integrados con distintos niveles de aporte
- el pipeline puede correr discovery y enriquecer/scorar por CLI/core

**Gaps conocidos:**
- el composer hoy no encadena formalmente enrichment por defecto
- el workspace tiene deuda de UX
- `jobs legacy` sigue apareciendo en la experiencia
- la lógica de nichos MINTUR todavía deja demasiado `other`

## Monitoreo implementado hoy

La observabilidad existe, pero está repartida:
- `health`
- `admin/system`
- `admin/costs`
- `admin/performance`
- `admin/backups`

**Estado actual:**
- existe contrato backend unificado `GET /api/v1/admin/monitoring/overview` para observabilidad admin.
- existe ruta UI `admin/monitoring` como pantalla ejecutiva unificada de monitoreo.
- `admin/health` sobrevive solo como alias con redirect.

**Gap conocido:**
- siguen existiendo vistas técnicas especializadas (`costs`, `performance`, `backups`) como drill-downs separados, aunque la visión ejecutiva ya quedó centralizada.

## Modelo comercial implementado hoy

- Leads, Outreach y Campaigns existen
- todavía no existe un CRM propio de seguimiento por etapas con board tipo Jira
- tampoco existe un sistema persistido de feedback humano sobre calidad de datos del lead

## Convenciones operativas importantes

- la coordinación entre `api/` y `src/` ocurre por PostgreSQL, no por HTTP interno
- los cambios de schema deben vivir en `supabase/migrations`
- las validaciones habituales del repo son:
  - `pnpm test`
  - `pnpm typecheck`
  - `pnpm --dir ui typecheck`
  - `pnpm --dir ui build`
  - `pnpm smoke:api`
  - `supabase db reset` cuando cambia schema
