# Blindspot — Future

> Backlog ejecutable del programa de mejoras vigente.
> `ROADMAP_CANONICAL.md` define orden y modos; este archivo define el detalle de cada fase.
> Si una fase se completa, marcarla como `done` en este archivo y actualizar el estado resumido en `PROJECT_MASTER.md`.

---

## Estado del programa

- `CTX-0` — done 2026-05-22
- `NAV-1` — done 2026-05-22
- `THEME-1` — done 2026-05-22
- `MON-1` — done 2026-05-22
- `MON-2` — done 2026-05-22
- `BKP-1` — done 2026-05-23
- `DISC-1` — done 2026-05-23
- `MINTUR-1` — done 2026-05-23
- `MAP-1` — done 2026-05-23
- `DISC-2` — done 2026-05-23
- `DISC-3` — done 2026-05-23
- `FDBK-1` — done 2026-05-23
- `FDBK-2` — done 2026-05-23
- `FDBK-3` — done 2026-05-23
- `CRM-1` — done 2026-05-24
- `CRM-2` — done 2026-05-24
- `CRM-3` — done 2026-05-24
- `CRM-4` — done 2026-05-24
- `UI-2` — done 2026-05-23
- `UI-1` — done 2026-05-23
- `NAV-2` — done 2026-05-23
- `THEME-2` — done 2026-05-23
- `MON-3` — done 2026-05-23
- `MON-4` — done 2026-05-23
- `OPS-1` — done 2026-05-23
- `PIPE-1` — done 2026-05-23
- `PIPE-3` — done 2026-05-23
- `PIPE-2` — done 2026-05-24
- `CRM-5` — done 2026-05-24
- `DISC-4` — done 2026-05-24
- `DISC-5` — done 2026-05-24
- `DISC-6` — done 2026-05-24

### Ciclo 3 — Mejoras operativas y comerciales (abierto 2026-05-24)

- `BUG-1` — done (2026-05-24)
- `BUG-2` — done (2026-05-24, resuelto por BUG-1)
- `OPS-2` — done (2026-05-24)
- `OPS-3` — done (2026-05-24)
- `OPS-4` — done (2026-05-24)
- `OPS-5` — done (2026-05-24)
- `DISC-7` — done (2026-05-24)
- `DISC-8` — done (2026-05-24)
- `DISC-9` — done (2026-05-24)
- `DISC-10` — done (2026-05-24)
- `DISC-11` — done (2026-05-24)
- `PIPE-4` — done
- `PIPE-5` — done
- `MAP-2` — pending
- `MAP-3` — pending
- `MAP-4` — pending
- `UI-3` — done
- `UI-4` — done
- `UI-5` — done
- `UI-6` — pending (depends on MAP-4)
- `UI-7` — done
- `ALERT-1` — pending
- `ALERT-2` — pending
- `CRM-6` — pending
- `CRM-7` — pending
- `CRM-8` — pending
- `RBAC-1` — pending
- `CRM-9` — pending
- `LEAD-1` — pending
- `LEAD-2` — pending
- `LEAD-3` — pending
- `LEAD-4` — pending
- `LEAD-5` — pending
- `QUAL-1` — pending
- `UI-RESP-1` — pending

## Gates globales

- No combinar dos fases canónicas en un mismo commit.
- Si una fase exige migración, correr `supabase db reset` antes de cerrarla.
- Si una fase toca contrato API/UI, correr también `pnpm smoke:api`.
- Si una fase toca navegación o pantallas operativas, agregar cobertura UI y hacer smoke con navegador cuando sea razonable.
- Si aparece una dependencia nueva, frenar antes de importar el paquete.
- Si una fase detecta que el diseño objetivo es demasiado grande, partirla en sub-paquete interno sin cambiar el orden canónico y dejarlo escrito en `PROJECT_MASTER.md`.

---

## CTX-0 — Context reset del programa

**Status:** `done`

**Resultado esperado**
- Contextos alineados con el programa de mejoras posterior a la remediación.
- `AUTONOMOUS.md` listo para iniciar un chat nuevo y ejecutar fases secuenciales con mínima intervención.

**Cierre**
- Actualizar `ROADMAP_CANONICAL.md`, `FUTURE.md`, `PROJECT_MASTER.md`, `AUTONOMOUS.md` y documentos de arquitectura asociados.

---

## NAV-1 — Sidebar operacional y fix de navegación

**Status:** `done`

**Objetivo**
- Reorganizar el sidebar admin para que sea más usable con crecimiento de producto.

**Alcance**
- Agrupar opciones en secciones colapsables.
- Todas las secciones empiezan colapsadas por defecto, salvo la que contiene la ruta activa.
- Agregar buscador arriba del sidebar.
- Sustituir iconografía genérica por iconos consistentes con la función real de cada sección.
- Resolver el warning `Encountered two children with the same key` detectado al entrar en la pantalla hoy llamada `Estado del sistema`.

**No hacer en esta fase**
- No introducir dark mode todavía.
- No rediseñar contenidos internos de páginas.
- No romper guards/RBAC ni slugs existentes sin alias/redirect claro.

**Áreas probables**
- `ui/src/components/admin-shell.tsx`
- `ui/src/lib/admin-access.ts`
- componentes/sidebar/icons
- tests de navegación/sidebar

**Validación mínima**
- `pnpm --dir ui typecheck`
- `pnpm --dir ui build`
- test UI del sidebar y de la route activa
- smoke navegando admin y CM

**Actualización de contexto al cerrar**
- `ARCHITECTURE_FRONTEND.md`
- `ADMIN_PANEL.md`
- `PROJECT_MASTER.md`

**Cierre**
- Sidebar reorganizado en grupos colapsables con buscador e iconografía consistente.
- La ruta activa deja su grupo abierto por defecto y el estado de colapso persiste por sesión.
- La entrada `/admin/health` se rotula como `Monitoreo` sin cambiar slug ni guards actuales.
- Se corrige el warning potencial de keys duplicadas en la pantalla `Estado del sistema`.

---

## THEME-1 — Dark mode del dashboard

**Status:** `done`

**Objetivo**
- Agregar modo oscuro real y consistente al dashboard/admin.

**Alcance**
- Theme toggle persistido.
- Tokens de color compartidos, no estilos inline aislados.
- Contraste suficiente en tablas, cards, badges, formularios y mapas.
- Soporte para páginas admin existentes y shell base.

**No hacer en esta fase**
- No rediseñar arquitectura de navegación nuevamente.
- No mezclar con cambios de monitoreo más allá de soportar el theme.

**Áreas probables**
- layout/theme provider
- componentes base y charts/cards compartidos
- páginas admin críticas

**Validación mínima**
- `pnpm --dir ui typecheck`
- `pnpm --dir ui build`
- tests de persistencia de preferencia de tema
- smoke visual rápido en 3 pantallas admin

**Riesgos a vigilar**
- hardcodes de color en páginas existentes
- textos de bajo contraste en estados degradados/error

**Cierre**
- Theme toggle persistido con `localStorage` y script de hidratación temprana para evitar flash incorrecto.
- Tokens compartidos y overrides globales de dark mode aplicados al shell admin y superficies reutilizables.
- Shell, Inicio, Backups y Discovery quedan cubiertos por la nueva infraestructura sin cambiar rutas ni contratos.

---

## MON-1 — Contrato backend unificado de monitoreo

**Status:** `done`

**Objetivo**
- Unificar la información de observabilidad bajo un modelo explícito de `monitoring` sin obligar a la UI a pegarse a endpoints dispersos y heterogéneos.

**Alcance**
- Definir read model/backend contract para monitoreo.
- Incluir al menos:
  - salud general
  - estado de procesos (`api`, `core`, scheduler, pipeline activo)
  - backups (scheduler, último backup, próximo backup, fallos recientes, tamaño DB)
  - costos resumidos
  - performance resumida
  - errores/logs recientes
  - uso operativo básico (cores/concurrency configurada, workers activos si aplica)
- Mantener compatibilidad razonable con endpoints actuales durante la transición.

**Decisión sugerida**
- Introducir namespace `GET /api/v1/admin/monitoring/*` y dejar adapters/compat wrappers donde convenga hasta completar `MON-2`.

**No hacer en esta fase**
- No construir aún la UI final “tipo Grafana”.
- No meter dependencias pesadas de observabilidad si se pueden evitar.

**Áreas probables**
- `api/src/routes/admin/system.ts`
- `api/src/routes/admin/costs.ts`
- `api/src/routes/admin/performance.ts`
- `api/src/routes/health.ts`
- servicios/read models de monitoreo

**Validación mínima**
- `pnpm test`
- `pnpm typecheck`
- `pnpm smoke:api`
- tests de shape/errores de endpoints admin

**Riesgos a vigilar**
- duplicar lógica de agregación en varios handlers
- esconder fallos reales detrás de estados `ok`

**Cierre**
- Nuevo contrato `GET /api/v1/admin/monitoring/overview` expone un read model unificado de health, procesos, pipeline, discovery, backups, costos, performance y logs recientes.
- Los endpoints existentes (`health`, `admin/system`, `admin/costs`, `admin/performance`, `admin/backups`) siguen vigentes para compatibilidad durante la transición.
- Verificación: `pnpm typecheck`, test focalizado de monitoring y suite completa en verde; `pnpm smoke:api` sigue rojo por un estado degradado preexistente de `/health` asociado a `backup_restore_failed`.

---

## MON-2 — Pantalla Monitoreo unificada

**Status:** `done`

**Objetivo**
- Reemplazar conceptualmente `Estado del sistema` por una pantalla `Monitoreo` unificada, clara y operativa.

**Alcance**
- IA y rotulado: `Monitoreo` como entrypoint único.
- Diseño tipo observabilidad/Grafana, sin copiar visualmente Grafana pero sí su claridad de paneles.
- Paneles mínimos:
  - procesos/estado
  - pipeline activo/reciente
  - backups y restore
  - costos resumidos
  - performance resumida
  - errores recientes/log tail
- Mantener links o drill-down a vistas especializadas si todavía aportan valor, pero la visión ejecutiva queda centralizada en `Monitoreo`.

**No hacer en esta fase**
- No reinventar charts si ya hay componentes reutilizables.
- No eliminar datos útiles existentes sin reemplazo.

**Áreas probables**
- nueva ruta/página `ui/src/app/admin/monitoring/page.tsx`
- shell/nav/sidebar
- cliente API de monitoreo
- posibles redirects desde `/admin/health`

**Validación mínima**
- `pnpm --dir ui typecheck`
- `pnpm --dir ui build`
- tests de render/carga/error
- smoke admin de monitoreo

**Cierre**
- Nueva ruta `ui/src/app/admin/monitoring/page.tsx` centraliza procesos, pipeline, discovery, backups, costos, performance y logs recientes sobre `admin/monitoring/overview`.
- `/admin/health` queda como alias con redirect a `/admin/monitoring`.
- El sidebar y RBAC pasan a usar `Monitoreo` como entrypoint técnico principal.

---

## BKP-1 — Política de backups separada y tamaño de DB

**Status:** `done`

**Objetivo**
- Evitar que la retención de backups automáticos pise backups manuales y mostrar mejor capacidad operativa.

**Alcance**
- `max_manual_backups` y `max_scheduled_backups` separados.
- Limpieza automática por tipo (`manual` y `scheduled`) de forma determinística.
- Mostrar peso actual de la base en la sección de backups/monitoreo.
- Exponer claramente uso de disco/cantidad por tipo cuando sea razonable.

**No hacer en esta fase**
- No cambiar el mecanismo base de restore.
- No meter storage remoto.

**Áreas probables**
- migración Supabase
- servicio de backups en API
- scheduler/config de backups
- UI admin de backups
- health/monitoring

**Validación mínima**
- `pnpm test`
- `pnpm typecheck`
- `pnpm --dir ui typecheck`
- `pnpm --dir ui build`
- `pnpm smoke:api`
- `supabase db reset`

**Riesgos a vigilar**
- edge cases de retención mixta
- métricas de tamaño DB inconsistentes según engine/local env

**Cierre**
- `backup_config` pasa a persistir `max_manual_backups` y `max_scheduled_backups` con migración aditiva y compatibilidad del campo legado `max_backups`.
- La retención automática se aplica por trigger (`manual` y `scheduled`) sin que los restores/checkpoints consuman la cuota del scheduler.
- Backups, health y monitoreo exponen conteos por tipo, huella agregada de backups retenidos y tamaño estimado de la DB vía RPC `get_database_size_bytes()`.
- Verificación: `pnpm typecheck`, tests focalizados de backups/monitoring, `pnpm --dir ui typecheck` y `pnpm --dir ui build` en verde; `pnpm smoke:api` sigue rojo por `backup_restore_failed` preexistente y no se corrió `supabase db reset` porque el restore local sigue degradado, por lo que usarlo como gate destructivo no es seguro.

---

## DISC-1 — Workspace de discovery: UX y persistencia

**Status:** `done`

