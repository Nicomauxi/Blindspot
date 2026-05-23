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
- `BKP-1` — pending
- `DISC-1` — pending
- `MINTUR-1` — pending
- `MAP-1` — pending
- `DISC-2` — pending
- `DISC-3` — pending
- `FDBK-1` — pending
- `FDBK-2` — pending
- `FDBK-3` — pending
- `CRM-1` — pending
- `CRM-2` — pending
- `CRM-3` — pending
- `CRM-4` — pending

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

**Status:** `pending`

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

---

## DISC-1 — Workspace de discovery: UX y persistencia

**Status:** `pending`

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

---

## MINTUR-1 — Mejorar lógica de nichos MINTUR

**Status:** `pending`

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

---

## MAP-1 — Mapa real para densidad comercial y contexto

**Status:** `pending`

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

---

## DISC-2 — Composer con toggle de enrichment

**Status:** `pending`

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

**Riesgos a vigilar**
- colas duplicadas
- estados poco claros entre discovery y enrich

---

## DISC-3 — Enrichment de leads por filtros

**Status:** `pending`

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

---

## FDBK-1 — Persistencia y API de feedback humano

**Status:** `pending`

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

---

## FDBK-2 — UI de feedback en Lead Detail

**Status:** `pending`

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

**Status:** `pending`

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

---

## CRM-1 — Fundaciones de CRM y puente con campañas

**Status:** `pending`

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

---

## CRM-2 — API de seguimiento CRM

**Status:** `pending`

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

---

## CRM-3 — Pantalla CRM tipo board

**Status:** `pending`

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

---

## CRM-4 — Modal detallado, notas, adjuntos y recordatorios

**Status:** `pending`

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

---

## Criterio de actualización de contexto al cerrar cualquier fase

Actualizar como mínimo:
- `ROADMAP_CANONICAL.md` si cambia el estado o el orden real.
- `FUTURE.md` marcando la fase.
- `PROJECT_MASTER.md` con snapshot y próxima fase.
- `AUTONOMOUS.md` solo si cambia el loop o los guardrails.
- El documento arquitectónico específico del área tocada.
