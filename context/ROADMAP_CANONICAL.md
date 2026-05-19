# Blindspot — Roadmap Canonical

> Fuente canónica de ejecución. Si este archivo contradice `FUTURE.md`,
> `PROJECT_MASTER.md`, `AUTONOMOUS.md`, `ARCHITECTURE_FUTURE.md`,
> `ARCHITECTURE_FRONTEND.md` o `ADMIN_PANEL.md`, este archivo gana.
>
> `FUTURE.md` conserva el detalle de implementación por fase. Este archivo define
> el orden, los prerequisitos, los límites de autonomía y las decisiones ya cerradas.

---

## Modelo técnico vigente

- Producto interno privado: 1 admin + 2–8 socios CM.
- Un repo con tres workspaces: `src/` core pipeline, `api/` Fastify, `ui/` Next.js.
- Dos procesos en producción:
  - `api/`: HTTP, JWT, RBAC, validación, lectura/escritura DB, `pg_notify`.
  - `src/`: proceso long-running. Ejecuta cron, `LISTEN pipeline_trigger`, polling de `pipeline_runs`, polling de `discovery_jobs`, discovery, enrichment y scoring.
- `api/` nunca importa ni ejecuta discovery, enrichment, scoring, Playwright ni cron del pipeline.
- Coordinación `api/` ↔ `src/` exclusivamente por PostgreSQL.
- DB operativa actual: local Docker `supabase_db_gap-radar`. Cualquier mención a Supabase cloud es futura/manual y está bloqueada en modo autónomo.

## Estados canónicos

`pipeline_runs.status`:

```text
pending | running | completed | failed | partial | aborted
```

- `POST /api/v1/pipeline/run` inserta `status='pending'` y emite `pg_notify`.
- `src/` consume `pending` y transiciona a `running`.
- Abort no usa estado `aborting`: `api/` setea `abort_requested=true`; `src/` termina limpiamente y deja `status='aborted'`.

`discovery_jobs.status`:

```text
queued | running | completed | failed | cancelled | paused
```

`lead_outreach.status`:

```text
contacted | responded | interested | closed_won | closed_lost | no_response
```

## Reglas de acceso

- Admin ve todo por `role='admin'`.
- CM ve solo la intersección entre su `lead_filter` y los filtros del request.
- Para CM, `lead_filter IS NULL` es configuración inválida y debe fallar cerrado: no crear ni actualizar un CM sin filtro explícito.
- Para CM, `lead_filter = '{}'` solo se permite si el body del request incluye `acknowledge_unrestricted: true`. Sin ese flag el endpoint retorna `400` con `error_code='lead_filter_empty_requires_ack'`. Equivale a sin restricciones cuando se guarda.
- `GET /api/v1/leads/:id` para un CM fuera de su filtro retorna `404`, no `403`, para no revelar existencia.
- El `lead_filter` se carga desde DB en cada request protegido. Si admin cambia el filtro de un CM (`PATCH /api/v1/users/:id`), el siguiente request del CM ya usa el filtro nuevo sin necesidad de re-login. No confiar nunca en `lead_filter` embebido en el JWT.

## Fuentes de datos — hechos cerrados

- MINTUR no provee GPS confiable ni RUT público. Cualquier fase que dependa de GPS/RUT de MINTUR debe rediseñarse o depender de otra fuente.
- OSM requiere atribución visible cuando sus datos se muestran en UI: `© Colaboradores de OpenStreetMap`.
- Yelu y PedidosYa son scraping de sitios privados; discovery real está bloqueado en modo autónomo salvo tests con fixtures.
- Google Places tiene costo y queda bloqueado en modo autónomo.

## Modos de ejecución

> **Nota de terminología:** "modo plan master" y "modo autónomo" son **roles operativos** del proyecto Blindspot. No confundir con el **Plan Mode** que ofrece Claude Code como feature del CLI (toggle con Shift+Tab, requiere `ExitPlanMode`). Los modos del proyecto definen *quién implementa* (Tech Lead vs Claude Code autónomo); el Plan Mode del CLI define *si Claude puede ejecutar acciones que modifican estado*. Las reglas globales (`~/.claude/CLAUDE.md`) priorizan Plan Mode CLI sobre cualquier modo del proyecto: si Plan Mode CLI está activo, no se permiten edits ni bash de modificación aunque la fase esté marcada `autonomous`.

### Modo plan master

- El Tech Lead analiza, diseña y genera prompts autocontenidos para Claude Code.
- No edita código fuente.
- Puede actualizar `context/` si la tarea es documentación/planificación.

