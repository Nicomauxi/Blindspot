# Blindspot — Future

> Solo contiene lo que NO está hecho todavía.
> Al completar un item → borrarlo.
> Al agregar un objetivo nuevo → insertarlo en el lugar correcto por prioridad.
>
> **Fuente canónica de ejecución:** `ROADMAP_CANONICAL.md`. Si hay contradicción entre este archivo y el roadmap canónico, gana `ROADMAP_CANONICAL.md`.
>
> **Modelo del sistema (decidido 2026-05-16):** herramienta interna privada para uso del admin + socios con accesos controlados. NO se comercializa. Optimizar para filtrado complejo sobre muchos datos y panel de administración robusto, NO para escala de tráfico masivo. Ver `PROJECT_MASTER.md § Modelo de uso` y `ADMIN_PANEL.md` para detalles.

---

## Urgente — Bloqueantes para el valor del producto

> Ejecutar en este orden por **bloques de dependencias**. Cada bloque deja un estado coherente para que el siguiente arranque sin recomputaciones.
> Ver `ARCHITECTURE_FUTURE.md` para el diseño objetivo completo de scoring, contactabilidad y pitch.

### Flujo de ejecución por bloques (canónico — sincronizado con `ROADMAP_CANONICAL.md § Roadmap ejecutable`)

**Bloque 1 — Schema aditivo + infra (todo aditivo, no destructivo):**

**Bloque 2 — Calidad de datos antes de scorear (alimentan inputs de Fase 22):**

**Bloque 3 — API + core automation (después de scoring estable):**
4. **Fase API-0** — `users`, `pipeline_runs`, `pipeline_config`, `discovery_jobs`, `audit_log`, **`lead_outreach`**, `contacted_by` (schemas canónicos completos). `lead_outreach` se crea acá para desbloquear la matriz de auth de Fase API.
5. **Fase 23** — Core long-running: `src/start.ts`, cron, `LISTEN pipeline_trigger`, polling y ejecución de `pipeline_runs`/`discovery_jobs`.
6. **Fase API** — Fastify endpoints reales (incluye `/api/v1/outreach*` y `/api/v1/leads*`) + `lead_dashboard` VIEW + matriz completa de tests de autorización. `/api/v1/campaigns*` queda como stub 501 hasta Fase 43.

**Bloque 4 — Operación segura (antes de dar acceso a socios):**
7. **Admin MVP UI** — User Management + lead_filter + Health read-only + Audit Log Viewer. No incluye Cost Dashboard, Performance Dashboard ni restart.
8. **Fase 46** — Anti-detección scraping. Aprobación humana/dependencias; stealth/proxy requiere aprobación explícita separada.
9. **Fase 48** — HTTPS + pm2 + Nginx + rate limiting. Manual/aprobación humana.
10. **Fase 39** — Webhook de notificaciones externas (Slack/n8n/Make). HMAC-SHA256, `pipeline_runs.webhook_status`. Útil cuando hay equipo notificándose fuera de la UI.

**Bloque 5 — Outreach + UI (post-API estable):**
11. **Fase 25** — `lead_outreach` feedback loop completo: trigger de `leads.contacted_by`, CLI stats, verificación end-to-end. Tabla ya existe desde API-0.
12. **Fase 44-pre** — `llm_usage_log` (mover antes de Fase 26 para que el primer uso real de LLM ya quede auditado y medible).
13. **Fase 26** — LLM offer generation.
14. **Fase 27** — Service pricing.
15. **Fase 13** — PedidosYa escape segment (`commission_estimate` en `delivery_propio` con `service_pricing.delivery_system`).
16. **UI base** — Lead Explorer + Detail + Outreach Tracker + Segment Explorer.

**Bloque 6 — Pipeline Manager + Discovery CC + Dashboards admin avanzados:**
17. **Pipeline Manager UI** — pantalla `/pipeline` consume API existente desde Fase 23. Desbloquea operación del cron desde UI.
18. **Discovery Control Center UI** — pantalla `/discovery` consume `/api/v1/discovery/jobs` y `/suggestions`.
19. **Fase 24** — Batch discovery multi-ciudad (CLI `--location-list` integrado con `pipeline_runs` sub-jobs).
20. **Fase 44** — Google Places budget tracker (backend + badge UI en Pipeline Manager).
21. **Cleanup snapshots v1** — `DROP COLUMN prospect_score_v1, score_breakdown_v1` con backup previo. Manual/aprobación. El admin decide cuándo (ver alerta `scoring_v1_columns_present` en Health).

**Bloque 7 — Enriquecimiento incremental + refinamientos scoring (cierre del producto):**
27. **Fase 40** — Full-text search.
28. **Fase 28** — Sub-niche detection (LLM clasifica `niche='other'`).
29. **Fase 29** — MINTUR TipoOperador extraction (sub-segmenta los 2027 MINTUR).
30. **Fase 11** — IMM Habilitaciones provider — **requiere Gemini DeepSearch previo** (research manual del Tech Lead).
31. **Fase 18** — Cruce MINTUR × IMM — desbloquea ~1600 teléfonos MINTUR (post-Fase 11).
32. **Fase 38** — Geo-dedup (post-PostGIS).
33. **Fase 37** — `canonical_source` (fuente de mayor confianza) — refinamiento dedup post-Fase 38.
34. **Fase 43** — Campañas de outreach (cierra el contrato de `/api/v1/campaigns*`).
35. **Fase 36** — `days_in_pool` scoring (refinamiento timing_factor).
36. **Fase 41** — `owner_group_id` (detección mismo propietario por phone/email).
37. **Fase 42** — Scoring estacional — **requiere data de conversión** (≥30 outreach cerrados en 2+ estaciones).
38. **Fase 30** — DGI/BPS dataset resolution — **DESCARTADA permanentemente por decisión de producto/legal (2026-05-18)**. No implementar ni reactivar dentro de este roadmap.

**Por qué este orden ahorra trabajo:**
- **Un solo `score --all`** (en Fase 22) en vez de tres (versión vieja: inicial + post-Fase-6 + post-reconciliación).
- `contact_reliability_score` ya es real cuando Fase 22 lo consume.
- `corroborating_sources` ya tiene >0 entradas cuando Fase 22 lo consume (Fase 6 antes).
- `gps` y `inferred_state` ya son columnas indexables cuando Fase 22 los referencia (Fase 21 y 47 antes).
- Fase 23 queda entre API-0 y API: el schema existe antes de crear el proceso core, y la API no promete triggers que nadie consuma.
- Admin MVP queda separado de dashboards avanzados: se puede operar usuarios, filtros, health y auditoría sin construir costos/performance/restart.
- `llm_usage_log` se crea justo antes del primer uso real de LLM (Fase 26) y `pipeline_errors` justo antes de Performance Dashboard — no quedan colgadas ni se pierde telemetría temprana.

**Reglas que NO cambian:**
- Fase 22-pre crea columnas de rollback; Fase 22 **backfillea `prospect_score_v1` y `score_breakdown_v1`** inmediatamente antes del primer `score --all` con v2.
- Fases 22, 47 y 6 requieren aprobación humana — ver `AUTONOMOUS.md § Fases que requieren aprobación humana`.
- Backup obligatorio antes de cada step destructivo (Fase 47, Fase 22 step `score --all`).

---

### Fase 20 — ✅ Absorbida por Fase 22

`contact_tier` y `pitch_hook` se implementan dentro del engine de scoring v2 (Fase 22, steps 10-12). No es una fase separada.

---

---

## API HTTP y frontend

> El sistema usa un **repo único** con tres directorios: `src/` (core pipeline), `api/` (Fastify), `ui/` (Next.js).
> Dos procesos en el servidor: core pipeline + API HTTP.
> Ver `context/ARCHITECTURE_FUTURE.md § Arquitectura: un repo, dos procesos` para el diseño completo.

### ✅ Fase API-0 — completada 2026-05-18

Tablas creadas: `users`, `pipeline_runs`, `pipeline_config`, `discovery_jobs`, `audit_log`, `lead_outreach`, `leads.contacted_by`. Ver `db/migrations/014_api_0_schema.sql`.

**Implementación:**
1. Migración: tabla `users` (id, email, password_hash, role, lead_filter, active, created_at, updated_at, last_login_at) — ver schema completo en `ARCHITECTURE_FUTURE.md § Autenticación y roles`
2. **Tabla `lead_outreach` — crear acá con schema canónico completo.** Movida desde Fase 25 a esta fase (canónico actualizado por octava auditoría 2026-05-16) para desbloquear la matriz de autorización de Fase API sin esperar a Bloque 7. Schema idéntico a `ARCHITECTURE_FUTURE.md § Tabla lead_outreach — diseño final` — incluye `user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT`. CC debe verificar idempotencia: `SELECT to_regclass('lead_outreach');` y saltar si ya existe. La columna `campaign_id` NO se crea acá — la agrega Fase 43 via ALTER TABLE (porque `outreach_campaigns` aún no existe).

   ```sql
   CREATE TABLE lead_outreach (
     id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     lead_id       uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
     user_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
     created_at    timestamptz DEFAULT now(),
     updated_at    timestamptz DEFAULT now(),

     offer_type    text,
     channel       text NOT NULL,
     offer_package jsonb,

     status        text NOT NULL DEFAULT 'contacted'
                   CHECK (status IN ('contacted','responded','interested','closed_won','closed_lost','no_response')),

     responded     boolean,
     outcome       text
                   CHECK (outcome IS NULL OR outcome IN ('closed_won','closed_lost','not_now','has_provider')),
     lost_reason   text
                   CHECK (lost_reason IS NULL OR lost_reason IN ('price','timing','no_interest','competitor','other')),
     service_sold  text,
     price_sold    integer,
     notes         text,

     contacted_at  timestamptz DEFAULT now(),
     responded_at  timestamptz,
     closed_at     timestamptz,

     lead_quality_signal smallint DEFAULT 0
   );

   CREATE INDEX lead_outreach_lead_id    ON lead_outreach(lead_id);
   CREATE INDEX lead_outreach_user_id    ON lead_outreach(user_id);
   CREATE INDEX lead_outreach_status     ON lead_outreach(status);
   CREATE INDEX lead_outreach_outcome    ON lead_outreach(outcome) WHERE outcome IS NOT NULL;
   CREATE INDEX lead_outreach_closed_at  ON lead_outreach(closed_at) WHERE closed_at IS NOT NULL;

   CREATE TRIGGER lead_outreach_updated_at BEFORE UPDATE ON lead_outreach
     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
   ```

   **Consecuencias:** Fase 25 deja de ejecutar el CREATE TABLE (su sección ahora cubre solo el trigger de `contacted_by`, CLI stats y verificación end-to-end). El endpoint `POST /api/v1/outreach` de Fase API queda funcional sin stub. La matriz de auth ("CM solo puede leer/modificar su propio `lead_outreach`") es testeable desde Fase API.
3. Insertar usuario admin inicial — generar el hash primero:
   ```bash
   # Generar bcrypt hash (cost 12) desde Node.js antes de insertar:
   node -e "const bcrypt = require('bcrypt'); bcrypt.hash('tu_password_aqui', 12).then(h => console.log(h))"
   # Copiar el output ($2b$12$...) y usarlo en el INSERT:
   ```
   ```sql
   INSERT INTO users (email, password_hash, role)
   VALUES ('admin@blindspot.local', '$2b$12$<hash_generado_arriba>', 'admin');
   ```
4. Índice lookup: no crear índice adicional — `email text UNIQUE NOT NULL` ya crea el índice automáticamente.
5. Trigger `updated_at`:
   ```sql
   CREATE OR REPLACE FUNCTION set_updated_at()
   RETURNS TRIGGER LANGUAGE plpgsql AS $$
   BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
   CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
   ```

**`lead_filter` null/empty behavior:** admin ve todo por `role='admin'`, no por `lead_filter`. Para CM, `lead_filter IS NULL` es inválido y debe fallar cerrado (no crear ni actualizar un CM sin filtro explícito).

**Contrato del flag `acknowledge_unrestricted` (canónico — ver `ROADMAP_CANONICAL.md § Reglas de acceso`):** para que un `POST /api/v1/users` o `PATCH /api/v1/users/:id` admita `lead_filter = '{}'` (CM sin restricciones), el body de la request **debe** incluir `acknowledge_unrestricted: true`. Sin ese flag el endpoint retorna:
```json
HTTP/1.1 400 Bad Request
{ "error": "lead_filter empty requires explicit acknowledgement", "error_code": "lead_filter_empty_requires_ack" }
```
El flag se valida solo cuando `lead_filter` viene en el body con valor `{}`. La UI Admin (Pantalla A Users) presenta un checkbox separado "Sin restricciones (mostrar todos los leads)" que arma el body con ambos campos. El flag NO se persiste — solo desbloquea el guardado en esa request.