**Objetivo**
- Mejorar la usabilidad del workspace de discovery sin tocar todavía la orquestación profunda ni el mapa real.

**Alcance**
- Tooltip/hover en contador de nichos sugeridos con breakdown por fuente.
- El composer no resetea sus configuraciones tras crear un batch.
- Retirar `jobs legacy` de la experiencia principal.

**No hacer en esta fase**
- No encadenar todavía enrichment automático.
- No rediseñar aún la infraestructura cartográfica.
- No cambiar todavía el backend central de jobs más de lo necesario para soportar el detalle por fuente.

**Validación mínima**
- `pnpm --dir ui typecheck`
- `pnpm --dir ui build`
- tests UI del workspace
- smoke creando batches repetidos sin perder draft

**Cierre**
- El contador de nichos sugeridos ahora expone breakdown por fuente en hover usando `top_niches_by_source` ya presente en el contrato actual.
- El composer persiste su draft en `localStorage` y ya no se resetea al crear un batch; solo vuelve al default mediante `Reset`.
- Los `jobs legacy` salen de la experiencia principal y quedan relegados a una tarjeta de compatibilidad colapsable.
- Verificación: `pnpm typecheck`, `pnpm test tests/ui/discovery.test.ts` y `pnpm --dir ui build` en verde; no hay harness E2E/browser todavía para automatizar el smoke completo del draft persistente.

---

## MINTUR-1 — Mejorar lógica de nichos MINTUR

**Status:** `done`

**Objetivo**
- Reducir `other` y mejorar la utilidad comercial de leads MINTUR.

**Alcance**
- Mejorar parser y mapeo de nichos/tipo de operador.
- Usar señales disponibles en `source_data` sin inventar taxonomía arbitraria.
- Mantener normalización canónica hacia los nichos usados por discovery/scoring/UI.

**No hacer en esta fase**
- No tocar scoring salvo ajustes inevitables por el nuevo mapeo.
- No depender de fuentes externas nuevas.

**Validación mínima**
- tests unitarios de parser/mapeo
- `pnpm test`
- `pnpm typecheck`
- comparar reducción del bucket `other` en fixture o snapshot controlado

**Cierre**
- El provider MINTUR ya no fuerza `niche: "other"`: reutiliza `TipoOperador` cuando existe y cae a señales del nombre del operador usando la taxonomía canónica soportada por discovery.
- Se prioriza `TipoOperador` por encima de keywords del nombre, con fallback seguro a `other` cuando no hay señal compatible.
- Verificación: `pnpm typecheck` y tests focalizados `tests/discovery/mintur.test.ts` + `tests/enrichment/mintur-tipo-operador.test.ts` en verde.

---

## MAP-1 — Mapa real para densidad comercial y contexto

**Status:** `done`

**Objetivo**
- Que la densidad comercial y `Contexto y mapa` se vean sobre un mapa geográfico real y útil para ubicación.

**Alcance**
- Reemplazar visualizaciones abstractas por mapa real donde corresponda.
- Definir contrato backend adecuado para puntos/áreas/capas según datos existentes.
- Respetar atribución de fuentes cartográficas, especialmente OSM si corresponde.
- En `Contexto y mapa`, agregar lista lateral con límite visual, scroll y filtros/orden útiles, incluyendo métricas agregadas cuando la data exista.

**No hacer en esta fase**
- No mezclar con el encadenamiento de enrichment del composer.
- No introducir una dependencia cartográfica sin justificarla y sin aprobación si es nueva.

**Validación mínima**
- si agrega dependencia: pedir aprobación primero
- `pnpm test`
- `pnpm typecheck`
- `pnpm --dir ui typecheck`
- `pnpm --dir ui build`

**Cierre**
- `Contexto y mapa` usa Leaflet + OpenStreetMap sobre `gps_points` reales de discovery, con viewport ajustado a densidad o selección activa.
- La lista lateral agrega filtro por ubicación, orden por densidad/leads/hot/prospect y métricas visibles de puntos exactos por ubicación.
- La atribución OSM queda visible en el mapa y el styling se integra con el theme actual del admin.

---

## DISC-2 — Composer con toggle de enrichment

**Status:** `done`

**Objetivo**
- Que el composer pueda disparar discovery + enrichment encadenado, con toggle default en `sí`.

**Alcance**
- Añadir control UI claro y persistente al composer.
- Extender backend/orquestación para que el batch o sus jobs hijos generen el trabajo de enrichment de lo descubierto.
- Mantener trazabilidad del encadenamiento: qué descubrió y qué enriqueció.
- El usuario debe entender si se ejecutó solo discovery o discovery+enrichment.

**No hacer en esta fase**
- No meter scoring automático salvo que el contrato actual ya lo haga naturalmente y quede claro.
- No hacer magia silenciosa imposible de auditar.

**Validación mínima**
- `pnpm test`
- `pnpm typecheck`
- `pnpm --dir ui typecheck`
- `pnpm --dir ui build`
- `pnpm smoke:api`
- tests de creación de batch con y sin enrich

**Cierre**
- El composer persiste `enrich_after_discovery`, default en `sí`, y muestra explícitamente si el lote corre `solo discovery` o `discovery + enrich`.
- Cada job hijo guarda su intención de enrich, el `linked_run_id` del discovery y el `linked_enrich_run_id` del follow-up cuando corresponde, con `enrich_status` independiente.
- El procesador de cola ejecuta enrichment encadenado por `run_id` del job descubierto, sin ampliar el alcance a enrich por filtros todavía.

**Riesgos a vigilar**
- colas duplicadas
- estados poco claros entre discovery y enrich

---

## DISC-3 — Enrichment de leads por filtros

**Status:** `done`

**Objetivo**
- Tener una herramienta específica para enriquecer colecciones de leads elegidas por filtros relevantes.

**Alcance**
- UI/admin para definir filtros de colección.
- Endpoint/backend para encolar/process enrichment sobre subconjuntos de leads.
- Guardrails para volumen, concurrencia y trazabilidad.

**No hacer en esta fase**
- No convertirlo en un query runner arbitrario sin validación.
- No permitir acciones masivas opacas sin resumen previo.

**Validación mínima**
- `pnpm test`
- `pnpm typecheck`
- `pnpm --dir ui typecheck`
- `pnpm --dir ui build`
- `pnpm smoke:api`

**Cierre**
- Lead Explorer admin puede encolar enrichment sobre la colección filtrada actual, con guardrails de filtros obligatorios, límite de 250 leads y concurrencia explícita.
- Backend expone `POST /api/v1/admin/enrichment/filter-jobs` con validación de filtros aprobados, conteo previo y rechazo de colecciones vacías o demasiado grandes.
- El pipeline de enrich soporta modo `filter`, crea un run trazable propio y procesa solo el subconjunto seleccionado desde `lead_dashboard`.

---

## FDBK-1 — Persistencia y API de feedback humano

**Status:** `done`

**Objetivo**
- Crear la base estructural para que usuarios validen manualmente calidad de datos por lead.

**Alcance**
- Tablas propias para feedback.
- RBAC y auditoría.
- API para crear/listar feedback y consultar resumen por lead/campo.
- Modelo de feedback mínimo: dato, veredicto (`good`/`bad`), comentario, actor, timestamp.

**No hacer en esta fase**
- No cambiar todavía scoring/enrichment por consumirlo.
- No embutirlo dentro de tablas de leads o outreach.

**Validación mínima**
- `pnpm test`
- `pnpm typecheck`
- `pnpm smoke:api`
- `supabase db reset`

**Cierre**
- Se agrega `lead_feedback` como tabla propia con `lead_id`, `field_key`, `field_value`, `verdict`, comentario, actor y timestamp.
- API disponible para crear feedback, listar feedback por lead y consultar resumen agregado por campo, con el mismo control de acceso del detalle del lead y soporte admin para `include_rejected`.
- Cada creación escribe auditoría en `audit_log` con acción `lead.feedback.create`.

---

## FDBK-2 — UI de feedback en Lead Detail

**Status:** `done` 2026-05-23

**Objetivo**
- Permitir validar datos manualmente desde la ficha del lead con una UX clara.

**Alcance**
- Controles por campo o bloque relevante.
- Visualización de feedback existente y estado resumido.
- Carga de comentario contextual.

**No hacer en esta fase**
- No mezclar todavía recomendaciones algorítmicas.
- No esconder información original del lead.

**Validación mínima**
- `pnpm --dir ui typecheck`
- `pnpm --dir ui build`
- tests del detalle y mutaciones de feedback
- smoke manual/Playwright de ficha

---

## FDBK-3 — Consumo operativo del feedback

**Status:** `done` 2026-05-23

**Objetivo**
- Hacer que el sistema aprenda operativamente de la validación humana sin introducir una falsa “IA autoentrenada”.

**Alcance**
- Agregados o overrides consumibles por heurísticas/scoring/reporting.
- Resumen de confiabilidad ajustado por feedback.
- Documentar qué usa feedback y qué no usa todavía.

**No hacer en esta fase**
- No prometer entrenamiento automático de modelos inexistentes.
- No tocar discovery masivo si no hay evidencia suficiente.

**Validación mínima**
- `pnpm test`
- `pnpm typecheck`
- tests de agregación y lectura de feedback

**Cierre**
- Helper `src/modules/feedback/summary.ts` cableado en `api/src/routes/leads.ts`.
- `GET /leads/:id/feedback-summary` refactorizado para usar `summarizeFeedbackRows` (sin duplicación inline).
- Nuevo endpoint `GET /leads/:id/feedback-adjusted-confidence` que consume `computeFeedbackAdjustedConfidence` con las scores base del lead y retorna scores ajustados, deltas y campos flaggeados/confirmados.
- Tipo `FeedbackAdjustedConfidence` y función cliente `getLeadFeedbackAdjustedConfidence` en `ui/src/lib/api.ts`.
- 2 tests nuevos de integración en `tests/api/leads.test.ts` — 20 tests en verde.
- Qué usa feedback: `feedback-summary` (lista por campo), `feedback-adjusted-confidence` (scores ajustados en runtime).
- Qué NO usa feedback todavía: scoring de enrichment (`src/storage/leads.ts`), discovery, campañas, segmentos.

---

## CRM-1 — Fundaciones de CRM y puente con campañas

**Status:** `done` 2026-05-24

**Objetivo**
- Introducir un CRM real de seguimiento sin perder historial ni romper lo existente.

**Alcance**
- Nuevas tablas CRM propias.
- Estados canónicos:
  - `pending`
  - `validation`
  - `contact`
  - `observed`
  - `rejected`
  - `accepted`
- Asignación al usuario que inicia seguimiento.
- Estrategia puente para reemplazar `iniciar campaña` por `iniciar seguimiento` sin borrar todavía estructuras viejas.

**No hacer en esta fase**
- No eliminar tablas/endpoints viejos en el mismo paso.
- No meter UI board todavía.

**Validación mínima**
- `pnpm test`
- `pnpm typecheck`
- `pnpm smoke:api`
- `supabase db reset`

**Cierre**
- `supabase/migrations/20260524000000_crm_tracking.sql` aplicada limpiamente.
- Tabla `lead_tracking`: PK uuid, `lead_id`→leads, `owner_id`→users, `status` CHECK 6 estados canónicos, `campaign_id`→outreach_campaigns nullable (puente), `notes`, `started_at`, `updated_at` con trigger.
- Partial unique index `lead_tracking_lead_active_uniq` sobre `(lead_id)` WHERE status NOT IN ('rejected','accepted') — garantiza un solo tracking activo por lead.
- Tabla `lead_tracking_events`: log de transiciones con `from_status`/`to_status`, actor y notas.
- Tablas viejas (`outreach_campaigns`, `lead_outreach`) intactas.
- 1125 tests en verde, typecheck limpio.

---

## CRM-2 — API de seguimiento CRM

**Status:** `done` 2026-05-24

**Objetivo**
- Exponer el nuevo CRM de seguimiento con RBAC y auditoría.

**Alcance**
- Crear seguimiento.
- Listar por owner y, para admin, listar propios o ajenos.
- Transiciones de estado válidas.
- Registro de canal exitoso o “ningún canal funcionó”.
- Registro de observación con fecha de recordatorio.
- Registro de rechazo y aceptación con descripción.

**No hacer en esta fase**
- No resolver todavía toda la UX de board/movimiento drag&drop.
- No inventar un sistema documental pesado; soportar metadata y adjuntos de forma consistente con el repo.

**Validación mínima**
- `pnpm test`
- `pnpm typecheck`
- `pnpm smoke:api`

**Cierre**
- `supabase/migrations/20260524010000_crm_tracking_events_metadata.sql`: agrega `channel` y `reminder_at` a `lead_tracking_events`.
- Nuevo route file `api/src/routes/tracking.ts` registrado en `api/src/server.ts` con 4 endpoints:
  - `POST /tracking` — crea tracking, valida acceso a lead, unique constraint 409, escribe evento inicial y auditoría.
  - `GET /tracking` — lista con filtros `status`, `owner_id` (admin), `lead_id`, `limit`. CM solo ve propios.
  - `GET /tracking/:id` — detalle con array `events`. CM solo ve propios.
  - `POST /tracking/:id/transition` — transición validada con state machine, escribe evento con `channel`/`reminder_at` opcionales y auditoría.