### Modo ejecución directa

- Se usa cuando **el mismo agente que analiza también implementa** en este workspace.
- No hay handoff a otra sesión ni prompt externo: el agente construye el `phase packet` internamente y ejecuta en la misma sesión.
- Mantiene exactamente las mismas restricciones de `SECURITY.md`, los mismos prerequisitos del roadmap y las mismas stop conditions del modo autónomo.
- Si Nicolás otorgó una **aprobación manual general vigente** para tareas que no requieran su intervención real, las etiquetas `approval` / `manual` del roadmap pasan a ser **señales de riesgo**, no pausas automáticas, para trabajo local sin gasto externo ni comandos bloqueados.
- Si detecta que la fase es demasiado grande para ejecutarse con bajo riesgo, **no avanza “igual”**: primero la parte en sub-paquetes internos siguiendo las reglas de abajo.
- **Default recomendado cuando ejecuta Codex directamente en este repo.** `plan master` queda para casos donde realmente exista una segunda sesión/harness separada.

### Modo autónomo

- Implementa código y documentación directamente.
- Lee este archivo primero, luego `AUTONOMOUS.md`, `SECURITY.md`, `ARCHITECTURE.md`, `ARCHITECTURE_FUTURE.md` y la fase específica en `FUTURE.md`.
- Si una fase tiene `modo = approval` o `modo = manual` y **no** existe aprobación manual general vigente, debe detenerse antes de editar y pedir confirmación.
- Si existe aprobación manual general vigente, solo debe detenerse por:
  - comandos bloqueados por `SECURITY.md`;
  - gasto externo / APIs billables / riesgo financiero;
  - research externo todavía no resuelto;
  - input o decisión humana realmente necesarios para continuar.
- Si una fase requiere comandos bloqueados por `SECURITY.md`, la aprobación de fase no levanta el bloqueo automáticamente. Debe existir instrucción explícita del usuario para esa acción.

## Reglas para ejecución agéntica

- La selección de fase sale solo de la tabla `Roadmap ejecutable`. `FUTURE.md` aporta detalle, no orden ni prioridad.
- Si `ROADMAP_CANONICAL.md` y `FUTURE.md` difieren en modo, orden, prerequisito o definición de listo, detenerse con `contradiccion-arquitectura` y corregir documentación antes de implementar.
- Cada fase debe ejecutarse con un "phase packet" mínimo:
  - `phase_id`, bloque y modo;
  - objetivo observable;
  - prerequisitos verificables;
  - archivos/secciones de contexto relevantes;
  - cambios permitidos y cambios prohibidos;
  - comandos permitidos y comandos bloqueados;
  - tests/invariantes obligatorios;
  - rollback o stop condition.
- Las fases grandes deben partirse en sub-tareas si exceden el límite de diff del modo autónomo. No partir cambiando el orden canónico ni mezclando fases.

## Partición obligatoria de fases grandes

> Esta sección **no cambia el orden canónico** del roadmap. Solo define cómo ejecutar sin desbordar alcance cuando una fase es demasiado grande para una sola implementación segura.

### Límites operativos

Si una implementación prevista supera cualquiera de estos umbrales, la fase **debe** partirse antes de tocar código:

- más de `12` archivos de código modificados;
- más de `600` líneas netas de diff estimadas;
- más de `3` módulos/áreas (`src/`, `api/`, `ui/`, `config/`, migraciones) en la misma sesión;
- mezcla simultánea de `schema DB + backend + UI` en una sola ejecución.

Si el agente descubre esto a mitad de trabajo, debe detenerse al cerrar el primer sub-bloque coherente, verificar y actualizar `context/` antes de seguir.

### Sub-paquetes internos fijos

Estas fases no deben ejecutarse “enteras de una” aunque sigan siendo una sola fase canónica:

- **Fase 23 — Core automation**
  - `23A`: boot, crash recovery, lectura de config y recálculo de `scheduled_for`
  - `23B`: polling / `LISTEN pg_notify` / transición de runs
  - `23C`: observabilidad mínima (`active run`, status, logs básicos) y tests

- **Fase API**
  - `APIA`: esqueleto Fastify, plugins, auth, `/health`
  - `APIB`: `lead_dashboard` + `/leads*`
  - `APIC`: `/outreach*`
  - `APID`: `/pipeline*`, `/discovery*`, admin read-only que no dependan de tablas futuras
  - `APIE`: matriz completa de auth + cierre documental