Si `lead_filter = '{"primary_offer":[]}'` → CM sin leads visibles (configuración de error, validar en API antes de guardar — retornar 400 con `error_code='lead_filter_array_empty'`).

**Sin self-registration** — admin crea cuentas CM vía `POST /api/v1/users` o query directa.

**6. Schemas canónicos de tablas requeridas por Fase API (crear aquí — Fase 23 NO ALTER posterior):**

Razón: Fase API necesita leer/escribir en estas tablas desde el día 1. **Schemas idénticos a los de `ARCHITECTURE_FUTURE.md § Schema completo — pipeline_runs/pipeline_config` y `§ Tabla discovery_jobs`.** No usar stubs reducidos — eso obliga a ALTER TABLE retroactivo en Fase 23 y rompe naming canónico (`triggered_by`, `phases`, `user_id`).

```sql
-- pipeline_runs: historial de runs del pipeline (schema canónico — completo)
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
  dashboard_stale  boolean DEFAULT false, -- warning UI si un run falló; no refresca VIEW

  -- Config usada en este run
  config_snapshot  jsonb,   -- copia de pipeline_config al iniciar
  overrides        jsonb,   -- overrides opcionales del POST /pipeline/run

  -- Resultados por fase (Fase 23 puebla la estructura interna)
  phase_results    jsonb,

  -- Log para el monitor de UI — jsonb (NO text[])
  log_lines        jsonb DEFAULT '[]',
  -- [{ ts: "ISO", msg: "texto", level: "info"|"warn"|"error" }, ...]

  -- Invariantes post-run
  invariant_details jsonb,

  -- Notificaciones
  webhook_status   text DEFAULT 'not_configured'
                   CHECK (webhook_status IN ('not_configured','sent','failed'))
);
CREATE INDEX pipeline_runs_status ON pipeline_runs(status);
CREATE INDEX pipeline_runs_created_at ON pipeline_runs(created_at DESC);

-- pipeline_config: configuración editable desde UI (fila única — singleton enforced) — schema canónico
CREATE TABLE pipeline_config (
  id                    text PRIMARY KEY DEFAULT 'singleton'
                        CHECK (id = 'singleton'),  -- impide múltiples filas
  updated_at            timestamptz DEFAULT now(),

  -- Schedule
  enabled               boolean DEFAULT false,
  cron_expression       text DEFAULT '0 2 * * 0',  -- domingos 02:00 UYU
  scheduled_for         timestamptz,                -- próxima ejecución calculada al guardar
  last_completed_at     timestamptz,                -- última ejecución completada OK

  -- Recursos
  cpu_budget            text DEFAULT 'balanced'
                        CHECK (cpu_budget IN ('conservative','balanced','aggressive')),
  timeout_per_lead_sec  integer DEFAULT 120,
  max_retries           integer DEFAULT 2,

  -- Config por fase (jsonb — sin migraciones adicionales para agregar parámetros)
  phases                jsonb DEFAULT '{
    "refresh":   { "enabled": true,  "sources": ["google_places","mintur","yelu","osm"], "priority_tiers_first": true },
    "discovery": { "enabled": true,  "max_jobs": 5 },
    "enrich":    { "enabled": true,  "with_heuristic": false, "concurrency": 5 },
    "score":     { "enabled": true,  "recalculate_buyer_types": true }
  }'::jsonb,

  -- Presupuesto Google Places (Fase 44 lo usa)
  google_places_budget_total     numeric(8,2) DEFAULT 200.00,
  google_places_budget_spent     numeric(8,2) DEFAULT 0.00,
  google_places_alert_threshold  numeric(8,2) DEFAULT 10.00,

  -- Costos manuales editables por admin (Cost Dashboard avanzado)
  infra_monthly_cost_usd         numeric(8,2) DEFAULT 0.00,
  backup_monthly_cost_usd        numeric(8,2) DEFAULT 0.00,

  -- Notificaciones (Fase 39 las activa; columnas creadas ahora para evitar ALTER posterior)
  notify_webhook_url     text,
  notify_webhook_secret  text,
  notify_webhook_events  text[] DEFAULT ARRAY['run_completed','new_hot_leads']
);

-- Solo existe una fila — singleton enforced por PK fijo 'singleton'.
-- ON CONFLICT DO NOTHING permite que la migración sea idempotente (replay seguro).
INSERT INTO pipeline_config (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING;

CREATE TRIGGER pipeline_config_updated_at BEFORE UPDATE ON pipeline_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- discovery_jobs: cola de jobs de discovery (schema canónico — naming `user_id`, NO `created_by`)
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
  cpu_budget   text DEFAULT 'balanced'
               CHECK (cpu_budget IN ('conservative','balanced','aggressive')),

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
CREATE INDEX discovery_jobs_status ON discovery_jobs(status) WHERE status IN ('queued','running');
CREATE INDEX discovery_jobs_user ON discovery_jobs(user_id) WHERE user_id IS NOT NULL;
```

**Nota para pnpm workspace:** antes de crear `api/`, verificar que `src/package.json` tiene `"name": "core"` y que existe `pnpm-workspace.yaml` en la raíz con `packages: ['src', 'api', 'ui']`. Si no, ajustarlo en este mismo step — es prerequisito para que `pnpm --filter api run start` y `pnpm --filter core run start` funcionen (Fase 48 depende de esto).

**Columna `contacted_by` en `leads`** (incluir en esta fase):
```sql
ALTER TABLE leads ADD COLUMN contacted_by uuid REFERENCES users(id) ON DELETE SET NULL;
-- ON DELETE SET NULL: si el user que contactó se elimina, contacted_by queda NULL.
-- El historial canónico vive en lead_outreach (con RESTRICT) — perder este shortcut
-- en el lead no es destructivo.
CREATE INDEX leads_contacted_by ON leads(contacted_by) WHERE contacted_by IS NOT NULL;
```
Se setea en `NULL` al crear el lead y se actualiza al primer registro en `lead_outreach` para ese lead. Es un shortcut para la UI de CM ("mis leads") — no reemplaza el historial completo de `lead_outreach`.

**7. Tabla `audit_log` (acciones admin auditables — requerido por modelo "socios con accesos controlados"):**

```sql
CREATE TABLE audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  actor_role  text NOT NULL,            -- snapshot del role en ese momento
  action      text NOT NULL,            -- ver lista canónica más abajo
  target_type text,                     -- 'user' | 'pipeline_config' | 'discovery_job' | 'lead' | 'system'
  target_id   text,                     -- uuid del recurso afectado (text para flexibilidad)
  diff        jsonb,                    -- before/after del cambio si aplica
  ip_address  inet,                     -- IP de la request si está disponible
  user_agent  text
);
CREATE INDEX audit_log_actor ON audit_log(actor_user_id, occurred_at DESC);
CREATE INDEX audit_log_target ON audit_log(target_type, target_id);
CREATE INDEX audit_log_occurred_at ON audit_log(occurred_at DESC);
```

**Lista canónica de `action` values** (mantener sincronizada con `ADMIN_PANEL.md § Tabla de endpoints admin`):

| Categoría | Action | Disparada por |
|-----------|--------|---------------|
| Users | `user.create` | `POST /api/v1/users` |
| Users | `user.update` | `PATCH /api/v1/users/:id` (cualquier campo excepto password/active/role/lead_filter) |
| Users | `user.password_reset` | `PATCH /api/v1/users/:id { password }` |
| Users | `user.deactivate` | `PATCH /api/v1/users/:id { active: false }` |
| Users | `user.reactivate` | `PATCH /api/v1/users/:id { active: true }` |
| Users | `user.role_change` | `PATCH /api/v1/users/:id { role }` |
| Users | `user.delete` | `DELETE /api/v1/users/:id` |
| Users | `lead_filter.update` | `PATCH /api/v1/users/:id { lead_filter }` |
| Pipeline | `pipeline.config.update` | `PUT/PATCH /api/v1/pipeline/config` |
| Pipeline | `pipeline.run.trigger` | `POST /api/v1/pipeline/run` |
| Pipeline | `pipeline.run.abort` | `POST /api/v1/pipeline/abort` |
| Discovery | `discovery.job.create` | `POST /api/v1/discovery/jobs` |
| Discovery | `discovery.job.update` | `PATCH /api/v1/discovery/jobs/:id` (pause/resume/cancel — `diff.action` distingue) |
| System | `system.restart` | `POST /api/v1/admin/system/restart-{core,api}` |

**Reglas del audit_log:**
- Insertar fila en cada acción de admin que modifique estado.
- Acciones de socios CM (registrar outreach, generar oferta, ver lead) NO se loguean aquí — viven en `lead_outreach` que ya es su historial.
- Endpoint `GET /api/v1/admin/audit-log?actor=&action=&from=&to=&limit=50&cursor=` (cursor-based).
- Sin política de retención automática — el admin decide cuándo purgar (manual SQL).
- **Audit log se escribe ANTES** de la acción cuando es destructiva (delete, deactivate, restart) — si la acción falla, el log queda igual y el admin sabe que se intentó. Acciones idempotentes (update) se loguean post-éxito.

---

### Fase API — Servidor Fastify en `api/` (mismo repo)

**Por qué:** el frontend necesita una API REST. La API vive en `api/` dentro de este repo — mismo servidor, mismo deploy, sin coordinación cross-repo. Core pipeline (Playwright, scoring, discovery) sigue siendo proceso separado.

**Prerequisitos:** Fase 22 estable + `contact_tier` + `pitch_hook` + `inferred_state` como columna (Fase 47) + Fase API-0 (users + pipeline tables completos).

**Nota crítica sobre `lead_dashboard` VIEW:** la VIEW referencia `score_breakdown->>'contact_tier'`, `score_breakdown->>'pitch_hook'`, `leads.inferred_state` y `leads.contact_ready`. Todos son generados por Fase 22 y Fase 47. Crear la VIEW SOLO después de que ambas fases estén aplicadas — el prerequisito "Fase 22 estable" ya lo cubre, pero asegurarse de verificar antes de ejecutar el step de creación de la VIEW.

**Estructura `api/`:**
```
api/
├── src/
│   ├── server.ts          ← Fastify instance + plugins
│   ├── auth/
│   │   ├── middleware.ts  ← JWT verify + role check
│   │   └── routes.ts      ← POST /auth/login, POST /auth/refresh
│   ├── routes/
│   │   ├── leads.ts       ← GET /leads, GET /leads/:id
│   │   ├── outreach.ts    ← GET/POST/PATCH /outreach, POST /outreach/generate-offer
│   │   ├── pipeline.ts    ← GET/PUT /pipeline/config, POST /pipeline/run, GET /pipeline/runs
│   │   ├── discovery.ts   ← GET/POST /discovery/jobs, GET /discovery/suggestions, /coverage
│   │   ├── stats.ts       ← GET /stats/overview, /stats/outreach, /stats/pipeline
│   │   ├── users.ts       ← GET/POST/PATCH/DELETE /users (solo admin)
│   │   ├── campaigns.ts   ← GET/POST /campaigns (STUB 501 hasta Fase 43)
│   │   ├── health.ts      ← GET /health (público)
│   │   └── admin/
│   │       ├── costs.ts        ← GET /admin/costs/overview, /admin/costs/history
│   │       ├── performance.ts  ← GET /admin/performance/{overview,errors,quality}
│   │       ├── system.ts       ← GET /admin/system/status, POST /admin/system/restart-{core,api}
│   │       └── audit-log.ts    ← GET /admin/audit-log
│   └── db/
│       └── client.ts      ← createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
└── package.json
```

**Endpoints admin creados por Fase API (no por fases UI posteriores):** Fase API crea **todos** los handlers de `/api/v1/admin/*` enumerados arriba. Las fases UI (Cost Dashboard UI, Performance Dashboard UI, Restart Actions UI) **consumen** estos endpoints — no los crean. Pero hay que distinguir **existencia del route handler** de **datos plenamente operativos**:
- `GET /admin/audit-log` y `GET /admin/system/status` quedan operativos desde Fase API.
- `GET /admin/costs/*` puede existir desde Fase API, pero no debe prometer métricas completas hasta `Fase 44-pre` + `Fase 44` (cuando ya existen `llm_usage_log` y `google_places_budget_spent`). Antes de eso puede responder estructura vacía/parcial explícita (`data_not_ready_until_phase_44`) o métricas limitadas a fuentes ya disponibles.
- `GET /admin/performance/*` puede existir desde Fase API, pero no debe prometer métricas completas hasta `Fase 45-pre` + `Fase 45` (cuando ya existe `pipeline_errors` y change detection). Antes de eso puede responder estructura vacía/parcial explícita (`data_not_ready_until_phase_45`) o solo métricas base derivables de `pipeline_runs`.
- `POST /admin/system/restart-{core,api}` existe pero retorna 501 `restart_disabled_in_dev` hasta Fase 48.
La regla canónica es: **crear el contrato temprano, no inventar datos antes de que exista la tabla o señal que los alimenta.**

