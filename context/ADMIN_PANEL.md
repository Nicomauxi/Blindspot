# Blindspot — Admin Panel

> Specs del panel de administración. El admin (Nicolás) controla todo desde la UI sin tocar CLI ni DB directa.
>
> Este archivo define **qué features admin debe tener la UI**, complementando `ARCHITECTURE_FRONTEND.md` (que describe las pantallas de uso normal — Lead Explorer, Lead Detail, Outreach Tracker, Segment Explorer).
> Para orden de ejecución, ownership de procesos y decisiones canónicas ver `ROADMAP_CANONICAL.md`.
>
> Modelo: 1 admin (Nicolás) + 2–8 socios (CM) con accesos delimitados. Servidor privado.

---

## Principios de diseño del admin panel

1. **El admin nunca debería ssh al servidor para tareas operativas habituales.** Crear/quitar usuarios, configurar cron, disparar runs, ver logs, revisar costos — todo desde la UI.
2. **Toda acción admin genera entrada en `audit_log`.** Quién, cuándo, qué cambió, IP. Para tener trazabilidad si un socio reporta "no veía leads ayer".
3. **Las acciones destructivas requieren confirmación inline.** Modal "¿Confirmás desactivar a `juan@socio.com`? Sus tokens activos se invalidan y no podrá entrar al sistema."
4. **Los dashboards de monitoreo se refrescan automáticamente (polling 5–10s) cuando el admin está mirando.** Sin pestaña abierta, sin overhead.

---

## Pantalla A — User Management

```
┌─────────────────────────────────────────────────────────────────────────┐
│ USUARIOS                                            [+ Crear usuario]   │
├─────────────────────────────────────────────────────────────────────────┤
│  Email                  Rol      Activo  Último login   Filtro          │
│  nicolas@…  (vos)       admin    ✓       hace 2 min     —               │
│  juan@socio.com         cm       ✓       hace 3 días    web+marketing   │
│  maria@socio.com        cm       ✓       hace 14 días   software UY     │
│  diego@socio.com        cm       ✗       nunca          —               │
│  ana@socio.com          cm       ✗       hace 2 meses   (desactivada)   │
│                                                                         │
│  [Ver detalle / Editar / Desactivar / Reset password]                   │
└─────────────────────────────────────────────────────────────────────────┘
```

**Acciones disponibles para el admin:**

| Acción | Endpoint | Confirmación requerida | Audit log |
|--------|----------|------------------------|-----------|
| Crear usuario | `POST /api/v1/users` | Sí — modal con email, password inicial, role, lead_filter + opción seed_pricing | `user.create` |
| Editar lead_filter | `PATCH /api/v1/users/:id { lead_filter }` | Sí | `lead_filter.update` |
| Resetear password | `PATCH /api/v1/users/:id { password }` | Sí | `user.password_reset` |
| Desactivar (revocar acceso inmediato) | `PATCH /api/v1/users/:id { active: false }` | Sí — texto: "Esto cierra todas las sesiones activas" | `user.deactivate` |
| Reactivar | `PATCH /api/v1/users/:id { active: true }` | No | `user.reactivate` |
| Cambiar role admin↔cm | `PATCH /api/v1/users/:id { role }` | Sí — solo otro admin puede hacerlo | `user.role_change` |
| Editar otros campos (email, etc.) | `PATCH /api/v1/users/:id` con campos no privilegiados | Sí | `user.update` |
| Eliminar definitivamente | `DELETE /api/v1/users/:id` | Sí — modal "Solo desactivar es reversible. ¿Estás seguro?" **Recomendación operativa: usar `desactivar`, nunca DELETE.** Ver "Política de DELETE" más abajo. | `user.delete` |

**Política de DELETE `/api/v1/users/:id` (canónico — sincronizado con todas las FKs a `users`):**

