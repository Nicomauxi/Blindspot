# Blindspot — Autonomous Development Runbook

> **Modo de uso:** adjuntar este archivo a una sesión Claude Code sin mensaje adicional.
> Claude lee este archivo y ejecuta el loop autónomo indefinidamente hasta que una
> condición de stop lo detenga. No requiere intervención humana por fases.
>
> **Diferencia con PROJECT_MASTER.md:** en el modo manual Claude actúa como Tech Lead
> y genera prompts para otra sesión CC. En modo autónomo Claude **implementa directamente**
> — planea, escribe código, verifica, corrige y commitea sin intermediarios.
>
> **Contexto requerido:** leer este archivo + `ARCHITECTURE.md` + `ARCHITECTURE_FUTURE.md`
> + `FUTURE.md` + `context/SECURITY.md` antes de ejecutar cualquier acción.

---

## Objetivo del producto (resumen)

Blindspot identifica negocios locales uruguayos con buena reputación offline pero gaps digitales.
Genera leads calificados con scores, contacto verificado y pitch concreto.
Stack: Node.js/TypeScript, PostgreSQL (Supabase local), Vitest, CLI + API HTTP futura.

---

## Reglas de oro — no violar bajo ninguna circunstancia

1. **Leer SECURITY.md antes de ejecutar cualquier comando.** Si una acción está en la lista BLOQUEADA → no ejecutarla, registrar en el reporte de stop y detenerse.

2. **Tests y typecheck deben pasar antes de commitear.** Sin excepción. Si fallan después de 3 intentos de fix → stop condition.

3. **No modificar tests para hacerlos pasar.** Un test puede corregirse solo si tiene un fixture de entrada incorrecto. Cambiar assertions para que pasen es trampa.

4. **Una fase por iteración.** No combinar dos fases de FUTURE.md en un solo commit. Atómico y verificable.

5. **Verificar DB invariantes antes y después de cada fase.** Si algún invariante falla post-implementación → fix o stop.

6. **Commitear al terminar cada fase correctamente.** Si la fase falla (stop condition) → no commitear código parcial.

7. **Actualizar context/ al terminar cada fase.** ARCHITECTURE.md, FUTURE.md y AUTONOMOUS.md (sección ESTADO) deben reflejar el estado real post-implementación.

---

## Loop autónomo — ejecutar en este orden exacto

### Paso 1 — Boot: verificar estado base

```bash
pnpm test 2>&1 | tail -8 && pnpm typecheck 2>&1 | tail -3 && git log --oneline -3
```

Si tests fallan en boot → **STOP INMEDIATO** antes de tocar código.
Registrar en ESTADO: "boot fallido — tests no pasaban al iniciar".

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

### Paso 3 — Seleccionar la próxima fase

Leer `context/FUTURE.md`. Tomar el **primer item** de la sección "Urgente — Bloqueantes" que no esté marcado como completado.

Si no hay items urgentes → tomar el primer item de la siguiente sección en orden.

**Antes de seleccionar, verificar que la fase sea auto-ejecutable:**

| Condición | Acción |
|-----------|--------|
| Fase requiere llamada a Google Places API | **STOP** — registrar, esperar instrucción |
| Fase requiere Gemini DeepSearch (nueva fuente externa) | **STOP** — registrar, esperar instrucción |
| Fase requiere migración de columnas en DB (`ALTER TABLE`) | Ver sección "Migraciones DB" más abajo |
| Fase dice "depende de Fase X" y X no está completa | Saltar a X primero |
| Fase es puramente de código TypeScript + tests | **SAFE TO EXECUTE** |
| Fase es de documentación o config YAML | **SAFE TO EXECUTE** |

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

Si el plan contradice `ARCHITECTURE_FUTURE.md` → ajustar el plan, no el documento.

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

Si la fase requiere re-scoring → correr:
```bash
pnpm run score -- --all 2>&1 | tail -10
```

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

- Si hay más fases en FUTURE.md → volver al Paso 1 (verificar estado limpio)
- Si no hay más fases → **STOP LIMPIO** "todas las fases completadas"
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
| `contradiccion-arquitectura` | Implementación contradice ARCHITECTURE_FUTURE.md | Revisar el conflicto y decidir dirección |
| `contexto-agotado` | Contexto de sesión > 70% | Iniciar nueva sesión con AUTONOMOUS.md adjunto |
| `fases-completas` | No quedan fases en FUTURE.md | Revisar FUTURE.md y agregar nuevas fases |

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

**Última actualización:** 2026-05-16

**Sesiones autónomas completadas:** ninguna

**Próxima fase a ejecutar:** Fase 22-pre — migración `scoring_version` + `contact_ready`
(seguir la spec en FUTURE.md § Fase 22-pre — es PREREQUISITO de Fase 22, no saltear)

**Estado conocido:**
- Tests: 882 passing, 7 skipped, 69 files
- Typecheck: limpio
- DB invariantes: todos en 0 (verificado 2026-05-16)
- Último commit: 65f8e1e (docs: cuarta auditoría — 19 fixes en arquitectura y roadmap)

**Contexto de la documentación:** los archivos context/ tienen 19 fixes aplicados en la cuarta auditoría (E1–E5, D1–D5, A1–A6, G1–G5). Antes de implementar cualquier fase, el diseño en ARCHITECTURE_FUTURE.md es el canónico — no tiene ambigüedades conocidas.

**Arquitectura objetivo (tres proyectos):**
- `blindspot` (este repo) — core pipeline puro: discovery, enrichment, scoring. Sin HTTP server. Proceso long-running que escucha instrucciones via PostgreSQL (pg_notify + polling).
- `blindspot-api` (nuevo repo) — gateway HTTP Fastify. Lee/escribe en la misma DB. Dispara pipeline via pg_notify. Sin Playwright ni lógica de scoring.
- `blindspot-ui` (nuevo repo) — frontend Next.js. Solo consume REST API de blindspot-api.

**Archivos de contexto disponibles:**
- `context/AUTONOMOUS.md` — este archivo, runbook del modo autónomo
- `context/SECURITY.md` — reglas de seguridad, comandos bloqueados, presupuesto Google API
- `context/ARCHITECTURE_FRONTEND.md` — diseño completo del frontend blindspot-ui
- `context/ARCHITECTURE_FUTURE.md` — arquitectura objetivo completa (tres proyectos + diseño de datos)
- `context/ARCHITECTURE.md` — arquitectura implementada actualmente en este repo

**Stop condition activa:** ninguna
