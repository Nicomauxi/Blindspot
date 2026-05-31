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
- Todas las fases del ciclo 3 completadas al 2026-05-25. Ciclo 3 cerrado.
- UI-RESP-1 cerrado el 2026-05-25: max-width 1440px en layout, overflow-x-auto en todas las tablas (audit-log, users, discovery), grids responsivos en audit-log diff y segments.
- QUAL-1 cerrado el 2026-05-25: tabla `niche_aliases` + storage/niches + CRUD admin API + expansión automática en filtros de leads + sección Nichos en `/admin/performance`.
- El usuario adjuntó `context/prompts/deepsearch-discovery-places.md` como input aparte para generar el XLS que consume `DISC-10`.
- Ciclo 4 abierto el 2026-05-27 con 11 fases nuevas (MAP-5 → LEAD-6) cubriendo: unificación real de `Mapa de leads` y `Contexto y mapa`, zonas dinámicas, fix de filtros combinados con Playwright, flujo `Aplicar`, iconos por nicho, auditoría integral de mapas, limpieza de alertas en Inicio, importación XLS en Plataforma, discovery predictivo por zona/histórico, XLS semilla y filtro por tipo de oferta comercial.
- MAP-5 cerrado el 2026-05-26: `Mapa de leads` y `Contexto y mapa` montan wrappers por variante sobre `LocationDensityMapBase`; la serialización de selección/drilldown vive en helpers compartidos y ya hay test focalizado que lo prueba.
- MAP-6 cerrado el 2026-05-27: `/api/v1/admin/geo/zones` expone zonas estructuradas con prioridad catálogo + fallback derivado; `lead-density` y `zone-leads` comparten parser/serializador de filtros y ambas pantallas refetch drilldown cuando cambian filtros.
- MAP-7 cerrado el 2026-05-27: `Inicio` separa estado `draft`/`applied`, `LeadReviewMap` expone `Aplicar al listado`/`Cancelar`/`Limpiar`, y la lista embebida sólo cambia con filtros geográficos aplicados.
- MAP-8 cerrado el 2026-05-27: el modo individual usa iconos por niche/canonical niche persistidos localmente, elimina `Vista completa` y reemplaza la lista lateral por cards comerciales compactas con selector de icono cuando el rol puede editar.
- MAP-9 cerrado el 2026-05-27: auditoría triple documentada en `context/research/map-flow-audit.md`; se corrigieron el riesgo SSR de la base compartida en `next start` y los errores silenciosos de `lead-density`/`zone-leads`.
- UI-8 cerrado el 2026-05-27: Inicio ya no muestra el bloque hardcoded de alertas y la campanita global se mantiene como única entrada a alertas persistidas.
- DISC-12 cerrado el 2026-05-27: `/admin/imports` concentra upload, preview, confirmación, historial y catálogo activo; `audit_log` registra `discovery.places.import` y Discovery consume el catálogo en modo solo lectura.
- DISC-13 cerrado el 2026-05-27: el ranking predictivo ya vive en `src/modules/discovery/location-opportunity.ts` y se consume por `GET /api/v1/discovery/location-suggestions` con razones, confianza y métricas históricas explicables.
- DISC-14 cerrado el 2026-05-27: Composer y Creación masiva ya consumen `GET /api/v1/discovery/location-suggestions`, permiten revisar/deseleccionar sugerencias y persisten `predictive_context`/`suggestion_source` en batches y jobs bulk sin migración nueva.
- DISC-15 cerrado el 2026-05-27: el repo ya incluye un seed reproducible (`uruguay-location-seed.ts` + `.xlsx`), documentación de fuentes y validación de preview real contra el contrato de importación.
- LEAD-6 cerrado el 2026-05-27: `Lead Explorer` ya filtra y ordena server-side por `Tipo de oferta comercial`, reutiliza `commercial_offers_summary` como contrato compartido y valida el flujo con Vitest + build + Playwright.
- Todas las fases del ciclo 4 completadas al 2026-05-27. Ciclo 4 cerrado.
- No quedan fases `pending` en el roadmap canónico actual.
- UX de selección de locación unificada el 2026-05-28: nueva base compartida `DiscoveryLocationPicker` (`ui/src/components/discovery-location-picker.tsx`) + helpers centralizados (`ui/src/lib/discovery-location.ts`). Composer (single + fallback texto libre) y Creación masiva (multi, ubicaciones del catálogo × nichos) la reutilizan; se eliminó la grilla hardcodeada `BULK_CITIES`, los paneles predictivos duplicados y la sección `CatalogSection` standalone (plegada en el tab `Catálogo`). Sin cambios de backend ni de schema; contrato `predictive_context`/`recommendation_origin` preservado. Validado con typecheck (raíz + ui), `ui build`, unit tests nuevos (`tests/ui/discovery-location.test.ts`) y Playwright actualizado (`tests/e2e/discovery-predictive-flow.playwright.ts`).

**Lo que no hacer al retomar:**
- no revertir lógica CRM por "simplicidad" — está diseñada para escalar
- no correr discovery billable sin necesidad
- no agregar fases nuevas sin definirlas primero en FUTURE.md y ROADMAP_CANONICAL.md
- no cerrar `LEAD-5` sin las tres auditorías documentadas en `context/research/lead-5-audits.md`
- no importar dependencias nuevas (charts, markercluster, xlsx, mapbox) sin pedir aprobación explícita antes
- no ejecutar `UI-RESP-1` antes de cerrar todas las pantallas nuevas o modificadas del ciclo 3
- no volver a duplicar lógica entre `Mapa de leads` y `Contexto y mapa`; cualquier cambio de mapas del ciclo 4 debe pasar por la base compartida de `MAP-5`
- no aceptar filtro de zona manual como fuente primaria; usar zonas registradas con id estable
- no cerrar `MAP-6` sin Playwright para combinaciones de filtros
- no correr discovery real ni Google Places para probar el algoritmo predictivo; `DISC-13` y `DISC-14` se validan con histórico/catálogo/fixtures
- no cargar XLS de fuentes externas sin trazabilidad de origen y licencia razonable

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

**Ciclo 4 — gaps que cubre (snapshot al abrir 2026-05-27):**
- `Mapa de leads` y `Contexto y mapa` deben converger en un componente/base cartográfica única con variantes por contexto.
- El filtro `Filtrar zona` ya no puede ser manual; debe alimentarse de zonas registradas y mostrar jerarquía Departamento > Ciudad > Barrio.
- Los filtros actuales de mapas tienen regresión al combinarse; la corrección exige matriz Playwright y validación de counters/listas/markers.
- En `Mapa de leads`, seleccionar en mapa no debe filtrar `Leads para revisar` hasta confirmar con `Aplicar`.
- Los leads individuales deben abandonar visual de heatmap y pasar a iconos configurables por nicho, con card comercial estética y resumida.
- Inicio debe perder el bloque de alertas textual; las alertas reales quedan en campanita/página dedicada.
- Discovery necesita catálogo de lugares importado desde `Plataforma > Importación` y un ranking predictivo por zona/histórico para evitar búsquedas amplias tipo `Montevideo`.
- Se requiere XLS semilla trazable para poblar y probar la importación sin consumo billable.
- `Leads para revisar` y listados compatibles deben filtrar/ordenar por `Tipo de oferta comercial` (`Marketing` vs `Software`).