- Tipos y cliente en `ui/src/lib/api.ts`: `CrmStatus`, `LeadTracking`, `LeadTrackingEvent`, `LeadTrackingDetail` + funciones `createTracking`, `listTrackings`, `getTracking`, `transitionTracking`.
- 12 tests en verde, typecheck limpio, migraciones limpias.

---

## CRM-3 — Pantalla CRM tipo board

**Status:** `done` 2026-05-24

**Objetivo**
- Tener una pantalla CRM operativa estilo Jira con cards móviles por etapa.

**Alcance**
- Board por estados.
- Cards con resumen suficiente.
- Vista de “mis leads” para CM y switch/filtro ampliado para admin.
- Acción visible `Iniciar seguimiento` integrada al flujo de leads/outreach.

**No hacer en esta fase**
- No resolver todavía todo el detalle documental en profundidad si hace crecer demasiado la fase.
- No usar componentes pesados nuevos sin aprobación.

**Validación mínima**
- `pnpm --dir ui typecheck`
- `pnpm --dir ui build`
- tests UI del board y filtros de ownership
- smoke navegando CRM con admin y CM

**Cierre**
- Nueva página `ui/src/app/admin/crm/page.tsx`: board horizontal con 6 columnas por estado, cards con lead_id, owner (admin), fecha y botones de transición inline, modal de confirmación con canal y notas opcionales.
- Helper module `ui/src/lib/crm-tracking.ts`: `CRM_COLUMNS`, `VALID_TRANSITIONS`, `groupTrackingsByStatus`, `isTerminalStatus` — extraídos del componente para ser testeables.
- Nav item "CRM" agregado al grupo "Comercial" en `admin-shell.tsx` con ícono propio.
- Botón "Iniciar seguimiento" en `ui/src/app/admin/leads/[id]/page.tsx` → llama `createTracking` y navega a `/admin/crm`.
- 8 tests en `tests/ui/crm-tracking.test.ts`: state machine, agrupación por estado, filtro por owner.
- Typecheck y build limpios.

---

## CRM-4 — Modal detallado, notas, adjuntos y recordatorios

**Status:** `done` 2026-05-24

**Objetivo**
- Cerrar el flujo operativo del CRM en el detalle de la card.

**Alcance**
- Modal o panel con detalle editable.
- Notas tipo Jira.
- Adjuntos/imagenes si el patrón técnico lo soporta razonablemente.
- Campo de canal exitoso.
- Caso “ningún canal funcionó” que deriva a `observed`.
- `observed` con fecha de recordatorio.
- `accepted` y `rejected` con texto y adjuntos relevantes.

**No hacer en esta fase**
- No mezclar automatizaciones futuras de re-enrichment; por ahora solo registrar el caso.
- No depender de storage externo si no existe el patrón.

**Validación mínima**
- `pnpm test`
- `pnpm typecheck`
- `pnpm --dir ui typecheck`
- `pnpm --dir ui build`
- `pnpm smoke:api`

**Cierre**
- `POST /tracking/:id/note` — endpoint nuevo para notas sin cambio de estado (from/to_status = estado actual); con `.select().single()` en el insert.
- `addTrackingNote` cliente en `ui/src/lib/api.ts`.
- Board `ui/src/app/admin/crm/page.tsx` reescrito con CRM-4 features:
  - Transition modal: campo `channel` para `contact`, `reminder_at` (datetime-local) para `observed`, nota recomendada para `rejected`/`accepted`.
  - Botón "Sin canal" (shortcut "Ningún canal funcionó" → `observed`) en cards de estado `contact`.
  - Botón "+ nota" que abre note modal.
  - Detail modal al hacer clic en el nombre del tracking — muestra timeline de eventos con status, canal, recordatorio y notas por evento.
- Adjuntos descartados: no existe patrón de storage externo en el repo; documentado como decisión.
- 3 tests nuevos en `tests/api/tracking.test.ts` (notas: success, 400 vacío, 404 RBAC). 1148 tests en verde.
- Typecheck y UI build limpios.

---

---

## UI-2 — Eliminar función Campañas/Outreach (deprecated)

**Status:** `pending`

**Objetivo**
- Retirar la experiencia de Campañas/Outreach de la UI ya que el CRM reemplaza ese flujo comercial.

**Alcance**
- Eliminar la entrada "Outreach" del sidebar en `ui/src/components/admin-shell.tsx`.
- Eliminar o archivar la página `ui/src/app/admin/outreach/` (mover a `_deprecated` si tiene código reutilizable, o borrar directamente si no).
- No tocar las tablas `outreach_campaigns` ni `lead_outreach` en DB: siguen siendo el puente FK para CRM hasta que se defina una fase de migración destructiva.
- No tocar endpoints API de outreach: pueden seguir existiendo sin exposición de UI.
- No tocar el segmento "Segmentos" si tiene lógica propia.

**No hacer en esta fase**
- No borrar tablas ni endpoints backend.
- No migrar datos de campañas al CRM.
- No tocar la página de CRM ni sus rutas.

**Áreas probables**
- `ui/src/components/admin-shell.tsx` — eliminar entrada Outreach del grupo Comercial
- `ui/src/app/admin/outreach/` — eliminar o archivar
- `ui/src/lib/api.ts` — marcar funciones de outreach como `@deprecated` en comentario, no borrar aún

**Validación mínima**
- `pnpm --dir ui typecheck`
- `pnpm --dir ui build`
- smoke navegando admin: verificar que `/admin/outreach` ya no aparece en nav

**Actualización de contexto al cerrar**
- `ADMIN_PANEL.md` — quitar referencia a Outreach como pantalla activa
- `ARCHITECTURE_FRONTEND.md` — actualizar rutas admin activas

---

## UI-1 — Scrollbar en lista de batches recientes (Discovery)

**Status:** `pending`

**Objetivo**
- La sección "Batches recientes" en Discovery puede crecer sin límite visual. Necesita altura máxima y scroll.

**Alcance**
- Localizar en `ui/src/app/admin/discovery/page.tsx` el contenedor que renderiza la lista de batches recientes.
- Aplicar `max-h-[X]` + `overflow-y-auto` con altura razonable (ej: `max-h-80` o `max-h-96`).
- Ajustar el scroll también para la lista de jobs dentro de cada batch si aplica.

**No hacer en esta fase**
- No virtualizar la lista (no es necesario con scroll simple).
- No cambiar la estructura de datos ni la paginación.

**Áreas probables**
- `ui/src/app/admin/discovery/page.tsx`
- `ui/src/lib/discovery-workspace.ts` (si hay lógica de UI relacionada)

**Validación mínima**
- `pnpm --dir ui typecheck`
- `pnpm --dir ui build`
- smoke visual en Discovery con varios batches: lista scrolleable sin desbordar

---

## NAV-2 — Auto-colapso del sidebar al navegar

**Status:** `pending`

**Objetivo**
- Cuando el usuario hace clic en una opción de navegación perteneciente a una sección distinta a la activa, las secciones previamente abiertas deben colapsarse automáticamente. Solo la sección que contiene la ruta activa permanece expandida.

**Alcance**
- Modificar la lógica de estado de `expandedGroups` en `ui/src/components/admin-shell.tsx`.
- Al cambiar de ruta, recalcular qué grupo debe estar expandido (el que contiene el nuevo `href` activo) y colapsar los demás.
- Mantener el comportamiento actual de "el grupo activo empieza expandido".
- Mantener la persistencia por sesión si ya está implementada.

**No hacer en esta fase**
- No cambiar la estructura visual del sidebar.
- No introducir animaciones de colapso/expansión que requieran dependencias nuevas.

**Áreas probables**
- `ui/src/components/admin-shell.tsx` — lógica `expandedGroups`, handler de click, efecto en cambio de ruta

**Validación mínima**
- `pnpm --dir ui typecheck`
- `pnpm --dir ui build`
- smoke manual: navegar entre secciones distintas y verificar que solo la activa queda abierta

---

## THEME-2 — Botón flotante de cambio de tema

**Status:** `pending`

**Objetivo**
- Reemplazar el control actual de tema (sea donde sea que esté: header, settings, etc.) por un botón flotante fijo en la esquina inferior derecha del viewport. Solo ícono (sol/luna), sin texto.

**Alcance**
- Añadir un `<button>` con `position: fixed; bottom: 1.5rem; right: 1.5rem` (o equivalente Tailwind `fixed bottom-6 right-6`) que alterne entre claro y oscuro.
- Usar los íconos ya existentes o de `lucide-react` (ya disponible).
- Mantener la lógica de persistencia en `localStorage` ya implementada en `THEME-1`.
- Si el control previo está en el header, eliminarlo para no duplicar.

**No hacer en esta fase**
- No rediseñar el sistema de tokens de tema.
- No agregar animaciones de transición entre temas si no están ya.

**Áreas probables**
- `ui/src/app/admin/layout.tsx` o `ui/src/components/admin-shell.tsx` — agregar botón flotante
- El componente de toggle actual (buscar en el shell donde ya existe)

**Validación mínima**
- `pnpm --dir ui typecheck`
- `pnpm --dir ui build`
- smoke visual: botón visible en todas las pantallas admin, alterna tema correctamente

---

## MON-3 — Estado del run en Monitoreo + logs en vivo

**Status:** `pending`

**Objetivo**
- Mover la sección "Estado del run" de Pipeline a Monitoreo, con polling de 5 s y logs en vivo del run activo.

**Alcance**
- Remover la sección `Estado del run` de `ui/src/app/admin/pipeline/page.tsx`.
- Añadir sección equivalente en `ui/src/app/admin/monitoring/page.tsx`:
  - Muestra el último run activo o el más reciente.
  - Polling cada 5 s a un endpoint de estado de run.
  - Logs incrementales del run visible en un `<pre>` o lista con autoscroll.
- El endpoint puede ser el ya existente para pipeline runs en la API (`GET /api/v1/admin/pipeline/status` o equivalente) — adaptar si hace falta.
- Pipeline page queda solo como panel de configuración y disparo; ya no muestra estado en vivo.

**No hacer en esta fase**
- No implementar WebSockets ni SSE; el polling 5 s es suficiente.
- No remover la capacidad de disparar runs desde Pipeline.

**Áreas probables**
- `ui/src/app/admin/pipeline/page.tsx` — remover sección Estado del run (a partir de línea ~308)
- `ui/src/app/admin/monitoring/page.tsx` — añadir sección run status
- `ui/src/lib/api.ts` — verificar/agregar función de cliente para estado del run
- `api/src/routes/admin/monitoring.ts` o ruta existente — asegurar que el endpoint de run status exista y devuelva lo necesario (logs, fase activa, timestamps)

**Validación mínima**
- `pnpm --dir ui typecheck`
- `pnpm --dir ui build`
- `pnpm smoke:api`
- smoke manual: disparar un run desde Pipeline, verificar en Monitoreo que se actualiza cada 5 s

---

## MON-4 — Lista de jobs por estado en Monitoreo

**Status:** `pending`

**Objetivo**
- Monitoreo debe mostrar una vista operativa de los discovery jobs agrupados por estado (queued/running/completed/failed) con conteos y lista básica.

**Alcance**
- Añadir endpoint o extender uno existente: `GET /api/v1/admin/monitoring/discovery-jobs` (o `GET /api/v1/admin/discovery/jobs/status-summary`) que devuelva:
  - Conteo por estado.
  - Lista de los últimos N jobs de cada estado con: id, source, location, niche, created_at, error_message si failed.
- Añadir sección en `ui/src/app/admin/monitoring/page.tsx` con tabs o acordeón por estado.
- Polling cada 30 s (no es urgente como el run status).

**No hacer en esta fase**
- No paginar con cursores; un límite fijo de 10–20 por estado es suficiente.
- No agregar acciones de retry/cancel desde aquí todavía.

**Áreas probables**
- `api/src/routes/discovery.ts` o nueva ruta en `api/src/routes/admin/` — endpoint status-summary
- `ui/src/app/admin/monitoring/page.tsx` — sección jobs
- `ui/src/lib/api.ts` — función cliente para el nuevo endpoint

**Validación mínima**
- `pnpm test`
- `pnpm typecheck`
- `pnpm --dir ui typecheck`
- `pnpm --dir ui build`
- `pnpm smoke:api`

---

## OPS-1 — Botones de acciones del sistema en Monitoreo

**Status:** `pending`

**Objetivo**
- Permitir reiniciar los procesos API/core desde Monitoreo sin tener que abrir terminal. El reset de DB solo para admin con confirmación explícita doble.

