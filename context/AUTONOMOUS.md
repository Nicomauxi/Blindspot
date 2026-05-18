# Blindspot — Autonomous Development Runbook

> **Modo de uso:** adjuntar este archivo a una sesión Claude Code sin mensaje adicional.
> Claude lee este archivo y ejecuta el loop autónomo indefinidamente hasta que una
> condición de stop lo detenga. No requiere intervención humana por fases.
>
> **Diferencia con PROJECT_MASTER.md:** en el modo manual Claude actúa como Tech Lead
> y genera prompts para otra sesión CC. En modo autónomo Claude **implementa directamente**
> — planea, escribe código, verifica, corrige y commitea sin intermediarios.
>
> **Contexto requerido:** leer este archivo + `ROADMAP_CANONICAL.md` + `ARCHITECTURE.md`
> + `ARCHITECTURE_FUTURE.md` + `FUTURE.md` + `context/SECURITY.md` antes de ejecutar cualquier acción.
> `ROADMAP_CANONICAL.md` gana ante cualquier contradicción entre documentos.

---

## Objetivo del producto (resumen)

Blindspot identifica negocios locales uruguayos con buena reputación offline pero gaps digitales.
Genera leads calificados con scores, contacto verificado y pitch concreto.
Stack: Node.js/TypeScript, PostgreSQL (Supabase local), Vitest, CLI + API HTTP futura.

---

## Reglas de oro — no violar bajo ninguna circunstancia

0. **Plan Mode CLI tiene precedencia sobre cualquier modo del proyecto.** Si Claude Code está en Plan Mode (toggle Shift+Tab de la CLI — independiente del "modo autónomo" del proyecto), las acciones de lectura y búsqueda son libres pero **prohibido** ejecutar `Edit`, `Write` o `Bash` que modifique estado hasta que el usuario apruebe via `ExitPlanMode`. Esta regla aplica aunque la fase actual esté marcada `autonomous` en `ROADMAP_CANONICAL.md`. Razón: el usuario activó Plan Mode CLI explícitamente para revisar antes de tocar nada — el modo autónomo del proyecto no lo overridea. Si Plan Mode CLI está activo y el agente entra a Paso 6 (Implementar) → STOP CONDITION `plan-mode-cli-active`. Ver `~/.claude/CLAUDE.md § Prioridad de modos`.

1. **Leer SECURITY.md antes de ejecutar cualquier comando.** Si una acción está en la lista BLOQUEADA → no ejecutarla, registrar en el reporte de stop y detenerse.

2. **Tests y typecheck deben pasar antes de commitear.** Sin excepción. Si fallan después de 3 intentos de fix → stop condition.

3. **No modificar tests para hacerlos pasar.** Un test puede corregirse solo si tiene un fixture de entrada incorrecto. Cambiar assertions para que pasen es trampa.

4. **Una fase por iteración.** No combinar dos fases de FUTURE.md en un solo commit. Atómico y verificable.

5. **Verificar DB invariantes antes y después de cada fase.** Si algún invariante falla post-implementación → fix o stop.

6. **Commitear al terminar cada fase correctamente.** Si la fase falla (stop condition) → no commitear código parcial.

7. **Actualizar context/ al terminar cada fase.** ARCHITECTURE.md, FUTURE.md y AUTONOMOUS.md (sección ESTADO) deben reflejar el estado real post-implementación.

## Aprobación manual general

Si Nicolás ya otorgó una **aprobación manual general vigente** para tareas que no requieran su intervención real:

- no detenerse solo porque una fase esté marcada `approval`, `manual` o `dependency-approval`;
- tratar esas etiquetas como señales de riesgo y verificar más, no como pausa automática;
- detenerse únicamente si aparece uno de estos casos:
  - comando bloqueado por `SECURITY.md`;
  - gasto externo / API billable / riesgo financiero real;
  - research externo todavía pendiente;
  - input humano realmente necesario para seguir;
  - acción manual fuera del repo o del entorno local.

Esta aprobación general **no** levanta bloqueos de `SECURITY.md`, no autoriza `pnpm add` por sí sola y no reemplaza una revisión humana de negocio cuando la fase la necesita para cerrar.

---

## Loop autónomo — ejecutar en este orden exacto

### Paso 1 — Boot: verificar estado base

```bash
pnpm test 2>&1 | tail -8 && pnpm typecheck 2>&1 | tail -3 && git log --oneline -3
```

Si tests fallan en boot → **STOP INMEDIATO** antes de tocar código.
Registrar en ESTADO: "boot fallido — tests no pasaban al iniciar".

**Crash recovery obligatorio antes de continuar:**
- Si existen filas en `pipeline_runs` con `status='running'` al arrancar la sesión, asumir que son runs huérfanos de un crash/restart previo.
- Antes del Paso 2, marcarlas como `aborted`, agregar una nota `startup-crash-recovery` a `log_lines` y dejar `dashboard_stale=true`.
- Si este cleanup no puede ejecutarse o el esquema real no coincide con el canónico → **STOP CONDITION `contradiccion-arquitectura`**. No seguir con el scheduler sobre estado zombie.

### Paso 2 — Verificar invariantes de calidad de DB

```bash
docker exec supabase_db_gap-radar psql -U postgres -d postgres -c "
SELECT
  COUNT(*) FILTER (WHERE passed_filter = true AND digital_footprint IS NULL) AS passed_not_enriched,
  COUNT(*) FILTER (WHERE 'no-website' = ANY(tags) AND 'website-heuristic' = ANY(tags) AND passed_filter = true) AS tags_contradictorios,
  COUNT(*) FILTER (WHERE 'email-found' = ANY(tags) AND (digital_footprint->>'contact_emails' = '[]' OR digital_footprint->>'contact_emails' IS NULL) AND passed_filter = true) AS email_found_sin_data,
  COUNT(*) FILTER (WHERE passed_filter = true AND prospect_score IS NULL) AS passed_sin_score
FROM leads;"
```

Si algún valor ≠ 0 → **STOP INMEDIATO**. No continuar con inconsistencias en DB.

**Invariante adicional post-Fase 22 (activar cuando `scoring_version=2` exista en la DB):**