El handler debe verificar **TODAS** las tablas que referencian `users.id` antes de ejecutar el DELETE. Cualquier presencia bloquea el DELETE con 409 Conflict + `error_code='user_has_history'` + listado de tablas que bloquean:

| Tabla | FK | Bloquea DELETE | Mensaje sugerido |
|---|---|---|---|
| `lead_outreach.user_id` | `ON DELETE RESTRICT` | Sí | "Tiene outreach registrado — usar desactivar" |
| `audit_log.actor_user_id` | sin ON DELETE (= NO ACTION) | Sí | "Tiene historial de acciones admin — usar desactivar" |
| `service_pricing.user_id` | sin ON DELETE (= NO ACTION), NOT NULL | Sí | "Tiene precios configurados — purgar primero o usar desactivar" |
| `outreach_campaigns.user_id` | sin ON DELETE (= NO ACTION), NOT NULL | Sí | "Tiene campañas creadas — purgar primero o usar desactivar" |
| `discovery_jobs.user_id` | sin ON DELETE (= NO ACTION), nullable | Sí cuando user_id ≠ NULL | "Tiene jobs de discovery — purgar primero o usar desactivar" |
| `llm_usage_log.user_id` | sin ON DELETE (= NO ACTION), nullable | Sí cuando user_id ≠ NULL | "Tiene uso de LLM registrado — usar desactivar" |
| `leads.contacted_by` | `ON DELETE SET NULL` | No | shortcut se nulifica automáticamente |

**Implementación canónica del handler:**
```sql
-- Pre-check antes del DELETE:
SELECT
  EXISTS(SELECT 1 FROM lead_outreach WHERE user_id=$1)            AS has_outreach,
  EXISTS(SELECT 1 FROM audit_log WHERE actor_user_id=$1)          AS has_audit,
  EXISTS(SELECT 1 FROM service_pricing WHERE user_id=$1)          AS has_pricing,
  EXISTS(SELECT 1 FROM outreach_campaigns WHERE user_id=$1)       AS has_campaigns,
  EXISTS(SELECT 1 FROM discovery_jobs WHERE user_id=$1)           AS has_disc_jobs,
  EXISTS(SELECT 1 FROM llm_usage_log WHERE user_id=$1)            AS has_llm_usage;
-- Si CUALQUIERA es true → 409 con error_code='user_has_history' + array de tablas bloqueantes.
```

**Recomendación operativa:** en la práctica, todo admin activo genera `audit_log` al hacer cualquier acción privilegiada. Eso vuelve el DELETE inalcanzable para users con actividad real. **La operación esperada es siempre `desactivar` (`PATCH { active: false }`).** El endpoint DELETE existe únicamente para users creados por error sin ninguna actividad.

---

**Granularidad de `audit_log.action` (canónico — sincronizado con `FUTURE.md § Fase API-0 step 7`):** el handler de `PATCH /api/v1/users/:id` inspecciona el body antes de elegir la action:
- Body contiene `lead_filter` → `lead_filter.update`
- Body contiene `password` → `user.password_reset`
- Body contiene `active: false` → `user.deactivate`
- Body contiene `active: true` → `user.reactivate`
- Body contiene `role` distinto al actual → `user.role_change`
- Otros campos (email, etc.) → `user.update`
- Si el body combina varios campos privilegiados, escribir **una row por action distinta** en `audit_log` (cada cambio queda auditado por separado) — no agrupar bajo `user.update` genérico.

**Detalle de un usuario:** ver `lead_filter` actual + última actividad + cantidad de leads contactados + tasa de respuesta.

