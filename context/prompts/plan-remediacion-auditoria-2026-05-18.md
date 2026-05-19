# Prompt Codex - Plan de remediacion post-auditoria (2026-05-18)

> Adjuntar este archivo a una nueva sesion Codex/Codex CLI sin mensaje adicional.
> Esta sesion debe ejecutar el plan por fases, implementando y auditando cada cierre.
> No abrir alcance nuevo. El objetivo es corregir contradicciones, bugs funcionales y
> desalineaciones reales encontradas en la auditoria tecnica.

> Decision cerrada de producto para esta ejecucion:
> `DGI/BPS` queda descartado permanentemente. No investigar, no implementar, no dejar
> el roadmap esperando esa fase. Si algun documento lo sigue tratando como fase viva,
> corregir la documentacion al inicio del trabajo.

---

## Objetivo

Cerrar los problemas criticos y altos detectados en la auditoria de Blindspot, dejando:

1. datos consistentes entre schema, VIEW, tipos compartidos, API y UI;
2. filtros de seguridad y RBAC alineados con la especificacion;
3. pipeline core ejecutando flujos reales y no stubs;
4. endpoints/admin UI sin contratos rotos ni campos inexistentes;
5. documentacion `context/*.md` sincronizada con la realidad del repo;
6. evidencia automatizada de que cada problema corregido quedo realmente resuelto.

No marcar una fase como cerrada solo porque compila o porque un test mockeado pasa.

---

## Contexto obligatorio a leer antes de tocar codigo

Leer en este orden:

1. `context/ROADMAP_CANONICAL.md`
2. `context/ARCHITECTURE_FUTURE.md`
3. `context/AUTONOMOUS.md`
4. `context/ARCHITECTURE_FRONTEND.md`
5. `context/ADMIN_PANEL.md`

Luego leer, si aplica a la fase:

- `context/ARCHITECTURE.md`
- `context/FUTURE.md`
- `context/SECURITY.md`
- los tests existentes del area
- `src/shared/types.ts`

---

## Reglas de ejecucion

1. Trabajar una sola fase a la vez.
2. Cada fase tiene dos entregables obligatorios:
   - correccion funcional;
   - auditoria de cierre con evidencia.
3. Al terminar cada fase:
   - correr tests y typecheck;
   - ejecutar checks focalizados del problema corregido;
   - actualizar la documentacion de `context/` afectada;
   - registrar en `AUTONOMOUS.md` el estado real, no aspiracional.
4. No implementar DGI/BPS ni dejarlo como pendiente tecnico. Solo dejarlo como descartado.
5. No dejar stubs silenciosos ni tests que dependan de mocks que oculten drift de schema.
6. Si una fase resulta demasiado grande, subdividirla internamente, pero no saltarla.

---

## Documentos de contexto que deben mantenerse sincronizados

Usar y actualizar segun corresponda:

- `context/ROADMAP_CANONICAL.md`
- `context/AUTONOMOUS.md`
- `context/ARCHITECTURE_FUTURE.md`
- `context/ARCHITECTURE_FRONTEND.md`
- `context/ADMIN_PANEL.md`

Regla:

- `ROADMAP_CANONICAL.md`: corregir solo contradicciones canonicamente falsas, especialmente DGI descartado, claims de cierre falsos y dependencias imposibles.
- `AUTONOMOUS.md`: reflejar el estado real despues de cada fase, remover claims falsos de completitud y dejar la siguiente fase real.
- `ARCHITECTURE_FUTURE.md`: alinear schemas, contratos, naming y reglas de acceso con la implementacion final.
- `ARCHITECTURE_FRONTEND.md`: alinear payloads y dependencias de pantalla con endpoints reales.
- `ADMIN_PANEL.md`: alinear endpoints, permisos, codigos de error y comportamiento admin/CM.

---

## Fase 0 - Reset documental y fuente de verdad

### Objetivo

Eliminar contradicciones entre docs antes de seguir tocando codigo.

### Problemas a corregir

- `AUTONOMOUS.md` declara completitud que el codigo no sostiene.
- `ROADMAP_CANONICAL.md` y `AUTONOMOUS.md` contradicen el estado de F42/F43.
- La decision actual de producto dice que DGI/BPS esta descartado y eso debe quedar explicito.

### Trabajo