**Alcance**
- Nuevo endpoint `POST /api/v1/admin/system/restart` — acepta `{ target: "api" | "core" | "all" }`, ejecuta `pm2 restart blindspot-<target>` vía `child_process.exec` y devuelve éxito/error.
- Nuevo endpoint `POST /api/v1/admin/system/reset-db` — **solo admin**, acepta `{ confirm: true }` y ejecuta el script `reset-db.sh`. Requiere doble confirmación en UI (modal con texto de confirmación explícito).
- Sección "Acciones del sistema" en `ui/src/app/admin/monitoring/page.tsx` con:
  - Botón "Reiniciar API" / "Reiniciar Core" / "Reiniciar todo" (sin confirmación adicional).
  - Botón "Reset DB" (admin only, abre modal con texto de alerta y campo de confirmación).
- RBAC: restart disponible para admin; reset-db solo admin.

**No hacer en esta fase**
- No exponer comandos arbitrarios.
- No ejecutar nada sin RBAC verificado en el backend.

**Riesgos a vigilar**
- `reset-db.sh` es destructivo: la UI debe tener doble confirmación y el backend debe verificar `role === "admin"` antes de ejecutar.
- `child_process.exec` con rutas relativas puede fallar según CWD del proceso API; usar rutas absolutas con `path.resolve(__dirname, '../../reset-db.sh')` o similar.

**Áreas probables**
- `api/src/routes/admin/system.ts` — nuevo archivo de rutas
- `api/src/server.ts` — registrar nueva ruta
- `ui/src/app/admin/monitoring/page.tsx` — sección acciones
- `ui/src/lib/api.ts` — funciones cliente restart/reset-db

**Validación mínima**
- `pnpm test`
- `pnpm typecheck`
- `pnpm --dir ui typecheck`
- `pnpm --dir ui build`
- `pnpm smoke:api`
- smoke manual: reiniciar un proceso y verificar que PM2 reporta el nuevo uptime

---

## PIPE-1 — Budget GP configurable desde Pipeline UI

**Status:** `pending`

**Objetivo**
- El presupuesto mensual de Google Places (`google_places_budget_total`) debe poder verse y editarse desde la UI de Pipeline sin tocar el CLI.

**Alcance**
- Nuevo endpoint `GET /api/v1/admin/pipeline/gp-budget` — devuelve `{ budget_total, budget_spent, budget_remaining, alert_threshold }` leyendo `pipeline_config` (columnas ya existentes: `google_places_budget_total`, `google_places_budget_spent`, `google_places_alert_threshold`).
- Nuevo endpoint `PUT /api/v1/admin/pipeline/gp-budget` — actualiza `google_places_budget_total` y opcionalmente `google_places_alert_threshold`. Solo admin.
- En `ui/src/app/admin/pipeline/page.tsx`: añadir sección "Budget Google Places" con:
  - Vista de total/gastado/restante.
  - Campo editable de total mensual y umbral de alerta.
  - Botón guardar con validación mínima (> 0, razonable).
- Opción adicional: botón "Resetear gasto del mes" que llama a `POST /api/v1/admin/pipeline/gp-budget/reset-spent` — pone `budget_spent = 0` y escribe auditoría.

**No hacer en esta fase**
- No cambiar la tabla `pipeline_config`; columnas ya existen.
- No crear un ciclo automático de reset mensual todavía.

**Áreas probables**
- `api/src/routes/admin/pipeline.ts` o nueva ruta
- `src/storage/pipeline-config.ts` — función `updateGooglePlacesBudget(total, alertThreshold)`
- `ui/src/app/admin/pipeline/page.tsx`
- `ui/src/lib/api.ts` — funciones cliente

**Validación mínima**
- `pnpm test`
- `pnpm typecheck`
- `pnpm --dir ui typecheck`
- `pnpm --dir ui build`
- `pnpm smoke:api`

---

## PIPE-3 — max_jobs configurable desde Pipeline UI

**Status:** `pending`

**Objetivo**
- El parámetro `max_jobs` de la fase de discovery del pipeline debe poder verse y modificarse desde la UI.

**Alcance**
- `max_jobs` vive en `pipeline_config.phases.discovery.max_jobs` (columna JSONB o similar). Verificar estructura real antes de editar.
- Nuevo endpoint o extensión del existente: `PUT /api/v1/admin/pipeline/config` que permita actualizar `phases.discovery.max_jobs` de forma aditiva (JSONB merge). Solo admin.
- En `ui/src/app/admin/pipeline/page.tsx`: añadir control numérico para `max_jobs` (mínimo 1, máximo 50) dentro del bloque de configuración del pipeline.
- Mostrar el valor actual y guardar con confirmación inline.

**No hacer en esta fase**
- No cambiar el esquema de la tabla.
- No exponer otros parámetros de `phases` todavía.

**Áreas probables**
- `api/src/routes/admin/pipeline.ts` — `GET /config` y `PUT /config`
- `src/storage/pipeline-config.ts` — función de actualización con merge JSONB seguro
- `ui/src/app/admin/pipeline/page.tsx`
- `ui/src/lib/api.ts`

**Validación mínima**
- `pnpm test`
- `pnpm typecheck`
- `pnpm --dir ui typecheck`
- `pnpm --dir ui build`
- `pnpm smoke:api`

---

## PIPE-2 — Decremento atómico del Budget GP en DB

**Status:** `done 2026-05-24`

**Objetivo**
- Eliminar la race condition donde dos jobs de Google Places ejecutados en paralelo pueden ambos leer el mismo `budget_remaining` antes de que el otro actualice, llevando a gastar más de lo presupuestado.

**Alcance**
- Modificar `incrementGooglePlacesBudgetSpent` en `src/storage/pipeline-config.ts` para usar una operación atómica en PostgreSQL:
  ```sql
  UPDATE pipeline_config
  SET google_places_budget_spent = google_places_budget_spent + $amount
  WHERE id = 'singleton'
  RETURNING google_places_budget_spent, google_places_budget_total
  ```
- Si el resultado `budget_spent > budget_total` post-update, registrar alerta pero no revertir (el gasto ya ocurrió y es real).
- Alternativamente, usar una función RPC de Supabase que ejecute el update atómico con check de límite y retorne si se excedió: `rpc("increment_gp_budget_spent_atomic", { amount })` — ya existe como `increment_gp_budget_spent`, verificar si tiene el check.
- Si la función RPC ya implementa el decremento correcto, asegurarse de que el fallback del `catch` en `incrementGooglePlacesBudgetSpent` no sobrescriba el valor calculado (bug potencial en la implementación actual donde el catch hace un UPDATE con el valor leído anteriormente, que puede estar desactualizado).

**No hacer en esta fase**
- No agregar bloqueos de fila (FOR UPDATE) si el RPC atómico ya resuelve.
- No cambiar el flujo de mid-execution cut ya implementado.

**Riesgos a vigilar**
- La función RPC actual puede no tener check de límite; verificar definición antes de asumir atomicidad.
- El fallback en `catch` hace un SELECT + UPDATE no atómico — es el bug a resolver.

**Áreas probables**
- `src/storage/pipeline-config.ts` — `incrementGooglePlacesBudgetSpent` (líneas ~14–20)
- Migración SQL si se necesita ajustar la función RPC en Supabase

**Validación mínima**
- `pnpm test`
- `pnpm typecheck`
- Tests específicos de concurrencia o al menos de la función de incremento
- Verificar definición de `increment_gp_budget_spent` en Supabase antes de cerrar

---

## CRM-5 — Drag & drop en board, popup de card y título = nombre del lead

**Status:** `done 2026-05-24`

**Objetivo**
- Completar la UX del board CRM: arrastrar cards entre columnas, ver detalle del lead en popup al hacer clic, y mostrar el nombre del lead como título de la card.

**Alcance**
- **4a — Drag & drop:** usar `@dnd-kit/core` + `@dnd-kit/sortable` para permitir arrastrar cards entre columnas del board. Al soltar, llamar `transitionTracking` con el estado destino. Requiere aprobación de dependencia antes de instalar.
- **4b — Popup de detalle:** al hacer clic en una card (no en los botones de transición), abrir un modal/slide-over con:
  - Datos básicos del lead (nombre, niche, location, website, teléfono si existe).
  - Timeline de eventos del tracking (ya disponible vía `GET /tracking/:id`).
  - Controles de transición desde el modal.
- **4c — Título de card = nombre del lead:** actualmente la card puede mostrar `lead_id` u otro identificador. Cambiar para mostrar `lead.name` o `lead.business_name`. Requiere enriquecer la respuesta del tracking con datos del lead (JOIN o campo adicional en `GET /tracking`).

**Prerequisitos**
- Aprobación explícita del usuario para instalar `@dnd-kit/core` y `@dnd-kit/sortable`.

**No hacer en esta fase**
- No implementar orden dentro de columnas (drag solo entre columnas).
- No mezclar nuevas etapas CRM.

**Áreas probables**
- `ui/src/app/admin/crm/page.tsx` — board + modal
- `ui/src/lib/crm-tracking.ts` — helpers
- `ui/src/lib/api.ts` — cliente tracking con campos de lead
- `api/src/routes/tracking.ts` — enriquecer respuesta GET con datos del lead (JOIN a `leads`)

**Validación mínima**
- `pnpm test`
- `pnpm typecheck`
- `pnpm --dir ui typecheck`
- `pnpm --dir ui build`
- `pnpm smoke:api`
- smoke manual: arrastrar card, verificar transición persiste; clic en card abre modal con nombre del lead

---

## DISC-4 — Algoritmo de búsqueda de lugares por sub-áreas

**Status:** `done 2026-05-24`

**Objetivo**
- Mejorar la cobertura de discovery subdividiendo ubicaciones grandes en sub-áreas geográficas, lanzando una query por sub-área y deduplicando resultados por `placeId`.

**Alcance**
- Crear módulo `src/modules/discovery/location-subdivider.ts` que dado un string de ubicación (ej: "Montevideo, Uruguay") retorne una lista de sub-áreas razonables (ej: barrios conocidos o cuadrantes). Para Uruguay: usar lista predefinida de barrios/zonas por ciudad.
- Modificar `fetchPlaceCandidates` en `src/modules/discovery/places.ts` para:
  - Si la ubicación no tiene sub-áreas configuradas, comportarse igual que ahora (1 query).
  - Si tiene sub-áreas, lanzar N queries en paralelo (controladas por `pLimit`) y mergear resultados.
  - Deduplicar por `placeId` antes de retornar.
- Actualizar `textSearchRequestCount` para reflejar el total real de queries realizadas.
- El costo estimado debe recalcularse en `estimateGooglePlacesCostUsd` si el número de sub-áreas multiplica las queries.

**No hacer en esta fase**
- No subdivir automáticamente basándose en área geográfica calculada; usar lista predefinida.
- No cambiar el contrato de la función `fetchPlaceCandidates` más allá de lo necesario.

**Áreas probables**
- `src/modules/discovery/places.ts`
- `src/modules/discovery/location-subdivider.ts` (nuevo)
- `src/modules/pipeline/google-places-discovery-job.ts` — actualizar estimación si la función cambia
- Tests en `tests/discovery/`

**Validación mínima**
- `pnpm test`
- `pnpm typecheck`
- Tests de deduplicación y conteo correcto de requests

---

## DISC-5 — Algoritmo de georreferenciación mejorado

**Status:** `done 2026-05-24`

**Objetivo**
- Validar que las coordenadas GPS recibidas de Places API estén dentro de los límites geográficos esperados e inferir el departamento del lead desde coordenadas o nombre de ubicación.

**Alcance**
- Crear módulo `src/modules/discovery/geo-validator.ts` con:
  - `isWithinUruguay(lat, lng): boolean` — bounding box de Uruguay: lat [-34.95, -30.08], lng [-58.44, -53.17].
  - `inferDepartamento(lat, lng, locationString): string | null` — usa un mapa de polígonos simplificados o al menos bounding boxes por departamento para inferir el departamento. Si no es posible, retorna `null`.
- Aplicar la validación en el enriquecimiento de candidatos: si las coordenadas están fuera del bounding box del país, marcar el candidato con una flag `geo_suspect: true` o aplicar un filtro configurable.
- Guardar el departamento inferido como campo del lead si el modelo lo soporta (verificar schema de `leads`).

**No hacer en esta fase**
- No implementar lookup de polígonos exactos (Turf.js o similares) sin aprobación de dependencia.
- No cambiar el scoring por geo_suspect todavía.

**Áreas probables**
- `src/modules/discovery/geo-validator.ts` (nuevo)
- `src/modules/discovery/filters.ts` — aplicar validación en pipeline de candidatos
- `src/modules/discovery/google-data-enricher.ts` — enriquecer con departamento inferido
- Tests en `tests/discovery/`

**Validación mínima**
- `pnpm test`
- `pnpm typecheck`
- Tests unitarios del validador con coordenadas dentro y fuera de Uruguay

---

## DISC-6 — Creación masiva de jobs desde UI

**Status:** `done 2026-05-24`