**Modal "Crear usuario" — campos del form:**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| email | text | Sí | Único — el backend devuelve 409 si ya existe. |
| password inicial | text | Sí | Mínimo 12 chars. El admin se lo comunica al CM por canal seguro. |
| role | radio (admin/cm) | Sí | Default `cm`. |
| lead_filter | form anidado | Sí si role=cm | Editor de filtro completo (multi-select, sliders, mapa). |
| ☐ Sin restricciones (mostrar todos los leads) | checkbox | No | Solo aparece si role=cm. Si está marcado, el body incluye `lead_filter: {}` + `acknowledge_unrestricted: true`. Sin el checkbox y filtro vacío, el backend retorna 400 con `error_code='lead_filter_empty_requires_ack'`. |
| seed_pricing | radio | No | Default `copy_admin`. Opciones: `copy_admin` (copia las 7 filas de `service_pricing` del admin actual al nuevo CM) / `empty` (deja `service_pricing` vacío — el CM lo configura en su primer login). Solo aparece si Fase 27 está aplicada. |

### Configuración de `lead_filter`

```jsonc
{
  "primary_offer": ["marketing", "catalogo"],        // qué tipos de oferta puede vender
  "contact_tier": ["A", "B"],                        // solo leads con email o whatsapp
  "niche": ["restaurant", "gym"],                    // qué nichos puede ver
  "min_prospect_score": 40,                          // score mínimo
  "geo_radius": {                                    // opcional — solo leads en radio GPS
    "center": { "lat": -34.9, "lng": -56.16 },
    "meters": 50000                                  // 50km
  },
  "exclude_franchises": true,                        // siempre filtrar franquicias
  "max_leads_visible": null                          // null = sin tope
}
```

UI: form con todos los campos como controles (multi-select, slider para score, mapa para radio). Validar antes de guardar: si el filter resulta en 0 leads visibles, mostrar warning ("este filtro deja al socio sin nada que ver — confirmar antes de guardar").

---

## Pantalla B — Pipeline Manager

> Ya está descrito en `ARCHITECTURE_FRONTEND.md § Pantalla 6 — Pipeline Manager`. Esta sección agrega los puntos específicos del modelo admin.

**Adicionales sobre el diseño base:**

- **Botón "Ver como socio"**: para testing de permisos — el admin puede previsualizar qué leads vería un socio con su `lead_filter`. No ejecuta el pipeline como socio; el pipeline siempre corre como sistema/admin.
- **Histórico de cambios de `pipeline_config`**: tab "Auditoría" que lista `audit_log` filtrado por `target_type='pipeline_config'`. Cada cambio muestra el diff entre antes/después.
- **Botón "Pausar todo"**: emergency stop que setea `pipeline_config.enabled = false` y aborta el run activo si lo hay. Útil si el admin nota un error.
- **Modo dry-run de config**: antes de guardar cambios de `pipeline_config`, mostrar un panel "qué cambia: tu próximo run pasaría de procesar 127 leads a 89 leads (porque excluiste OSM)".

---

## Pantalla C — Discovery Control Center

> Ya está descrito en `ARCHITECTURE_FRONTEND.md § Pantalla 5`. Adiciones admin:

- **Filtro "creadas por mí" vs "creadas por sistema (cron)"** — el admin puede ver qué jobs disparó manualmente vs cuáles vinieron del cron.
- **Botón "Repetir job"**: re-ejecutar un discovery anterior con los mismos parámetros (útil para zonas con resultados pobres tras un cambio).
- **Estimador de costo previo a encolar**: antes de "Iniciar exploración" con Google Places, mostrar costo estimado (`max_results × $0.02`) y restar del presupuesto disponible.

---