1. Corregir `ROADMAP_CANONICAL.md` para que:
   - F43 DGI/BPS quede descartada permanentemente.
   - no exista stop condition que la siga tratando como fase viva.
   - no se declare `fases-completas` si siguen existiendo issues abiertos de remediacion.
2. Corregir `AUTONOMOUS.md` para que:
   - deje de afirmar items/fases completas que hoy estan rotas;
   - remueva o reescriba claims falsos de `fases-completas`;
   - registre este plan de remediacion como trabajo pendiente real.
3. Ajustar `ARCHITECTURE_FUTURE.md`, `ARCHITECTURE_FRONTEND.md` y `ADMIN_PANEL.md` donde hoy describan contratos o flujos inconsistentes con la realidad o con esta decision de DGI descartado.

### Auditoria obligatoria de cierre

1. Buscar en `context/*.md` referencias a:
   - DGI/BPS como fase pendiente;
   - `fases-completas` cuando todavia existan fases rotas;
   - contratos que contradigan el roadmap canonicamente corregido.
2. Confirmar que no queden dos documentos de contexto contando historias distintas sobre:
   - F43;
   - filtros CM;
   - `lead_dashboard`;
   - pipeline core.

### Criterio de cierre

- La documentacion ya no contradice la decision de descartar DGI/BPS.
- No quedan claims falsos de completitud en `AUTONOMOUS.md`.
- El roadmap canonicamente corregido permite continuar sin ambiguedad.

---

## Fase 1 - Contrato de datos DB -> VIEW -> tipos -> API -> UI

### Objetivo

Reparar la desincronizacion entre schema, `lead_dashboard`, tipos compartidos, API y pantallas admin.

### Problemas a corregir

- `lead_dashboard` no expone varios campos que la UI consume.
- La UI espera nombres/campos que la API no garantiza.
- `owner_group_id` y otros campos de fases recientes no quedaron reflejados de punta a punta.

### Trabajo

1. Definir un contrato canonico de lead para API/UI:
   - decidir si el canon sera el shape actual de la UI o un shape corregido con adaptacion en API;
   - evitar alias ambiguos (`contact_phone` vs `phone`) si la UI espera el lead completo.
2. Rehacer la VIEW `lead_dashboard` o introducir una capa API de transformacion para cubrir, como minimo:
   - `phone`
   - `whatsapp`
   - `website`
   - `rating`
   - `review_count`
   - `tags`
   - `state`
   - `owner_group_id`
   - `digital_footprint`
   - `inferred_state`
   - `score_breakdown`
   - `business_status`
   - `source_confidence`
   - `canonical_source`
   - `search_vector` si el backend la usa directamente
3. Alinear:
   - `src/shared/types.ts`
   - `api/src/routes/leads.ts`
   - `ui/src/lib/api.ts`
   - `ui/src/app/admin/leads/*`
4. Corregir cualquier endpoint que lea columnas inexistentes desde la VIEW.

### Auditoria obligatoria de cierre

1. Crear tests de contrato para:
   - `GET /api/v1/leads`
   - `GET /api/v1/leads/:id`
   - `GET /api/v1/leads/:id/owner-group`
2. Verificar que:
   - ningun campo consumido por `ui/src/app/admin/leads/` falte en la respuesta real;
   - ningun campo obligatorio de la API dependa de una columna inexistente en la VIEW;
   - `pnpm typecheck` pase en `api` y `ui`.
3. Agregar al menos un test que falle si la VIEW vuelve a omitir `owner_group_id` o `score_breakdown`.

### Criterio de cierre

- Lead Explorer y Lead Detail consumen API real sin campos fantasma.
- `lead_dashboard` y tipos compartidos ya no estan desincronizados.

---

## Fase 2 - Seguridad, RBAC y enforcement real de `lead_filter`

### Objetivo

Cerrar los huecos de seguridad y consistencia funcional en accesos CM/admin.

### Problemas a corregir

- `lead_filter` implementa solo una parte minima de la spec.
- Algunos checks usan logica incorrecta o incompleta.
- Hay diferencias `403` vs `404` que revelan existencia.
- Validaciones de users y filtros no cumplen la spec.

### Trabajo