**Stub para Fase 43:** `campaigns.ts` existe en Fase API como stub que retorna 501 `not_implemented_until_phase_43`. Fase 43 reemplaza la implementación contra la tabla real `outreach_campaigns`.

**Lo que NUNCA va en `api/`:**
- Playwright, Puppeteer, o cualquier browser automation
- Lógica de scoring (`computeContactTier`, `calculateSubScores`, etc.)
- Discovery providers (`YeluProvider`, `OSMProvider`, etc.)
- Enrichment parsers

**Configuración Fastify (plugins obligatorios):**
```typescript
// server.ts
app.register(import('@fastify/cors'), {
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
})
app.register(import('@fastify/helmet'))  // headers de seguridad
app.register(import('@fastify/rate-limit'), { max: 100, timeWindow: '1 minute' })
```

**Vista `lead_dashboard`:** VIEW normal (no MATERIALIZED) — suficiente para 2-8 usuarios. Crear como paso explícito antes del primer endpoint de leads:
```sql
-- Ejecutar como migración al deployar la API
CREATE VIEW lead_dashboard AS
SELECT ... -- ver definición completa en ARCHITECTURE_FUTURE.md § View lead_dashboard
```

**Paginación cursor-based en todos los list endpoints:**
- Todos los GET de colecciones aceptan `limit` (default 50, max 200) y `cursor` (último `id` de la página anterior)
- Respuesta siempre incluye `{ data: T[], next_cursor: string | null, total: number }`
- Aplica a: `GET /leads`, `GET /outreach`, `GET /stats/outreach`, `GET /pipeline/runs`

**Validación de filtros de CM en endpoints individuales:**
- `GET /leads/:id` → si el lead no pasa el `lead_filter` del CM → 404 para no revelar existencia
- `PATCH /outreach/:id` → CM solo puede actualizar sus propios registros (`user_id = req.user.id`)
- `GET /stats/overview` → para CM, retorna solo sus métricas de outreach (no globales)

**Endpoint de password reset (admin only):**
- `PATCH /api/v1/users/:id` body: `{ password?: string, active?: boolean, lead_filter?: object }`
- Solo admin puede cambiar la password de otro usuario
- No hay "forgot password" email — uso interno, admin lo resetea directamente

**Trigger de pipeline:** `api/` escribe `pipeline_runs` row + `pg_notify('pipeline_trigger', run_id)`. Core escucha `LISTEN pipeline_trigger` + pollea `pipeline_runs WHERE status='pending'` cada 60s como fallback.

**Verificación post-setup:**
```bash
# API corriendo en puerto 3001:
curl -H "Authorization: Bearer <token>" \
  http://localhost:3001/api/v1/leads?contact_tier=A,B&prospect_score_gte=40&limit=5
# → { data: LeadCard[], next_cursor: string|null, total: number }

# Trigger de pipeline:
curl -X POST -H "Authorization: Bearer <token>" http://localhost:3001/api/v1/pipeline/run
# → { run_id: "uuid" }
# → core debe recibir el pg_notify y empezar a ejecutar
```

**Matriz obligatoria de tests de autorización (no cerrar Fase API sin esto):**
- Admin lista y ve todos los leads.
- CM con `lead_filter IS NULL` no se puede crear/actualizar — `POST /api/v1/users` y `PATCH /api/v1/users/:id` retornan 400 con `error_code='lead_filter_required'`. Si por datos viejos existe un CM con `lead_filter IS NULL`, sus requests fallan cerrado (no ven ningún lead).
- CM con `lead_filter = '{}'` solo se crea/actualiza si el body incluye `acknowledge_unrestricted: true`. Sin el flag, 400 con `error_code='lead_filter_empty_requires_ack'`. Con el flag, se persiste el `{}` y el CM ve todos los leads.
- CM ve solo la intersección entre `lead_filter` y filtros del request.
- `GET /api/v1/leads/:id` devuelve `404` para un lead fuera del filtro del CM (NO `403`, para no revelar existencia).
- CM solo puede leer/modificar su propio `lead_outreach` (`PATCH /api/v1/outreach/:id` con `user_id != $auth.user_id` retorna 404). La tabla `lead_outreach` se crea en Fase API-0 — la matriz es ejecutable desde esta fase sin esperar a Fase 25.
- **Live update de `lead_filter`:** crear CM con filtro F1, autenticar y `GET /api/v1/leads` → conjunto A. Admin `PATCH /api/v1/users/:id { lead_filter: F2 }`. CM con el mismo JWT (sin re-login) llama `GET /api/v1/leads` → conjunto B distinto de A según F2. Falla si la API cachea `lead_filter` del token.
- `active=false` bloquea al usuario inmediatamente aunque tenga JWT previo. Test: autenticar CM, admin `PATCH /api/v1/users/:id { active: false }`, siguiente request del CM con el mismo token → 401 (o 403) sin esperar expiración.
- `/api/v1/users`, `/api/v1/admin/*`, `PUT/PATCH /api/v1/pipeline/config` y audit log son admin-only. CM recibe 403 en todos esos paths.
- `/api/v1/campaigns*` retorna 501 con `error_code='not_implemented_until_phase_43'` (stub esperado — no falla la matriz). Fase 43 reemplaza el stub con implementación real.
- Acciones admin que modifican estado escriben `audit_log` con `actor_user_id`, `action`, `target_type`, `target_id` y `diff`. El set canónico de `action` está en `§ Fase API-0 step 7`.
- **Validación cross-field `lead_outreach.status` ↔ `outcome` en handler `POST/PATCH /api/v1/outreach`:** si `status='closed_won'`, `outcome` debe ser `'closed_won'` o `NULL`. Si `status='closed_lost'`, `outcome` debe ser `'closed_lost'` o `NULL`; `lost_reason` solo se permite si `status='closed_lost'`. Si `status NOT IN ('closed_won','closed_lost')`, `outcome` puede ser `'not_now'`, `'has_provider'` o `NULL`. Cualquier mismatch retorna 400 con `error_code='outreach_status_outcome_mismatch'`. Test obligatorio en la matriz.

**Regla de implementación auth:** el JWT puede identificar al usuario, pero la API debe cargar `active`, `role` y `lead_filter` actuales desde DB en requests protegidos. No confiar en un `lead_filter` embebido en un token viejo.

---

## Automatización de pipeline

### Fase 23 — Pipeline completo automatizado con cron + Pipeline Manager API

**Por qué:** hoy cada paso (refresh, discovery, enrich, score) se lanza manualmente. La automatización debe seguir el orden correcto: **primero refrescar lo existente, luego descubrir nuevo, luego enriquecer descubierto, luego re-scorear todo**. La configuración debe ser editable desde el frontend (Pipeline Manager) sin tocar el servidor. Ver `ARCHITECTURE_FUTURE.md § Pipeline de automatización completo`.

**Prerequisito:** Fase API-0 aplicada. Fase 23 consume `pipeline_runs`, `pipeline_config` y `discovery_jobs`; no crea ni altera esas tablas.

**Límite de modo autónomo:** puede implementar scheduler, watchers, tests y fixtures. No puede ejecutar discovery real, Google Places, scraping real ni `score --all` sin aprobación explícita.

**Implementación — CLI (blindspot):**
1. Comando `blindspot pipeline --run-all [--cpu-budget balanced] [--dry-run] [--phases refresh,score]`
2. Tabla `pipeline_runs` — historial con `phase_results` detallados por fuente y `log_lines`
3. Tabla `pipeline_config` — configuración persistida en DB, editable desde UI
4. `node-cron` para schedule interno — se reconfigura en memoria cuando UI actualiza la config
5. Al terminar: verificar invariantes, guardar en `pipeline_runs.invariant_details`

**Integración con API (para el Pipeline Manager del frontend):**
> Estos endpoints ya están definidos en Fase API — no reimplementar. Fase 23 los *completa* con la lógica de cron y el scheduler, pero las rutas HTTP las crea Fase API.
> Referencia: `ARCHITECTURE_FUTURE.md § Diseño objetivo — api/ → Endpoints que expone`.

La responsabilidad de Fase 23 respecto al Pipeline Manager queda del lado `src/` (core) — **las tablas `pipeline_runs` y `pipeline_config` YA fueron creadas con schema canónico completo en Fase API-0 (Bloque 5)**. Fase 23 NO ejecuta `CREATE TABLE`; solo agrega la lógica que las consume:
- Implementar `node-cron` en `src/` que lee `pipeline_config.cron_expression` y dispara el run
- Implementar `configWatcher()` que reconfigura el cron cuando `pipeline_config.updated_at` cambia
- **Owner del cálculo de `pipeline_config.scheduled_for`:** `api/` lo calcula al recibir `PUT/PATCH /api/v1/pipeline/config` (usa `cron-parser` para parsear el `cron_expression` nuevo). `src/` lo recalcula al **finalizar exitosamente un run del cron** dentro del mismo UPDATE que setea `last_completed_at = now()` — sin este recálculo, `scheduled_for` queda apuntando a un tick ya pasado y el detector de missed-run dispara falsos positivos en cada arranque. `cron-parser` se instala en ambos workspaces (`api/` y `src/`).
- **Owner de `pipeline_runs.dashboard_stale`:** `src/` setea `dashboard_stale = true` en el mismo UPDATE final cuando `status IN ('failed','partial')`. Al completar un run posterior con `status='completed'`, `src/` setea `dashboard_stale = false`. El campo es read-only para la UI (warning visual); no dispara refresh de VIEW.
- Implementar warning de missed run: si `pipeline_config.enabled=true`, `scheduled_for < now() - INTERVAL '15 minutes'` y `last_completed_at < scheduled_for`, `/api/v1/health` expone `cron.missed=true`. En `startup` de `src/`, además, encolar un run con `triggered_by='startup-recovery'` (ver `ARCHITECTURE_FUTURE.md § Detección de cron missed runs`).
- **Crash recovery de runs zombie al boot:** antes de registrar `LISTEN`/cron, ejecutar un cleanup que marque `pipeline_runs.status='running'` huérfanos como `aborted`, agregue una entrada `startup-crash-recovery` a `log_lines` y deje `dashboard_stale=true`.
- Implementar el comando `blindspot pipeline --run-all` y reutilizar su lógica desde `src/start.ts` cuando `src/` consume un `pipeline_runs.status='pending'` notificado por `pg_notify`
- Poblar `pipeline_runs.phase_results` durante la ejecución (estructura ya documentada en `ARCHITECTURE_FUTURE.md § pipeline_runs.phase_results`)

**Fases del pipeline en orden:**
```
1. Refresh stale enrichments (por source, prioridad tiers A+B primero)
2. Discovery queue (discovery_jobs pendientes)
3. Enrich nuevos descubiertos
4. Score de todos los actualizados + buyer types
5. Invariant check + report
```

**Parámetros configurables desde UI:**
- `cron_expression`: cuándo corre automáticamente
- `cpu_budget`: conservative/balanced/aggressive (determina concurrencia)
- `timeout_per_lead_sec`, `max_retries`: tolerancia a errores
- Por fase: habilitado/deshabilitado, fuentes incluidas, with_heuristic, max_jobs
- `enabled`: on/off del cron completo sin perder la config

**5. Entry point long-running para `src/` (proceso core):**
   - Crear `src/start.ts`: arrancar LISTEN `pipeline_trigger` (pg_notify), poll `pipeline_runs WHERE status='pending'` cada 60s (fallback), poll `discovery_jobs WHERE status='queued'` cada 30s, y el cron interno (`node-cron`) leyendo `pipeline_config.cron_expression`.
   - Agregar script en `src/package.json` (`"name": "core"`): `"scripts": { "start": "tsx src/start.ts" }` (o el equivalente según setup tsx del proyecto).
   - **Este es el proceso que pm2 arranca en Fase 48** via `pnpm --filter core run start`. Sin este entry point, Fase 48 fallará al configurar pm2.

**Archivos:** `src/start.ts` (nuevo), `src/cli/commands/pipeline.ts` (nuevo), `src/modules/pipeline/scheduler.ts` (nuevo), tablas `pipeline_runs` + `pipeline_config` (schemas creados en Fase API-0, Fase 23 agrega lógica completa)