**Objetivo**
- Permitir crear múltiples discovery jobs de una sola vez desde la UI, con selector de ciudad × nicho predefinido y estimación de costo total antes de confirmar.

**Alcance**
- Nuevo endpoint `POST /api/v1/admin/discovery/jobs/bulk` que acepta un array de job definitions y los inserta en `discovery_jobs` en un solo batch. Validar cada uno (fuente, location, niche, cost_cap_usd requeridos). Devolver IDs creados y costo estimado total.
- En `ui/src/app/admin/discovery/page.tsx`: añadir sección o modal "Creación masiva" con:
  - Checkboxes para seleccionar ciudades (lista predefinida de ciudades de Uruguay).
  - Checkboxes para seleccionar niches (lista predefinida de los más exitosos históricamente).
  - `max_results` y `cost_cap_usd` globales configurables para el lote.
  - Preview de cuántos jobs se crearán y costo estimado total (`estimateGooglePlacesCostUsd(max_results) × N`).
  - Botón "Crear lote" con confirmación si el costo estimado supera un umbral.
- Lista predefinida de ciudades: Montevideo, Salto, Paysandú, Las Piedras, Rivera, Maldonado, Tacuarembó, Melo, Mercedes, Artigas, Minas, San José, Durazno, Florida, Trinidad, Rocha, Fray Bentos, Nueva Helvecia, Dolores, Young.
- Lista de niches exitosos: restaurante, hotel, clínica, ferretería, supermercado, farmacia, peluquería, taller, panadería, estudio contable.

**No hacer en esta fase**
- No implementar templates guardados de batches; la lista predefinida es suficiente.
- No disparar los jobs automáticamente; solo crearlos como "queued".

**Áreas probables**
- `api/src/routes/discovery.ts` — endpoint bulk
- `src/storage/discovery-jobs.ts` — función `bulkInsertDiscoveryJobs`
- `ui/src/app/admin/discovery/page.tsx` — sección creación masiva
- `ui/src/lib/api.ts` — cliente bulk jobs

**Validación mínima**
- `pnpm test`
- `pnpm typecheck`
- `pnpm --dir ui typecheck`
- `pnpm --dir ui build`
- `pnpm smoke:api`
- smoke manual: crear un lote de 3 jobs y verificar que aparecen como queued en la lista

---

# Ciclo 3 — Detalle de fases (abierto 2026-05-24)

> Cada fase aquí descrita pertenece al nuevo ciclo de mejoras operativas y comerciales lanzado por el usuario el 2026-05-24. El orden ejecutable y dependencias viven en `ROADMAP_CANONICAL.md`. Una fase debe partirse si excede los límites globales (12 archivos, 600 líneas netas, o mezcla schema+backend+UI sin necesidad real).

---

## BUG-1 — Budget Google Places muestra 0 gastado

**Status:** `done` (2026-05-24)

**Resultado esperado**
- `GET /api/v1/pipeline/gp-budget` devuelve un `budget_spent` real, calculado contra los runs `completed` de tipo `google_places` del mes en curso.
- `incrementGooglePlacesBudgetSpent` (en `src/storage/pipeline-config.ts`) no queda en silencio si falla; relanza el error y se loggea con contexto del run.
- En Pipeline UI y en Discovery (card "Discovery en cola") el valor mostrado coincide con la suma real, no con el default 0.
- Hay un comando o RPC reproducible que recalcula `google_places_budget_spent` desde el histórico de runs (`backfillGooglePlacesBudget`) y se documenta cuándo correrlo.

**Áreas/archivos probables**
- `src/storage/pipeline-config.ts` — `getGooglePlacesBudgetStatus`, `incrementGooglePlacesBudgetSpent`, `backfillGooglePlacesBudget`.
- `src/modules/pipeline/google-places-discovery-job.ts:164-175` — orden de `completeRun` + increment, asegurar que ambas operaciones ocurran o ninguna.
- `api/src/routes/pipeline.ts:495-538` — endpoints GP budget.

**Cambios prohibidos**
- Tocar la tabla `pipeline_config` con migraciones nuevas si no es estrictamente necesario; preferir backfill por RPC.

**Validación mínima**
- `pnpm test` (cobertura de `incrementGooglePlacesBudgetSpent` y `backfillGooglePlacesBudget`).
- `pnpm smoke:api` GET budget.
- Smoke manual: lanzar un job de yelu (no-billable), no debe mover el spent; lanzar un fake run de google_places via test seed y verificar que el spent crece.

**Riesgos**
- Inflar el spent con runs viejos al hacer backfill. Mitigación: filtrar por `finished_at >= start_of_month` y dejar el alcance escrito.

---

## BUG-2 — Card "Discovery en cola" muestra "Budget GP restante USD 200" siempre

**Status:** `done` (2026-05-24, resuelto por BUG-1 — UI ya leía dinámico, el problema era el backend)

**Resultado esperado**
- La hint de la StatCard "Discovery en cola" en `/admin` (`ui/src/app/admin/page.tsx:100`) muestra el `budget_remaining` real, no 200.
- Si BUG-1 está cerrado, esta fase es casi trivial; si no, esta fase **depende** de BUG-1 y no puede cerrarse antes.
- La fase queda cubierta por UI-5 si la card desaparece al rediseñar el home; coordinar para no duplicar trabajo.

**Áreas/archivos probables**
- `ui/src/app/admin/page.tsx`

**Validación mínima**
- `pnpm --dir ui typecheck`
- Smoke browser: verificar que el valor coincide con el de Pipeline UI.

---

## OPS-2 — Pantalla unificada `/admin/operations` (Pipeline + Monitoreo)

**Status:** `done` (2026-05-24)

**Resultado esperado**
- Existe `/admin/operations` con secciones colapsables `Pipeline` y `Monitoreo`. Cada sección reusa el contenido funcional actual de `/admin/pipeline` y `/admin/monitoring` sin perder features.
- Existe un componente reusable `ui/src/components/collapsible-section.tsx` con API similar a `SectionCard` + soporte de `defaultOpen`, `open`/`onToggle` controlados, `id` para deep-linking por hash.
- `ui/src/app/admin/pipeline/page.tsx` y `ui/src/app/admin/monitoring/page.tsx` quedan eliminadas; su contenido fue extraído a `ui/src/components/operations/pipeline-section.tsx` y `ui/src/components/operations/monitoring-section.tsx`.
- Sidebar (`ui/src/components/admin-shell.tsx`) mueve los links viejos a una sola entrada "Operación" → `/admin/operations`. No hay links rotos a `/admin/pipeline` ni `/admin/monitoring` en el resto del repo.
- Toggle de cada sección persiste en `sessionStorage` con clave propia.

**Áreas/archivos probables**
- `ui/src/app/admin/operations/page.tsx` (nuevo).
- `ui/src/components/collapsible-section.tsx` (nuevo).
- `ui/src/components/operations/pipeline-section.tsx`, `monitoring-section.tsx` (nuevos, JSX migrado).
- `ui/src/components/admin-shell.tsx` (sidebar).
- `ui/src/app/admin/pipeline/page.tsx`, `ui/src/app/admin/monitoring/page.tsx` (eliminar).

**Cambios prohibidos**
- Cambiar contratos de API en esta fase. Solo migración de UI.
- Tocar polling intervals o lógica de auto-refresh sin justificación.

**Validación mínima**
- `pnpm --dir ui typecheck`
- `pnpm --dir ui build`
- Smoke navegador: ambos secciones cargan, polling sigue activo, restart system buttons funcionan, deep-link `/admin/operations#monitoring` abre la sección expandida.

**Riesgos**
- Romper polling o estado de useEffect al extraer JSX. Mitigación: mover hooks y estado completos como están, no refactorizar.

---

## OPS-3 — Mover "Enrichment de colección" a Operaciones

**Status:** `done` (2026-05-24)

**Resultado esperado**
- El bloque `Enrichment de colección` que hoy vive embebido en Lead Explorer (`ui/src/components/lead-explorer.tsx:672-708`) deja de mostrarse desde el dashboard home.
- Existe una nueva sección colapsable dentro de `/admin/operations` que ofrece la misma funcionalidad y más: filtros combinables incluyendo todos los del schema actual (`contact_tier`, `prospect_score_gte`, `niche`, `source`, `primary_offer`, `q`) y los nuevos `missing_*` (cubiertos por DISC-8) cuando ya estén disponibles.
- El endpoint sigue siendo `POST /api/v1/admin/enrichment/filter-jobs`; no cambia el contrato server-side.
- El resultado (run_id, lead_count) se muestra inline y con link al sub-bloque de procesos en Operaciones.

**Áreas/archivos probables**
- `ui/src/components/operations/enrichment-section.tsx` (nuevo).
- `ui/src/app/admin/operations/page.tsx`.
- `ui/src/components/lead-explorer.tsx` (remover bloque embebido).

**Validación mínima**
- `pnpm --dir ui typecheck`, `pnpm --dir ui build`.
- Smoke API: lanzar un filter-job desde la nueva sección y validar 202 + run aparece en Procesos.

**Riesgos**
- Lead Explorer reutilizado en varias pantallas; verificar que ninguna queda rota al sacar el bloque.

---

## OPS-4 — Apartado "Variables" en Operaciones

**Status:** `pending`

**Resultado esperado**
- Una sección colapsable `Variables` dentro de `/admin/operations` lista todas las variables runtime configurables del pipeline en formato key-value con descripción, tipo, default y valor actual.
- Cubre como mínimo las que hoy viven en `pipeline_config`: `cron_enabled`, `cron_daily_hour`, `max_jobs`, `google_places_budget_total`, `google_places_alert_threshold`, `webhook_url`, `webhook_secret`, `webhook_events`.
- Cualquier variable nueva agregada por fases posteriores (PIPE-4, PIPE-5, etc.) debe aparecer automáticamente en esta sección via un registry server-side.
- Edición inline con confirmación; auditoría se persiste en `audit_log` cuando cambia un valor.
- Permisos: solo `admin`.

**Áreas/archivos probables**
- `api/src/routes/admin/variables.ts` (nuevo): `GET /admin/variables` y `PATCH /admin/variables/:key`.
- `src/storage/pipeline-config.ts` o `src/storage/variables.ts` (nuevo registry).
- `ui/src/components/operations/variables-section.tsx` (nuevo).

**Validación mínima**
- `pnpm test`, `pnpm typecheck`.
- `pnpm smoke:api` GET y PATCH.
- Smoke UI: cambiar `max_jobs` desde Variables y ver que `pipeline_config` queda con el nuevo valor.

**Riesgos**
- Exponer secretos (webhook_secret) en plano por la API. Mitigación: enmascarar valores sensibles en GET y permitir solo PATCH cuando se manda el valor completo.

---

## OPS-5 — Apartado "Procesos" con métricas en vivo y gráficos

**Status:** `pending`

**Resultado esperado**
- Una sección `Procesos` dentro de `/admin/operations` muestra:
  - Lista de runs/jobs activos y recientes (queued, running, completed, failed) reusando datos de `/admin/monitoring/discovery-jobs`.
  - Panel lateral: cuántos hilos corren ahora, qué job ocupa cada hilo, consumo CPU/MEM por proceso.
  - Click en un job abre vista detalle con logs en tiempo real (poll 2-3 s) y gráficos de consumo CPU/MEM/Network de los últimos N minutos.
- Existe endpoint `GET /api/v1/admin/operations/process-metrics` que devuelve snapshot de:
  - Procesos `blindspot-api`, `blindspot-core`, `blindspot-ui` (CPU%, MEM bytes, uptime).
  - Hilos lógicos activos (workers, concurrency level corriente).
  - Si está disponible vía `node-os-utils`, `pidusage` o similar, métricas más finas.
- Gráficos: usar Recharts (si ya está en deps) o `chart.js` (si está); si ninguno, **detenerse para aprobación de dependencia nueva** (`dependency-approval`).
- Datos históricos: persistir snapshots cada 30s en una tabla `process_metrics` con TTL de 24h.

**Áreas/archivos probables**
- `api/src/routes/admin/operations.ts` (nuevo).
- `src/storage/process-metrics.ts` (nuevo).
- `supabase/migrations/*_process_metrics.sql` (nueva tabla con TTL).
- `ui/src/components/operations/processes-section.tsx` (nuevo).
- `ui/src/components/operations/process-charts.tsx` (gráficos).

**Cambios prohibidos**
- No hacer polling con interval < 2s.
- No persistir métricas más de 24h sin aprobación explícita.

**Validación mínima**
- `pnpm test`, `pnpm typecheck`, `supabase db reset` por la migración nueva.
- Smoke browser: arrancar un job y ver que aparece con su consumo en tiempo real.

**Riesgos**
- Crecer la DB con métricas. Mitigación: TTL agresivo + index sobre `recorded_at`.
- Dependencia nueva de librería de charts. Detenerse y pedir aprobación si no hay una en deps.

---

## DISC-7 — Reordenar Discovery: Creación masiva debajo de Composer