1. Implementar enforcement real de `lead_filter` en endpoints que devuelven leads:
   - `GET /leads`
   - `GET /leads/:id`
   - `GET /leads/:id/owner-group`
   - cualquier otro endpoint que exponga leads o subconjuntos derivados
2. Soportar correctamente los filtros canonicos que correspondan al estado actual del roadmap, incluyendo al menos:
   - `contact_tier`
   - `primary_offer`
   - `niche`
   - `source`
   - `exclude_contacted`
   - `exclude_franchises`
   - `max_leads_visible`
   - `require_inferred_state`
   - `detected_sub_niche` si la fase 28 ya esta implementada
3. Corregir comportamiento de users:
   - password minimo 12;
   - validacion cerrada de `lead_filter`;
   - pre-check de borrado con `409 user_has_history` si corresponde;
   - no permitir degradar un CM a configuracion invalida.
4. Normalizar `404` vs `403` para no revelar existencia donde la spec exige `404`.

### Auditoria obligatoria de cierre

1. Expandir la matriz de tests de autorizacion para admin vs CM.
2. Agregar tests que prueben:
   - interseccion entre filtros del request y `lead_filter`;
   - fail-closed de CM mal configurado;
   - `404` cuando el CM no deberia saber que el recurso existe;
   - que `lead_filter` cambia sin depender del JWT embebido.
3. Buscar todos los handlers con leads y confirmar que ninguno omite `requireAuth` o el filtro CM.

### Criterio de cierre

- La implementacion de RBAC coincide con la documentacion.
- No quedan caminos donde un CM vea datos fuera de su alcance por drift de filtro.

---

## Fase 3 - Pipeline core real, schema correcto y semantica de ejecucion

### Objetivo

Hacer que el pipeline central deje de simular ejecucion y opere con semantica real sobre los modulos existentes.

### Problemas a corregir

- `run-executor` sigue en stub.
- `pollDiscoveryJobs()` no dispara trabajo real.
- Hay drift entre schema y codigo (`triggered_by_user_id` y variantes).
- El dry-run desde UI/API esta mal cableado.

### Trabajo

1. Elegir naming canonico para `pipeline_runs` y alinear:
   - migraciones/schema
   - tipos
   - storage
   - rutas API
2. Reemplazar stubs de `run-executor` por ejecucion real de fases permitidas usando los modulos ya existentes.
3. Hacer que `pollDiscoveryJobs()` procese trabajos reales o, si el diseno final es otro, mover esa responsabilidad a la capa correcta y documentarlo.
4. Corregir dry-run de punta a punta:
   - UI
   - helper `ui/src/lib/api.ts`
   - backend
   - persistencia/logging
5. Verificar que el webhook final siga funcionando con el pipeline corregido.

### Auditoria obligatoria de cierre

1. Tests del scheduler y run executor sin mocks vacios:
   - pending -> running -> completed/failed/aborted;
   - `abort_requested`;
   - dry-run real sin efectos persistentes indebidos;
   - actualizacion de `scheduled_for`.
2. Smoke test del flujo:
   - crear `pipeline_run`;
   - disparar ejecucion;
   - verificar logs y estado final.
3. Test explicito para evitar reintroducir campos de schema inexistentes.

### Criterio de cierre

- El pipeline ya no depende de comentarios "stub - real execution pending".
- Dry-run hace dry-run de verdad.

---

## Fase 4 - Discovery operable y Discovery Control Center coherente

### Objetivo

Cerrar la brecha entre UI/API de discovery y la ejecucion real disponible hoy.

### Problemas a corregir

- `/discovery/suggestions` y `/discovery/coverage` siguen stub.
- Batch multi-ciudad existe en CLI, pero no queda realmente integrado como sub-jobs visibles.

### Trabajo

1. Implementar o recortar honestamente `Discovery CC` para que no prometa datos inexistentes.
2. Resolver una de estas dos vias, explicitandola en docs:
   - implementar `suggestions`/`coverage` con datos reales; o
   - degradar la pantalla/spec para que solo muestre capacidades realmente soportadas.
3. Integrar batch multi-ciudad con tracking real:
   - sub-jobs visibles; o
   - modelo equivalente documentado y testeado.

### Auditoria obligatoria de cierre