---

### Admin MVP UI — operación mínima segura antes de socios

**Por qué:** antes de compartir acceso con socios, el admin necesita operar usuarios/filtros, ver estado básico y auditar cambios sin usar SQL/SSH. No hace falta construir todavía dashboards de costos, performance ni restart de procesos.

**Prerequisitos:** Fase API completa + `users` + `audit_log` + endpoint `/api/v1/health`.

**Alcance incluido:**
1. User Management básico:
   - listar usuarios;
   - crear CM con password inicial (con opción `seed_pricing: copy_admin | empty` cuando Fase 27 ya esté aplicada);
   - editar `active`, `role`, `lead_filter`;
   - resetear password;
   - validación explícita para `lead_filter = '{}'` — checkbox "Sin restricciones (mostrar todos los leads)" que arma el body con `acknowledge_unrestricted: true`. Sin el checkbox, el backend devuelve 400 con `error_code='lead_filter_empty_requires_ack'`.
2. Health & System Status read-only:
   - estado API/DB;
   - último run;
   - próximo run;
   - `cron.missed` warning si aplica;
   - sin acciones de restart.
   - **Invariantes operativos canónicos disponibles en Admin MVP** (las tablas existentes en este punto del roadmap): `passed_not_enriched`, `tags_contradictorios`, `passed_sin_score`, `contact_tier_X_hot`, `audit_log_rows`. Los invariantes que dependen de `llm_usage_log` y `pipeline_errors` quedan ocultos hasta Fase 44-pre y Fase 45-pre respectivamente (la UI los renderiza con placeholder "pendiente — tabla no existe todavía"). `scoring_v1_columns_present` aparece solo después de Fase 22 aplicada. Ver `ADMIN_PANEL.md § Pantalla F — Health` para set completo.
3. Audit Log Viewer:
   - listar por actor, action, fecha;
   - ver `diff`;
   - paginación cursor-based.

**Fuera de alcance:** Cost Dashboard, Performance Dashboard, restart-core/restart-api, Google Places budget UI, `llm_usage_log`, `pipeline_errors`.

**Referencias:** `ADMIN_PANEL.md § Orden de construcción del admin panel`, etapas 1, 2 y 5.

---

### Pipeline Manager UI — operación del cron desde UI (item 22 del roadmap canónico)

**Por qué:** sin esta pantalla, el admin solo puede operar el pipeline por SQL/SSH. Los endpoints existen desde Fase 23 (core long-running) y Fase API (handlers HTTP). Esta fase construye el frontend.

**Prerequisitos:**
- Fase 23 aplicada (`src/start.ts`, cron interno, `pg_notify`, polling).
- Fase API aplicada (`GET/PUT/PATCH /api/v1/pipeline/config`, `GET /api/v1/pipeline/runs`, `POST /api/v1/pipeline/run`, `POST /api/v1/pipeline/abort`).
- UI base operativa (Lead Explorer/Detail/Outreach Tracker/Segment Explorer funcionando con auth).

**Alcance incluido:**
1. **Config editor** — formulario con `cron_expression`, `cpu_budget` (radio), `timeout_per_lead_sec`, `max_retries`, toggle `enabled`. PUT cuando el admin guarda. Validación local de cron expression antes del submit (parse via `cron-parser` si está disponible en `ui/`, sino dejarlo del lado backend).
2. **Phases editor** — toggles por fase (refresh/discovery/enrich/score) + sub-config por fase (sources, max_jobs, with_heuristic, concurrency, priority_tiers_first, recalculate_buyer_types).
3. **Ejecución manual** — botón "Correr ahora" (`POST /api/v1/pipeline/run`), botón "Dry-run" (mismo endpoint con flag), botón "Pause phase" (overrides), botón "Abort" (`POST /api/v1/pipeline/abort`).
4. **Historial** — lista paginada de `pipeline_runs` con status, started_at, completed_at, duración, `dashboard_stale`. Click expande a `phase_results` y `log_lines` (tail con autoscroll mientras `status='running'`).
5. **Monitor activo** — cuando hay un run con `status='running'`, mostrar `log_lines` en streaming (polling cada 3s a `GET /api/v1/pipeline/runs/:id`).
6. **Warning de missed-run** — si `/api/v1/health` retorna `cron.missed=true`, banner amarillo en la pantalla.

**Fuera de alcance:** Cost Dashboard, Performance Dashboard, restart actions, badge de Google Places budget (esto último entra junto con Fase 44).

**Referencias:** `ADMIN_PANEL.md § Pantalla C — Pipeline Manager`, `ARCHITECTURE_FRONTEND.md § Pipeline Manager`.

---

### Discovery Control Center UI — gestión de discovery jobs (item 23)

**Por qué:** sin esta pantalla, el admin no puede ver la cola de `discovery_jobs` ni encolar nuevos jobs sin pasar por CLI. Endpoints existen desde Fase API.

**Prerequisitos:**
- Fase API aplicada (`GET/POST /api/v1/discovery/jobs`, `PATCH /api/v1/discovery/jobs/:id` para pause/resume/cancel, `GET /api/v1/discovery/suggestions`).
- UI base + Pipeline Manager UI (para coherencia visual de la sección admin).

**Alcance incluido:**
1. **Cola de jobs** — tabla con `status`, `source`, `location`, `niche`, `progress`, `leads_found`, `leads_new`, `error_message`. Filtros por status. Paginación cursor-based.
2. **Acciones por job** — pause/resume/cancel. Modo autónomo no ejecuta jobs reales, pero los handlers UI deben funcionar contra fixtures.
3. **Zonas sugeridas** — `GET /api/v1/discovery/suggestions` retorna ciudades+niches con baja cobertura. Botón "Encolar" arma el body de `POST /api/v1/discovery/jobs`.
4. **Zonas stale** — leads con `last_enriched_at` viejo agrupados por ciudad+niche, con botón "Refrescar zona".
5. **Gap analysis básico** — gauge de cobertura por niche/ciudad. Si `lead_dashboard` lo expone, usar ese view; sino, agregación on-demand.

**Fuera de alcance:** ejecutar discovery real desde la UI en modo autónomo (los handlers funcionan, pero el agente autónomo no debe disparar runs reales — `SECURITY.md` lo bloquea).

**Referencias:** `ADMIN_PANEL.md § Pantalla — Discovery Control Center`, `ARCHITECTURE_FRONTEND.md § Discovery Control Center`.

---

### Cleanup snapshots v1 — DROP COLUMN prospect_score_v1/score_breakdown_v1 (item 31)

**Por qué:** Fase 22-pre creó las columnas `prospect_score_v1` y `score_breakdown_v1` como snapshot pre-v2 para permitir rollback. Después de validar Scoring v2 en producción (criterio: 30+ días de operación estable + Health no muestra anomalías), esas columnas se vuelven deuda eterna si no se eliminan. Esta es la fase que las borra.

**Modo:** `manual/approval`. El admin decide cuándo. El agente autónomo NO ejecuta esta fase aunque esté en el canónico.

**Prerequisitos:**
- Fase 22 aplicada (Scoring v2 corriendo).
- 30+ días desde la aplicación de Fase 22 (verificar `MIN(updated_at) FROM leads WHERE scoring_version=2`).
- Health screen muestra el invariante `scoring_v1_columns_present` con su edad (días desde Fase 22). Cuando ese invariante pasa los 30 días, se renderiza como warning amarillo "Considerar Cleanup v1".
- Backup automatizado verde (Fase 49 verificada en últimas 24h — `ls $HOME/blindspot-backups | tail -1` debe ser de hoy).

**Implementación:**

1. **Backup explícito previo** (no confiar en el cron diario — ejecutar manualmente justo antes):
   ```bash
   BACKUP_TAG=pre-cleanup-v1 bash scripts/backup.sh
   ```

2. **Migración destructiva:**
   ```sql
   BEGIN;
   ALTER TABLE leads DROP COLUMN prospect_score_v1;
   ALTER TABLE leads DROP COLUMN score_breakdown_v1;
   -- scoring_version se mantiene — útil para distinguir leads viejos si surge v3.
   COMMIT;
   ```

3. **Update de Health screen** — el invariante `scoring_v1_columns_present` desaparece (queries `information_schema.columns` y retorna `false` cuando las columnas ya no existen).

4. **Update de `ARCHITECTURE_FUTURE.md`** — eliminar referencias a las columnas v1 en la sección Scoring v2 / Backup obligatorio (el snapshot ya cumplió su función).

**Rollback:** si después de Fase 22 algo se rompió y los snapshots v1 son necesarios, NO ejecutar esta fase. Si la fase ya se ejecutó y luego se descubre un problema, restaurar el backup pre-cleanup-v1 (los 30+ días dan margen para detectar problemas con tiempo).

**Lo que NO hace esta fase:** eliminar `scoring_version` (sigue útil), borrar `lead_buyer_scores` viejos (esos no son snapshot, son histórico válido), purgar `audit_log` (gestión separada).

**Referencias:** `ROADMAP_CANONICAL.md § Decisiones cerradas`, `ADMIN_PANEL.md § Pantalla F — Health invariantes`.

---

### Fase 24 — Batch discovery multi-ciudad

**Por qué:** explorar 10 ciudades requiere 10 comandos. Con batch se hace en uno.

**Implementación:**
1. `discover-external --location-list "salto,paysandu,rivera,rocha"` — itera por ciudad
2. `discover-external --location-list-file config/locations.yaml` — desde archivo de config
3. Integración con `pipeline_runs` — cada ciudad es un sub-job con progreso propio

**Archivos:** `src/cli/commands/discover-external.ts`, nuevo `config/locations.yaml`

---

## Producto — UI y outreach

### Fase 25 — lead_outreach feedback loop (trigger contacted_by + CLI stats)

**Por qué:** la tabla `lead_outreach` y sus endpoints REST ya existen desde Fase API-0 + Fase API (Bloque 5). Esta fase cierra el feedback loop con tres piezas que viven en `src/` (core) y no en la API: trigger SQL que actualiza `leads.contacted_by` al primer outreach del lead, CLI `blindspot outreach --stats` para inspección operativa, y verificación end-to-end del flujo lead → outreach → status. Ver `ARCHITECTURE_FUTURE.md § Feedback loop de outreach`.

**Prerequisitos (todos ya aplicados al llegar a este bloque):**
- Fase API-0 — tabla `lead_outreach` creada con schema canónico, columna `leads.contacted_by` creada con FK a `users(id)`.
- Fase API — endpoints `POST/PATCH/GET /api/v1/outreach` operativos, matriz de auth verde, `lead_dashboard` VIEW expone `contacted_by`.

**Implementación:**

1. **Trigger SQL `leads_contacted_by_first_outreach`** — al insertar el primer `lead_outreach` para un lead, setear `leads.contacted_by = NEW.user_id`. Idempotente: en outreaches subsiguientes del mismo lead no toca `contacted_by` (queda apuntando al primer contactador). Si el primer outreach se borra, no revertir (perder este shortcut no es destructivo — el historial canónico vive en `lead_outreach`).
   ```sql
   CREATE OR REPLACE FUNCTION set_lead_contacted_by()
   RETURNS TRIGGER LANGUAGE plpgsql AS $$
   BEGIN
     UPDATE leads
        SET contacted_by = NEW.user_id
      WHERE id = NEW.lead_id
        AND contacted_by IS NULL;
     RETURN NEW;
   END $$;

   CREATE TRIGGER lead_outreach_set_contacted_by
     AFTER INSERT ON lead_outreach
     FOR EACH ROW EXECUTE FUNCTION set_lead_contacted_by();
   ```
   Migración idempotente — `CREATE OR REPLACE` y `DROP TRIGGER IF EXISTS lead_outreach_set_contacted_by ON lead_outreach;` antes del CREATE para permitir replay.

2. **CLI `blindspot outreach --stats [--user <email>] [--since <YYYY-MM-DD>]`** — query directa a `lead_outreach` sin pasar por la API:
   - Total contactados (rows en `lead_outreach`).
   - Por status: contacted / responded / interested / closed_won / closed_lost / no_response.
   - Por channel: email / whatsapp / phone.
   - Tasa de conversión: `closed_won / contacted`.
   - Precio promedio vendido (`price_sold` no null) y servicio más vendido (`service_sold` agrupado).
   - Filtros opcionales: `--user` (filtra por `users.email`), `--since` (filtra por `contacted_at >= $since`).