- **UI base**
  - `UIA`: Lead Explorer
  - `UIB`: Lead Detail
  - `UIC`: Outreach Tracker
  - `UID`: Segment Explorer

Cada sub-paquete conserva el mismo `phase_id` canónico y debe dejar una verificación cerrada antes del siguiente.

## Roadmap ejecutable

> Esta tabla es la **única fuente de selección de fase** para modo autónomo y plan master.
> Si un item no aparece acá, no se ejecuta. Para item 35 (IMM) el agente autónomo debe detenerse con `approval-required-fase-11-research` y esperar que el Tech Lead complete el research previo (Gemini DeepSearch). La antigua Fase 30 `DGI/BPS` quedó descartada permanentemente por decisión de producto/legal el 2026-05-18 y no forma parte del roadmap ejecutable. Las únicas decisiones arquitectónicas fuera del roadmap viven en `FUTURE.md § Fases postpuestas` (Fase 32, 34, items eliminados del modelo) — no son fases ejecutables.

| Orden | Bloque | Fase | Modo | Definición de listo |
|---:|---|---|---|---|
| 0 | Backup | Fase 49 | autonomous + manual-cron | `scripts/backup.sh` existe, corre, valida gzip y tamaño. Cron se instala con comando no interactivo o queda documentado como pendiente manual. |
| 1 | Schema aditivo | Fase 22-pre | autonomous | Columnas `scoring_version`, `contact_ready`, `prospect_score_v1`, `score_breakdown_v1` creadas/backfilled. |
| 2 | Infra DB | Fase 21 | approval | PostGIS local habilitado, `gps` backfilled solo desde fuentes con lat/lng confiable. MINTUR no cuenta como GPS confiable. |
| 3 | Migración destructiva | Fase 47 | approval | Backup pre-fase verificado, `inferred_state` migrado a columna e índices, path viejo eliminado de `digital_footprint` por lotes. |
| 4 | Calidad contacto | Fase 15 | autonomous | Email quality, MX check y phone type actualizan `contact_reliability_score` sin re-score masivo. |
| 5 | Dedup futuro | Fase 6A | approval | Inserts nuevos usan cross-source dedup con guardas por fuente, niche, ciudad/dirección y GPS cuando exista. |
| 6 | Dedup retroactivo | Fase 6B | manual/approval | Reconciliación sobre datos locales existentes con reporte previo de matches esperados. No ejecuta discovery real en autónomo. |
| 7 | Scoring v2 eval | Fase 22-eval | approval | Reporte v1/v2 sobre gold set y snapshot real aprobado por Nicolás. No persiste cambios. |
| 8 | Scoring v2 apply | Fase 22 | approval | Backup, guardar v1, aplicar fórmula v2, un solo `score --all`, invariantes v2 en 0. |
| 9 | API schema | Fase API-0 | approval | `users`, `pipeline_runs`, `pipeline_config`, `discovery_jobs`, `audit_log`, `lead_outreach`, `contacted_by` con schemas completos. |
| 10 | Core automation | Fase 23 | autonomous + dependency-approval | `src/start.ts` existe, `src/` consume `pipeline_runs`/`discovery_jobs`, escucha `pg_notify`, pollea pendientes y recalcula `scheduled_for`. No ejecuta discovery real en autónomo. |
| 11 | API server | Fase API | autonomous + dependency-approval | Fastify con auth/RBAC, endpoints reales para `/api/v1/outreach*` y `/api/v1/leads*`, `lead_dashboard` VIEW, filtros componibles y matriz completa de tests de autorización. `/api/v1/campaigns*` queda como stub 501 hasta Fase 43. Dependencias nuevas requieren aprobación. |
| 12 | Admin MVP UI | Admin MVP UI | autonomous + dependency-approval | User Management, lead_filter, Health read-only y Audit Log Viewer consumen API real. Cost/performance/restart quedan fuera. |
| 13 | Scraping hardening | Fase 46 | approval | Rate limit/backoff/UA/fallback para Yelu, PedidosYa y social-enrich antes de producción. Cualquier stealth/proxy requiere aprobación explícita separada. |
| 14 | Producción | Fase 48 | manual/approval | HTTPS, pm2, Nginx, rate limiting y procesos `api`/`core` corriendo. |
| 15 | Webhook notificaciones externas | Fase 39 | autonomous | `pipeline_config.notify_webhook_*` columnas existen desde Fase API-0. Implementar `notifyWebhook()` con HMAC-SHA256, persistir `pipeline_runs.webhook_status`, UI Pipeline Manager expone campo de config + botón "probar webhook". Útil para Slack/n8n/Make. Modo `autonomous` porque endpoints externos son configuración del admin, no llamadas de pago. |
| 16 | Outreach feedback loop | Fase 25 | autonomous | Tabla `lead_outreach` ya existe (creada en Fase API-0). Esta fase agrega: trigger de `leads.contacted_by` al primer outreach del lead, CLI `blindspot outreach --stats` y verificación end-to-end del flujo (lead → outreach → status). |
| 17 | LLM usage log schema | Fase 44-pre | autonomous | Tabla `llm_usage_log` creada con índices. Prerequisito de Fase 26, Fase 44 y Cost Dashboard. |
| 18 | Offers LLM | Fase 26 | dependency-approval | LLMProvider con fallback a templates y logging en `llm_usage_log`. Modelo/precios se revalidan al implementar; no hardcodear proveedor obsoleto. |
| 19 | Service pricing | Fase 27 | autonomous | `service_pricing` por usuario, seed para admin inicial, hook documentado para CMs nuevos, y uso en generación de ofertas. |
| 20 | PedidosYa escape segment | Fase 13 | autonomous | `commission_estimate` en buyer_type `delivery_propio` usa `service_pricing.delivery_system` para calcular ROI real. Pitch "independizate de PedidosYa" disponible en generación de ofertas. Requiere Fase 27 (service_pricing seed `delivery_system`) + buyer_type_scores estables. |
| 21 | UI base | UI base | autonomous + dependency-approval | Lead Explorer, Lead Detail, Outreach Tracker y Segment Explorer consumen API real. Atribución OSM visible cuando hay leads con `source='osm'`. |
| 22 | Pipeline Manager UI | Pipeline Manager UI | autonomous + dependency-approval | Pantalla `/pipeline` (config + ejecución + historial + monitor activo + dry-run + abort + pause-phase) consume API. Sin Cost Dashboard ni restart todavía. |
| 23 | Discovery Control Center UI | Discovery CC UI | autonomous + dependency-approval | Pantalla `/discovery` (cola, zonas sugeridas, zonas stale, gap analysis) consume API. Sin ejecutar discovery real en autónomo. |
| 24 | Batch discovery multi-ciudad | Fase 24 | autonomous | CLI `discover-external --location-list <list>` o `--location-list-file config/locations.yaml`. Integración con `pipeline_runs` — cada ciudad es sub-job con progreso propio. UI Discovery CC consume los sub-jobs como cola normal. Quality-of-life: ejecuta cola ya existente, no inventa fuentes nuevas. |
| 25 | Budget tracker Google Places | Fase 44 | autonomous | `google_places_budget_spent` se incrementa por run real, con backfill inicial del gasto histórico ya realizado, y badge UI alerta cuando `budget_remaining < alert_threshold`. |
| 26 | Cost Dashboard UI | Cost Dashboard UI | autonomous + dependency-approval | Pantalla `/admin/costs` consume `/api/v1/admin/costs/overview` y `/history`. Por mes, por fuente, por lead. |
| 27 | Pipeline errors schema | Fase 45-pre | autonomous | Tabla `pipeline_errors` creada con índices. Prerequisito de Fase 45 y Performance Dashboard. |
| 28 | Change detection | Fase 45 | autonomous | `diffFootprint` activo en re-enrich, persiste `digital_footprint.last_change_diff`, re-score automático en cambios críticos. |
| 29 | Performance Dashboard UI | Performance Dashboard UI | autonomous + dependency-approval | Pantalla `/admin/performance` consume `/api/v1/admin/performance/*`. Errores recientes, calidad de datos, tasa de éxito por fuente. |
| 30 | Restart actions UI + endpoints | Restart Actions | autonomous + dependency-approval | `POST /api/v1/admin/system/restart-{core,api}` implementados con códigos tipados; UI Health expone los botones con confirmación. Solo activos cuando `NODE_ENV='production'` (post-Fase 48). En dev devuelven 501. |
| 31 | Cleanup snapshots v1 | Cleanup v1 | manual/approval | `ALTER TABLE leads DROP COLUMN prospect_score_v1, DROP COLUMN score_breakdown_v1` con backup previo. El admin decide cuándo; no antes de validar v2 en 30+ días de operación o cuando Health muestre la alerta `scoring_v1_columns_present`. |
| 32 | Full-text search | Fase 40 | autonomous | `search_vector` generated column + GIN index + endpoint `?q=` + barra de búsqueda en Lead Explorer con FTS rank. |
| 33 | Sub-niche detection | Fase 28 | dependency-approval | LLMProvider clasifica leads `niche='other'` en sub-niches; `lead_company_data.detected_sub_niche` poblado y consumible por `lead_filter`. Requiere Fase 26. |
| 34 | MINTUR TipoOperador extraction | Fase 29 | autonomous | Parser extrae `TipoOperador` de `source_data` MINTUR a `lead_company_data.tipo_operador`. Índice `((lead_company_data->>'tipo_operador'))`. Sub-segmenta los 2027 MINTUR (hotel / restaurante / spa / etc) — complementa Fase 28 para leads MINTUR sin sub-niche. NO extrae RUT (MINTUR no expone público). |
| 35 | IMM Habilitaciones provider | Fase 11 | approval + research | Provider scraping CSV Montevideo (negocios habilitados activos). **Prerequisito: Gemini DeepSearch confirmar licencia + endpoint + frecuencia (manual Tech Lead).** Confianza base 0.75. Implementar IDiscoveryProvider con tests fixture. NO ejecutar discovery real en autónomo. |
| 36 | Cruce MINTUR × IMM | Fase 18 | autonomous | Script join por nombre normalizado + dirección entre MINTUR y IMM. Para cada match, copia phone de IMM a `canonical_fields.phone` del lead MINTUR. Desbloquea ~1600 leads MINTUR sin teléfono (96% del dataset). Requiere Fase 11 aplicada. |
| 37 | Geo-dedup | Fase 38 | autonomous | `findCrossSourceMatch` v2 con filtro Haversine antes del threshold de nombre. Requiere Fase 21 (GPS). |
| 38 | canonical_source | Fase 37 | autonomous | `ALTER TABLE leads ADD COLUMN canonical_source text`. Calculado al reconciliar `canonical_fields`: fuente con mayor `source_confidence` entre primaria y corroborantes. `lead_dashboard` expone el campo. Backfill: `UPDATE leads SET canonical_source = source WHERE canonical_source IS NULL`. Refinamiento dedup junto a Fase 38. |
| 39 | Outreach campaigns | Fase 43 | autonomous + dependency-approval | Tabla `outreach_campaigns`, `lead_outreach.campaign_id` añadida, endpoints `/api/v1/campaigns*` pasan de stub 501 a implementación real, UI Outreach Tracker integra selector de campaña activa. |
| 40 | days_in_pool scoring | Fase 36 | autonomous | `score_breakdown.days_in_pool` persistido. `computeTimingFactor` incluye fresh_bonus (+0.05 si <7d) y stale_penalty (-0.05 si >90d). Config en `scoring.yaml → commercial_score.timing.days_in_pool`. Refinamiento post-60-días de operación con Fase 22. |
| 41 | owner_group_id | Fase 41 | autonomous | `ALTER TABLE leads ADD COLUMN owner_group_id uuid`. Detección post-enrich: leads con mismo phone canónico O email canónico → mismo `owner_group_id`. API `GET /leads/:id/owner-group` lista hermanos. UI Lead Detail muestra badge "N negocios del mismo propietario". |
| 42 | Scoring estacional | Fase 42 | dependency-approval | `seasonal_modifiers` en `config/scoring.yaml`. `score_breakdown.seasonal_note` persistido. UI Lead Explorer sort secundario por relevancia estacional. Requiere data de conversión por estación (≥30 outreach cerrados en al menos 2 estaciones) — Tech Lead valida antes de aprobar. |
## Criterio obligatorio para Scoring v2