## Pantalla D — Cost Dashboard (nueva — feature admin explícita)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ COSTOS                                  [Mes actual ▼]  [Exportar CSV]  │
├─────────────────────────────────────────────────────────────────────────┤
│  GOOGLE PLACES API                                                       │
│  Gastado este mes:     $1.16 USD     ████░░░░░░  21% del budget         │
│  Acumulado total:      $5.16 / $200.00 USD                              │
│  Requests este mes:    58                                                │
│  Costo por request:    ~$0.02                                            │
│  Alerta cuando queda:  $20.00 USD     [Editar]                          │
│                                                                          │
│  LLM (proveedor configurado)                                             │
│  Tokens usados hoy:    12.450 / límite configurado                       │
│  Tokens este mes:      87.500                                            │
│  Ofertas generadas:    142                                               │
│  Costo estimado:       $0.00 USD                                         │
│                                                                          │
│  INFRAESTRUCTURA                                                         │
│  Servidor mensual:     $X USD (configurar manualmente)                  │
│  Backups offsite:      $Y USD                                            │
│                                                                          │
│  COSTO POR LEAD                                                          │
│  Total leads hot generados este mes:  23                                 │
│  Costo total este mes:                ~$1.50 USD                        │
│  Costo por hot lead:                  ~$0.07 USD                        │
│                                                                          │
│  COSTO POR FUENTE (último run)                                           │
│  google_places:  $0.90 USD · 45 leads                                   │
│  mintur:         $0.00 (gratuito)                                       │
│  yelu:           $0.00 (gratuito)                                       │
│  osm:            $0.00 (gratuito)                                       │
│                                                                          │
│  [Ver histórico de gasto mensual →]                                     │
└─────────────────────────────────────────────────────────────────────────┘
```

**Endpoints:**

```
GET /api/v1/admin/costs/overview?month=2026-05
     → { google_places: { spent_usd, request_count, budget_remaining },
         llm: { provider, tokens_used, offers_generated, cost_usd },
         infra: { server_monthly_usd, backup_monthly_usd },
         per_lead: { hot_leads_count, total_cost_usd, cost_per_hot_usd },
         per_source: [{ source, cost_usd, leads_count }] }

GET /api/v1/admin/costs/history
     → [{ month: '2026-05', google_places_usd, llm_usd, hot_leads }] — últimos 12 meses
```

**Datos fuente:**
- Google Places: `pipeline_config.google_places_budget_spent` (incremental por run) + tabla `pipeline_runs.phase_results.refresh.by_source.google_places.cost_usd`.
- LLM: tabla `llm_usage_log(id, ts, user_id, provider, model, tokens_in, tokens_out, cost_usd_estimated)` — registro por llamada a `generateOffer()`. Provider/model/límites vienen de configuración runtime, no del texto del dashboard.
- Infra: campo manual en `pipeline_config.infra_monthly_cost_usd` y `backup_monthly_cost_usd` (admin lo edita).

**Alertas:** badge rojo en header cuando Google Places budget restante < `alert_threshold`. También en payload de webhook si está configurado (Fase 39, opcional).

---

## Pantalla E — Performance Dashboard (nueva — feature admin explícita)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ RENDIMIENTO                             [Últimos 30 días ▼]  [Refresh]  │
├─────────────────────────────────────────────────────────────────────────┤
│  PIPELINE RUNS                                                           │
│  Runs ejecutados:      4    Exitosos: 3    Fallidos: 1   Parciales: 0   │
│  Duración promedio:    3h 47min                                          │
│  Tiempo total:         15h 8min de CPU                                  │
│                                                                          │
│  POR FASE (promedio último run)                                          │
│  ─────────────────────────────                                           │
│  refresh:    █████████████░░░░░  1h 38min  (45% del tiempo)             │
│  discovery:  ████░░░░░░░░░░░░░░    22min   (10%)                        │
│  enrich:     ████░░░░░░░░░░░░░░    18min   (8%)                         │
│  score:      ███░░░░░░░░░░░░░░░    14min   (6%)                         │
│  invariantes:░░░░░░░░░░░░░░░░░░     1min   (0.5%)                       │
│                                                                          │
│  THROUGHPUT                                                              │
│  Leads enriquecidos/hora:  62                                            │
│  Leads scoreados/hora:     13.460                                        │
│  Discovery candidatos/min: 12 (yelu) · 8 (osm) · 5 (gp)                 │
│                                                                          │
│  ERRORES RECIENTES (últimos 7 días)                                      │
│  ─────────────────────────────────                                       │
│  2026-05-15 14:23  enrich  timeout en lead "El Olivo"   [Ver detalle]   │
│  2026-05-14 02:14  discov  HTTP 429 yelu — backoff aplicado [Ver]       │
│  2026-05-13 16:45  social  blocked en facebook — skip       [Ver]       │
│                                                                          │
│  TASA DE ÉXITO POR FUENTE                                                │
│  google_places:  100%   45/45                                            │
│  mintur:         100%   32/32                                            │
│  yelu:            96%   27/28  (1 timeout)                              │
│  osm:            100%   22/22                                            │
│  pedidosya:       80%    4/5   (1 captcha)                              │
│                                                                          │
│  CALIDAD DE DATOS (cambios significativos último run)                    │
│  ─────────────────────────────────────────────                           │
│  Leads con score subiendo >15pts:    28                                  │
│  Leads con score bajando >15pts:     12  [Ver razón]                    │
│  Leads que ganaron contact_tier:      9                                  │
│  Leads que perdieron contact_tier:    3                                  │
│  Nuevos hot leads:                    3                                  │
│                                                                          │
│  [Ver detalle de un run específico →]                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

**Endpoints:**

```
GET /api/v1/admin/performance/overview?days=30
     → { runs: { total, successful, failed, partial },
         duration: { avg_min, total_hours },
         per_phase: [{ phase, avg_min, pct_of_total }],
         throughput: { enrich_per_hour, score_per_hour, discovery_per_min },
         success_rate_per_source: [{ source, success, total, pct }] }

