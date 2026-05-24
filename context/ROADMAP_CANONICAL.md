# Blindspot — Roadmap Canonical

> Fuente canónica de ejecución para el programa de mejoras vigente desde 2026-05-22.
> Si este archivo contradice `FUTURE.md`, `PROJECT_MASTER.md`, `AUTONOMOUS.md`,
> `ARCHITECTURE.md`, `ARCHITECTURE_FUTURE.md`, `ARCHITECTURE_FRONTEND.md` o
> `ADMIN_PANEL.md`, este archivo gana.
>
> Contexto actual: la remediación integral ya dejó baseline reproducible, API/UI
> operativas, backups/restores administrativos y una base repoblada por discovery.
> El trabajo pendiente ya no es “rescatar” el sistema sino llevarlo a una versión
> más operable, coherente y usable en profundidad.

---

## Estado base asumido

- Repo único con tres workspaces: `src/` (core pipeline), `api/` (Fastify), `ui/` (Next.js).
- Dos procesos de aplicación: `api/` y `src/`, coordinados solo por PostgreSQL.
- Supabase local es la base operativa actual.
- Backups manuales, programados y restore desde UI ya existen.
- Discovery Control Center, Pipeline, Backups, Leads, Outreach, Costs, Performance,
  Users y Audit Log ya existen en la UI admin.
- El estado actual de datos puede variar; la planificación no depende de un volumen fijo.

## Reglas no negociables

1. Ejecutar una sola fase canónica por iteración.
2. Antes de tocar código, leer `AUTONOMOUS.md`, `FUTURE.md`, `ARCHITECTURE.md` y el documento de arquitectura específico del área (`ARCHITECTURE_FRONTEND.md`, `ADMIN_PANEL.md`, `ARCHITECTURE_FUTURE.md`).
3. No usar discovery real billable ni scraping externo pago para validar una fase salvo que sea estrictamente necesario y exista instrucción explícita del usuario.
4. No ejecutar acciones destructivas sobre DB sin backup verificable previo.
5. Las migraciones nuevas deben ser aditivas por defecto. Si una fase requiere reemplazar algo existente, introducir primero compatibilidad o puente y postergar la eliminación a una fase explícita posterior.
6. Toda fase debe cerrar con validación real acorde al área tocada y actualización de `context/`.
7. Si una fase exige una dependencia nueva, pedir aprobación antes de escribir código que la importe.
8. Si una fase supera alguno de estos límites, partirla antes de implementarla:
   - más de `12` archivos de código modificados;
   - más de `600` líneas netas estimadas;
   - mezcla simultánea de `schema DB + backend + UI` sin una necesidad estricta.

## Modos

- `autonomous`: el agente puede analizar, implementar, verificar y seguir a la siguiente fase.
- `dependency-approval`: la fase es autónoma salvo por dependencias nuevas.
- `destructive-approval`: la fase es autónoma salvo por acciones destructivas reales sobre datos.
- `manual-input`: la fase requiere input humano real y se debe detener.

## Roadmap ejecutable