**Status:** `pending`

**Resultado esperado**
- En `ui/src/app/admin/discovery/page.tsx`, el bloque `Creación masiva` (hoy al final) queda inmediatamente debajo del bloque `Composer`. Orden vertical resultante: Stats → Composer → Creación masiva → (espacio para Refresh masivo de DISC-8) → Recomendaciones → Mapa → Batches recientes → Legacy jobs.
- Composer y Creación masiva pueden ser full-width o stacked, lo que dé mejor lectura. Las dos formas de crear jobs quedan visualmente agrupadas.

**Áreas/archivos probables**
- `ui/src/app/admin/discovery/page.tsx` (solo reordenamiento JSX).

**Validación mínima**
- `pnpm --dir ui typecheck`, `pnpm --dir ui build`.
- Smoke navegador: confirmar orden visual.

---

## DISC-8 — Refresh masivo de leads desde Discovery (filtros incluyendo missing_*)

**Status:** `pending`

**Resultado esperado**
- Existe nueva sección "Refresh masivo" debajo de Creación masiva en `/admin/discovery`.
- Permite filtrar por:
  - Filtros lógicos existentes: `contact_tier`, `prospect_score_gte`, `niche`, `source`, `primary_offer`, `q`.
  - Nuevos filtros booleanos `missing_*`: `missing_gps`, `missing_address`, `missing_phone`, `missing_whatsapp`, `missing_email`, `missing_website`.
- Hay un botón "Estimar impacto" que devuelve count sin lanzar. Si el count > 50, requiere confirmación explícita.
- Al confirmar lanza `POST /api/v1/admin/enrichment/filter-jobs` extendido para soportar los nuevos campos.
- `enrichCollectionSchema` (en `api/src/routes/leads.ts:22-31`) se extiende con los 6 booleans opcionales.
- `EnrichmentLeadFilterSelection`, `countLeadsByFilterSelection`, `loadLeadsByFilterSelection` (en `src/storage/leads.ts`) aplican `.is(col, null)` cuando el flag viene `true`.
- `hasRelevantEnrichmentFilter` cuenta cualquier `missing_*` como filtro relevante.
- Límite actual de 250 leads se mantiene; si se cambia debe quedar configurable via Variables (OPS-4).

**Áreas/archivos probables**
- `api/src/routes/leads.ts` schema y handler.
- `src/storage/leads.ts` (storage layer y types).
- `ui/src/app/admin/discovery/page.tsx` (sección Refresh masivo).
- `ui/src/lib/api.ts` (cliente).

**Validación mínima**
- `pnpm test` (filtros nuevos en storage).
- `pnpm smoke:api` con body `{"missing_gps":true}`.
- `pnpm --dir ui typecheck`.
- Smoke browser: refrescar leads sin gps y ver que aparece run en Procesos.

**Riesgos**
- `lead_dashboard` view podría no exponer todas las columnas necesarias para los filtros nuevos. Si falta alguna, agregar a la view en una migración aditiva, no rehacer la view.

---

## DISC-9 — Refresh debe permitir re-discovery (no solo enrichment)

**Status:** `pending`

**Resultado esperado**
- El refresh masivo de DISC-8 ofrece dos modos:
  - **Enrichment** (existente): re-corre el enrichment pipeline sobre los leads filtrados.
  - **Re-discovery** (nuevo): para leads con `place_id` no nulo (origen google_places), vuelve a llamar a Google Places Details para refrescar campos que pudieron cambiar (rating, review_count, business_status, opening hours, lat/lng, etc.).
- Para fuentes no-google, el modo re-discovery está deshabilitado en UI con tooltip explicativo.
- El re-discovery NO duplica el lead; hace merge campo-a-campo preservando datos manuales (notes, tags manuales, contacted_at, etc.) y refrescando solo los provenientes de la fuente.
- Mantener guardrail de costo: si el modo es re-discovery + fuente google_places, se respeta el GP budget cap (PIPE-4).
- Acción se loguea en `audit_log` con el filtro y el modo.

**Áreas/archivos probables**
- `api/src/routes/leads.ts` extender schema con `mode: enum(["enrichment", "re_discovery"])`.
- `src/cli/commands/enrich.ts` o nuevo `src/cli/commands/re-discover.ts`.
- `src/modules/discovery/places.ts` (reuso de `fetchPlaceDetails`).
- `src/storage/leads.ts` (función de merge limitado).

**Cambios prohibidos**
- No correr Google Places con API key real durante tests automáticos; mockear `fetchPlaceDetails`.

**Validación mínima**
- `pnpm test` (merge de campos preserva manuales).
- Smoke API: mock de Places Details + verificar que el lead queda con `rating` actualizado y `notes` preservado.

**Riesgos**
- Pisar `digital_footprint` o tags. Mitigación: lista explícita de campos refrescables.

---

## DISC-10 — Importación XLS de lugares de discovery

**Status:** `pending`

**Resultado esperado**
- Existe `POST /api/v1/admin/discovery/places/import` que acepta multipart con un `.xlsx` y carga las filas en una nueva tabla `discovery_places_catalog` (location_key, display_name, parent_location, kind, lat_approx, lng_approx, commercial_score, notes, source = "xls_import", imported_at, imported_by_user_id).
- En `/admin/discovery`, sección Recomendaciones (o nueva sub-sección "Catálogo de lugares") muestra las entradas importadas como sugerencias clickeables que prefillean el Composer.
- Validación: rechazar fila con `location_key` duplicado contra DB existente (upsert por key con confirmación explícita en query param `upsert=true`).
- El formato XLSX esperado es el que define `context/prompts/deepsearch-discovery-places.md`.
- Reusar parser `xlsx` si ya está en deps; si no, detenerse para aprobación de dependencia nueva.

**Áreas/archivos probables**
- `supabase/migrations/*_discovery_places_catalog.sql`.
- `api/src/routes/admin/discovery-places.ts` (nuevo).
- `src/storage/discovery-places.ts` (nuevo).
- `ui/src/app/admin/discovery/page.tsx` (sub-sección).

**Validación mínima**
- `pnpm test` (parser de XLSX con fixture pequeño).
- `pnpm smoke:api` upload de un fixture.
- `supabase db reset`.

**Riesgos**
- XLS malformado puede tirar el endpoint. Mitigación: parser tolerante con validación fila a fila + report de errores antes de insertar.

---

## DISC-11 — Optimizar discovery de Google Places (reducir descartes)

**Status:** `pending`

**Resultado esperado**
- Análisis previo (auditoría): identificar la tasa actual de descartes por run y las causas más comunes (duplicados por placeId, fuera de zona, niche incorrecto, etc.). Dejar el reporte en `context/research/disc-11-analysis.md`.
- Implementar optimizaciones específicas según los hallazgos. Hipótesis a validar primero:
  - Subdivisión de ubicación más fina (sub-áreas más pequeñas).
  - Filtro pre-API: si la combinación (location_key, niche) ya tiene N resultados recientes, no relanzar.
  - Dedup más agresivo entre runs paralelos.
  - Skip de páginas posteriores cuando la tasa de descarte de la primera página supera un umbral.
- KPI: para un lote de jobs equivalente, reducir el costo USD por lead nuevo en al menos 25% sin perder cobertura significativa.

**Áreas/archivos probables**
- `src/modules/discovery/places.ts`.
- `src/modules/pipeline/google-places-discovery-job.ts`.
- `context/research/disc-11-analysis.md` (nuevo).

**Validación mínima**
- `pnpm test` (tests específicos de las nuevas heurísticas).
- Smoke: simular dos lotes equivalentes (uno con código viejo, otro con nuevo) sobre data sintética y comparar la métrica.

**Cambios prohibidos**
- Ejecutar discovery real billable. Toda validación con mocks/fixtures.

**Riesgos**
- Optimizar de más y perder leads válidos. Mitigación: A/B test con flag tipo `discovery_optimization_v2` controlable via Variables (OPS-4).

---

## PIPE-4 — Hard cap mensual del Budget Google Places

**Status:** `done`

**Resultado esperado**
- Es imposible que el sistema corra un job de google_places si el `budget_spent_month` actual + estimated_cost del job > `budget_total`.
- El cap se valida en tres niveles:
  1. UI Composer: deshabilita el botón si la estimación más spent excede.
  2. API: `POST /discovery/jobs/bulk` y `POST /discovery/batches` rechazan con 400 si el run llevaría a exceder.
  3. Core: el job al arrancar valida una última vez con `getGooglePlacesBudgetStatus` y aborta antes de la primera request.
- El cap es por **mes calendario** UTC. `budget_spent` se rastrea por mes (nueva columna o vista agregada sobre `runs.stats`).
- Métrica visible en Pipeline UI: spent del mes vs cap, % consumido, días restantes del mes.
- Override manual: un admin puede subir el `budget_total` en cualquier momento via Variables (OPS-4) y el sistema lo respeta.

**Áreas/archivos probables**
- `supabase/migrations/*_gp_budget_monthly.sql` (columna `budget_spent_month` o vista nueva).
- `src/storage/pipeline-config.ts`.
- `src/modules/pipeline/google-places-discovery-job.ts`.
- `api/src/routes/discovery.ts` (validación en bulk y batches).
- `ui/src/app/admin/discovery/page.tsx` y `ui/src/app/admin/operations/page.tsx`.

**Validación mínima**
- `pnpm test` (test específico que verifica que se rechaza un job que excedería).
- `pnpm smoke:api`.
- `supabase db reset`.

**Riesgos**
- Race entre dos jobs paralelos que cada uno individualmente cabe pero juntos no. Mitigación: usar el decremento atómico ya existente (PIPE-2) + validación post-claim.

---

## PIPE-5 — Concurrencia configurable por run con perfiles de consumo

**Status:** `done`

**Resultado esperado**
- En Composer (manual) y en cron config, se puede especificar:
  - **Número fijo** de jobs simultáneos (1-N).
  - **O bien**, un porcentaje objetivo de uso de RAM (10-80%) que se mapea al número de jobs según un perfil.
- Reusar los perfiles existentes `cpu_budget` (`conservative`, `balanced`, `aggressive` en `src/modules/pipeline/types.ts`) y el RamMode (`src/shared/ram.ts:7`); extender si es necesario.
- El scheduler respeta la concurrencia configurada y ajusta workers dinámicamente.
- Si se pasa porcentaje de RAM, el sistema monitorea consumo y throttlea jobs cuando se acerca al cap.
- UI muestra el preview: "con perfil X corriendo Y jobs ≈ Z% RAM esperado".

**Áreas/archivos probables**
- `src/modules/pipeline/scheduler.ts`.
- `src/shared/ram.ts` (extender).
- `api/src/routes/pipeline.ts` (config endpoint).
- `ui/src/components/operations/variables-section.tsx` o composer de discovery.

**Validación mínima**
- `pnpm test` (concurrency respect tests).
- Smoke: lanzar lote de 10 jobs con concurrency=2 y verificar que el scheduler nunca corre más de 2 en paralelo.

**Riesgos**
- Throttling agresivo que mata jobs en curso. Mitigación: solo throttlear nuevos jobs, nunca matar uno corriendo.

---

## MAP-2 — Mapa heatmap granular con geocoding

**Status:** `dependency-approval`

**Resultado esperado**
- La densidad del mapa ya no agrupa solo a nivel departamento, sino a nivel **barrio/zona/cuadricula** (resolución configurable, default ~500m).
- Si un lead tiene `gps` real, se usa.
- Si un lead tiene `address` confiable (de fuente con fiabilidad media o alta) pero NO `gps`, se geocodea y persiste en una nueva columna `gps_inferred boolean` para distinguirla. La fuente del geocoding se registra en `gps_source enum("google_places","provider","geocoder_nominatim","geocoder_mapbox")`.
- Geocoder: usar Nominatim (OpenStreetMap) por default — gratis, rate-limited a 1 req/s. Si se necesita más velocidad, Mapbox o Google Geocoding requieren `dependency-approval` explícito.
- Backfill: tarea en core que va procesando leads sin gps de a tandas respetando rate limit.
- `lead-density` endpoint devuelve cuadrículas con `commercial_density_score` y `lead_count`, ya no solo departamentos.

**Áreas/archivos probables**
- `supabase/migrations/*_lead_gps_inferred.sql`.
- `src/modules/discovery/geocoder.ts` (nuevo).
- `src/modules/pipeline/geocoding-backfill-job.ts` (nuevo).
- `api/src/routes/discovery.ts` y `api/src/routes/discovery-insights.ts`.
- `ui/src/components/location-density-map.tsx`.

**Validación mínima**
- `pnpm test` con fixtures de geocoding mockeadas.
- `supabase db reset`.
- Smoke: backfill de 10 leads sin gps, verificar que aparecen con `gps_source` no-google.

**Riesgos**
- Nominatim TOS prohíbe heavy use. Mitigación: rate limit estricto + cache permanente del resultado por address.

---

## MAP-3 — Filtros del mapa heatmap