```bash
docker exec supabase_db_gap-radar psql -U postgres -d postgres -c "
SELECT
  COUNT(*) FILTER (WHERE passed_filter = true AND scoring_version < 2) AS leads_v1_post_v2,
  COUNT(*) FILTER (WHERE lead_buyer_scores.scoring_version < 2) AS buyer_scores_v1_post_v2
FROM leads
LEFT JOIN lead_buyer_scores ON lead_buyer_scores.lead_id = leads.id;"
```

Post Fase 22 ambos deben ser 0 — leads y buyer_scores quedaron migrados.

### Paso 3 — Seleccionar la próxima fase

Leer `context/ROADMAP_CANONICAL.md`. Tomar el **primer item ejecutable** del roadmap canónico. Usar `context/FUTURE.md` solo como detalle de implementación de esa fase.

**Reglas de bloque** (sexta auditoría 2026-05-16):
- No saltear bloques. Bloque 0 (Fase 49) debe estar completo antes de Bloque 1; Bloque 2 (Fase 47, destructiva) requiere Bloque 0 + 1; Bloque 4 (Fase 22) requiere Bloques 0–3 limpios y Fase 22-eval aprobada.
- Dentro de un bloque, los items se ejecutan en el orden listado.
- Si la fase del bloque actual cae en un caso que **todavía requiere intervención real** (ver sección más abajo) → STOP CONDITION antes de continuar.
- Si la fase está marcada como `manual` pero existe aprobación manual general vigente, no detenerse por esa etiqueta sola. Solo frenar si además requiere input real, research, gasto externo o un comando bloqueado por `SECURITY.md`.

Si no quedan items ejecutables en `ROADMAP_CANONICAL.md`, detenerse con `fases-completas`. No tomar secciones libres de `FUTURE.md`: ese archivo contiene detalle, backlog e histórico y no es fuente de selección.

**Gate adicional de tamaño antes de implementar:**
- Si la fase prevista supera `12` archivos de código, `600` líneas netas estimadas, o mezcla `schema DB + backend + UI`, **no empezar la implementación completa**.
- Primero definir el sub-paquete interno que corresponda según `ROADMAP_CANONICAL.md § Partición obligatoria de fases grandes`.
- Registrar en ESTADO qué sub-paquete se ejecuta (`23A`, `APIB`, `UIA`, etc.) y cuál queda pendiente.
- Si no existe una partición definida y la fase sigue siendo demasiado grande → **STOP CONDITION `fase-demasiado-grande`** y corregir documentación antes de tocar código.

**Antes de seleccionar, verificar que la fase sea auto-ejecutable:**

| Condición | Acción |
|-----------|--------|
| Fase requiere llamada a Google Places API | **STOP** — registrar, esperar instrucción |
| Fase requiere Gemini DeepSearch (nueva fuente externa) | **STOP** — registrar, esperar instrucción |
| Fase requiere `ALTER TABLE` **puramente aditivo** (`ADD COLUMN` con `DEFAULT`, `CREATE INDEX`, `CREATE TABLE`) | **SAFE TO EXECUTE** dentro de `BEGIN; … COMMIT;` — ver sección "Migraciones DB". No es destructivo. Ej: Fase 22-pre. |
| Fase requiere `ALTER TABLE` **destructivo** (`DROP COLUMN`, `UPDATE` masivo sin rollback, eliminación de campos JSONB en lotes) | **APPROVAL** + backup obligatorio. Ver "Backup obligatorio antes de fases destructivas". Ej: Fase 47 step 5. |
| Fase dice "depende de Fase X" y X no está completa, **dentro del mismo bloque** | Saltar a X primero. **Nunca cruzar bloques**: si X está en un bloque posterior, hay un error en el roadmap — detenerse con `contradiccion-arquitectura` y reportar antes de avanzar. |
| Fase es puramente de código TypeScript + tests | **SAFE TO EXECUTE** |
| Fase es de documentación o config YAML | **SAFE TO EXECUTE** (salvo `config/scoring.yaml`, que requiere aprobación — ver tabla de aprobaciones). |
| Fase es `Fase 23`, `Fase API` o `UI base` | **SAFE SOLO POR SUB-PAQUETE**. Ejecutar un único sub-paquete interno por sesión (`23A`, `23B`, `23C`; `APIA`…`APIE`; `UIA`…`UID`). |

### Paso 4 — Research: entender el código actual

Leer los archivos relevantes mencionados en la fase antes de escribir una línea.
Siempre leer:
- Los archivos que la fase dice que modifica
- Los tests existentes de esos archivos
- El tipo relevante en `src/shared/types.ts`
- La sección correspondiente en `ARCHITECTURE.md`

No implementar hasta tener el modelo mental completo. Una lectura incompleta genera bugs que cuestan más que la lectura.

### Paso 5 — Plan: diseñar la implementación

Antes de editar cualquier archivo, escribir internamente (en el razonamiento) el plan:
- Qué archivos se crean / modifican
- Qué funciones se agregan / cambian
- Qué tests se escriben
- Qué invariantes se verifican al final
- **Qué dependencias nuevas requiere** (`pnpm add <paquete>`) — listarlas antes de tocar código

Si el plan contradice `ARCHITECTURE_FUTURE.md` → ajustar el plan, no el documento.

**Chequeo de dependencias obligatorio** (antes de tocar código, no después):
- Revisar `package.json` (`api/`, `src/`, `ui/` según corresponda) y comparar con los imports que el plan va a requerir.
- Si el plan necesita un paquete que NO está en `package.json` → **STOP CONDITION `approval-required-dependency`** ANTES de escribir cualquier archivo. Mostrar a Nicolás: nombre del paquete, workspace destino, motivo, tamaño aproximado.
- Razón: instalar el paquete (`pnpm add`) está bloqueado por `SECURITY.md`. Si el agente escribe código que importa el paquete y luego descubre que no puede instalarlo, queda con código a medio camino sin poder commitear (typecheck rojo).
- Ejemplo típico: Fase 23 requiere `node-cron` y `cron-parser` — listarlos antes de empezar `src/start.ts`.

**Chequeo de criterio de cierre alcanzable** (antes de implementar):
- Releer la "definición de listo" del item canónico (`ROADMAP_CANONICAL.md § Roadmap ejecutable`).
- Verificar que cada criterio sea testeable contra el estado actual del repo (schemas existentes, fases previas aplicadas).
- Si algún criterio depende de algo que aún no existe (tabla no creada, fase posterior no aplicada) → **STOP CONDITION `criterio-imposible-de-cerrar`**. Reportar a Nicolás qué criterio es inalcanzable y por qué; proponer adelantar la fase faltante o ajustar el roadmap canónico antes de avanzar.