| Orden | Bloque | Fase | Modo | Definición de listo |
|---:|---|---|---|---|
| 0 | Contexto | CTX-0 | complete | Contextos sincronizados con el programa actual de mejoras y loop autónomo listo. |
| 1 | Navegación | NAV-1 | autonomous | Sidebar con grupos colapsables colapsados por defecto, buscador superior, iconografía consistente y fix del warning de keys duplicadas. |
| 2 | UX base | THEME-1 | autonomous | Dark mode funcional en dashboard admin con tokens compartidos, persistencia y contraste validado. |
| 3 | Monitoreo | MON-1 | autonomous | Contrato backend unificado para monitoreo (`monitoring`) definido e implementado sin romper compatibilidad actual. |
| 4 | Monitoreo | MON-2 | autonomous | Pantalla `Monitoreo` tipo observabilidad unificada reemplaza la dispersión actual de Health/estado, con logs y métricas operativas claras. |
| 5 | Backups | BKP-1 | autonomous | Retención separada para backups manuales y programados, peso actual de DB expuesto y UI/admin coherentes. |
| 6 | Discovery UX | DISC-1 | autonomous | Workspace de discovery mejora ergonomía: detalles por fuente en hover, composer persistente, lista lateral limitada con scroll/filtros y sin `jobs legacy`. |
| 7 | Discovery Data | MINTUR-1 | autonomous | Lógica de nichos MINTUR mejorada, baja el bucket `other` y quedan tests de parser/mapeo sólidos. |
| 8 | Geografía | MAP-1 | dependency-approval | El mapa de densidad comercial usa un mapa real del mundo por ubicación, con atribución correcta y contratos backend/UI estables. |
| 9 | Discovery Orchestration | DISC-2 | autonomous | Composer puede encadenar discovery + enrichment mediante toggle default-on, con estado claro por batch/job. |
| 10 | Discovery Enrichment | DISC-3 | autonomous | Existe un flujo dedicado para enriquecer colecciones de leads por filtros relevantes desde la UI admin. |
| 11 | Feedback | FDBK-1 | autonomous | Schema y API de retroalimentación de calidad de datos por lead disponibles con auditoría y RBAC. |
| 12 | Feedback | FDBK-2 | autonomous | Lead Detail permite marcar datos buenos/malos con contexto operativo claro. |
| 13 | Feedback | FDBK-3 | autonomous | El sistema consume feedback humano en agregados/reglas operativas sin romper scoring ni enriquecimiento existentes. |
| 14 | CRM | CRM-1 | autonomous | Modelo de datos CRM propio y puente con campañas existentes listos sin pérdida de historial. |
| 15 | CRM | CRM-2 | autonomous | API/RBAC/audit del nuevo seguimiento CRM implementados; `iniciar campaña` deja paso a `iniciar seguimiento`. |
| 16 | CRM | CRM-3 | autonomous | Pantalla CRM tipo board móvil estilo Jira, con cards por etapa y permisos correctos. |
| 17 | CRM | CRM-4 | autonomous | Modal/flujo completo por card: notas, archivos, canal exitoso, observado con recordatorio, rechazado y aceptado. |
| 18 | UI deuda | UI-2 | autonomous | Página y entrada de sidebar "Campañas/Outreach" eliminada; solo queda CRM como interfaz de seguimiento comercial. |
| 19 | UI deuda | UI-1 | autonomous | Lista de batches recientes en Discovery tiene scrollbar y altura máxima para no desbordar la vista. |
| 20 | Navegación | NAV-2 | autonomous | Al navegar a una sección del sidebar, las otras secciones se colapsan automáticamente; solo la activa permanece expandida. |
| 21 | UX base | THEME-2 | autonomous | Botón flotante de cambio de tema (oscuro/claro) en esquina inferior derecha; solo ícono, sin texto; reemplaza el control previo. |
| 22 | Monitoreo | MON-3 | autonomous | Sección "Estado del run" movida de Pipeline a Monitoreo con polling real de 5 s y logs en vivo; Pipeline solo configura y dispara. |
| 23 | Monitoreo | MON-4 | autonomous | Monitoreo muestra lista de discovery jobs por estado (queued/running/completed/failed) con conteos y detalle operativo. |
| 24 | Operaciones | OPS-1 | autonomous | Botones de acciones del sistema en Monitoreo: reiniciar API/core desde UI; reset-db solo para admin con confirmación explícita. |
| 25 | Pipeline | PIPE-1 | autonomous | Budget GP (total mensual y gasto actual) visible y editable desde Pipeline UI; sin salir al CLI. |
| 26 | Pipeline | PIPE-3 | autonomous | `max_jobs` del pipeline configurable desde Pipeline UI; campo validado con mínimo 1 y máximo razonable. |
| 27 | Pipeline | PIPE-2 | autonomous | Decremento atómico del Budget GP en DB al completar cada job; race condition entre jobs paralelos eliminada. |
| 28 | CRM | CRM-5 | dependency-approval | Board CRM con drag & drop entre columnas; clic en card abre popup con detalle del lead y controles de transición; título de card = nombre del lead. |
| 29 | Discovery | DISC-4 | autonomous | Algoritmo de búsqueda de lugares subdivide ubicaciones grandes en sub-áreas, lanza multi-query y deduplica por `placeId`. |
| 30 | Discovery | DISC-5 | autonomous | Algoritmo de georreferenciación valida que GPS esté dentro de los límites del país/departamento e infiere departamento desde nombre o coordenadas. |
| 31 | Discovery | DISC-6 | autonomous | Creación masiva de jobs desde UI: selector de ciudad × nicho predefinido, estimación de costo total antes de confirmar, inserción en lote. |