GET /api/v1/admin/performance/errors?days=7
     → [{ ts, phase, source, lead_id, error_type, message }]

GET /api/v1/admin/performance/quality?run_id=<id>
     → { score_up_15: N, score_down_15: N, tier_gained: N, tier_lost: N, new_hot: N,
         significant_changes: [{ lead_id, field, from, to }] }
```

**Datos fuente:**
- `pipeline_runs.phase_results` (ya planeado)
- Nuevo: registro de errores en tabla `pipeline_errors(id, ts, run_id, phase, source, lead_id, error_type, message, stack)` para no perder errores entre runs.
- `digital_footprint.last_change_diff` (Fase 45) alimenta "calidad de datos / cambios significativos".

---

## Pantalla F — Health & System Status

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ESTADO DEL SISTEMA                                                       │
├─────────────────────────────────────────────────────────────────────────┤
│  Servidor:           ✅ Online      Uptime: 7d 4h                        │
│  Base de datos:      ✅ Conectada   Latencia: 3ms                        │
│  Pipeline cron:      ✅ Habilitado  Próximo run: domingo 25 May 02:00   │
│  Último run:         ✅ Completado  hace 3 días                          │
│  Proceso core:       ✅ Running     PID 12345                            │
│  Proceso api:        ✅ Running     PID 12346                            │
│                                                                          │
│  INVARIANTES DE DB                                                       │
│  ──────────────────                                                      │
│  passed_not_enriched:    0  ✅                                          │
│  tags_contradictorios:   0  ✅                                          │
│  passed_sin_score:       0  ✅                                          │
│  contact_tier_X_hot:     0  ✅                                          │
│                                                                          │
│  INVARIANTES OPERATIVOS                                                  │
│  ──────────────────────                                                  │
│  scoring_v1_columns_present:  ⚠️  presentes (32 días desde Fase 22)     │
│      → considerar item 28 (Cleanup v1)                                  │
│  audit_log rows:        12,540   ✅                                     │
│      ⚠️  warning > 100k                                                  │
│  llm_usage_log rows:    48,210   ✅                                     │
│      ⚠️  warning > 500k                                                  │
│  pipeline_errors rows:  6,802    ✅                                     │
│      ⚠️  warning > 100k                                                  │
│                                                                          │
│  ÚLTIMO BACKUP                                                           │
│  ──────────────                                                          │
│  Local:    $HOME/blindspot-backups/blindspot_20260515_030001.sql.gz     │
│  Offsite:  ✅ Sincronizado (Backblaze B2)  hace 14 h                    │
│                                                                          │
│  PROCESOS BACKGROUND                                                     │
│  ────────────────                                                        │
│  pg_notify LISTEN:        ✅ Escuchando 'pipeline_trigger'              │
│  Poll discovery_jobs:     ✅ Cada 30s                                   │
│  Poll pipeline_runs:      ✅ Cada 60s                                   │
│  Poll pipeline_config:    ✅ Cada 60s                                   │
│                                                                          │
│  [Forzar refresh] [Reiniciar proceso core] [Reiniciar proceso api]      │
└─────────────────────────────────────────────────────────────────────────┘
```