**Test-first obligatorio:** para cada nueva función o módulo, el test se escribe ANTES que la implementación. El flujo es RED → GREEN → REFACTOR.

### Paso 6 — Implementar

Usar Edit/Write directamente. Guías:
- Funciones < 50 líneas
- Archivos < 800 líneas. Si un archivo crece más → extraer módulo
- Sin comments que expliquen el qué (el código lo dice). Solo comments para el porqué no obvio
- Sin `console.log` en código de producción
- Inmutabilidad: nunca mutar objetos existentes, retornar nuevos
- Error handling explícito en cada nivel — nunca swallow silencioso

### Paso 7 — Verificar

```bash
pnpm test 2>&1 | tail -12
pnpm typecheck 2>&1 | tail -5
```

Si todo pasa → continuar al Paso 8.

Si tests fallan:
- Intento 1: leer el error, identificar la causa, corregir la implementación (no el test)
- Intento 2: si sigue fallando, leer más contexto (tipos, imports, dependencias)
- Intento 3: último intento — si sigue fallando → **STOP CONDITION "tests-no-pasan"**

Si typecheck falla:
- Intento 1: corregir tipos
- Intento 2: si sigue → **STOP CONDITION "typecheck-falla"**

### Paso 8 — Verificar DB post-implementación

Si la fase afecta scoring, enrichment o discovery → correr los invariantes del Paso 2.
Si la fase agrega campos a `score_breakdown` → verificar además:
```bash
docker exec supabase_db_gap-radar psql -U postgres -d postgres -c "
SELECT COUNT(*) FROM leads WHERE passed_filter=true AND score_breakdown->>'contact_tier' IS NULL;"
```
(adaptar según los campos nuevos)

**`score --all` ya no es pausa automática** cuando existe aprobación manual general vigente y no hay gasto externo. Si una fase requiere re-scoring:

1. Verificar antes que la fase realmente lo necesita y que existe backup/rollback cuando corresponda.
2. Ejecutarlo sin frenar si no depende de input humano pendiente.
3. Detenerse solo si el re-score depende de una revisión humana previa del negocio.

Ejemplo: `Fase 22-eval` puede correrse autónomamente para generar el reporte; **`Fase 22` sí debe esperar** a que Nicolás revise ese reporte antes del `score --all`.

Luego las queries de verificación específicas que define la fase en FUTURE.md.

### Paso 9 — Actualizar context/

Al terminar una fase exitosamente, actualizar estos tres archivos:

**`context/FUTURE.md`:** eliminar la sección de la fase completada.

**`context/ARCHITECTURE.md`:** agregar o actualizar la sección del módulo que cambió.
Solo documentar lo implementado — nunca intenciones ni planes.
Mantener el estilo existente del archivo (tablas, bloques de código, secciones).

**`context/AUTONOMOUS.md` (este archivo):** reescribir la sección ESTADO al final.

### Paso 10 — Commit

```bash
# Stagear solo los archivos modificados por esta fase (no usar git add -p — es interactivo)
git add <lista-de-archivos-específicos>
git diff --staged   # revisar que el diff sea coherente con la fase
git commit -m "<tipo>: <descripción concisa>"
```

Tipos: feat, fix, refactor, docs, test, chore.
El mensaje debe describir el comportamiento, no los archivos.
Nunca usar `git add -p`, `git add -i` ni ningún comando interactivo — el modo autónomo no tiene input humano.

### Paso 11 — Continuar o detener

- Si quedan items ejecutables en `ROADMAP_CANONICAL.md` → volver al Paso 1 (verificar estado limpio)
- Si no quedan items ejecutables en `ROADMAP_CANONICAL.md` → **STOP LIMPIO** "todas las fases completadas"
- Si el contexto de la sesión está > 70% usado → **STOP LIMPIO** "contexto agotándose — reanudar en nueva sesión"

---

## Migraciones de DB — protocolo especial

Las migraciones (`ALTER TABLE`, `CREATE TABLE`, `CREATE INDEX`) son irreversibles en local.
Antes de ejecutar cualquier migración:

1. Mostrar el SQL que se va a ejecutar
2. Verificar que no rompe datos existentes (`SELECT COUNT(*)` de lo que se va a afectar)
3. Ejecutar en transacción cuando sea posible
4. Nunca `DROP COLUMN` sin haber verificado que ningún código lo usa

```bash
# Formato para ejecutar migraciones
docker exec supabase_db_gap-radar psql -U postgres -d postgres -c "BEGIN; <SQL>; COMMIT;"
```

Si la migración falla → ROLLBACK automático. No dejar la DB en estado inconsistente.

### Backup obligatorio antes de fases destructivas

Una fase es "destructiva" si:
- Hace `UPDATE` masivo que sobrescribe datos sin path de rollback (ej: re-scoring v2 sin guardar v1)
- Elimina contenido del JSONB en lotes (ej: Fase 47 step 5)
- Hace `DROP COLUMN` o `DROP TABLE` (BLOQUEADO por SECURITY.md, no debería ocurrir, pero por si el agente lo intenta)
- Trunca o reinicializa cualquier tabla

**Antes de ejecutar el primer paso destructivo:**
```bash
TS=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BLINDSPOT_BACKUP_DIR:-$HOME/blindspot-backups}"
mkdir -p "$BACKUP_DIR"
docker exec supabase_db_gap-radar pg_dump -U postgres -d postgres | gzip > "$BACKUP_DIR/pre-fase<N>-${TS}.sql.gz"
# Verificar que el archivo se creó y es válido:
ls -lh "$BACKUP_DIR/pre-fase<N>-${TS}.sql.gz"
gunzip -t "$BACKUP_DIR/pre-fase<N>-${TS}.sql.gz"
# Solo continuar si tamaño > 1KB y gunzip -t no produce error
```

Si Fase 49 (backup automatizado) no está aplicada todavía:
- El directorio `$HOME/blindspot-backups` puede no existir. Crear con `mkdir -p "$HOME/blindspot-backups"` (no requiere sudo — vive en home del usuario).
- Si el `mkdir` falla por algún motivo (filesystem read-only, cuota llena), fallar la fase con `STOP CONDITION` y pedir a Nicolás que diagnostique antes de cualquier UPDATE masivo.

---

## Casos que sí requieren intervención real