### Ciclo 3 — Mejoras operativas y comerciales (abierto 2026-05-24)

| Orden | Bloque | Fase | Modo | Definición de listo |
|---:|---|---|---|---|
| 32 | Bugfix | BUG-1 | autonomous | Budget GP `spent` se calcula y persiste correctamente; backfill reproducible documentado. |
| 33 | Bugfix | BUG-2 | autonomous | Card "Discovery en cola" en home muestra el `budget_remaining` real (depende: BUG-1). |
| 34 | Operaciones | OPS-2 | autonomous | Pantalla `/admin/operations` con secciones colapsables Pipeline y Monitoreo reusando JSX existente; pantallas viejas eliminadas. |
| 35 | Operaciones | OPS-3 | autonomous | "Enrichment de colección" migrado a Operaciones con filtros combinables; sale del home. |
| 36 | Operaciones | OPS-4 | autonomous | Apartado "Variables" en Operaciones edita config runtime (cron, max_jobs, budget, webhook, etc.) con auditoría. |
| 37 | Operaciones | OPS-5 | dependency-approval | Apartado "Procesos" con hilos, consumo CPU/MEM, logs en vivo y gráficos tipo grafana. Requiere librería de charts si no hay. |
| 38 | Discovery UX | DISC-7 | autonomous | "Creación masiva" debajo de "Composer" en Discovery. |
| 39 | Discovery | DISC-8 | autonomous | Refresh masivo de leads en Discovery con filtros lógicos + `missing_*`. Reusa endpoint enrichment filter-jobs. |
| 40 | Discovery | DISC-9 | autonomous | Refresh permite modo re-discovery (Google Places Details) además de enrichment. |
| 41 | Discovery | DISC-10 | dependency-approval | Importación de XLS con catálogo de lugares; aparece como recomendaciones en composer. |
| 42 | Discovery | DISC-11 | autonomous | Optimización del costo USD por lead nuevo de Google Places, con A/B controlable via Variables. |
| 43 | Pipeline | PIPE-4 | autonomous | Hard cap mensual del Budget GP: imposible superar, validado en UI, API y core. |
| 44 | Pipeline | PIPE-5 | autonomous | Concurrencia configurable por run con perfiles de consumo (fijo o % RAM). |
| 45 | Geografía | MAP-2 | dependency-approval | Mapa heatmap granular por barrio/cuadrícula, con geocoding de leads con address pero sin gps. |
| 46 | Geografía | MAP-3 | autonomous | Filtros del mapa: source, niche, score, tier, gps_source. |
| 47 | Geografía | MAP-4 | dependency-approval | Mapa con modo dual heatmap / leads individuales con clustering. |
| 48 | UI limpieza | UI-3 | autonomous | Eliminar referencias UI visibles a Campañas (home, lead detail, help, login). |
| 49 | UI limpieza | UI-4 | autonomous | Sacar alerta "Presupuesto Google Places" del home. |
| 50 | UI limpieza | UI-5 | autonomous | Sacar "Colas de trabajo" del home. |
| 51 | UI nuevo | UI-6 | autonomous | Reemplazar bloques eliminados del home (UI-4 + UI-5) por el mapa interactivo MAP-4 como filtro vivo. |
| 52 | UI limpieza | UI-7 | autonomous | Sacar de la ficha de lead: "Asistente comercial", "Outreach e historial", botón "Ver acciones". |
| 53 | Alertas | ALERT-1 | autonomous | Tabla `system_alerts` + API con kind/severity/status; producers iniciales escriben a DB. |
| 54 | Alertas | ALERT-2 | autonomous | Campanita en header con counter de unread, dropdown con últimas 10, página `/admin/alerts`. |
| 55 | CRM | CRM-6 | autonomous | Transiciones bidireccionales (retroceso y reapertura de terminales con nota obligatoria). |
| 56 | CRM | CRM-7 | autonomous | Historial completo de transiciones en el popup de cualquier card del board CRM. |
| 57 | CRM | CRM-8 | autonomous | Filtros server-side en pantalla CRM (niche, source, tier, score, owner, status, q). |
| 58 | RBAC | RBAC-1 | autonomous | Datos de contacto ocultos para rol comercial hasta iniciar tracking; redacción server-side. |
| 59 | CRM | CRM-9 | autonomous | Bloque de contacto embebido en popup CRM (estado `contact`); marca canal usado y feedback inline. Depende: RBAC-1 + LEAD-1. |
| 60 | Lead Detail | LEAD-1 | autonomous | Resumen comercial dual (Software | Marketing) full-width con líneas/evidencia que justifican ofertas. |
| 61 | Lead Detail | LEAD-2 | autonomous | Bloque contacto/datos con filtros (fuente, tipo, confiabilidad) y scroll interno. |
| 62 | Lead Detail | LEAD-3 | autonomous | Feedback por variable inline en contacto/datos; elimina "Feedback humano" deprecated. |
| 63 | Lead Detail | LEAD-4 | autonomous | Traza de evidencia comercial integrada al Resumen comercial como expandible "Ver por qué". |
| 64 | Lead Detail | LEAD-5 | autonomous | Rediseño global de la ficha con auditoría triple obligatoria (técnico, UX, vendedor) documentada en `context/research/lead-5-audits.md`. |
| 65 | Calidad | QUAL-1 | autonomous | Apartado "Nichos" en Calidad con aliasing/sinónimos; filtros expanden automáticamente al grupo. |
| 66 | Responsive | UI-RESP-1 | autonomous | Contenedor global responsive; smoke Playwright en 3 viewports por pantallas clave; partir en sub-paquetes si excede límites. |