3. **Verificación end-to-end (modo autónomo puede ejecutar contra DB local con fixtures, no contra datos reales de CMs):**
   ```bash
   # 1. Crear lead de prueba (o usar uno existente sin contacted_by)
   psql ... -c "SELECT id FROM leads WHERE contacted_by IS NULL LIMIT 1;"
   # 2. Insertar outreach via API
   curl -X POST -H "Authorization: Bearer <cm_token>" \
     -d '{"lead_id":"<uuid>","channel":"email","status":"contacted"}' \
     http://localhost:3001/api/v1/outreach
   # 3. Verificar que el trigger seteó contacted_by
   psql ... -c "SELECT contacted_by FROM leads WHERE id='<uuid>';"  # → NOT NULL, igual al user_id del CM
   # 4. Stats CLI
   pnpm --filter core run blindspot outreach --stats
   ```

**Lo que NO implementar en esta fase:**
- Algoritmo de mejora de scoring desde feedback (vive en una fase futura — el feedback loop guarda datos hoy, el algoritmo los lee mañana).
- Modal UI ni vista "Mis contactos" — son parte de **UI base** (item 18 del roadmap canónico), no de Fase 25.
- Generación de ofertas LLM (`generateOffer`) — es Fase 26.

**Archivos:** `src/cli/commands/outreach.ts` (nuevo), migración SQL `migrations/0XXX_lead_outreach_trigger.sql`. Sin cambios en `api/`.

---

### Fase 26 — Generación de ofertas con LLM (proveedor genérico)

**Por qué:** el agente de ventas no debe escribir el pitch desde cero. El sistema genera un draft basado en las señales del lead; el humano revisa y envía. Ver `ARCHITECTURE_FUTURE.md § Generación de ofertas con IA`.

**Implementación:**
1. Interface `LLMProvider` con implementaciones: `GeminiProvider`, `OllamaProvider`, `OpenAICompatibleProvider`
2. Config via `.env`: `LLM_PROVIDER=gemini|ollama|openai-compatible` + credenciales por proveedor
3. Función `generateOffer(lead, offerType, channel): Promise<OfferPackage>` con fallback a templates
4. UI en Lead Detail: botón "Generar oferta" → muestra texto generado → "Copiar" / "Editar" / "Aprobar"
5. Guardar resultado en `lead_outreach.offer_package` (jsonb — incluye `text`, `source_llm`, `generated_at`).
   El endpoint `POST /api/v1/outreach` acepta `offer_package` en el body. No usar un campo `offer_text` separado.

**Proveedor recomendado para empezar:** Gemini u Ollama local, elegido por `LLM_PROVIDER`/`LLM_MODEL` en runtime. **No hardcodear modelos legacy/deprecated**: el modelo y sus límites deben revalidarse contra documentación oficial al implementar esta fase.

**Prerequisito:** Fase API-0 (tabla `lead_outreach` con columna `offer_package jsonb` ya existe) + Fase 44-pre (tabla `llm_usage_log` para logging de cada llamada — sin ella, no se puede medir costo ni status). Esta fase puede ejecutarse antes o después de Fase 25 — la persistencia de la oferta no depende del trigger de `contacted_by`.

**Nota — relación con Fase API:** el endpoint `POST /api/v1/outreach/generate-offer` existe como parte de Fase API (stub que devuelve template fijo). Fase 26 agrega la lógica LLM real al handler ya existente — no crea el endpoint desde cero. Cada invocación inserta un row en `llm_usage_log` con `feature='generate_offer'`, `provider`, `model`, `tokens_in/out`, `cost_usd_estimated`, `status` y `duration_ms` (sea exitosa, error, rate-limited o fallback a template).

---

### Fase 27 — Service pricing table (cuantificación real de ROI)

**Por qué:** los pitches dicen "el sistema cuesta $X" pero ese número no existe. Cada usuario de Blindspot tiene sus propios precios. Sin tabla de precios, la cuantificación es un placeholder.

**Schema:**
```sql
CREATE TABLE service_pricing (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES users(id) NOT NULL,
  service_type text NOT NULL
               CHECK (service_type IN (
                 'web_nuevo','rediseno','marketing',
                 'catalogo','pos','reservas','delivery_system'
               )),
  base_price   numeric(10,2) NOT NULL,  -- precio base UYU
  monthly_fee  numeric(10,2),           -- precio recurrente mensual UYU (null si one-time)
  notes        text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX service_pricing_user_type ON service_pricing(user_id, service_type);
CREATE INDEX service_pricing_user ON service_pricing(user_id);
CREATE TRIGGER service_pricing_updated_at BEFORE UPDATE ON service_pricing
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

**Mapeo canónico `primary_offer` → `service_type`** (sincroniza Fase 22 → Fase 27):

| primary_offer | service_type buscado | Notas |
|---|---|---|
| `web_nuevo` | `web_nuevo` | 1-a-1 |
| `rediseno` | `rediseno` | 1-a-1 |
| `marketing` | `marketing` | 1-a-1 |
| `catalogo` | `catalogo` | 1-a-1 |
| `software` | `reservas` si `niche IN ('gym','hairdresser')`, `pos` en otros | resolver por `lead.niche` antes del lookup |
| `contacto_directo` | — | sin precio asociado; el pitch es llamada, no servicio vendible — generateOffer() devuelve template sin `price` |
| `none` | — | sin oferta primaria; generateOffer() retorna 400 con `error_code: 'no_primary_offer'` |

Para el buyer_type `delivery_propio` (Fase 13): siempre usa `service_pricing.delivery_system` directamente — no depende de `primary_offer`.

Función helper canónica (vive en `api/src/pricing.ts` desde Fase 27, consumida por Fase 26):
```typescript
function mapOfferToServiceType(primaryOffer: PrimaryOffer, niche: string): ServiceType | null {
  if (primaryOffer === 'software') return ['gym','hairdresser'].includes(niche) ? 'reservas' : 'pos'
  if (primaryOffer === 'contacto_directo' || primaryOffer === 'none') return null
  return primaryOffer  // 1-a-1 para web_nuevo, rediseno, marketing, catalogo
}
```

**Implementación:**
1. Migración: crear tabla + UNIQUE (user_id, service_type) + trigger `updated_at` (mismo patrón que `users`)
2. Seed inicial — solo para el usuario admin de Fase API-0:
   ```sql
   INSERT INTO service_pricing (user_id, service_type, base_price, monthly_fee, notes)
   SELECT u.id, sp.service_type, sp.base_price, sp.monthly_fee, 'Seed inicial — admin debe ajustar'
   FROM users u
   CROSS JOIN (VALUES
     ('web_nuevo',       40000,  2500),
     ('rediseno',        25000,  2000),
     ('marketing',       15000,  8000),
     ('catalogo',        20000,  1500),
     ('pos',             18000,  3000),
     ('reservas',        12000,  2500),
     ('delivery_system', 30000,  4000)
   ) AS sp(service_type, base_price, monthly_fee)
   WHERE u.role = 'admin'
   ON CONFLICT (user_id, service_type) DO NOTHING;
   ```
   Los valores son referencias razonables en UYU — el admin debe ajustarlos en `/settings/pricing` antes de generar ofertas reales.
3. **Política de seed para CMs nuevos** — al crear un CM via `POST /api/v1/users` (admin acción), el handler tiene dos opciones según el body:
   - `seed_pricing: 'copy_admin'` (default): copiar las 7 filas del admin actual al nuevo CM. Permite que `mapOfferToServiceType` retorne precios desde el primer login del CM.
   - `seed_pricing: 'empty'`: dejar `service_pricing` vacío para ese `user_id`. La UI Settings → Pricing del CM le muestra "Configurar precio" en cada servicio antes de generar ofertas. `generateOffer()` cae al template sin precio cuando el lookup retorna null.

   El default `copy_admin` evita el bug silencioso "lookup null → oferta sin precio" en el primer outreach del CM. Documentado en `ADMIN_PANEL.md § Pantalla A — Users`.
4. `mapOfferToServiceType()` definido y exportado en `api/src/pricing.ts`; tests unitarios cubren los 7 casos del mapa
5. `commission_estimate` en buyer_type `delivery_propio` usa `service_pricing.delivery_system` para calcular ROI real (no pasa por el map)
6. La generación de ofertas (Fase 26) llama `mapOfferToServiceType(primary_offer, niche)` → consulta `service_pricing WHERE user_id=$auth.user_id AND service_type=$mapped`. Si el lookup retorna 0 filas: `generateOffer` retorna `OfferPackage` con `price=null` y `notes='Configurar precio en /settings/pricing antes de enviar'` — no rompe el flujo, solo flagea para que el CM complete el setup.
7. Endpoints CRUD: `GET/POST/PATCH/DELETE /api/v1/settings/pricing` — admin ve y edita las suyas; CM ve y edita solo las propias (`user_id = $auth.user_id`).

---

## Enriquecimiento avanzado

### Fase 28 — Sub-niche detection para leads "other"

**Por qué:** 2.034 leads (59% del total passed) clasificados como "other". Rating promedio 4.57, 225 reviews, zero hot leads. Son ferreterías, veterinarias, estudios contables, ópticas, spas — negocios con presupuesto real completamente invisibles para el scoring. Ver `ARCHITECTURE_FUTURE.md § Sub-niche detection`.

**Implementación:**
1. Dos paths de detección:
   - Con RUT (solo si una fuente futura explícitamente aprobada lo aporta): CIIU → sub-niche via tabla de mapeo
   - Sin RUT: llamada a LLMProvider con prompt de clasificación (modelo configurado por `LLM_PROVIDER`/`LLM_MODEL`, ~5 tokens output)
2. Nuevo campo: `lead_company_data.detected_sub_niche`
3. Sub-niche activa lógica de sub-scores específica en `sub-scores.ts`
4. CLI: `blindspot enrich --sub-niche-detection --niche other`

**Costo estimado:** 2034 × ~50 tokens input = 102k tokens. Revalidar costo/límites al implementar según proveedor configurado. Ollama local: ~68 minutos con Mistral 7B como referencia aproximada.

**Prerequisito:** Fase 26 (LLMProvider disponible).

---

### Fase 29 — MINTUR TipoOperador extraction

**Por qué:** MINTUR clasifica sus 2027 registros por tipo de operador (hotel, restaurante, agencia de viajes, spa, guía turístico). Esta info está en `source_data` JSONB sin parsear. Un hotel 3 estrellas sin web tiene un pitch y deal size completamente diferente a un camping sin web.

**Aclaración crítica:** MINTUR no expone RUT público según `context/research/mintur.md`. Esta fase NO extrae RUT. Cualquier trabajo futuro con RUT queda fuera del roadmap actual salvo decisión nueva explícita.

**Implementación:**
1. Parser `TipoOperador` en enrich de MINTUR: extraer de `source_data` → guardar en `lead_company_data.tipo_operador`
2. Mapeo `TipoOperador` → sub-niche → sub-scores específicos
3. Índice: `CREATE INDEX leads_tipo_operador ON leads ((lead_company_data->>'tipo_operador'));`

**Archivos:** `src/modules/enrichment/index.ts`, parser/mapping específico para `tipo_operador` si conviene extraerlo.

---

### Fase 30 — DGI/BPS dataset resolution

**Estado:** descartada permanentemente por decisión de producto/legal al 2026-05-18.

**Regla:** no implementar, no investigar y no dejar dependencias vivas del roadmap apuntando a esta fase.

---

### Fase E — Fix discover-external + Reconocimiento de franquicias ✅ Completada

**Diagnóstico ejecutado:** los tags `possible-duplicate` en MINTUR NO venían de Levenshtein
sino de `tagDuplicates` (identity-keys: phone, address). Los duplicados son reales —
MINTUR registra el mismo negocio bajo múltiples categorías de operador (ABITAB: 182 entradas,
HERTZ: 10 entradas). No hay falsos positivos por nombre.

**Bug corregido:** `discover-external.ts` ahora actualiza `allLeads` en memoria después de cada
inserción — candidatos del mismo run ya detectan leads recién insertados.

**Franquicias implementadas:** `isFranchise()` + `tagFranchises()` + tag `franchise-detected`.
Ver ARCHITECTURE.md para detalles.

---

### Fase B — Sub-scores por tipo de oferta ✅ Completada

Ver ARCHITECTURE.md — sección Scoring para detalles de implementación.

---

### Fase F — Capa de inferencia de estado operativo ✅ Completada

`computeInferredState` en `src/modules/enrichment/inferred-state.ts`. Corre al final del pipeline enrichment. 20 tests nuevos. Ver ARCHITECTURE.md para detalles de la interfaz y reglas de inferencia.

**Reglas de inferencia:**

| Conclusión | Señal | Confianza |
|---|---|---|
| `has_reservations` | `booking_platforms` o `reservation_platforms` no vacío | 0.9 |
| `has_reservations` | `contact_form` + niche gym/hairdresser | 0.5 |
| `has_delivery` | `delivery_platforms` no vacío | 0.8 |
| `has_delivery` | `source === 'pedidosya'` o `corroborating_sources` incluye pedidosya | 0.95 (✅ activo) |
| `has_online_catalog` | `ecommerce_platforms` detectado (Fase D) | 0.9 |
| `has_online_catalog` | `menu_links` (PDF) detectado | 0.85 |
| `has_online_catalog` | `menu_keywords` + es restaurant | 0.6 |
| `has_ecommerce` | `ecommerce_platforms` (Shopify, WooCommerce, Tienda Nube, MercadoShops) | 0.95 |
| `has_pos` | `has_ecommerce` + `has_delivery` juntos | 0.7 |
| `has_pos` | Pasarela de pago detectada (MercadoPago, Stripe, PayPal) | 0.8 |
| `has_chat_support` | `chat_widget` en DOM hidratado (Playwright) | 0.9 |
| `has_chat_support` | `whatsapp-confirmed` | 0.85 |

**Impacto en scoring (Fase B):**
- Negocio con `has_delivery + has_reservations + has_ecommerce` → `digitalization_level: advanced` → sub-scores de software y catálogo bajan, pero sube potencial de oferta de "siguiente nivel" (CRM, analytics, integración).
- Negocio con `has_delivery` pero sin web propia → `score_web_nuevo` alto + pitch "independizate de la comisión".

**Fuentes futuras que alimentan inferencias:**
- PedidosYa (Fase 10): confirma `has_delivery` con alta confianza
- Yelu (Fase 9): confirma `has_online_catalog` si tiene descripción de servicios
- IMM Habilitaciones (Fase 11): confirma `has_formal_registration`

---

### Fase C — Cadencia de refresh por source ✅ Completada

`source_refresh` en `config/discovery.yaml` (google_places:30, mintur:90, osm:90). `maintenance` ahora detecta y re-enriquece fuentes externas stale via `enrichCommand --source`. `getSourceRefreshDays()` en modules/discovery/config.ts.

---

## Arquitectura multi-source — Nuevos providers

> Las fases con fuente externa tienen su investigación en `context/research/<fuente>.md`.
> Antes de implementar una fase sin MD → correr Gemini DeepSearch primero (ver flujo en PROJECT_MASTER.md).
> PedidosYa (Fase 10) es especialmente importante: confirma `has_delivery` en `inferred_state` con alta confianza.

### Fase 6 — ✅ Movida al bloque Urgente (ver arriba)

---

| Fase | Descripción | Investigación | Prioridad |
|------|-------------|---------------|-----------|
| 9 | YeluProvider — scraping yelu.uy (31k listings, confianza 0.65) | ✅ Completada | — |
| 10 | PedidosYaProvider — confirma delivery activo. Alimenta `inferred_state.has_delivery` con confianza 0.95 | ✅ Completada | — |
| 11 | IMM Habilitaciones provider — CSV Montevideo, negocios habilitados activos | pendiente | **Media** — desbloquea teléfonos para MINTUR (Fase 18) |
| 12 | InfoNegocios provider — decisores B2B, emails de gerencia | pendiente | Baja |
| 13 | DGI/BPS dataset — RUT → razón social + CIIU + régimen fiscal | descartado permanentemente | Fuera de roadmap por decisión legal/producto |
| 18 | Cruce MINTUR × IMM — join por nombre+dirección para resolver teléfonos faltantes en 1600 leads MINTUR | depende de Fase 11 | Media — desbloquea el 96% de MINTUR hoy inaccionable |

---

## Mejoras de scoring y segmentación

---

### Fase 12 — Buyer-type scoring ✅ Completada

Ver ARCHITECTURE.md — tabla `lead_buyer_scores`, 7 buyer types, CLI `score --buyer-types`. 850 tests pasando.

---

### Fase 13 — PedidosYa escape: segmento de alto valor (desbloqueada por Fase 12)

**Por qué:** un negocio en PedidosYa paga ~30% de comisión por pedido. El pitch no es "construite una web" sino "independizate con tu propio sistema de pedidos a $X/mes". Es la propuesta comercial más concreta y cuantificable que genera el sistema.

**Señales del segmento:**
- `inferred_state.has_delivery.value = true` Y `inferred_state.has_delivery.confidence >= 0.90`
- Y `inferred_state.has_pos.value = false` (o sin señal de sistema propio)
- Fuente confirmatoria: `corroborating_sources` incluye `pedidosya` OR `source = 'pedidosya'`

**Implementación:**
- `delivery_propio` buyer_type (definido en Fase 12) es el score de este segmento
- Agregar campo `commission_estimate` en `breakdown` del buyer_type: `{ monthly_orders_est: 'N/A', commission_rate: 0.30, pitch_hook: 'independizate-de-pedidosya' }`
- Query de extracción: `SELECT l.*, lbs.score FROM leads l JOIN lead_buyer_scores lbs ON lbs.lead_id = l.id AND lbs.buyer_type = 'delivery_propio' WHERE lbs.score >= 60 ORDER BY lbs.score DESC`
  — *Nota: este 60 es un threshold de `lead_buyer_scores.score` (escala de buyer_type específico), no del `prospect_score` general (cuyo hot threshold es 55). Ambos son independientes.*

**Depende de:** Fase 12 (buyer_type `delivery_propio`), PedidosYa discovery activo.

---

### Fase 17 — Investigación perfil MINTUR (diagnóstico antes de implementar)

**Síntoma:** 2027 leads de MINTUR enriquecidos, 0 hot (prospect_score >= 50). Antes de ajustar scoring, diagnosticar.

**Queries de diagnóstico a correr:**

```sql
-- Distribución de scores MINTUR
SELECT
  width_bucket(prospect_score, 0, 100, 10) * 10 AS score_bucket,
  COUNT(*) AS leads