> Con aprobación manual general vigente, el agente **sigue solo** salvo en estos casos.

| Caso | Motivo |
|------|-------|
| **APIs con costo / gasto externo** | Google Places, modelos billables o cualquier ejecución con impacto financiero real. |
| **Comandos bloqueados por `SECURITY.md` o instalación de paquetes** | La aprobación general no levanta `pnpm add`, comandos destructivos ni bloqueos del sandbox/política. |
| **Research externo pendiente** | Fase 11 (IMM) y Fase 30 (DGI) siguen frenando hasta que exista el research en `context/research/`. |
| **Input humano de negocio** | Ejemplo principal: `Fase 22-eval` se ejecuta sola, pero `Fase 22` no arranca hasta que Nicolás revise el reporte v1/v2. También aplica a Fase 42 y a cualquier criterio que dependa de juicio comercial. |
| **Acciones manuales fuera del repo o del entorno local** | Producción/infra como Fase 48, cron fuera del flujo automatizable, PM2/Nginx/HTTPS, o configuraciones que solo el admin debe operar. |
| **Cleanup v1** | `DROP COLUMN` manual/administrativo; el agente lo sigue salteando por diseño y avanza al item siguiente del canónico. |

**Stop condition para estos casos:** detenerse solo cuando falta una de esas condiciones reales, no por la etiqueta `approval` aislada.

---

## Límites de cambios por sesión autónoma

Aunque el agente puede ejecutar múltiples fases en una sesión, hay límites duros para evitar acumulación de cambios sin revisión:

- **Máximo 1 fase con cambio de schema de DB por sesión.** Si el agente termina una fase con migración, STOP LIMPIO antes de empezar otra con migración.
- **Máximo 200 líneas de diff por commit.** Si una fase requiere más, fragmentarla en sub-tareas con commits separados.
- **Si una sesión modifica `scoring/index.ts`, `sub-scores.ts` o `config/scoring.yaml`** → STOP LIMPIO después de esa fase. Revisión humana antes de la siguiente.
- **Si una sesión modifica `digital_footprint` schema o cualquier columna jsonb crítica** → STOP LIMPIO.

---

## Condiciones de stop — cuándo detenerse y reportar

Cuando se llega a una stop condition, NO continuar al siguiente paso. En cambio:

1. Reescribir ESTADO en este archivo con la causa exacta
2. Commitear solo los archivos de context/ (no código parcial)
3. Mostrar al usuario un resumen claro de:
   - Qué se completó antes del stop
   - Por qué se detuvo
   - Qué necesita revisión humana para continuar

| Código | Condición | Acción recomendada para el usuario |
|--------|-----------|-----------------------------------|
| `boot-fallido` | Tests fallaban al arrancar la sesión | Revisar el último commit, correr tests manualmente |
| `invariante-db` | DB invariant ≠ 0 al inicio | Diagnóstico manual con queries SQL |
| `tests-no-pasan` | Tests fallando después de 3 intentos de fix | Revisar diff, posible regresión en otro módulo |
| `typecheck-falla` | Typecheck fallando después de 2 intentos | Revisar tipos, posible cambio de interfaz |
| `fase-bloqueada-google` | Fase requiere Google Places API | Decidir si ejecutar manualmente con presupuesto |
| `fase-requiere-research` | Fase necesita Gemini DeepSearch primero | Correr Gemini y pegar resultado para continuar |
| `contradiccion-arquitectura` | Implementación contradice ARCHITECTURE_FUTURE.md, o una "dependencia" cruza bloques del roadmap canónico | Revisar el conflicto y decidir dirección, o corregir el roadmap |
| `contexto-agotado` | Contexto de sesión > 70% | Iniciar nueva sesión con AUTONOMOUS.md adjunto |
| `fases-completas` | No quedan fases ejecutables en ROADMAP_CANONICAL.md | Revisar roadmap canónico y agregar nuevas fases |
| `approval-required-fase-<id>` | Falta una condición real para seguir: gasto externo, comando bloqueado, research o input humano. `<id>` puede ser numérico (`22`, `47`) o textual (`API-0`, `46-deps`). | Resolver la condición faltante o dar la instrucción específica necesaria |
| `approval-required-dependency` | Fase requiere `pnpm add <paquete>` — detectado en Paso 5 antes de tocar código | Revisar paquete + razón + tamaño; aprobar el install específico, luego el agente puede volver al Paso 5 |
| `cron-pendiente-manual` | `crontab` no se puede instalar de forma no interactiva (ej. Fase 49) | Instalar el cron line manualmente y registrarlo |
| `backup-pendiente` | Una fase destructiva intentó arrancar y `scripts/backup.sh` no produjo backup válido | Diagnosticar el filesystem / espacio en disco antes de re-intentar |
| `restart_disabled_in_dev` | Endpoint solo activo en `NODE_ENV='production'` (ej. restart-core/restart-api) ejecutado en dev | Esperado en local; ignorar |
| `plan-mode-cli-active` | Claude Code está en Plan Mode CLI y el agente intentó ejecutar `Edit`/`Write`/`Bash` de modificación | Salir de Plan Mode CLI (`ExitPlanMode` con aprobación humana del plan) o cambiar a Auto Mode CLI |
| `criterio-imposible-de-cerrar` | La definición de listo del item canónico depende de algo que aún no existe (schema, fase anterior no aplicada) | Adelantar la fase faltante, ajustar `ROADMAP_CANONICAL.md` o reordenar el item antes de avanzar |
| `manual-skip-cleanup-v1` | Item 31 (Cleanup v1) detectado como próximo en el canónico. El agente **no ejecuta esta fase** (modo `manual/approval`, solo Nicolás) pero **sí avanza al siguiente item** (32 = Fase 40 — Bloque 9). Registrar en ESTADO que se saltó por diseño y continuar — no es bloqueante. | Ignorar en la cadena autónoma; Nicolás ejecuta Cleanup v1 off-band cuando decida. |
| `approval-required-fase-11-research` | Item 35 (Fase 11 IMM Habilitaciones) requiere Gemini DeepSearch del Tech Lead antes de implementar el provider. Sin research previo en `context/research/imm-habilitaciones.md`, no procede. | Tech Lead corre Gemini DeepSearch sobre IMM Habilitaciones (licencia, endpoint, frecuencia) y guarda resultado en `context/research/imm-habilitaciones.md`. Luego aprobar con `"ok proceder con Fase 11"`. |
| `approval-required-fase-30-research` | Item 43 (Fase 30 DGI) requiere Gemini DeepSearch del Tech Lead validando fuente DGI/BPS oficial. | Tech Lead investiga fuente DGI/BPS, guarda en `context/research/dgi.md`. Si no hay fuente viable, terminar con `fases-completas-con-research-pendiente` (NO `fases-completas`). |
| `approval-required-fase-42-data` | Item 42 (Fase 42 Scoring estacional) requiere ≥30 outreach cerrados en 2+ estaciones distintas para calibrar `seasonal_modifiers`. | Tech Lead valida el dataset de outreach (`SELECT EXTRACT(MONTH FROM closed_at), COUNT(*) FROM lead_outreach WHERE outcome IS NOT NULL GROUP BY 1`). Aprobar con `"ok proceder con Fase 42"`. |
| `fases-completas-con-research-pendiente` | Items 0–42 completos pero item 43 (Fase 30 DGI) sigue sin research validado. El producto está esencialmente completo; el cierre nominal queda en pausa indefinida hasta que aparezca fuente DGI viable. | Sin acción inmediata. Cuando aparezca fuente DGI viable, retomar con Gemini DeepSearch + aprobación de Fase 30. |