## Dependencias entre fases

- `NAV-1` antes de `THEME-1`, `MON-2`, `DISC-1` y `CRM-3`.
- `MON-1` antes de `MON-2` y `BKP-1`.
- `DISC-1` antes de `MINTUR-1`, `DISC-2` y `DISC-3`.
- `MINTUR-1` antes de campañas fuertes de repoblación futuras y antes de cerrar del todo `DISC-3` si se apoya en la taxonomía mejorada.
- `MAP-1` después de `DISC-1` para aislar el riesgo cartográfico y antes de cerrar cualquier rediseño final de `Contexto y mapa`.
- `FDBK-1` antes de `FDBK-2`; `FDBK-2` antes de `FDBK-3`.
- `CRM-1` antes de `CRM-2`; `CRM-2` antes de `CRM-3`; `CRM-3` antes de `CRM-4`; `CRM-4` antes de `CRM-5`.
- `UI-2` antes de `CRM-5` (no tiene sentido conservar Outreach/Campañas si CRM-5 completa el board).
- `MON-2` antes de `MON-3` y `MON-4`.
- `PIPE-1` y `PIPE-3` pueden ejecutarse en cualquier orden entre sí; ambas antes de `PIPE-2`.
- `DISC-3` antes de `DISC-4`; `DISC-4` antes de `DISC-5` y `DISC-6`.
- `CRM-5` requiere aprobación de dependencia nueva (biblioteca drag & drop).

### Dependencias del ciclo 3

- `BUG-1` antes de `BUG-2` y antes de cerrar `UI-4` (la alerta sale después de que el valor esté bien).
- `OPS-2` antes de `OPS-3`, `OPS-4`, `OPS-5`.
- `OPS-3` después de `DISC-8` para que el bloque migrado ya incluya los filtros `missing_*`.
- `DISC-7` independiente; preferentemente antes de `DISC-8` para que la UX final ya esté ordenada.
- `DISC-8` antes de `DISC-9` y antes de `OPS-3`.
- `PIPE-4` antes de `DISC-11` y antes de cualquier campaña de discovery real.
- `MAP-2` antes de `MAP-3` y `MAP-4`.
- `MAP-4` antes de `UI-6`.
- `UI-4` y `UI-5` antes de `UI-6`.
- `UI-3` independiente del resto del ciclo, puede ir en cualquier punto.
- `UI-7` antes de `LEAD-5` para limpiar antes de rediseñar.
- `ALERT-1` antes de `ALERT-2`.
- `CRM-6` antes de `CRM-7` (el historial muestra retrocesos también).
- `RBAC-1` antes de `CRM-9`.
- `LEAD-1` antes de `LEAD-4` y `CRM-9`.
- `LEAD-2` antes de `LEAD-3` (los botones de feedback viven en el bloque rediseñado).
- `LEAD-1`, `LEAD-2`, `LEAD-3`, `LEAD-4`, `UI-7` antes de `LEAD-5` (rediseño consolidado).
- `UI-RESP-1` debe ejecutarse **al final** del ciclo, después de cerrar todas las pantallas nuevas o modificadas, salvo que se decida partirlo en sub-paquetes por pantalla y entrelazar.
- `OPS-5` requiere aprobación de dependencia nueva (charting library) si no hay una en `package.json`.
- `DISC-10` requiere aprobación de dependencia `xlsx` si no está en deps.
- `MAP-2` requiere aprobación si se usa Mapbox/Google Geocoding pagos; con Nominatim queda autónomo bajo rate-limit estricto.
- `MAP-4` requiere aprobación de `leaflet.markercluster` si no está en deps.