Antes de aplicar Fase 22 debe existir un reporte con:

- Distribución v1 vs v2 por fuente, niche y contact_tier.
- Top 50 leads v1 y top 50 v2 comparados.
- Conteo de tier X con `prospect_score >= 55`: debe ser menor a 5.
- Porcentaje de leads con `prospect_score = 100`: debe ser `< 5%` del pool activo. Si lo supera, recalibrar antes de aplicar Fase 22.
- Franquicias promedio: debe bajar por debajo de 20 salvo excepciones justificadas.
- Car dealers promedio: debe subir por encima de 40 si tienen contacto.
- 30–50 leads conocidos revisados manualmente con expected tier/ranking.

Sin ese reporte aprobado, Fase 22 no se ejecuta.

## Criterio obligatorio para Fase API

Antes de cerrar Fase API deben existir tests automatizados para la matriz de autorización:

- Admin puede listar/ver todo.
- CM con `lead_filter IS NULL` falla cerrado.
- CM con `lead_filter = '{}'` solo se crea/actualiza si el body incluye `acknowledge_unrestricted: true`. Sin el flag, 400 con `error_code='lead_filter_empty_requires_ack'`.
- CM solo ve la intersección entre su `lead_filter` y los filtros del request.
- `GET /api/v1/leads/:id` devuelve `404` si el lead está fuera del filtro del CM.
- CM solo puede leer/modificar su propio `lead_outreach`. (La tabla `lead_outreach` se crea en Fase API-0 con schema canónico — esta matriz es ejecutable desde Fase API sin esperar a Fase 25.)
- **Live update de `lead_filter`:** admin cambia `lead_filter` de un CM vía `PATCH /api/v1/users/:id`; el siguiente request del CM (sin re-login, con el mismo JWT) ya devuelve resultados con el filtro nuevo. Test: crear CM con filtro F1, autenticar, listar leads → conjunto A. Admin PATCH a filtro F2. CM mismo token lista leads → conjunto B distinto de A según F2.
- Usuario `active=false` queda bloqueado inmediatamente aunque tenga JWT previo. Test: autenticar CM, admin desactiva, siguiente request del CM → 401 (o 403) sin esperar expiración.
- `POST /auth/refresh` verifica `users.active = true` antes de emitir un token nuevo. Si `active=false` → 401 con `error_code='account_inactive'`.
- Endpoints `/api/v1/users`, `/api/v1/admin/*`, config de pipeline y audit log son admin-only.
- Cambios admin escriben `audit_log` con `actor_user_id`, `action`, `target_type`, `target_id` y `diff`. Para el set canónico de `action` ver `FUTURE.md § Fase API-0 step 7`.
- `/api/v1/campaigns*` devuelve 501 con `error_code='not_implemented_until_phase_43'` (no falla la matriz — es stub esperado hasta Fase 43).