---

## Qué NO hacer — trampas comunes del modo autónomo

- **No asumir que un test de otro módulo no importa.** Si un test ajeno al módulo actual falla después del cambio → es una regresión y debe corregirse.
- **No saltear el research de código existente.** Implementar sin leer el código circundante genera duplicados y conflictos de tipos.
- **No commitear `console.log` de debugging.** Revisar el diff completo antes de commitear.
- **No inventar campos en tipos TypeScript.** Si un campo no existe en `types.ts` → agregarlo primero, con su tipo correcto.
- **No correr discovery ni enrich en modo autónomo salvo para tests controlados.** Ver SECURITY.md.
- **No combinar una fase de código con una de documentación en el mismo commit.** Un commit = una responsabilidad.

---

## ESTADO DE SESIÓN AUTÓNOMA

> Reescribir al finalizar cada fase o al llegar a una stop condition.

**Última actualización:** 2026-05-18

**Sesiones autónomas completadas:** 35 (`Fase 49 — DB backup automatizado`, `Fase 22-pre — campos de versión y rollback de scoring`, `Fase 21 — PostGIS local + columna gps`, `Fase 47 — inferred_state a columna propia`, `Fase 15 — calidad de email + tipo de teléfono`, `Fase 6A — deduplicación cross-source para inserts nuevos`, `Fase 6B — reconciliación retroactiva local`, `Fase 22 — scoring v2 apply`, `Fase API-0 — schemas users/pipeline/outreach/audit_log`, `Fase 23 — core automation scheduler`, `Fase API APIA…APIE — Fastify completo + matriz auth verde`, `Admin MVP UI — User Management + Health + Audit Log Viewer`, `Fase 46 — Scraping hardening anti-detección`, `Fase 48 — Producción (artifacts)`, `Fase 39 — Webhook notificaciones externas`, `UI base`, `Pipeline Manager UI`, `Discovery Control Center UI`, `Fase 24 — batch discovery multi-ciudad`, `Fase 44 — budget tracker Google Places`, `Cost Dashboard UI`, `Fase 45-pre — pipeline_errors schema`, `Fase 45 — change detection en re-enrich`, `Performance Dashboard UI`, `Restart Actions UI + endpoints`, `Fase 40 — Full-text search (search_vector + GIN index)`, `Fase 26 — LLM offer generation con template fallback`, `Fase 28 — Sub-niche detection para leads other`, `Fase 29 — MINTUR TipoOperador extraction`, `Fase 38 — Geo-dedup ya implementada en commit previo (haversine + GPS filter)`, `Fase 37 — canonical_source (ALTER TABLE + backfill + VIEW + reconcileLeadIntoPrimary)`, `Fase 36 — days_in_pool scoring (timing_factor fresh/stale + score_breakdown.days_in_pool)`, `Fase 43 — Outreach campaigns (CREATE TABLE + CRUD API + UI selector)`, `Fase 41 — owner_group_id (ALTER TABLE + detectOwnerGroups + API owner-group + UI badge)`)

**Próxima fase a ejecutar:** Item 42 — Fase 42 (scoring estacional) → STOP CONDITION `approval-required-fase-42-data`. Item 43 — Fase 30 (DGI) → STOP CONDITION `approval-required-fase-30-research`. No quedan items ejecutables. Ver sección "Stop condition activa".

**Orden por bloques (canónico — sincronizado con `ROADMAP_CANONICAL.md § Roadmap ejecutable`, 44 items 0–43):**
- **Bloque 0:** Fase 49 (backup) — completada y verificada el 2026-05-17.
- **Bloque 1 (aditivo):** Fase 22-pre y Fase 21 completadas y verificadas el 2026-05-17.
- **Bloque 2 (destructivo, ÚNICO en el bloque):** Fase 47 — completada y verificada el 2026-05-17.
- **Bloque 3 (calidad de inputs):** Fase 15, Fase 6A y Fase 6B completadas y verificadas el 2026-05-18.
- **Bloque 4 (scoring único):** Fase 22-eval → Fase 22 — un solo `score --all`.
- **Bloque 5 (API + core automation):** Fase API-0 (incluye `lead_outreach`) → Fase 23 → Fase API.
- **Bloque 6 (operación segura):** Admin MVP UI → Fase 46 → Fase 48 → Fase 39 (webhooks).
- **Bloque 7 (outreach + UI base):** Fase 25 → Fase 44-pre (`llm_usage_log`) → Fase 26 → Fase 27 → Fase 13 (PedidosYa escape) → UI base.
- **Bloque 8 (Pipeline Manager + Discovery CC + dashboards avanzados):** Pipeline Manager UI → Discovery CC UI → Fase 24 (batch discovery) → Fase 44 → Cost Dashboard UI ✓ → Fase 45-pre ✓ → Fase 45 ✓ → Performance Dashboard UI ✓ → Restart Actions ✓ → Cleanup v1.
- **Bloque 9 (enriquecimiento incremental + refinamientos — cierra el producto):** Fase 40 (FTS) → Fase 28 (sub-niche) → Fase 29 (MINTUR TipoOperador) → Fase 11 (IMM, requires research) → Fase 18 (cruce MINTUR×IMM) → Fase 38 (geo-dedup) → Fase 37 (canonical_source) → Fase 43 (campaigns) → Fase 36 (days_in_pool) → Fase 41 (owner_group_id) → Fase 42 (scoring estacional, requires conversion data) → Fase 30 (DGI, requires research).
- Ver `FUTURE.md § Urgente — Flujo de ejecución por bloques` y `PROJECT_MASTER.md § Próximas acciones`.