FROM leads WHERE source = 'mintur' AND prospect_score IS NOT NULL
GROUP BY 1 ORDER BY 1;

-- Sub-scores promedio MINTUR vs google_places
SELECT source,
  AVG((score_breakdown->'sub_scores'->>'web_nuevo')::numeric) AS avg_web_nuevo,
  AVG((score_breakdown->'sub_scores'->>'marketing')::numeric) AS avg_marketing,
  AVG((score_breakdown->'sub_scores'->>'software')::numeric) AS avg_software
FROM leads WHERE source IN ('mintur','google_places') AND score_breakdown IS NOT NULL
GROUP BY source;

-- Cuántos MINTUR tienen website en footprint
SELECT
  COUNT(*) FILTER (WHERE digital_footprint->>'website' IS NOT NULL) AS con_web,
  COUNT(*) FILTER (WHERE digital_footprint->>'website' IS NULL) AS sin_web
FROM leads WHERE source = 'mintur';
```

**Diagnóstico ejecutado (2026-05-15). Causa raíz confirmada.**

| Métrica | Valor |
|---|---|
| Con web directa | 0 / 2027 |
| Web vía heuristic | 384 |
| Con email | 90 (4.4%) |
| Con phone | **0 (0%)** |
| Franchises | 218 |
| `web_nuevo` avg | **0.0** — colapsado por contactabilidad |

**Causa:** `contactability_multiplier ≈ 0` sin teléfono. El scoring es correcto — un lead incontactable no tiene valor comercial. MINTUR es fuente de *descubrimiento* pero no de *contacto*.

**Subsegmento accionable hoy:** ~80 leads (`email-found` AND NOT `franchise-detected`). Se rankean correctamente con Fase 12 buyer_type scores.

**Plan:**
1. **Corto plazo:** usar solo los 80 con email. Fase 12 los rankeará correctamente.
2. **Mediano plazo (Fase 18):** cruzar MINTUR con IMM Habilitaciones → teléfono habilitación municipal desbloquea ~1600 leads. Ver tabla providers.
3. **No hacer:** inflar scoring artificialmente para leads sin contacto.

---

### Items de mejora de scoring (backlog)

| Item | Descripción | Prioridad |
|------|-------------|-----------|
| Corroboración cross-source v2 | Si mismo email aparece en 2+ fuentes → `contact_reliability +0.2`. Si phone diferente en 2+ fuentes → tag `phone-conflict` + penalty | Media |
| Zona turística urgency | Implementar como parte de Fase 16 (señales urgencia) | Media |
| Competitor density signal | Si 3 negocios del mismo niche/zona sin web → pitch más débil (todos sobreviven sin ella). Requiere query geoespacial. | Baja |

---

## Reconocimiento de franquicias

Sistema implementado en Fase E. Pendiente:

| Item | Descripción | Prioridad |
|------|-------------|-----------|
| Filtro en CLI y reportes | `--exclude-franchises` en discover y report. La UI futura lo hereda | Media |

---

## Discovery pendiente

Ejecutar solo después de confirmar invariantes en 0.

| Acción | Perfil | Prioridad |
|--------|--------|-----------|
| Colonia del Sacramento — restaurant + hospedaje | A/B | ✅ Ejecutado (2026-05-15). 0 leads nuevos — mercado turístico, todos con web y reviews altas. No re-intentar. |
| Minas (Lavalleja) — restaurant + gym | A/B | ✅ Ejecutado (2026-05-15). 0 leads nuevos — ya estaban en DB. |
| Durazno — restaurant + car_dealer | A/B | ✅ Ejecutado (2026-05-15). 3 leads nuevos (score 63/45/15). |
| Barra de Valizas / Rocha — restaurant | A | Media |
| Salto — restaurant (La Vieja Cocina mostró potencial) | A/B | Media |
| Yelu — más ciudades (Salto, Maldonado, Colonia) — restaurant + hairdresser | — | Media — Yelu Montevideo aportó 1113 candidatos (338 restaurant + 387 hairdresser + 388 car_dealer). Gym = 0 resultados. |
| OSM — más niches para ciudades existentes (hairdresser, car_dealer) | — | Media — OSM Montevideo gym = 0 resultados (tag leisure=gym escaso en UY). Probar shop=hairdresser. |
| PedidosYa — montevideo restaurant | — | Pendiente post-Fase 46 (stealth/anti-detección activo). Discovery real manual con aprobación explícita: `discover-external --source pedidosya --location montevideo --niche restaurant --limit 200` |

---

## Pre-producción — antes de dar acceso a otros usuarios

> Estos items deben estar resueltos antes de compartir la URL con cualquier CM.
> Están formalizados como Fases 48 y 49 para poder rastrearlos y schedulearlos.

### Fase 48 — Infraestructura de producción (HTTPS + pm2 + rate limiting)

**Por qué:** sin esto, JWT viaja en claro y los procesos no sobreviven reinicios. Bloqueante antes de dar acceso a CMs.

**Implementación:**
1. **Nginx reverse proxy:** configurar `proxy_pass http://localhost:3001` + SSL con Let's Encrypt (certbot `--nginx -d blindspot.tudominio.com`)
2. **pm2:** `pm2 start pnpm --name api -- --filter api run start` + `pm2 start pnpm --name core -- --filter core run start` + `pm2 startup` + `pm2 save`
3. **Rate limiting:** ya incluido en Fase API (`@fastify/rate-limit`: 100 req/min general, 10 req/min en `/auth/login`)
4. **Anti-detección scraping Yelu/PedidosYa:** ya cubierto en ARCHITECTURE_FUTURE.md § Estrategia anti-detección + Fase 46 para Meta. El config de discovery.yaml → scraping debe estar completo antes de runs en producción.

**Verificación:**
```bash
curl https://blindspot.tudominio.com/api/v1/health   # → status: ok, vía HTTPS
pm2 status                                            # → api: online, core: online
```

---

## Infraestructura y operaciones

> **Fases diferidas / absorbidas:**
> - Fase 31: absorbida por **Fase 23**. El core long-running no se considera implementado hasta que existan `src/start.ts`, `LISTEN pipeline_trigger`, polling y cron interno.
> - Fase 33 (versionado API): ya implementado — todos los endpoints usan `/api/v1/` desde el inicio. No hay consumidores externos.
> - Fase 35 (cron missed runs): absorbida por **Fase 23**. PM2 + polling recuperan jobs ya encolados; Fase 23 debe agregar warning básico si `scheduled_for < now()` y no hubo run completado.

### Fase 32 — `lead_dashboard` como MATERIALIZED VIEW + refresh automático

> **Status: POSTPONED — ver § Fases postpuestas al final. Razón: VIEW normal suficiente para 2–8 socios concurrentes.**

**Por qué:** hoy es una VIEW normal que recalcula en cada query con LEFT JOIN. Con múltiples usuarios en la UI y actualizaciones frecuentes, la latencia va a ser impredecible. Ver `ARCHITECTURE_FUTURE.md § lead_dashboard MATERIALIZED VIEW`.

