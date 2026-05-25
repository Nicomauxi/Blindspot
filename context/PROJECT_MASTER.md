# Blindspot — Project Master

> Runbook operativo del repo para ejecución directa.
> Leer junto con `ROADMAP_CANONICAL.md`, `FUTURE.md`, `ARCHITECTURE.md`,
> `ARCHITECTURE_FUTURE.md`, `ARCHITECTURE_FRONTEND.md`, `ADMIN_PANEL.md`
> y `SECURITY.md` al iniciar una sesión de implementación.
>
> Si se adjunta este archivo solo, la intención es retomar el estado descrito al final.

---

## Objetivo del producto

Blindspot es una herramienta interna para detectar, enriquecer, priorizar y operar
leads de negocios locales con brechas digitales. Hoy ya cuenta con pipeline,
API, UI admin, backups y restauración. El foco actual es elevar la operación,
la observabilidad, la UX de discovery y convertir el seguimiento comercial en un
CRM real con feedback humano estructurado.

## Modelo de uso vigente

- 1 admin principal
- 2–8 usuarios comerciales
- repo único: `src/`, `api/`, `ui/`
- dos procesos de aplicación: `api` y `core`
- Supabase local como entorno operativo base

## Principios de ejecución actuales

1. El roadmap vigente es el de `ROADMAP_CANONICAL.md`.
2. La planificación detallada por fase está en `FUTURE.md`.
3. La ejecución por defecto es directa/autónoma, no handoff a otra sesión.
4. No rehacer la remediación ya cerrada salvo evidencia de regresión real.
5. Mantener fases chicas, verificables y con contexto sincronizado.
6. No revertir ni pisar cambios ajenos del worktree; si la próxima fase entra en conflicto real con trabajo existente, resolver primero el conflicto o detenerse con contexto claro.

## Snapshot funcional actual

### Ya implementado

- baseline DB reproducible y migraciones ordenadas
- API Fastify con auth/RBAC y pantallas admin operativas
- backups manuales y programados desde UI
- restore administrativo con checkpoint previo
- páginas admin actuales: leads, lead detail, outreach, discovery, pipeline, backups, costs, performance, health, users, audit log, help
- pipeline core persistente con polling/listener/scheduler
- repoblación reciente por discovery completada sobre la base actual

### Gaps principales del programa vigente

- monitoreo fragmentado entre health/system/costs/performance
- monitoreo fragmentado entre health/system/costs/performance
- no hay dark mode
- density map ya usa cuadrículas granulares con geocoding on-demand y metadata de backlog
- backup policy ya separa retención manual vs scheduled y expone métricas de capacidad
- discovery workspace todavía tiene deuda de UX y orquestación
- MINTUR sigue aportando demasiado `other`
- no existe feedback humano estructurado sobre calidad de datos
- el flujo comercial sigue modelado alrededor de campañas/outreach y no de un CRM de seguimiento

## Orden de lectura por área

- Navegación, theme, discovery y CRM UI: `ARCHITECTURE_FRONTEND.md`
- Monitoreo, backups y CRM admin: `ADMIN_PANEL.md`
- Cambios de datos o modelos nuevos: `ARCHITECTURE_FUTURE.md`
- Estado real implementado: `ARCHITECTURE.md`

## ESTADO DE SESIÓN

**Fecha:** 2026-05-23

**Contexto sincronizado:** sí, `CTX-0` completo.

**Snapshot operativo conocido:**
- remediación integral cerrada
- backup/restore ya operativos
- discovery reciente terminado con base repoblada
- enrich parcial, no bloqueante para este programa de mejoras
- `NAV-1` cerrado: sidebar admin con grupos colapsables, buscador, iconografía consistente y fix de keys duplicadas en health
- `THEME-1` cerrado: dark mode admin con toggle persistido, tokens compartidos y shell/superficies críticas cubiertas
- `MON-1` cerrado: contrato backend `admin/monitoring/overview` agregado sin romper endpoints legacy; smoke API sigue fallando por `backup_restore_failed` ya presente en health
- `MON-2` cerrado: nueva pantalla `Monitoreo` consume el contrato unificado y `/admin/health` queda como alias por redirect
- `BKP-1` cerrado: retención manual/programada separada, métricas de capacidad visibles y tamaño de DB expuesto en backups/monitoreo
- `DISC-1` cerrado: composer persistente, nichos sugeridos con breakdown por fuente y jobs legacy retirados de la experiencia principal
- `MINTUR-1` cerrado: el provider usa `TipoOperador`/`Operador` para mapear niches canónicos y reducir `other`
- `DISC-3` cerrado: Lead Explorer puede encolar enrichment por colección filtrada con límite operativo, filtros aprobados y run trazable propio
- `FDBK-1` cerrado: existe persistencia de feedback por lead/campo, API de create/list/summary y auditoría en `audit_log`
- `FDBK-2` cerrado: UI de feedback en Lead Detail — controles por campo, resumen de actividad, registro de veredicto; cliente en `ui/src/lib/api.ts` y helpers en `ui/src/lib/lead-feedback.ts`
- `FDBK-3` cerrado: consumo operativo — `GET /leads/:id/feedback-adjusted-confidence` expone scores ajustados por feedback usando helper `src/modules/feedback/summary.ts`; documentado qué usa y qué no usa feedback todavía