**Comportamiento al cerrar Bloque 7 (UI base):** el agente NO debe reportar "todas las fases completadas". Debe pasar al item 22 (Pipeline Manager UI) y continuar por el Bloque 8 según el canónico. La stop condition `fases-completas` solo se dispara cuando el último item del Bloque 9 (item 43 = Fase 30 DGI, o quedará en `approval-required-fase-30-research` si no hay fuente validada — eso NO es `fases-completas`).

**Intervención humana todavía necesaria:** gasto externo / APIs billables, `pnpm add` o comandos bloqueados, research pendiente (IMM/DGI), revisión humana del reporte post-apply de `Fase 22` si se quiere recalibrar antes de API/UI, validación de data estacional para `Fase 42`, y acciones manuales de producción/cleanup como `Fase 48` y `Cleanup v1`. El resto debe continuar solo.

**Estado conocido:**
- Tests: 1068 passing, 7 skipped, 99 files
- Typecheck: limpio
- DB invariantes: todos en 0 (verificado 2026-05-18)
- Directiva de sesión 2026-05-18: continuar el roadmap sin pausas por etiquetas `approval/manual` aisladas. Frenar solo por bloqueo real de seguridad, gasto externo, research pendiente, contradicción documental o input humano realmente necesario.
- Fase 43: `outreach_campaigns` table + `lead_outreach.campaign_id` FK + CRUD API `/api/v1/campaigns*` + UI selector campaña en Outreach Tracker. 10 tests. Stub 501 eliminado.
- Fase 41: `leads.owner_group_id uuid` + `detectOwnerGroups()` agrupa por phone/email canónico + `GET /leads/:id/owner-group` + badge "N negocios del mismo propietario" en Lead Detail. 8 tests.
- Fase 49: `scripts/backup.sh` implementado, ejecutado con éxito y backup gzip validado en `$HOME/blindspot-backups`.
- Fase 22-pre: columnas `leads.scoring_version`, `leads.contact_ready`, `leads.prospect_score_v1`, `leads.score_breakdown_v1` y `lead_buyer_scores.scoring_version` creadas; backfill de `scoring_version` verificado en `0 NULLs`.
- Fase 21: `postgis` habilitado localmente, `leads.gps` creada con índice GIST, backfill aplicado sobre `535` filas OSM con `source_data.lat/lon`. Google Places queda sin backfill en esta fase porque el provider actual persiste coordenadas nulas; MINTUR sigue excluido por falta de GPS confiable.
- Fase 47: backup `blindspot_pre-fase47_20260517_175205.sql.gz` creado y validado; `leads.inferred_state` creada e indexada; backfill aplicado sobre `2163` filas; cleanup de `digital_footprint.inferred_state` completado (`0` claves remanentes).
- Fase 15: `email-quality.ts` y `shared/phone.ts` implementados; `enrich` persiste `digital_footprint.email_quality` + `phone_classification`; `updateLeadEnrichment()` y `updateLeadSocialSearch()` recalculan `contact_reliability_score` sin `score --all`; tags nuevos `mobile-phone`, `landline-phone`, `email-no-mx`.
- Fase 6A: `discover-external` ahora deduplica solo cross-source con guardas por `source`, `niche`, ciudad/dirección y GPS (`<=500m` cuando ambos lados tienen coordenadas); si hay match usa el RPC `merge_corroborating_source()` para upsertar `lead_source_references` y actualizar atómicamente `corroborating_sources`, `canonical_fields`, `data_confidence_score` y `contact_reliability_score`.
- Fase 6B: `blindspot reconcile-retroactive` implementado con `--dry-run/--apply`; usa `deduplication.name_threshold_retroactive=0.90`, planner keeper→secondary, guardas por ciudad/dirección/GPS y wildcard controlado para `mintur/other`. `src/storage/reconciliation.ts` mueve `lead_source_references` + `lead_field_evidences`, recalcula scores de confianza y elimina el secundario al final. Resultado real sobre la DB local 2026-05-18: `0` grupos candidatos, `0` leads absorbidos; query de sanidad por nombres normalizados cross-source también dio `0` overlaps exactos.
- Fase 22-eval: CLI `blindspot score-eval` implementada y ejecutada contra la DB local. Reporte pre-apply en `reports/22-eval/2026-05-18T043126026Z/` y reporte post-apply en `reports/22-eval/2026-05-18T045722Z-post-apply/` con `summary.md`, `summary.json`, distribuciones CSV, `lead-deltas.csv`, `top-v1.csv`, `top-v2.csv`, `top-50-comparison.csv` y `gold-set.seed.csv`.
- Resultado real de Fase 22-eval / post-apply (2026-05-18): `3493` leads evaluados; `Tier X >=55 = 0` (PASS), `score=100 = 6 / 3493 = 0.2%` (PASS), `avg franquicias = 36.8` (WARN), `avg car_dealer contactables = 44.3` (PASS), `top-50 overlap = 23/50`.
- Fase 22: backup `blindspot_pre-fase22_20260518_015503.sql.gz` validado; snapshot `prospect_score_v1` / `score_breakdown_v1` completo (`missing_v1_snapshot = 0`); `pnpm dev score --all` ejecutado con `passed_not_v2 = 0`, `buyer_scores_not_v2 = 0`, `missing_contact_tier = 0`, `tier_x_hot = 0`.
- Estado del gold set: bootstrap automático de `40` filas con `reviewStatus=pending_human`; útil para revisión humana del resultado ya aplicado.
- Cron backup: instalado no interactivamente (`0 3 * * * /home/nicolasfalcioni/Documentos/blindspot/scripts/backup.sh >> $HOME/blindspot-backup.log 2>&1`).
- Fase API-0: migración `014_api_0_schema.sql` aplicada. Tablas creadas: `users` (con admin `admin@blindspot.local`), `pipeline_runs`, `pipeline_config` (singleton con `enabled=false`), `discovery_jobs`, `audit_log`, `lead_outreach`. Columna `leads.contacted_by uuid REFERENCES users(id)` agregada. Tests: 917 passing, invariantes DB todos en 0.
- Fase 23: `src/start.ts` (entry point long-running), `PipelineScheduler` (cron + polling 60s/30s + configWatcher), `PgListener` (pg LISTEN pipeline_trigger con reconexión), `run-executor.ts` (executeRun + transitionToPending), `crash-recovery.ts` (recoverOrphanedRuns al boot), `scheduled-for.ts` (nextCronRun via cron-parser). Paquetes instalados: `node-cron`, `cron-parser`, `pg`. CLI `blindspot pipeline --run-all [--dry-run]`. Tests: 921 passing, typecheck limpio.
- `src/package.json` creado con `"name": "core"`. `pnpm-workspace.yaml` + workspace completo se finaliza en Fase API cuando se crea `api/`.
- Fase API APIA: `api/` creado como workspace, `buildServer()` con cors/helmet/rate-limit/jwt, `POST /auth/login`, `POST /auth/refresh`, `GET /api/v1/health`. Supabase client con NoopWebSocket, `requireAuth`/`requireAdmin` middleware con DB lookup fresh por request.
- Fase API APIB: migración `015_lead_dashboard_view.sql` (VIEW `lead_dashboard` con LEFT JOIN LATERAL `lead_buyer_scores`). `GET /api/v1/leads` (cursor-based, CM filter intersection, fail-closed para `lead_filter=null`). `GET /api/v1/leads/:id` (404 para lead fuera del filtro del CM). Zod validation de query params.
- Fase API APIC: `GET/POST/PATCH /outreach`, `POST /outreach/generate-offer` (stub Fase 26). Status/outcome cross-field validation. CM 404 en otros registros. Fix Zod v4 UUID strictness con regex permissivo.
- Fase API APID: `GET/PUT/PATCH /pipeline/config`, `POST /pipeline/run` (202 + pg_notify), `GET /pipeline/runs*`, `POST /pipeline/abort`. `GET/POST /discovery/jobs`, `PATCH /discovery/jobs/:id` (pause/resume/cancel). `GET/POST/PATCH/DELETE /users` (bcrypt, lead_filter validation, audit_log). `GET /campaigns*` (501 stub). Stats routes. `/admin/audit-log`, `/admin/system/status`, restart stubs (501 dev), costs/performance stubs.
- Fase API APIE: 8 auth matrix tests — live lead_filter update con mismo JWT, active=false bloqueo inmediato, CM 403 en paths admin-only, intersección de filtros CM, 404 en lead fuera de filtro. Tests: 972 passing, typecheck limpio. Fase API COMPLETA.
- Admin MVP UI (2026-05-18): `ui/` workspace Next.js 15 completado. Rutas: `/login`, `/admin/users` (CRUD + lead_filter + reset pwd + activate/deactivate), `/admin/health` (polling 10s, estado DB/cron/last_run), `/admin/audit-log` (filtros actor/action/from/to, tabla paginada cursor-based, modal diff before/after, export JSON). Build Next.js limpio. TypeCheck limpio.
- Fase 48 (2026-05-18): `ecosystem.config.cjs` (pm2 apps blindspot-core + blindspot-api), `nginx/blindspot.conf` (rate limiting 30r/m API / 5r/m auth, TLS1.3, security headers HSTS/XFO/XCTO, proxy UI 3000 y API 3001), `scripts/production-setup.sh` (guía interactiva 8 pasos). pm2 e nginx no instalados en dev — artifacts del repo listos para deploy.
- Fase 39 (2026-05-18): `src/modules/pipeline/webhook.ts` con `notifyWebhook()` HMAC-SHA256 + `loadWebhookConfig()`. `run-executor.ts` llama webhook al final de cada run (best-effort). `api/pipeline.ts` acepta `notify_webhook_{url,secret,events}` en PUT/PATCH + `POST /pipeline/webhook/test`. `ui/admin/pipeline/page.tsx` Pipeline Manager con estado del pipeline + sección webhook (URL, secreto, eventos, probar). Tests: 985 passing.
- Cost Dashboard UI (2026-05-18): `api/src/routes/admin/costs.ts` ahora agrega por mes sin depender de nuevas tablas: budget GP + requests, `llm.by_provider`, `per_source`, top leads por costo (`llm_usage_log` + share del `first_seen_run_id`) e historial `monthly[12]`. `ui/src/app/admin/costs/page.tsx` consume el contrato nuevo y renderiza overview, barras por fuente, top leads y tendencia de 12 meses. Tests: 1010 passing, typecheck limpio.
- Fase 45-pre (2026-05-18): migraciones `db/migrations/019_pipeline_errors.sql` y `supabase/migrations/20260518050000_pipeline_errors.sql` creadas y aplicadas localmente. Tabla `pipeline_errors` + índices (`run`, `occurred_at`, `phase`, `lead`) verificados con `to_regclass`. `src/storage/pipeline-errors.ts` expone `recordPipelineError()` y `tests/storage/pipeline-errors.test.ts` cubre insert normalizado, flags explícitos y error de DB.
- Fase 45 (2026-05-18): `src/modules/enrichment/change-detection.ts` implementa el diff incremental de re-enrich. `updateLeadEnrichment()` ahora persiste `digital_footprint.last_change_diff`, agrega `state-changed-significant`, re-scorea automáticamente cambios críticos y recalcula `lead_buyer_scores`. `enrichCommand()` contabiliza `significant_changes` en `EnrichmentRunStats`, lo imprime en el summary y persiste errores recuperados en `pipeline_errors`. Se corrigió además el cleanup de listeners `SIGINT/SIGTERM` por invocación. Verificación final: `pnpm test` = `1019 passing, 7 skipped`; `pnpm typecheck` limpio; invariantes DB `0/0/0/0`.
- Performance Dashboard UI (2026-05-18): `api/src/routes/admin/performance.ts` dejó de responder stub y ahora entrega overview, errores filtrables y quality summary usando `pipeline_runs`, `pipeline_errors`, `leads` y `digital_footprint.last_change_diff`. `ui/src/app/admin/performance/page.tsx` consume esos endpoints y renderiza runs, tiempo por fase, throughput, tasa de éxito por fuente, cobertura de datos, errores recientes y cambios significativos. Tests: `tests/api/performance.test.ts` cubre overview/errors/quality. Verificación final: `pnpm test` = `1022 passing, 7 skipped`; `pnpm typecheck` limpio.
- Restart Actions UI + endpoints (2026-05-18): `api/src/routes/admin/system.ts` amplió `GET /api/v1/admin/system/status` con metadatos de server/procesos y activó `POST /api/v1/admin/system/restart-{core,api}` con códigos tipados (`restart_disabled_in_dev`, `pm2_not_found`, `process_not_registered`, `pm2_failed`, `timeout`) y audit log previo al intento. `ui/src/app/admin/health/page.tsx` migró a `/admin/system/status`, muestra procesos `core/api`, agrega confirmación de restart y polling post-reinicio. `tests/api/admin-system.test.ts` cubre status, 501 en dev y restart exitoso en producción mockeada. Verificación final: `pnpm test` = `1025 passing, 7 skipped`; `pnpm typecheck` limpio; invariantes DB `0/0/0/0`.
- Fase 46 (2026-05-18): `src/shared/scraping.ts` con `jitter`, `randomBetween`, `pickRandom`, `backoffMs`, `isBlockedStatus`. `ScrapingConfig` en `types.ts` + `config/discovery.yaml` (5 UA discovery, 10 UA social, delays `[800,2500]ms`/`[1500,4000]ms`, max_retries 3/2). `YeluProvider`: `sleepFn` injectable (no-op en tests), delay entre páginas, retry+backoff en 429/403/503. `PedidosYaProvider`: mismo patrón + UA rotation al crear contexto Playwright. `social-enrich/browser.ts`: migrado a `playwright-extra` + stealth, UA rotado desde config. `social-enrich/index.ts`: delay aleatorio entre leads, `blocked` clasificado por señales (`blocked`, `captcha`, `denied`, `403`, `checkpoint`), `updateLeadSocialEnrichStatus` persiste `social_enrich_status: "blocked"` + tag `social-blocked`. `discover-external` pasa `sleepFn` real. Tests: 976 passing, typecheck limpio.