**Endpoint:**
```
GET /api/v1/admin/system/status
     → { server: { uptime_seconds, version },
         db: { connected, latency_ms },
         pipeline: { cron_enabled, next_run_at, last_run_at, last_status },
         processes: { core: { running, pid }, api: { running, pid } },
         invariants: { passed_not_enriched, tags_contradictorios, passed_sin_score, contact_tier_x_hot },
         operational_invariants: {
           scoring_v1_columns_present: {
             present: boolean,           // true si las columnas prospect_score_v1/score_breakdown_v1 existen
             days_since_v2_applied: int, // calculado desde MIN(updated_at) WHERE scoring_version=2
             severity: 'ok' | 'warning'  // 'warning' cuando present=true Y days_since_v2_applied > 30
           },
           audit_log_rows: { count: int, severity: 'ok' | 'warning' },          // warning > 100k
           llm_usage_log_rows: { count: int, severity: 'ok' | 'warning' },      // warning > 500k
           pipeline_errors_rows: { count: int, severity: 'ok' | 'warning' }     // warning > 100k
         },
         backups: { local_latest, offsite_latest, sync_status },
         background: { listen_pg_notify, poll_discovery_jobs, poll_pipeline_runs, poll_pipeline_config } }
```

**Cálculo de `operational_invariants` (todas queries baratas — `pg_class.reltuples` para counts aproximados):**
- `scoring_v1_columns_present.present`: `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='prospect_score_v1')`.
- `scoring_v1_columns_present.days_since_v2_applied`: `SELECT EXTRACT(DAY FROM now() - MIN(updated_at)) FROM leads WHERE scoring_version=2` — null si v2 aún no aplicada.
- Row counts: `SELECT reltuples::bigint FROM pg_class WHERE relname=$tabla`. Aproximado pero suficiente para tier warnings; `SELECT COUNT(*)` solo se usa cuando el usuario abre la pantalla y solicita refresh exacto.
- Thresholds canónicos (alineados con `ROADMAP_CANONICAL.md § Decisiones cerradas`): `audit_log > 100k` warning, `llm_usage_log > 500k` warning, `pipeline_errors > 100k` warning. Si el admin decide purgar o particionar, esos thresholds se revisan junto con la fase de purga (no canónica todavía).
- El warning `scoring_v1_columns_present` con `severity='warning'` (`present=true` + `days_since_v2_applied > 30`) habilita visualmente el item 28 (Cleanup v1) del roadmap canónico. La UI muestra el botón "Considerar Cleanup v1" que linkea a la sección del roadmap, no ejecuta nada automáticamente.

**Acciones admin (con confirmación):**