**Status:** `pending`

**Resultado esperado**
- El mapa permite filtrar visualmente por:
  - `source` del lead (yelu, mintur, osm, google_places, pedidosya).
  - `niche` (texto libre con autocompletado).
  - `prospect_score_gte` (slider 0-100).
  - `contact_tier` (A/B/C/D/X multi-select).
  - `gps_source` (real vs inferido vs google) — fiabilidad del dato de geolocalización.
- El endpoint `/admin/geo/lead-density` acepta esos query params y los aplica antes de agregar.
- UI: panel lateral con los filtros, debounce de 300ms, indicador de leads filtrados.

**Áreas/archivos probables**
- `api/src/routes/discovery.ts:673` (extender query schema).
- `ui/src/components/location-density-map.tsx`.

**Validación mínima**
- `pnpm test` (filtros aplicados en `buildLeadDensityRows`).
- `pnpm smoke:api`.
- Smoke browser.

---

## MAP-4 — Modo "leads individuales por zona" en el mapa

**Status:** `pending`

**Resultado esperado**
- El mapa tiene un toggle entre dos modos:
  - **Heatmap** (default): densidad por zona como hoy.
  - **Individual**: cada lead es un pin con popup que muestra `name`, `niche`, `contact_tier`, `prospect_score` y link a la ficha.
- Click en una zona del heatmap zoomea a la zona y cambia a modo individual mostrando solo los leads de esa zona.
- Si la zona tiene más de 200 leads, mostrar muestra paginada con "+N más" + link a Lead Explorer con el filtro pre-poblado.
- UX: el diseño es claro, pins agrupados con clustering (Leaflet markercluster). Si markercluster no está en deps, **detenerse para aprobación de dependencia nueva**.

**Áreas/archivos probables**
- `ui/src/components/location-density-map.tsx`.
- `ui/src/lib/location-density-map.ts`.
- `api/src/routes/discovery.ts` (endpoint que devuelva leads por bbox).

**Validación mínima**
- `pnpm --dir ui typecheck`, `pnpm --dir ui build`.
- Smoke browser: toggle modos, click en zona, ver leads.

---

## UI-3 — Limpiar referencias UI a "Campañas" deprecated

**Status:** `pending`

**Resultado esperado**
- En `/admin` (home) NO hay StatCard "Campañas activas", alert "Sin campañas activas" ni section "Campañas" en activity.
- En `/admin/leads/[id]` NO hay modal "Iniciar campaña" ni state asociado.
- En `/admin/help` y `/login` no hay strings sobre campañas.
- `_deprecated/outreach-page.tsx` queda como está (no se renderiza).
- `ui/src/lib/api.ts` mantiene las funciones legacy exportadas pero el resto de la UI no las llama.
- `api/src/routes/campaigns.ts` y migraciones DB quedan intactas (otro ciclo decide si se eliminan).

**Áreas/archivos probables**
- `ui/src/app/admin/page.tsx`.
- `ui/src/app/admin/leads/[id]/page.tsx`.
- `ui/src/app/admin/help/page.tsx`.
- `ui/src/app/login/page.tsx` (o donde viva la landing).

**Validación mínima**
- `grep -rn "campañas\|listCampaigns\|createCampaign" ui/src/ --include="*.tsx" --include="*.ts"` solo devuelve `_deprecated/`, `lib/api.ts` y URLs `?campaign_id=` en CRM.
- `pnpm --dir ui typecheck`, `pnpm --dir ui build`.
- Smoke browser.

---

## UI-4 — Quitar alerta "Presupuesto Google Places" del home

**Status:** `done`

**Resultado esperado**
- En `ui/src/app/admin/page.tsx`, la AlertRow "Presupuesto Google Places" en el bloque "Alertas" desaparece, junto con la card "Discovery en cola" cuya hint mostraba el budget.
- La info sigue accesible desde `/admin/operations` (Pipeline section) y desde `/admin/discovery`.

**Áreas/archivos probables**
- `ui/src/app/admin/page.tsx`.

**Validación mínima**
- `pnpm --dir ui typecheck`.
- Smoke browser.

---

## UI-5 — Quitar apartado "Colas de trabajo" del home

**Status:** `done`

**Resultado esperado**
- El SectionCard "Colas de trabajo" (`ui/src/app/admin/page.tsx:104`) desaparece.
- Los atajos que ofrecía (hot leads, tier A, etc.) se conservan como filtros directos en Lead Explorer.
- Esta fase preferiblemente se cierra junto con UI-6 (que pone algo más útil en el espacio liberado).

**Áreas/archivos probables**
- `ui/src/app/admin/page.tsx`.

**Validación mínima**
- `pnpm --dir ui typecheck`, `pnpm --dir ui build`.

---

## UI-6 — Reemplazar "Colas de trabajo" + "Alertas" del home por el mapa interactivo

**Status:** `pending`

**Resultado esperado**
- El espacio dejado por UI-5 (Colas) y UI-4 (Alerta GP) en `/admin` se llena con un widget de mapa interactivo basado en MAP-4 (modo dual heatmap + individual).
- El mapa funciona como filtro vivo: click en una zona o en un pin lleva al usuario a Lead Explorer con los leads de esa zona filtrados (`?location_key=...` o bbox).
- El mapa carga lazy con un placeholder mientras el endpoint responde.
- Esta fase **depende** de MAP-4 estar cerrado.

**Áreas/archivos probables**
- `ui/src/app/admin/page.tsx`.
- `ui/src/components/location-density-map.tsx` (reusable).

**Validación mínima**
- `pnpm --dir ui typecheck`, `pnpm --dir ui build`.
- Smoke browser: click en zona del mapa lleva a Lead Explorer con el filtro aplicado.

---

## UI-7 — Limpiar bloques deprecated de la ficha de Lead

**Status:** `done`

**Resultado esperado**
- En `ui/src/app/admin/leads/[id]/page.tsx`:
  - Eliminar SectionCard "Asistente comercial" (línea ~510).
  - Eliminar SectionCard "Outreach e historial" (línea ~717) — parte del dominio Campañas deprecated.
  - Eliminar botón "Ver acciones" (línea ~401).
- Esta fase precede al rediseño de LEAD-5 para que la limpieza no se mezcle con el rediseño.

**Áreas/archivos probables**
- `ui/src/app/admin/leads/[id]/page.tsx`.

**Validación mínima**
- `pnpm --dir ui typecheck`.
- Smoke browser: la ficha de un lead carga sin los bloques eliminados, sin errores.

---

## ALERT-1 — Sistema de alertas en DB (schema + API)

**Status:** `pending`

**Resultado esperado**
- Nueva tabla `system_alerts` con columnas:
  - `id uuid pk`
  - `kind text` (enum lógico: `gp_budget_threshold`, `run_failed`, `job_failed_burst`, `disk_low`, `monitoring_alert`, etc.)
  - `severity text` (enum: `info`, `warn`, `critical`)
  - `title text`, `description text`, `payload jsonb`
  - `target_user_id uuid` (null = broadcast a todos los admin)
  - `status text` (enum: `pending`, `read`, `archived`)
  - `created_at timestamptz`, `read_at timestamptz`, `read_by uuid`
- Endpoints:
  - `GET /api/v1/alerts?status=pending&limit=20` — list para el usuario actual (broadcast + targeted).
  - `POST /api/v1/alerts/:id/read` — marcar como leída.
  - `POST /api/v1/alerts/:id/archive` — archivar.
  - `GET /api/v1/alerts/unread-count` — counter para la campanita.
- Producers iniciales: los disparadores que hoy generan alertas in-memory (over_alert de GP budget, runs failed, jobs failed) escriben a esta tabla.
- RBAC: solo admin/comercial ve sus propias + broadcast.

**Áreas/archivos probables**
- `supabase/migrations/*_system_alerts.sql`.
- `api/src/routes/alerts.ts` (nuevo).
- `src/storage/alerts.ts` (nuevo).
- Productores: `src/modules/pipeline/scheduler.ts`, `src/modules/pipeline/google-places-discovery-job.ts`, etc.

**Validación mínima**
- `pnpm test`, `pnpm smoke:api`.
- `supabase db reset`.

**Riesgos**
- Saturar la tabla con eventos. Mitigación: dedup por `(kind, payload_hash)` dentro de una ventana, + TTL para alerts archived > 30 días.

---

## ALERT-2 — Campanita en UI con counter de alertas no leídas

**Status:** `pending`

**Resultado esperado**
- En el header del AdminPageLayout aparece un icono campanita (top-right, esquina superior derecha de la página, no del sidebar).
- Cuando hay `unread_count > 0`, el icono se muestra azul con un badge numérico encima.
- Click abre dropdown con las últimas 10 alerts pendientes; cada item permite marcar leída o archivar.
- Footer del dropdown con link "Ver todas" → `/admin/alerts` (página simple con tabla paginada).
- Polling cada 30s del `unread_count`.
- Esta fase depende de ALERT-1 cerrada.

**Áreas/archivos probables**
- `ui/src/components/alerts-bell.tsx` (nuevo).
- `ui/src/components/admin-shell.tsx` (header).
- `ui/src/app/admin/alerts/page.tsx` (nuevo).
- `ui/src/lib/api.ts`.

**Validación mínima**
- `pnpm --dir ui typecheck`, `pnpm --dir ui build`.
- Smoke browser: triggerar una alerta (ej. failed run) y ver que la campanita refleja el counter.

---

## CRM-6 — Transiciones CRM bidireccionales

**Status:** `pending`

**Resultado esperado**
- La UI del CRM board permite retroceder de cualquier estado a un estado válido anterior según `VALID_TRANSITIONS` (que ya soporta `observed → contact`, por ejemplo).
- La acción de retroceso queda visualmente diferenciada (icono o color distinto al avance).
- Cada transición exige una nota mínima si es retroceso ("Razón del retroceso").
- Estados terminales (`accepted`, `rejected`) deben poder reabrirse a `validation` con confirmación explícita y nota obligatoria, dejando registro en `lead_tracking_events`.
- Backend ya soporta lo necesario; cambios principalmente en UI + extender `VALID_TRANSITIONS` con reaperturas si no están.

**Áreas/archivos probables**
- `ui/src/app/admin/crm/page.tsx`.
- `ui/src/lib/crm-tracking.ts` (`VALID_TRANSITIONS`).
- `api/src/routes/tracking.ts` (paridad de validaciones).

**Validación mínima**
- `pnpm test`, `pnpm --dir ui typecheck`.
- Smoke browser: mover una card adelante y atrás.

---

## CRM-7 — Historial completo en popup de cualquier etapa

**Status:** `pending`

**Resultado esperado**
- El popup/modal de cualquier card del CRM muestra en su parte inferior un timeline cronológico de TODAS las transiciones del tracking, con:
  - fecha/hora absoluta y relativa
  - `from_status` → `to_status`
  - actor (usuario + rol)
  - canal (si aplica)
  - notas
  - reminder_at (si aplica)
- Los datos vienen de `lead_tracking_events` (ya existe, migración `20260524000000_crm_tracking.sql:40-56`).
- El timeline se ve igual independientemente de en qué etapa esté el tracking ahora.

**Áreas/archivos probables**
- `ui/src/app/admin/crm/page.tsx` (modal).
- `api/src/routes/tracking.ts` (verificar que `GET /:id` ya devuelve events).
- `ui/src/components/crm-timeline.tsx` (nuevo).

**Validación mínima**
- `pnpm --dir ui typecheck`, `pnpm --dir ui build`.
- Smoke: tracking con 5 transiciones se muestra completo y ordenado.

---

## CRM-8 — Filtros en pantalla CRM

**Status:** `pending`

**Resultado esperado**
- La pantalla `/admin/crm` ofrece filtros encima del board:
  - `niche`, `source`, `contact_tier`, `prospect_score_gte`, `assigned_to_user_id`, `status_in`, `created_after`, `q` (texto libre).
- Los filtros se aplican server-side via `GET /api/v1/tracking?...`.
- Persistencia opcional en query params para compartir links.
- Reset rápido con botón "Limpiar filtros".

**Áreas/archivos probables**
- `api/src/routes/tracking.ts`.
- `ui/src/app/admin/crm/page.tsx`.

**Validación mínima**
- `pnpm test`, `pnpm smoke:api`.
- `pnpm --dir ui typecheck`.

---

## RBAC-1 — Datos de contacto ocultos hasta iniciar seguimiento

**Status:** `pending`

**Resultado esperado**
- Para usuarios con role `comercial`, los campos `phone`, `whatsapp`, `email` y cualquier otro dato de contacto vienen redactados (`***` o placeholder) en `GET /api/v1/leads` y `GET /api/v1/leads/:id` hasta que el lead tenga un tracking activo asignado a ese usuario.
- Cuando el usuario crea un tracking (`POST /tracking` con ese lead_id), los datos de contacto se desbloquean **solo para ese usuario** en ese lead.
- Admin no está afectado: ve siempre todo.
- En la UI:
  - Lead Detail muestra los campos redactados con un botón "Iniciar seguimiento para ver contacto".
  - Una vez iniciado, los campos aparecen completos y permanecen visibles.