**Contexto de la documentación:** los archivos context/ tienen 19 fixes de auditorías previas + reorganización 2026-05-16 (modelo "uso interno + socios"). Se eliminaron contradicciones C2–C5 detectadas en quinta auditoría:
- Mono-repo confirmado (un directorio `blindspot/` con `src/`, `api/`, `ui/`) — `AUTONOMOUS.md` alineado.
- `accessibility_factor` valores canónicos: X=0.30, D=0.65, C=0.90, B=1.15, A=1.30 (tiers **mutuamente excluyentes** — no existe A+B). Ajuste multiplicativo por reliability: `× (0.75 + 0.25 × contact_reliability_score)`. Ver `ARCHITECTURE_FUTURE.md § Componente 4`.
- Schema canónico de `lead_outreach`: ver `ARCHITECTURE_FUTURE.md § Tabla lead_outreach — diseño final`.
- Schemas canónicos de `pipeline_runs`, `pipeline_config`, `discovery_jobs`, `audit_log`: **FUTURE.md Fase API-0 step 6 y step 7 los crea con el schema completo desde el inicio** — no hay stubs reducidos. Naming canónico: `triggered_by` (no `trigger`), `phases` (no `phase_config`), `user_id` (no `created_by` en discovery_jobs), `log_lines jsonb` (no `text[]`), CHECK status incluye `'partial'`.
- `ADMIN_PANEL.md` define endpoints `/api/v1/admin/*` y la lista canónica de `audit_log.action` (sincronizada con FUTURE.md Fase API-0 step 7).