**Implementación:**
1. `DROP VIEW lead_dashboard; CREATE MATERIALIZED VIEW lead_dashboard AS ...`
2. Índices: `contact_tier`, `prospect_score DESC`, `primary_offer`, `urgency_signal`, `contacted_at`
3. `REFRESH MATERIALIZED VIEW CONCURRENTLY lead_dashboard` como último paso del pipeline run
4. Campo `pipeline_runs.dashboard_stale: boolean` solo como warning operativo si un run falló a medio camino. No implica refresh de VIEW: `lead_dashboard` es VIEW normal y siempre refleja DB actual.

**Verificación:** `EXPLAIN ANALYZE SELECT * FROM lead_dashboard WHERE contact_tier='A' LIMIT 50` debe mostrar Index Scan, no Seq Scan.

---

### Fase 33 — ✅ Resuelta sin fase

Todos los endpoints usan `/api/v1/` desde el inicio de Fase API — no hay migración. Headers `X-API-Version` y `X-Scoring-Version` se incluyen en Fase API.

---

### Fase 34 — Endpoint `/api/v1/health` + observabilidad básica

> **Status: POSTPONED — ver § Fases postpuestas al final. Razón: endpoint básico se implementa inline en Fase API.**

**Por qué:** sin un health endpoint, no hay forma de monitorear el servidor sin abrir la UI completa. Crítico para producción. Ver `ARCHITECTURE_FUTURE.md § Endpoint /api/v1/health`.

**Implementación:**
1. `GET /api/v1/health` → `{ status, db, cron: { status, last_run_at, next_run_at }, pipeline_running, leads_count, hot_leads_count, version }`
2. Sin autenticación — público para monitors externos
3. `cron.missed` básico se calcula desde `pipeline_config.scheduled_for` y `last_completed_at`; alerta si `scheduled_for < now()` y no hubo run completado.

**Archivos:** `api/src/routes/health.ts` (nuevo). Puede implementarse dentro de Fase API.

---

### Fase 35 — Absorbida por Fase 23

PM2 restart + poll de pending jobs cada 60s cubre la recuperación de jobs ya encolados. Fase 23 debe agregar además detección mínima de cron perdido usando `pipeline_config.scheduled_for` y `last_completed_at`, expuesta como warning en `/api/v1/health`. No implementar fase separada por ahora.

---

## Mejoras de scoring y segmentación (continuación)

### Fase 36 — `days_in_pool` en timing_factor de scoring v2

**Por qué:** leads recién descubiertos tienen ventaja competitiva — nadie los ha contactado. La fórmula v2 no captura esta señal. Ver `ARCHITECTURE_FUTURE.md § days_in_pool`.

**Implementación:**
1. Agregar `days_in_pool` config block en `config/scoring.yaml → commercial_score.timing`
2. Calcular en `computeTimingFactor(lead)`: fresh < 7d → +0.05, stale > 90d → -0.05
3. Persistir `score_breakdown.days_in_pool: number` para la UI

**Prerequisito:** Fase 22 (Scoring v2 completo).

---

### Fase 37 — `canonical_source` — fuente de mayor confianza del lead

**Por qué:** el campo `source` refleja la fuente de descubrimiento, no la más confiable. Un lead corroborado por Google Places debería mostrar GP como fuente canónica aunque haya sido descubierto en OSM. Ver `ARCHITECTURE_FUTURE.md § canonical_source`.

**Implementación:**
1. `ALTER TABLE leads ADD COLUMN canonical_source text`
2. Calcular al reconciliar `canonical_fields`: fuente con mayor `source_confidence` entre primaria y corroborantes
3. Actualizar `lead_dashboard` VIEW/MV para exponer `canonical_source`
4. Backfill: `UPDATE leads SET canonical_source = source WHERE canonical_source IS NULL`

---

### Fase 38 — Deduplicación con coordenadas geográficas

**Por qué:** `findCrossSourceMatch` usa solo similitud de nombre. Dos negocios con el mismo nombre en ciudades distintas se matchearían erróneamente al escalar a más ciudades. Ver `ARCHITECTURE_FUTURE.md § Deduplicación con coordenadas geográficas`.

**Implementación:**
1. Función `haversineDistance(a, b): number` en `src/modules/discovery/deduplication.ts` — distancia en metros
2. `findCrossSourceMatch` v2: filtrar por niche exacto + radio Haversine < 500m (si ambos tienen GPS) antes del threshold de nombre
3. Config en `config/discovery.yaml`: `deduplication.geo_radius_meters: 500`
4. Tests para: mismo nombre ciudades distintas (no debe matchear), mismo nombre ±200m (sí debe matchear)

**Prerequisito:** Fase 6 (cross-source dedup activo).

---

## Producto avanzado (post-UI)

> Estas fases agregan valor diferencial pero requieren que la UI base esté operativa.

### Fase 39 — Webhook de notificaciones externas

**Por qué:** el equipo de ventas necesita ser notificado cuando el pipeline genera nuevos hot leads sin tener la UI abierta. Ver `ARCHITECTURE_FUTURE.md § Webhook de notificaciones externas`.

**Implementación:**
1. Campos en `pipeline_config`: `notify_webhook_url`, `notify_webhook_secret`, `notify_webhook_events[]`
2. `src/modules/pipeline/notifications.ts` → `notifyWebhook(run: PipelineRun): Promise<void>`
3. Payload: `{ event, run_id, new_hot_leads, leads_enriched, invariants_ok, summary_url }`
4. HMAC-SHA256 en header `X-Blindspot-Signature` para verificación del receptor
5. Resultado en `pipeline_runs.webhook_status`: 'sent' | 'failed' | 'not_configured'
6. UI: campo en Pipeline Manager para configurar URL + botón "Probar webhook"

---

### Fase 40 — Full-text search de leads

**Por qué:** 2034 leads "other" con sub-niches no mapeados (veterinarias, farmacias, ópticas) son completamente invisibles sin búsqueda de texto. Ver `ARCHITECTURE_FUTURE.md § Full-text search`.

**Implementación:**
1. `ALTER TABLE leads ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (...) STORED`
2. Backfill: `UPDATE leads SET search_vector = ...` (trigger se encarga del futuro)
3. `CREATE INDEX leads_fts ON leads USING gin(search_vector)`
4. Endpoint: `GET /api/v1/leads?q=veterinaria` → `WHERE search_vector @@ plainto_tsquery('spanish', $q)`
5. UI: barra de búsqueda en Lead Explorer (actualmente falta)

**Verificación:**
```bash
curl /api/v1/leads?q=veterinaria&contact_tier=A,B
# → debe retornar leads con "veterinaria" en nombre o dirección
```

---

### Fase 41 — Detección de mismo propietario (`owner_group_id`)

**Por qué:** muchos dueños de PyMEs en Uruguay tienen 2–3 negocios. Contactarlos por separado es redundante. Ver `ARCHITECTURE_FUTURE.md § Detección de mismo propietario`.

**Implementación:**
1. `ALTER TABLE leads ADD COLUMN owner_group_id uuid`
2. `CREATE INDEX leads_owner_group ON leads(owner_group_id) WHERE owner_group_id IS NOT NULL`
3. Proceso de detección: post-enrich, buscar leads con mismo phone o email canónico → asignar mismo `owner_group_id`
4. API: `GET /api/v1/leads/:id/owner-group` → leads del mismo propietario
5. UI: badge "N negocios del mismo propietario" en Lead Detail y Lead Explorer

---

### Fase 42 — Scoring estacional

**Por qué:** el mismo lead vale más en ciertos momentos del año. Un gimnasio vale más como prospecto en enero. Ver `ARCHITECTURE_FUTURE.md § Scoring estacional`.

**Implementación:**
1. `seasonal_modifiers` config block en `config/scoring.yaml`
2. Función `computeSeasonalNote(lead, config): string | null` en `src/modules/scoring/index.ts`
3. Persistir `score_breakdown.seasonal_note` si aplica el mes actual
4. UI: el sort secundario de Lead Explorer usa `seasonal_note` para subir leads relevantes

**Prerequisito:** Fase 22 (Scoring v2 completo).

---

### Fase 43 — Campañas de outreach

**Por qué:** sin una entidad "campaña", no hay forma de medir qué segmentos convierten. Ver `ARCHITECTURE_FUTURE.md § Campañas de outreach`.

**Implementación:**
1. Tabla `outreach_campaigns` con el schema canónico de `ARCHITECTURE_FUTURE.md § Tabla outreach_campaigns` — incluye `user_id NOT NULL` para RBAC:
   ```sql
   CREATE TABLE outreach_campaigns (
     id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     name            text NOT NULL,          -- "Restaurantes Pocitos mayo 2026"
     created_at      timestamptz DEFAULT now(),
     closed_at       timestamptz,
     user_id         uuid NOT NULL REFERENCES users(id),  -- quién creó la campaña; alimenta RBAC CM
     segment_filter  jsonb NOT NULL,         -- {contact_tier: ['B'], niche: ['restaurant'], ...}
     status          text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','paused','closed')),
     notes           text
   );
   CREATE INDEX outreach_campaigns_user_id ON outreach_campaigns(user_id);
   CREATE INDEX outreach_campaigns_status ON outreach_campaigns(status);
   ```
2. `ALTER TABLE lead_outreach ADD COLUMN campaign_id uuid REFERENCES outreach_campaigns(id);`
   `CREATE INDEX lead_outreach_campaign ON lead_outreach(campaign_id) WHERE campaign_id IS NOT NULL;`
3. API CRUD: `GET/POST /api/v1/campaigns`, `GET /api/v1/campaigns/:id/stats`. **RBAC**: CM solo ve/edita campañas con `user_id = $auth.user_id`; admin ve todas. Implementar el filtro en el handler antes del SELECT.
4. UI: Outreach Tracker agrega selector de campaña activa + stats de conversión por campaña.

**Prerequisito:** Fase 25 (lead_outreach tracking completo).

**Nota sobre stubs en Fase API:** los endpoints `/api/v1/campaigns*` existen como stubs 501 desde Fase API (ver `ARCHITECTURE_FUTURE.md § Endpoints que expone`). Fase 43 reemplaza los stubs con la implementación real.

---

### Fase 44-pre — Tabla `llm_usage_log` (PREREQUISITO de Fase 26 + Fase 44 + Cost Dashboard)

**Por qué:** `ADMIN_PANEL.md § Pantalla D — Cost Dashboard` consume datos de gasto LLM por usuario, proveedor y modelo. Sin esta tabla, el dashboard no tiene datos que mostrar. Migración aditiva, sin riesgo.

**Implementación:**

```sql
CREATE TABLE llm_usage_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  user_id             uuid REFERENCES users(id),    -- null si fue sistema/cron
  provider            text NOT NULL,                -- 'gemini'|'ollama'|'openai-compatible'
  model               text,                         -- modelo real usado, ej. 'gemini-2.x-flash'|'qwen2.5:7b'|...
  feature             text NOT NULL,                -- 'generate_offer'|'sub_niche_detection'|...
  lead_id             uuid REFERENCES leads(id),    -- null si no aplica a un lead específico
  tokens_in           integer NOT NULL DEFAULT 0,
  tokens_out          integer NOT NULL DEFAULT 0,
  cost_usd_estimated  numeric(10,6) NOT NULL DEFAULT 0,  -- 0 si free tier
  status              text NOT NULL DEFAULT 'ok'    -- 'ok'|'error'|'rate_limited'|'fallback_template'
                      CHECK (status IN ('ok','error','rate_limited','fallback_template')),
  error_message       text,
  duration_ms         integer
);
CREATE INDEX llm_usage_log_occurred_at ON llm_usage_log(occurred_at DESC);
CREATE INDEX llm_usage_log_user ON llm_usage_log(user_id, occurred_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX llm_usage_log_feature ON llm_usage_log(feature, occurred_at DESC);
```

**Quién inserta:** la función `generateOffer()` (Fase 26) y `detectSubNiche()` (Fase 28) insertan UN row por llamada al LLM (sea exitosa, error, rate-limited o fallback a template).

**Política de retención:** sin auto-purga. El admin decide cuándo agregar particionamiento o purga si crece >1M rows.

**Verificación:** `\d llm_usage_log` muestra todas las columnas; `INSERT` de prueba + `SELECT COUNT(*)` ≥ 1.

---

### Fase 44 — Presupuesto Google Places en UI

**Por qué:** el saldo de la API de Google existe solo en SECURITY.md como texto. La UI debe mostrar el consumo en tiempo real y alertar antes de agotar el crédito. Ver `ARCHITECTURE_FUTURE.md § Presupuesto Google Places`.