1. Tests de endpoints de discovery sin stubs aspiracionales.
2. Validar que la UI de `/admin/discovery` no invoque endpoints que sigan fakeando capacidad.
3. Smoke del flujo:
   - crear job;
   - procesarlo;
   - ver su estado en API/UI.

### Criterio de cierre

- Discovery CC solo muestra capacidades reales.
- La cola y el batch estan observables de punta a punta.

---

## Fase 5 - Outreach, campaigns, pricing y logging LLM

### Objetivo

Corregir la capa comercial para que no dependa de schemas o contratos rotos.

### Problemas a corregir

- `llm_usage_log` no coincide con lo que inserta la API.
- campaigns usa `prospect_score_at_contact` inexistente.
- `service_pricing` no cierra del todo con generacion de ofertas.

### Trabajo

1. Elegir el contrato canonico de `llm_usage_log` y alinear:
   - migracion/schema
   - `api/src/llm/types.ts`
   - `api/src/routes/outreach.ts`
   - admin costs endpoints
2. Corregir `campaigns`:
   - o agregar el dato faltante al schema y poblarlo correctamente;
   - o rehacer stats para no depender de una columna fantasma.
3. Integrar `service_pricing` en generacion de ofertas donde la spec lo exige.
4. Confirmar que el Cost Dashboard siga calculando bien despues del cambio.

### Auditoria obligatoria de cierre

1. Tests con almacenamiento realista de:
   - insert en `llm_usage_log`;
   - stats de campaign;
   - fallback template/LLM;
   - costos por proveedor.
2. Asegurar que ningun test de estas areas pase por mocks que aceptan cualquier payload.
3. Smoke:
   - generar oferta;
   - verificar logging;
   - consultar dashboard de costos;
   - consultar una campaign con stats.

### Criterio de cierre

- La capa de outreach/campaigns deja de apoyarse en columnas inexistentes.
- El logging LLM queda confiable para auditoria de costos.

---

## Fase 6 - Cierre real de `owner_group_id` y limpieza final de `inferred_state`

### Objetivo

Cerrar dos fases que hoy figuran como listas pero siguen incompletas en runtime.

### Problemas a corregir

- `owner_group_id` no corre en el flujo real.
- F47 no esta cerrada porque todavia existe fallback al path viejo de `digital_footprint.inferred_state`.

### Trabajo

1. Conectar `detectOwnerGroups()` al punto correcto del flujo:
   - post-enrich;
   - post-reconcile;
   - o job puntual bien documentado si no debe ser inline.
2. Asegurar que la VIEW/API/UI ya consuman `owner_group_id` correctamente.
3. Eliminar los ultimos reads/writes al path viejo de `digital_footprint.inferred_state`.
4. Dejar tests que fallen si reaparece esa dependencia.

### Auditoria obligatoria de cierre

1. Tests de owner-group en runtime real, no solo unitarios del detector.
2. Busqueda repo-wide para confirmar que no queden referencias funcionales al path viejo.
3. Smoke:
   - dos leads con mismo phone/email canonico;
   - enrich/reconcile;
   - verificar grupo y endpoint `/owner-group`.

### Criterio de cierre

- `owner_group_id` ya no es una columna muerta.
- F47 queda realmente cerrada.

---

## Fase 7 - Verificacion integral, endurecimiento de tests y cierre documental

### Objetivo

Consolidar todo lo corregido y evitar que vuelva a romperse silenciosamente.

### Trabajo

1. Revisar tests sobre-mockeados y reemplazar los que oculten drift real de schema.
2. Agregar checks de contrato entre:
   - migraciones y rutas;
   - VIEW y UI;
   - tipos compartidos y payloads reales.
3. Ejecutar una verificacion integral del repo:
   - `pnpm test`
   - `pnpm typecheck`
   - checks focalizados de leads/pipeline/outreach/discovery/admin
4. Actualizar `AUTONOMOUS.md` y contexto asociado para dejar:
   - lo corregido;
   - lo todavia pendiente;
   - lo descartado permanentemente;
   - la siguiente auditoria recomendada.

### Auditoria obligatoria de cierre

1. Confirmar que no queden:
   - stubs marcados como implementados;
   - columnas leidas por la API que no existan;
   - pantallas admin atadas a endpoints falsos;
   - claims documentales de completitud que el codigo no sostenga.
2. Emitir un resumen final con:
   - issues cerrados;
   - issues aun abiertos;
   - items del roadmap corregidos vs pendientes.