## Criterios globales de validación por tipo de fase

### UI only

- `pnpm --dir ui typecheck`
- `pnpm --dir ui build`
- tests UI/RTL o equivalentes si existen
- smoke manual/Playwright si la fase toca navegación, formularios o boards

### API/core/schema

- `pnpm test`
- `pnpm typecheck`
- `pnpm --dir ui typecheck` si cambia contrato consumido por UI
- `pnpm smoke:api` si cambia endpoint o shape admin/API
- `supabase db reset` cuando la fase agrega o modifica migraciones

### Fases con DB destructive risk

- backup verificable previo
- prueba del camino de migración/rollback acordado en la fase
- nunca borrar tablas o columnas viejas en la misma fase que introduce el reemplazo

## Decisiones cerradas para este programa

- `Estado del sistema` se reemplaza conceptualmente por `Monitoreo`; la información hoy dispersa en health/costs/performance/system debe converger ahí.
- El sidebar admin pasa a tener grupos colapsables y buscador. La navegación existente puede reubicarse, pero no se eliminan capacidades sin un reemplazo funcional.
- Los backups manuales y los programados deben tener retención separada; los manuales no pueden ser barridos por la política de scheduled.
- `Composer` de discovery deja de ser discovery-only: el objetivo funcional es discovery con encadenamiento opcional de enrichment.
- `Jobs legacy` en discovery se considera deuda de UI y debe retirarse de la experiencia principal.
- El CRM nuevo usa tablas propias. No se reusa `outreach_campaigns` como modelo central del seguimiento; solo puede haber compatibilidad transitoria.
- La retroalimentación humana debe quedar persistida y trazable; no alcanza con un flag efímero en frontend.

### Decisiones del ciclo 3 (2026-05-24)

- `Pipeline` y `Monitoreo` se reemplazan conceptualmente por una sola pantalla `Operaciones` con secciones colapsables. Las pantallas viejas dejan de existir (no se mantienen como redirects).
- `Enrichment de colección` deja de vivir en el home y pasa a ser un proceso operativo en `Operaciones`.
- La ficha de Lead se rediseña con foco comercial; cualquier información técnica queda en bloques colapsables secundarios. Ningún dato existente se elimina.
- Los datos de contacto del lead no son visibles para usuarios con rol `comercial` hasta iniciar un tracking (`RBAC-1`). Admin no está afectado.
- Las "Campañas/Outreach" siguen como ciclo cerrado: en el ciclo 3 solo se eliminan las referencias UI visibles; endpoints, lib client y tablas DB quedan intactos por seguridad.
- El Budget mensual de Google Places es un hard cap. Cualquier mecanismo que pueda superarlo se cierra antes de aceptar nuevas optimizaciones de discovery.
- El mapa heatmap debe ser útil como filtro vivo en el home, no solo como visualización pasiva. La granularidad por barrio/cuadrícula es objetivo, no por departamento.
- Los procesos del pipeline se observan en tiempo real desde la nueva pantalla `Operaciones > Procesos`, con métricas físicas y logs en vivo. Si la dependencia de charts requiere aprobación, el agente debe detenerse antes de importar.
- La auditoría de la ficha rediseñada (LEAD-5) es **triple y obligatoria**: técnico, UX, vendedor. Sin las tres aprobadas, la fase no cierra.
- La responsividad global (UI-RESP-1) se ejecuta como cierre del ciclo. No tiene sentido auditar responsive de pantallas que aún están en rediseño.

## Histórico

- El roadmap largo previo queda archivado como contexto histórico del sistema y no como fuente de selección autónoma.
- `context/prompts/` sigue siendo archivo histórico; no usarlo como fuente canónica.