**Arquitectura objetivo (un repo, tres directorios — workspace pnpm):**
- `src/` (este directorio) — core pipeline: discovery, enrichment, scoring. Proceso long-running. Escucha instrucciones via PostgreSQL (`LISTEN pipeline_trigger` + polling de fallback cada 60s + poll de `discovery_jobs` cada 30s).
- `api/` (directorio nuevo) — gateway HTTP Fastify. Lee/escribe en la misma DB. Dispara pipeline via `pg_notify` + inserción en `pipeline_runs`. Sin Playwright ni lógica de scoring/discovery.
- `ui/` (directorio nuevo) — frontend Next.js. Solo consume REST API de `api/` (puerto 3001).

Coordinación entre procesos: PostgreSQL exclusivamente (`pg_notify` + tablas `pipeline_runs`, `discovery_jobs`, `pipeline_config`). `api/` y `src/` nunca se llaman por HTTP entre sí.

`pnpm-workspace.yaml` en la raíz lista los tres directorios. Los `package.json` de cada directorio deben tener `"name"` igual a `core` / `api` / `ui` respectivamente para que `pnpm --filter <name>` funcione.

**Archivos de contexto disponibles:**
- `context/AUTONOMOUS.md` — este archivo, runbook del modo autónomo
- `context/ROADMAP_CANONICAL.md` — fuente de verdad para orden, dependencias, estados y decisiones consolidadas
- `context/PROJECT_MASTER.md` — modelo de uso, roles, próximas acciones priorizadas
- `context/SECURITY.md` — reglas de seguridad, comandos bloqueados, presupuesto Google API
- `context/ARCHITECTURE.md` — arquitectura implementada actualmente en este repo
- `context/ARCHITECTURE_FUTURE.md` — arquitectura objetivo (un repo, tres directorios `src/`, `api/`, `ui/` + diseño de datos)
- `context/ARCHITECTURE_FRONTEND.md` — diseño completo del frontend `ui/` (pantallas de uso normal)
- `context/ADMIN_PANEL.md` — specs del panel de administración (gestión de socios, costos, performance, audit)
- `context/FUTURE.md` — backlog priorizado de fases + sección de postpuestas
- `context/LEADS_DATA.md` — snapshot de datos (cargar solo si la fase involucra análisis de leads concretos)
- `context/research/<source>.md` — investigación por fuente externa (mintur, osm, yelu, pedidosya)

**Stop condition activa:** `fases-completas-con-research-pendiente` — Items 0–41 completos. Item 42 (Fase 42 scoring estacional): `approval-required-fase-42-data` — requiere ≥30 outreach cerrados en 2+ estaciones. Item 43 (Fase 30 DGI): `approval-required-fase-30-research` — requiere Gemini DeepSearch validando fuente DGI/BPS. No quedan items auto-ejecutables en el roadmap canónico.