Sin esta matriz verde, no se construye UI sobre la API.

## Dependencias nuevas

`SECURITY.md` bloquea `pnpm add` sin aprobación. Toda fase que requiera paquetes nuevos debe listar el paquete y el motivo antes de instalarlo.

Paquetes probables, desglosados por workspace:

- `api/`: `fastify`, `@fastify/cors`, `@fastify/helmet`, `@fastify/rate-limit`, `bcrypt`, `jsonwebtoken` (o equivalente), **`cron-parser`** (para calcular `pipeline_config.scheduled_for` al recibir PUT/PATCH desde la UI).
- `src/` (core scheduler): `node-cron` (ejecuta el cron interno), **`cron-parser`** (recalcula `scheduled_for` al finalizar un run del cron — ver Fase 23). `cron-parser` aparece en ambos workspaces; se instala con `pnpm --filter api add cron-parser` y `pnpm --filter core add cron-parser` (cada `pnpm add` requiere aprobación explícita).
- `ui/`: Next.js, Tailwind, shadcn/ui, Zustand/SWR, MapLibre o Leaflet.
- Scraping hardening: cualquier stealth/proxy package requiere aprobación explícita separada.

## Decisiones cerradas (dormidas hasta que se agregue una fase explícita)

- **`competitive_pressure = 0` permanente en `timing_factor`.** Aunque PostGIS esté activo (Fase 21), `computeTimingFactor()` se implementa con `competitive_pressure` como parámetro con default 0. La señal geográfica requiere calibración y no se justifica en el modelo "uso interno". Para activarlo: agregar primero una fase nueva al `§ Roadmap ejecutable` (ej. "Fase XX — Geo-scoring activation") con criterios de calibración. **No confundir con Fase 38 (geo-DEDUP, item 37), que es deduplicación, no scoring.**
- **`prospect_score_v1` y `score_breakdown_v1` se eliminan en item 31 (Cleanup v1).** No buscar otra fase. El item 31 está en modo `manual/approval` — el admin decide cuándo, basado en la alerta operativa de Health (`scoring_v1_columns_present` cuando hayan pasado 30+ días de operación estable con v2).
- **Retención de logs sin auto-purga.** `audit_log`, `llm_usage_log` y `pipeline_errors` crecen sin política automática. Health expone contadores y emite warning cuando superan thresholds (ver `ADMIN_PANEL.md § Pantalla F`). El admin decide cuándo agregar particionamiento o purga manual.

## Archivos históricos

`context/prompts/` es archivo histórico. No ejecutar ni obedecer esos prompts salvo que Nicolás los pida explícitamente.