- **"Reiniciar proceso core"** → `POST /api/v1/admin/system/restart-core`. El handler en Fastify ejecuta `child_process.exec('pm2 restart core')` con `cwd=process.cwd()`, timeout 30s. Audit log se escribe **antes** del exec (acción destructiva). Prerequisito operativo: Fase 48 aplicada (pm2 instalado, el usuario unix del proceso `api/` tiene pm2 en PATH). Si pm2 no está disponible, el endpoint devuelve 503 con código tipado (ver tabla más abajo).
- **"Reiniciar proceso api"** → `POST /api/v1/admin/system/restart-api`. Mismo flujo pero `pm2 restart api`. **Importante**: este reinicio mata al propio handler — el cliente recibe connection reset, no respuesta JSON. La UI debe interpretar `connection reset within 5s del POST` como "reinicio iniciado" y reconectar tras 10s al `/admin/system/status` para verificar `uptime_seconds < 30`.
- **"Forzar refresh"** → simplemente re-pide `/api/v1/admin/system/status`. Sin audit log (read-only).

**Forma canónica de respuesta de restart-core / restart-api** (códigos tipados, no strings libres):

```typescript
type RestartResponse =
  | { ok: true,  exit_code: 0 }
  | { ok: false, error_code: 'pm2_not_found' | 'process_not_registered' | 'pm2_failed' | 'timeout',
      stderr: string, exit_code: number | null }
```

| `error_code` | HTTP | Significado | UI muestra |
|---|---|---|---|
| `pm2_not_found` | 503 | `which pm2` falla. Fase 48 no aplicada. | "pm2 no instalado — ejecutar Fase 48 antes de usar restart" |
| `process_not_registered` | 503 | pm2 existe pero `pm2 jlist` no lista el nombre. | "Proceso `core`/`api` no registrado en pm2 — re-correr `pm2 save`" |
| `pm2_failed` | 500 | pm2 ejecutó pero exit_code ≠ 0. | "pm2 falló al reiniciar — ver stderr" + stderr expandible |
| `timeout` | 504 | exec excedió 30s. | "Reinicio no respondió en 30s — verificar `pm2 status` manualmente" |

**Modo dev (sin pm2):** si `process.env.NODE_ENV !== 'production'`, ambos endpoints devuelven 501 Not Implemented con `{ ok: false, error_code: 'restart_disabled_in_dev', stderr: '', exit_code: null }`.

**Nota de excepción a la regla "api/ no toca src/":** los handlers `restart-*` usan `child_process.exec('pm2 ...')` para gestionar el ciclo de vida del proceso `src/`. Esto es la **única excepción aceptable** a la regla "api/ nunca importa módulos de src/" (`ARCHITECTURE_FUTURE.md § Mecanismo de trigger`). Gating: solo activo cuando `NODE_ENV='production'` (Fase 48 aplicada). En dev devuelve 501 sin ejecutar. No usar este patrón para ningún otro caso — toda otra interacción api/↔src/ pasa por PostgreSQL.

---

## Pantalla G — Audit Log Viewer

```
┌─────────────────────────────────────────────────────────────────────────┐
│ HISTORIAL DE ACCIONES                  [Filtros ▼]  [Exportar JSON]     │
├─────────────────────────────────────────────────────────────────────────┤
│  Actor: [Todos ▼]   Acción: [Todas ▼]   Desde: [...]   Hasta: [...]    │
│                                                                          │
│  2026-05-15  14:23  nicolas@…   pipeline.run.trigger   run_id=abc123    │
│  2026-05-15  14:18  nicolas@…   pipeline.config.update [Ver diff]       │
│  2026-05-15  10:02  juan@…      user.password_reset    (por admin)      │
│  2026-05-14  09:14  nicolas@…   user.create            maria@socio.com  │
│  2026-05-13  17:30  nicolas@…   discovery.job.create   yelu·salto       │
│  2026-05-13  16:45  nicolas@…   lead_filter.update     juan@socio.com   │
│                                                                          │
│  [Página 1 de 12]  [→]                                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

**Endpoint:**
```
GET /api/v1/admin/audit-log
     ?actor_user_id=<uuid>&action=<text>&target_type=<text>
     &from=<iso>&to=<iso>&limit=50&cursor=<id>
     → { data: AuditEntry[], next_cursor: string|null, total: number }