**Prerequisito:** Fase 44-pre (tabla `llm_usage_log` ya existe — alimenta la sección LLM del Cost Dashboard).

**Implementación:**
1. Campos en `pipeline_config`: `google_places_budget_total`, `google_places_budget_spent`, `google_places_alert_threshold`
2. Backfill inicial al activar la feature: `google_places_budget_spent = 5.16` USD para reflejar el gasto histórico ya documentado en `PROJECT_MASTER.md` y `SECURITY.md`.
3. Worker: `google_places_budget_spent += 0.02 × requests_made` al finalizar cada run con GP
4. UI: barra de presupuesto en Pipeline Manager → Estado del servidor
5. Alerta: badge rojo si `budget_remaining < alert_threshold`; incluir en payload de webhook

---

### Fase 46 — Anti-detección de scraping completa (discovery + social-enrich)

> **⚠️ Ejecutar ANTES de Fase 48 (producción)** aunque esta sección esté en "Producto avanzado". Un pipeline semanal sin anti-detección genera ban permanente de Yelu y PedidosYa en días de operar en producción. Ver orden actualizado en `PROJECT_MASTER.md § Próximas acciones`.

**Por qué (dos problemas distintos):**

**Parte A — Discovery scrapers (Yelu + PedidosYa via `discover-external`):** Yelu y PedidosYa no tienen rate limit propio, rotación de user agents ni backoff exponencial. Un discovery semanal desde la misma IP con el mismo user-agent genera ban permanente en días. Estos son providers de *descubrimiento*, no de social-enrich — el riesgo es perder acceso permanente a dos de las cinco fuentes activas del sistema.

**Parte B — Social-enrich (Facebook + Instagram via `social-enrich`):** Facebook e Instagram bloquean por IP, fingerprint de browser y patrones de tiempo. Sin anti-detección, el enriquecimiento de redes sociales es inviable en producción.

**Implementación — Parte A: Discovery scrapers (Yelu + PedidosYa)**

1. **Rate limit por proveedor:** máximo 1 request/3s para yelu.uy, 1 request/5s para pedidosya.com.uy. Implementar en cada provider via `sleep` con jitter `±20%`.
2. **User-agent rotation (discovery):** pool de 5+ UAs reales rotando por sesión de discovery. Configurar en `config/discovery.yaml → scraping.discovery_ua_pool`.
3. **Backoff exponencial:** ante HTTP 429, CAPTCHA o timeout → esperar `min(2^attempt × 10s, 600s)`, máximo 3 reintentos. Loguear el evento con pino (level: warn).
4. **Graceful fallback (discovery):** si el provider es baneado mid-run → marcar los candidatos restantes como `skipped` en el run, no error fatal. El run completa con los candidatos obtenidos hasta el momento.
5. **Session rotation para PedidosYa:** PedidosYa usa Playwright. Cerrar y reiniciar el browser context cada 50 páginas para evitar acumulación de fingerprint.

**Implementación — Parte B: Social-enrich (Facebook + Instagram)**

6. **User-agent rotation (social):** pool de 10+ UAs reales (Chrome Windows, Chrome Mac, Firefox Linux). Configurar en `config/discovery.yaml → scraping.social_ua_pool`.
7. **Timing aleatorio:** delay base `[2000, 5000]ms` + jitter `±30%` entre requests. Nunca intervalos regulares.
8. **Backoff exponencial:** ante HTTP 429 o redirect a login → esperar `min(2^attempt × 5s, 300s)`, máximo 3 reintentos por lead.
9. **Headless browser fingerprinting:** usar `playwright-stealth` plugin para ocultar `navigator.webdriver`, `navigator.languages`, `window.chrome`, etc.
10. **Proxy rotation (opcional):** integración con proxies residenciales. Config `config/discovery.yaml → scraping.proxy_enabled: false` (desactivado por defecto).
11. **Rate limit por dominio social:** máximo 1 request/10s por dominio (facebook.com, instagram.com separados).
12. **Graceful fallback (social):** si social-enrich falla para un lead → `digital_footprint.social_enrich_status: 'blocked'` + tag `social-blocked` + skip sin error fatal.

**Config en `config/discovery.yaml`:**
```yaml
scraping:
  discovery_ua_pool:
    - "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"
    - "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"
    # ... 3+ más
  discovery_delay_ms: [1000, 3000]   # base para Yelu; PedidosYa usa 3000–5000
  discovery_max_retries: 3
  social_ua_pool:
    - "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"
    - "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"
    # ... 8+ más
  social_delay_ms: [2000, 5000]
  social_max_retries: 3
  proxy_enabled: false
```

**Archivos:** `src/modules/discovery/providers/yelu.ts`, `src/modules/discovery/providers/pedidosya.ts`, `src/modules/social-enrich/index.ts`, `config/discovery.yaml`.

**Verificación:**
```bash
# Parte A — discovery con rate limiting activo (manual/aprobado; no modo autónomo):
blindspot discover-external --source yelu --location montevideo --niche restaurant --limit 5 --dry-run
# → debe mostrar delays entre requests en el log

# Parte B — social-enrich con fallback activo (manual/aprobado si toca red real):
blindspot social-enrich --limit 3 --verbose
# → leads baneados deben quedar con social_enrich_status='blocked', no error fatal
```

---

## Deuda técnica

| Item | Descripción | Impacto |
|------|-------------|---------|
| `enrichment/index.ts` grande | Refactor en módulos más pequeños | Bajo |
| `whois.ts` sin tests | Hace I/O de red, falla silenciosa si formato cambia | Bajo |
| Fallbacks hardcodeados restantes | Post Fase D completa — revisar qué quedó | Medio |
| Phone regex unificada `shared/phone.ts` | Lógica de validación de teléfonos dispersa en varios parsers | Medio |
| `web-outdated` undercounting | copyright-year parser falla en sitios sin copyright visible. `outdated_year_threshold` movido a `config/enrichment.yaml` (valor: 2022) en Fase D | Bajo |
| Bounding boxes OSM en código | Coordenadas de 8 ciudades hardcodeadas en `providers/osm.ts`. Mover a `config/discovery.yaml` cuando se expanda a más ciudades | Bajo |
| Magic numbers de scoring en código | `0.85` dedup threshold, `0.7` confirmation threshold — mover a `config/scoring.yaml` como parámetros nombrados. Los pesos de sub-scores en `sub-scores.ts` (35, 10, 15, 28, 25, 20...) también deberían moverse a config cuando se afinen. **Nota:** el `1.2` contactability multiplier desaparece en Fase 22 (reemplazado por `accessibility_factor`). | Bajo |
| OSM enrich lento con --with-heuristic | ~3 leads/min para OSM (sin website/phone, heuristic hace muchos HTTP rounds). Considerar --with-heuristic opcional o concurrency=10 para fuentes sin URL directa. | Medio |
| `external_source_quality=70` calibración | ✅ **Resuelto por Fase 22** — la regla se elimina en el step 0 de Fase 22 y es reemplazada por `source_quality_bonus` aditivo con valores diferenciados por fuente. Eliminar este item al aplicar Fase 22. | Medio |
| **`contact_ready` field** | ✅ **Resuelto por Fase 22-pre + Fase 22** (step 12b). Eliminar este item al aplicar Fase 22. | Medio |
| **Schema: score columns dispersas en `leads`** | `business_quality_score`, `digital_gap_score`, `systems_gap_score`, `data_confidence_score`, `contact_reliability_score` son scores internos del pipeline en columnas sueltas. Candidatos a consolidar en `lead_buyer_scores` como tipos internos (`pipeline_bq`, `pipeline_dg`) cuando se implemente Fase 12. Evaluar junto con Fase 12. | Bajo |
| **Schema: tags como `text[]` sin confidence** | El array `tags` no puede expresar confianza por tag ni historial. Si el sistema crece en complejidad de tags, considerar `lead_tags(lead_id, tag, confidence, source, tagged_at)`. No urgente mientras tags sean booleanos. | Bajo |
| **Scraping sin anti-detección** | ✅ **Resuelto por Fase 46** (expandida para cubrir Yelu/PedidosYa discovery + Facebook/Instagram social, ejecuta antes de Fase 48). Eliminar este item al aplicar Fase 46. | **Alto para producción** |
| **Cursor pagination — confirmar en implementación** | Fase API define cursor-based para `GET /leads`, `GET /outreach`, `GET /stats/outreach`, `GET /pipeline/runs`. CC debe verificar que todos implementen `{ data: T[], next_cursor: string\|null, total: number }`. | Bajo |
| **Missed run detection mínima** | Fase 23 debe exponer warning si `scheduled_for < now()` y `last_completed_at` no cubre ese schedule. No crear Fase 35 separada salvo que producción muestre falsos positivos/negativos. | Medio |

---

## Proyecto frontend — `ui/` (directorio en este repo)

El frontend es un workspace Next.js en `ui/` dentro de este mismo repo.
Todo el diseño de pantallas, componentes y UX está en `context/ARCHITECTURE_FRONTEND.md`.

**Prerequisitos para iniciar `ui/`:**
- Fase API completada (API en `api/` corriendo en puerto 3001)
- Scoring v2 estable (`contact_tier` + `pitch_hook` en score_breakdown)
- Vista `lead_dashboard` creada en DB
- Tabla `users` + JWT funcionando

**Orden de construcción** (ver detalle en ARCHITECTURE_FRONTEND.md):
1. Lead Explorer básico (lista con filtros)
2. Lead Detail completo
3. Modal de registro de outreach
4. Generación de ofertas IA
5. Segment Explorer (incluido dentro de UI base en el roadmap canónico actual)
6. Discovery Control Center

**No construir hasta que:** Fase API esté completa y se pueda hacer `curl /api/v1/leads` y recibir datos reales.

---

## Decisiones arquitectónicas fuera del roadmap (no son fases ejecutables)

> Esta sección contiene **decisiones activas de diseño** que NO van al roadmap canónico. NO son backlog — son no-ejecutar por diseño bajo el modelo actual.
> El roadmap canónico (`ROADMAP_CANONICAL.md § Roadmap ejecutable`) cubre **todo el producto ejecutable**. La antigua Fase 30 `DGI/BPS` quedó fuera del roadmap por descarte permanente y no debe tratarse como trabajo pendiente.

| Decisión | Razón |
|------|--------------------|
| **Fase 32** — `lead_dashboard` como MATERIALIZED VIEW | VIEW normal suficiente para 2–8 socios concurrentes. Reconsiderar solo si latencia de filtros >500ms sostenida sobre dataset >50k leads. Activar **NO requiere agregar fase** — es un swap operativo del DDL de la VIEW + un cron de `REFRESH MATERIALIZED VIEW CONCURRENTLY` agregado al final del pipeline. Si pasa a ser bloqueante, el Tech Lead lo agrega como fase específica con criterios de calibración. |
| **Fase 34** — `/api/v1/health` extendido | Un endpoint básico `{ status, db, last_run_at, next_run_at, leads_count, hot_count }` se implementa inline en Fase API. Sin necesidad de fase separada para uptimerobot-style observability. |
| **Fase 17** — Investigación perfil MINTUR | Diagnóstico ya ejecutado (snapshot 2026-05-15) — los resultados están documentados en la sección "Fase 17 — Investigación perfil MINTUR (diagnóstico antes de implementar)" más arriba en este archivo. No requiere acción adicional. |

**Items eliminados del roadmap (no se implementarán bajo el modelo actual):**

| Item descartado | Razón |
|-----------------|-------|
| Self-service password reset por email | Uso interno con admin presente — admin resetea directamente via `PATCH /api/v1/users/:id`. |
| API pública para terceros | El sistema no se comercializa. La API es interna entre `ui/` y `api/` solamente. |
| Multi-tenant por organización | No hay otras organizaciones. El admin es uno solo. |
| OAuth/SSO con providers externos | Cuentas creadas por admin con email+password+bcrypt. Simple y suficiente. |
| Webhooks de outreach para CRM externo | Sin CRM externo en el modelo. El registro de outreach vive en `lead_outreach`. |
| Cache distribuido (Redis) | Concurrencia 2–8 socios — DB directo es suficiente. Si surge bottleneck en una query específica, mejorar el índice. |
| Métricas a Prometheus/Grafana | El Performance Dashboard de la UI cubre lo necesario para el admin. |

**Si el modelo cambia (comercialización, expansión a >50 usuarios, otra organización, etc.):** revisar esta sección antes de empezar el cambio. La arquitectura actual puede absorber crecimiento moderado (PostgreSQL + Fastify escalan bien) pero requiere planificación explícita de migración.