**Programa activo:**
- `CTX-0` done
- `NAV-1` done
- `THEME-1` done
- `MON-1` done
- `MON-2` done
- `BKP-1` done
- `DISC-1` done
- `MINTUR-1` done
- `MAP-1` done
- `DISC-2` done
- `DISC-3` done
- `FDBK-1` done
- `FDBK-2` done
- `FDBK-3` done
- `CRM-1` cerrado: tablas `lead_tracking` y `lead_tracking_events` con 6 estados canónicos, unique parcial para tracking activo, FK nullable a `outreach_campaigns` como puente — estructuras viejas intactas
- `CRM-2` cerrado: API completa de tracking — POST create, GET list/detail, POST transition, POST note; RBAC admin/CM; auditoría
- `CRM-3` cerrado: board UI por estado, nav CRM, botón "Iniciar seguimiento" en lead detail
- `CRM-4` cerrado: modal de detalle con timeline de eventos, notas standalone, controles ricos por tipo de transición (canal, recordatorio, notes recomendadas para terminal states), shortcut "Sin canal"

**Programa activo:**
- Ciclo 2 completado (2026-05-23/24): UI-2, UI-1, NAV-2, THEME-2, MON-3, MON-4, OPS-1, PIPE-1, PIPE-3, PIPE-2, CRM-5, DISC-4, DISC-5, DISC-6 — todos done
- Snapshot 2026-05-24: sistema estable, roadmap canónico sin fases pendientes

**Cambios del ciclo 2:**
- PIPE-2: incremento atómico de budget GP via RPC PostgreSQL, race condition eliminada
- CRM-5: drag & drop en board (dnd-kit), popup con datos del lead, card título = nombre real, enriquecimiento de GET /tracking con JOIN a leads
- DISC-4: location subdivider para Montevideo y otras ciudades UY, fetchPlaceCandidates paraleliza sub-áreas y deduplica por placeId
- DISC-5: geo-validator con bounding box Uruguay + departamentos, campo lat/lng/geo_suspect/departamento en PlaceCandidate, places.location en field mask
- DISC-6: endpoint POST /discovery/jobs/bulk + bulkInsertDiscoveryJobs + UI creación masiva con ciudades × nichos predefinidos
- RBAC-1: datos de contacto redactados server-side para `cm` hasta iniciar tracking propio; Lead Detail muestra unlock explícito y refresca el detalle al abrir seguimiento
- MAP-2: `lead-density` ahora agrega por cuadrículas, geocodea direcciones sin GPS con Nominatim + cache local y Discovery UI expone métricas separadas de GPS real vs inferido
- MAP-3: el heatmap acepta filtros server-side (`source`, `niche`, `prospect_score_gte`, `contact_tier`, `gps_source`) y la UI aplica debounce de 300ms con contador de leads filtrados/posicionados

**Siguiente paso:**
- Ciclo 3 abierto el 2026-05-24 con 35 fases nuevas (BUG-1 → UI-RESP-1) cubriendo: bugfixes urgentes, pantalla Operaciones unificada con Variables/Procesos, refresh masivo de leads, optimización de discovery + hard cap del budget GP, mapa heatmap granular con filtros, limpieza UI deprecated, sistema de alertas, mejoras CRM + RBAC de contacto, rediseño completo de la ficha de Lead con auditoría triple, aliasing de nichos y responsive global.
- Próxima fase pendiente en el orden canónico: `MAP-4` (modo individual por zona en el mapa).
- El usuario adjuntó `context/prompts/deepsearch-discovery-places.md` como input aparte para generar el XLS que consume `DISC-10`.

**Lo que no hacer al retomar:**
- no revertir lógica CRM por "simplicidad" — está diseñada para escalar
- no correr discovery billable sin necesidad
- no agregar fases nuevas sin definirlas primero en FUTURE.md y ROADMAP_CANONICAL.md
- no cerrar `LEAD-5` sin las tres auditorías documentadas en `context/research/lead-5-audits.md`
- no importar dependencias nuevas (charts, markercluster, xlsx, mapbox) sin pedir aprobación explícita antes
- no ejecutar `UI-RESP-1` antes de cerrar todas las pantallas nuevas o modificadas del ciclo 3

**Ciclo 3 — gaps que cubre (snapshot al abrir):**
- bug: Budget GP spent muestra 0 en lugar del valor real
- Pipeline y Monitoreo viven como pantallas separadas, sin variables ni vista de procesos en vivo
- Discovery permite crear jobs pero no refrescar/re-enriquecer leads existentes ni traer datos de Google Places sobre leads viejos
- mapa de densidad ya usa cuadrículas granulares con geocoding on-demand, filtros server-side/UI (`MAP-3`) y cache local; queda pendiente el modo individual (`MAP-4`)
- home muestra alertas hardcoded y bloques poco accionables; falta sistema de alertas persistido con campanita y counter
- CRM ya tiene transiciones bidireccionales, historial, filtros y gating server-side de contacto para `cm`; queda pendiente embebido de contacto en popup (`CRM-9`)
- ficha de Lead mezcla técnico y comercial; no diferencia ofertas de software vs marketing; el feedback humano está separado del dato que valida; bloques deprecated siguen visibles
- nichos divergen por sinónimos sin forma de unirlos
- no hay garantía de responsive en todo el admin