```

Solo accesible por admin. Click en una entrada con `diff` jsonb → modal que muestra before/after.

---

## Tabla de endpoints admin (resumen)

| Endpoint | Método | Acción | Audit log action |
|----------|--------|--------|------------------|
| `/api/v1/users` | GET | Listar usuarios | — |
| `/api/v1/users` | POST | Crear usuario | `user.create` |
| `/api/v1/users/:id` | GET | Detalle | — |
| `/api/v1/users/:id` | PATCH | Editar otros campos (email, etc.) | `user.update` |
| `/api/v1/users/:id` | PATCH | Cambiar password | `user.password_reset` |
| `/api/v1/users/:id` | PATCH | Desactivar (`active: false`) | `user.deactivate` |
| `/api/v1/users/:id` | PATCH | Reactivar (`active: true`) | `user.reactivate` |
| `/api/v1/users/:id` | PATCH | Cambiar `role` | `user.role_change` |
| `/api/v1/users/:id` | PATCH | Editar `lead_filter` | `lead_filter.update` |
| `/api/v1/users/:id` | DELETE | Eliminar definitivamente | `user.delete` |
| `/api/v1/pipeline/config` | GET/PUT/PATCH | Config | `pipeline.config.update` |
| `/api/v1/pipeline/run` | POST | Disparar run manual | `pipeline.run.trigger` |
| `/api/v1/pipeline/abort` | POST | Abortar run activo | `pipeline.run.abort` |
| `/api/v1/discovery/jobs` | GET/POST | Listar/crear job | `discovery.job.create` |
| `/api/v1/discovery/jobs/:id` | PATCH | Pause/resume/cancel | `discovery.job.update` |
| `/api/v1/admin/costs/overview` | GET | Dashboard costos | — |
| `/api/v1/admin/costs/history` | GET | Histórico mensual | — |
| `/api/v1/admin/performance/overview` | GET | Dashboard rendimiento | — |
| `/api/v1/admin/performance/errors` | GET | Errores recientes | — |
| `/api/v1/admin/performance/quality` | GET | Calidad de datos por run | — |
| `/api/v1/admin/system/status` | GET | Health del sistema | — |
| `/api/v1/admin/system/restart-core` | POST | Reiniciar proceso core | `system.restart` |
| `/api/v1/admin/system/restart-api` | POST | Reiniciar proceso api | `system.restart` |
| `/api/v1/admin/audit-log` | GET | Ver audit log | — |

Todos requieren `role=admin` en el JWT. El middleware de Fastify rechaza con 403 si no.

---

## Orden de construcción del admin panel

> Las pantallas no se construyen todas en una fase. Orden recomendado, alineado con las fases de `FUTURE.md`:
> **Admin MVP** = etapas 1, 2 y 5. Eso es lo mínimo antes de dar acceso a socios: usuarios/filtros, health read-only y auditoría. Costos, performance y restart son admin avanzado.

| Etapa | Pantalla | Bloqueada por |
|-------|----------|---------------|
| 1 | **A. User Management básico** (CRUD de usuarios + lead_filter) | Fase API-0 (tabla users) + Fase API |
| 2 | **F. Health & System Status** (read-only, sin acciones de restart) | Fase API |
| 3 | **B. Pipeline Manager** (config + ejecutar) | Fase 23 (cron + scheduler) |
| 4 | **C. Discovery Control Center** | Fase API + tabla `discovery_jobs` |
| 5 | **G. Audit Log Viewer** | Fase API-0 (tabla `audit_log` ya creada) |
| 6 | **D. Cost Dashboard** | Fase 44 + tabla `llm_usage_log` |
| 7 | **E. Performance Dashboard** | Fase 45 (change detection) + tabla `pipeline_errors` |
| 8 | **F. Acciones de restart de procesos** (cuando hay confianza en pm2) | Fase 48 (pm2 corriendo) |

**Default landing del admin tras login:** Pantalla F (Health) — un vistazo rápido al estado, badge si algo falla.