### Criterio de cierre

- El repo queda coherente consigo mismo.
- La documentacion vuelve a ser una fuente de verdad util.

---

## Orden recomendado de ejecucion

Ejecutar en este orden:

1. Fase 0
2. Fase 1
3. Fase 2
4. Fase 3
5. Fase 4
6. Fase 5
7. Fase 6
8. Fase 7

No saltar directo a UI o docs finales sin cerrar antes contrato de datos, seguridad y pipeline.

---

## Comandos minimos de verificacion por fase

Usar los que apliquen, no a ciegas:

```bash
pnpm test
pnpm typecheck
```

Y ademas, segun la fase:

```bash
rg -n "inferred_state|owner_group_id|lead_dashboard|llm_usage_log|triggered_by|dry_run" src api ui db tests context
```

Si una fase cambia migraciones o VIEWs, revisar explicitamente:

```bash
rg -n "CREATE OR REPLACE VIEW lead_dashboard|ALTER TABLE|CREATE TABLE" db/migrations
```

Si una fase cambia auth o filtros:

```bash
rg -n "requireAuth|requireAdmin|lead_filter|404|403" api/src/routes tests/api
```

---

## Definicion global de terminado

Este plan solo puede darse por terminado si:

1. las correcciones criticas y altas de la auditoria quedaron cerradas con evidencia;
2. el contexto documental ya no contradice al codigo;
3. DGI/BPS figura como descartado y no como deuda tecnica viva;
4. existe una nueva auditoria end-to-end independiente para validar que el sistema tiene sentido de punta a punta.

---

## Prompt final para una nueva sesion de auditoria integral

Usar este prompt en una sesion nueva, separada de la implementacion:

```md
# Auditoria final end-to-end - Blindspot

Sos el auditor tecnico final del proyecto Blindspot. No implementes cambios. Solo leer, contrastar y reportar.

## Decision de contexto ya cerrada

- DGI/BPS fue descartado permanentemente.
- No lo trates como fase pendiente ni como gap a implementar.
- Si algun documento todavia lo presenta como fase viva, reportalo como inconsistencia documental.

## Archivos a leer primero, en este orden

1. `context/ROADMAP_CANONICAL.md`
2. `context/ARCHITECTURE_FUTURE.md`
3. `context/AUTONOMOUS.md`
4. `context/ARCHITECTURE_FRONTEND.md`
5. `context/ADMIN_PANEL.md`

Luego explorar el codigo real.

## Que auditar

### 1. Coherencia documental

- Los `.md` de contexto cuentan la misma historia.
- No hay fases marcadas como completas si el codigo no lo sostiene.
- DGI/BPS esta descartado de forma consistente.

### 2. Flujo end-to-end real

Validar de punta a punta:

1. Discovery -> dedup -> persistencia de lead
2. Enrichment -> change detection -> re-score -> owner-group
3. Scoring -> score_breakdown -> lead_dashboard
4. API `/leads` + filtros CM
5. UI Lead Explorer + Lead Detail
6. Outreach -> campaigns -> stats -> conversion tracking
7. Offer generation -> fallback -> `llm_usage_log`
8. Pipeline scheduler -> run execution -> webhook
9. Backup script

### 3. Consistencia de datos

- Migrations, VIEWs, tipos compartidos y payloads API/UI estan alineados.
- No hay columnas fantasma ni campos que existan solo en mocks.

### 4. Seguridad

- No hay endpoints sensibles sin auth.
- `lead_filter` se aplica de forma consistente.
- No hay leaks de existencia por `403` donde deberia ser `404`.

### 5. Calidad de tests

- Los tests cubren los casos criticos reales.
- No hay mocks permisivos ocultando drift de schema o de contratos.

## Formato del reporte

- `RESUMEN EJECUTIVO`
- `HALLAZGOS CRITICOS`
- `HALLAZGOS ALTOS`
- `HALLAZGOS MEDIOS`
- `COHERENCIA DE DATOS`
- `SEGURIDAD`
- `COBERTURA DE TESTS`
- `CONCLUSION`

Si no encontrás hallazgos criticos, decilo explicitamente. Si encontrás contradicciones documentales o logicas residuales, citarlas con archivo y linea.
```