- La redacción ocurre server-side; el browser nunca recibe los datos completos si no corresponde.

**Áreas/archivos probables**
- `api/src/routes/leads.ts` (redactor function en el GET path).
- `api/src/auth/middleware.ts` (helper para detectar trackings activos del user).
- `ui/src/app/admin/leads/[id]/page.tsx`.

**Validación mínima**
- `pnpm test` (test específico de RBAC).
- `pnpm smoke:api` con usuario comercial.
- Smoke browser: comercial ve `***`, hace tracking, ve `+598...`.

**Riesgos**
- Romper Lead Explorer / pantallas admin si la redactor no respeta el rol. Mitigación: test E2E con dos usuarios (admin y comercial) en paralelo.

---

## CRM-9 — Datos de contacto embebidos en popup CRM

**Status:** `pending`

**Resultado esperado**
- El popup de la columna `contact` del board CRM (estado `contact`) muestra los datos de contacto del lead (phone, whatsapp, email, website) inline, sin tener que abrir la ficha del lead.
- Esos datos son los que se desbloquearon en RBAC-1 al iniciar el seguimiento.
- El popup permite:
  - Marcar cuál canal se usó (radio buttons: WhatsApp, llamada, email).
  - Confirmar o reportar dato erróneo por canal (botones thumbs up/down inline, similar a LEAD-3).
  - Avanzar a la siguiente etapa (transición) con un solo click después de registrar el canal.
- Esta fase depende de RBAC-1 y LEAD-1 (para el diseño del bloque de contacto).

**Áreas/archivos probables**
- `ui/src/app/admin/crm/page.tsx` (popup).
- Componente compartido `ui/src/components/lead/contact-block.tsx` (nuevo, reusable entre Lead Detail y CRM popup).
- `api/src/routes/tracking.ts` (registrar canal usado).

**Validación mínima**
- `pnpm --dir ui typecheck`, `pnpm --dir ui build`.
- Smoke browser.

---

## LEAD-1 — Resumen comercial dual (Software | Marketing) en ficha de lead

**Status:** `pending`

**Resultado esperado**
- En `/admin/leads/:id`, debajo de las cards del header, el primer SectionCard ocupa todo el ancho de pantalla y se llama **"Resumen comercial"**.
- Dentro tiene dos sub-apartados visuales lado a lado (en desktop) o stacked (mobile):
  - **Ofertas de software** — productos digitales sugeridos (sitio_web, catalogo, sistema_caja, etc.).
  - **Ofertas de marketing y redes** — sugerencias de redes sociales, ads, gestión de cuentas, etc.
- Cada sub-apartado contiene:
  - Lista priorizada de ofertas posibles (top 3-5) con score.
  - Para cada oferta: **explicación visual** del por qué con líneas o conexiones que unen señales del lead (ausencia/presencia de variables) → conclusión.
  - Ej.: `(sin website) + (rating alto) + (reviews recientes)` → `oferta: sitio_web` con confianza 85%.
- El diseño es para no-técnicos: lenguaje claro, badges de color, sin jerga.
- La lógica de derivación de ofertas vive en el backend (nueva función `buildCommercialOfferings(lead): { software, marketing }`).
- Si el lead no tiene datos suficientes, mostrar un placeholder honesto ("Necesitamos enriquecer este lead para sugerir ofertas") con botón "Enriquecer ahora".

**Áreas/archivos probables**
- `src/modules/scoring/offerings.ts` (nuevo) — derivación dual.
- `api/src/routes/leads.ts` `GET /leads/:id` que devuelva el bloque.
- `ui/src/components/lead/commercial-summary.tsx` (nuevo).
- `ui/src/app/admin/leads/[id]/page.tsx`.

**Validación mínima**
- `pnpm test` con fixtures: leads con distintos perfiles → ofertas esperadas en cada slot.
- `pnpm --dir ui typecheck`, `pnpm --dir ui build`.
- Smoke browser.

**Riesgos**
- Falsos positivos por hipótesis de oferta mal calibrada. Mitigación: hacer revisable y editable la regla via Variables (OPS-4) o config en `src/modules/scoring/config.ts`.

---

## LEAD-2 — "Contacto y datos listos para vender": filtros + scroll

**Status:** `pending`

**Resultado esperado**
- El bloque actual de contacto/datos en la ficha de lead pasa a tener:
  - Filtros encima: por `fuente` (origin del dato), `tipo` (phone, email, social, etc.), `confiabilidad` (alta/media/baja).
  - Scroll interno cuando hay muchos datos, con altura máxima (~480px) para no estirar la página.
- Cada dato del bloque muestra:
  - su valor
  - su fuente (badge: google_places, mintur, social_search, manual, etc.)
  - su confiabilidad (icono o color)
  - el botón de feedback de LEAD-3 (cubierto en esa fase).

**Áreas/archivos probables**
- `ui/src/app/admin/leads/[id]/page.tsx` o `ui/src/components/lead/contact-block.tsx`.

**Validación mínima**
- `pnpm --dir ui typecheck`, `pnpm --dir ui build`.
- Smoke browser.

---

## LEAD-3 — Feedback por variable en contacto/datos, quitar Feedback humano deprecated

**Status:** `pending`

**Resultado esperado**
- Cada dato individual en el bloque de contacto/datos (LEAD-2) tiene un botón inline (thumbs up / thumbs down) para marcarlo como verdadero o falso positivo.
- Click en thumbs down abre un mini-modal opcional para agregar razón (texto corto, 1-3 opciones predefinidas).
- El feedback persiste en la tabla existente de feedback (`leads_feedback` o equivalente — ver migración FDBK-1).
- El bloque "Feedback humano" actual (SectionCard `Feedback humano` en `ui/src/app/admin/leads/[id]/page.tsx:568`) se elimina junto con el state asociado.
- El reporte agregado de feedback sigue accesible desde /admin/quality o equivalente.

**Áreas/archivos probables**
- `ui/src/app/admin/leads/[id]/page.tsx` (eliminar bloque viejo).
- `ui/src/components/lead/contact-block.tsx` (botones inline).
- `api/src/routes/leads.ts` (verificar que el endpoint actual de feedback acepta `field_key` granular).

**Validación mínima**
- `pnpm test`, `pnpm smoke:api`.
- `pnpm --dir ui typecheck`.
- Smoke browser.

---

## LEAD-4 — Traza de evidencia comercial integrada al Resumen comercial

**Status:** `pending`

**Resultado esperado**
- El SectionCard "Traza de evidencia comercial" actual (línea ~684) desaparece como bloque separado.
- Su contenido se integra dentro del Resumen comercial (LEAD-1), visible por cada oferta sugerida como expandible "Ver por qué".
- El expandible muestra el subset de evidencia relevante a esa oferta (no toda la traza junta).
- La traza completa sigue accesible desde un botón "Ver traza completa" con un modal o página dedicada para casos de debugging.

**Áreas/archivos probables**
- `ui/src/components/lead/commercial-summary.tsx`.
- `ui/src/app/admin/leads/[id]/page.tsx`.

**Validación mínima**
- `pnpm --dir ui typecheck`, `pnpm --dir ui build`.
- Smoke browser.

---

## LEAD-5 — Rediseño global de la ficha de Lead con auditoría triple

**Status:** `pending`

**Resultado esperado**
- La ficha de lead `/admin/leads/:id` queda rediseñada con UX moderna, intuitiva y NO técnica para vendedores. Estructura propuesta:
  1. Header con cards de resumen (nombre, score, tier, source, status).
  2. Resumen comercial (LEAD-1) full-width con sus dos sub-apartados.
  3. Contacto y datos listos para vender (LEAD-2) con filtros y scroll.
  4. Diagnóstico técnico y enrichment (collapsible, no expuesto por default).
  5. Historial de seguimiento (CRM-7 timeline) si existe tracking.
  6. Footer con acciones admin (re-enrich, manual, etc.).
- Ningún dato existente se pierde, solo se reorganiza.
- **Auditoría triple obligatoria antes de marcar `done`**: el agente debe hacer tres revisiones explícitas y dejarlas en `context/research/lead-5-audits.md`:
  - **Auditoría técnica**: contratos UI/API consistentes, no regresiones de scoring/enrichment, accesibilidad básica, performance del render.
  - **Auditoría UX**: jerarquía visual clara, contraste, espaciado consistente, dark mode funcional, mobile responsive (mide ancho del viewport target).
  - **Auditoría comercial (vendedor)**: simular flujo de un vendedor que recibe un lead nuevo — puede entender en <30 segundos: quién es, qué venderle, cómo contactarlo, cuál es el próximo paso. Si algún paso fricciona, corregir.
- Las tres auditorías deben pasar antes de cerrar la fase. Si alguna identifica issue mayor, abrir sub-fase explícita.

**Áreas/archivos probables**
- `ui/src/app/admin/leads/[id]/page.tsx`.
- Componentes en `ui/src/components/lead/*`.
- `context/research/lead-5-audits.md` (nuevo).

**Validación mínima**
- `pnpm --dir ui typecheck`, `pnpm --dir ui build`.
- Smoke browser con 3-4 leads de perfiles distintos (sin web, sin contacto, completo, parcial).
- Auditorías triples documentadas.

**Riesgos**
- Pérdida de info crítica al reorganizar. Mitigación: checklist explícito de los datos que existían antes del rediseño antes de mover/eliminar nada.

---

## QUAL-1 — Apartado "Nichos" en Calidad con aliasing/sinónimos

**Status:** `pending`

**Resultado esperado**
- En la pantalla de Calidad (probable `/admin/quality` o `/admin/performance/quality`), un nuevo sub-apartado "Nichos" lista los niches encontrados en `leads` agrupados por similitud.
- El admin puede:
  - Crear un alias group: marcar `restaurante`, `restaurant`, `parrilla` como equivalentes.
  - Asignar un canonical name al grupo.
- La nueva tabla `niche_aliases` persiste estos grupos.
- En cualquier filtro de UI/API que reciba un `niche`, si el valor matchea un alias del grupo, se expande automáticamente para incluir todos los niches del grupo.
- Por ejemplo: filtrar por `restaurante` en Lead Explorer trae también los con niche `restaurant` o `parrilla`.

**Áreas/archivos probables**
- `supabase/migrations/*_niche_aliases.sql`.
- `api/src/routes/admin/niches.ts` (nuevo) — CRUD de alias.
- `src/storage/niches.ts` (nuevo).
- Aplicación de aliasing en: `src/storage/leads.ts` (countByFilter, loadByFilter), `api/src/routes/discovery.ts`.
- `ui/src/app/admin/quality/page.tsx` o equivalente.

**Validación mínima**
- `pnpm test`, `pnpm smoke:api`.
- `supabase db reset`.
- Smoke browser.

---

## UI-RESP-1 — Responsive global: ningún viewport excedido

**Status:** `pending`

**Resultado esperado**
- Existe un contenedor wrapper alrededor del contenido principal (`AdminPageLayout` o un nuevo `ResponsiveShell`) que:
  - Limita el ancho máximo del contenido a un valor configurado (ej. 1440px) con padding lateral fluido.
  - Evita overflow horizontal en cualquier breakpoint (sm, md, lg, xl, 2xl).
  - En mobile (<768px), todos los grids 2-col o 3-col colapsan a stacked sin scroll horizontal.
- Pasada por todas las pantallas admin clave: home, leads, lead detail, discovery, operations, crm, backups, costs, performance, audit-log, users.
- Para cada pantalla anterior, un smoke en Playwright en tres viewports (375×667, 1024×768, 1440×900) confirma que no hay `overflow-x` involuntario.
- Componentes con tablas anchas (Audit Log, Discovery jobs lists) tienen scroll horizontal **interno** controlado, no de toda la página.
- Tailwind config sin breakpoints customizados (sm/md/lg/xl default) salvo necesidad concreta.

**Áreas/archivos probables**
- `ui/src/components/admin-shell.tsx`.
- `ui/src/app/admin/**` (varias).
- `ui/src/components/**` (varias).
- `ui/tailwind.config.ts`.

**Validación mínima**
- `pnpm --dir ui typecheck`, `pnpm --dir ui build`.
- Playwright smoke en 3 viewports por las pantallas listadas.

**Riesgos**
- Esta fase puede ser grande. Si supera los límites globales, partir en sub-paquetes por pantalla (`UI-RESP-1-home`, `UI-RESP-1-leads`, etc.) sin cambiar el orden canónico.

---



Actualizar como mínimo:
- `ROADMAP_CANONICAL.md` si cambia el estado o el orden real.
- `FUTURE.md` marcando la fase.
- `PROJECT_MASTER.md` con snapshot y próxima fase.
- `AUTONOMOUS.md` solo si cambia el loop o los guardrails.
- El documento arquitectónico específico del área tocada.
