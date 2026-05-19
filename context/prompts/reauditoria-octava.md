# Re-auditoría crítica — Blindspot planning docs (octava ronda)

> ARCHIVO HISTÓRICO. No ejecutar ni obedecer como runbook activo salvo pedido explícito de Nicolás.
> Para ejecución actual usar `context/ROADMAP_CANONICAL.md`.

Sos un Tech Lead / PO senior externo. Hacés una **auditoría adversarial** de la documentación de planificación del proyecto Blindspot. Verificá que las correcciones de la séptima auditoría (2026-05-16) cerraron limpiamente los hallazgos N-1 a N-10 y que NO introdujeron nuevas contradicciones.

**Tu output es solamente la auditoría escrita. No modifiques archivos. No escribas código. No corras tests ni queries SQL.**

---

## Contexto del proyecto

Blindspot es una herramienta interna privada (NO se comercializa). 1 admin (Nicolás) + 2–8 socios CM con accesos delimitados por `lead_filter`. Pipeline de discovery + enrichment + scoring sobre negocios uruguayos. Stack: Node.js 20 + TypeScript strict, PostgreSQL (Supabase local), Playwright, Fastify (planeado), Next.js 15 (planeado). **Mono-repo con pnpm workspaces:** `src/` (core) + `api/` (HTTP) + `ui/` (frontend). Coordinación src↔api exclusivamente via PostgreSQL (`pg_notify` + polling).

## Archivos a auditar

Todos en `/home/nicolasfalcioni/Documentos/blindspot/context/`:

- `PROJECT_MASTER.md` — runbook tech lead + próximas acciones por bloques
- `AUTONOMOUS.md` — runbook ejecución autónoma
- `ARCHITECTURE.md` — arquitectura implementada hoy (v1)
- `ARCHITECTURE_FUTURE.md` (~3200+ líneas — leer en chunks de 400) — arquitectura objetivo
- `ARCHITECTURE_FRONTEND.md` — UI de uso normal
- `ADMIN_PANEL.md` — panel admin
- `FUTURE.md` (~1580 líneas — leer en chunks) — backlog de fases
- `SECURITY.md` — reglas de seguridad

Empezá por `PROJECT_MASTER.md` y `AUTONOMOUS.md` completos. Luego `FUTURE.md` en chunks (offset 0, 400, 800, 1200). Luego `ARCHITECTURE_FUTURE.md` en chunks (offset 0, 500, 1000, 1500, 2000, 2500). Finalmente `ADMIN_PANEL.md`, `ARCHITECTURE_FRONTEND.md` y `SECURITY.md` si hay hallazgos que requieran verificación.

---

## Qué cambió en la sesión anterior (verificar que cerró)

La séptima auditoría aplicó **10 correcciones** sobre la documentación. Para cada una: confirmar ✅ CERRADA, ⚠️ PARCIAL (qué falta) o ❌ NO APLICADA / NUEVA CONTRADICCIÓN.

### N-1 (CRÍTICO) — `business_quality_pts` consolidado
**Cambio aplicado:**
- `ARCHITECTURE_FUTURE.md § Componente 3` (sección "(0–15)") reescrito con:
  - rating ≥ 4.3 → +5, ≥ 4.0 → +2 (excluyentes)
  - review_count ≥ 50 → +3, ≥ 20 → +1 (excluyentes)
  - `data_confidence: floor(score × 3)` → 0–3 pts (continuo, no binario)
  - `contact_reliability: floor(score × 2)` → 0–2 pts ← **incluido como componente aditivo**
  - corroboration: +2 si corroborating_sources >= 2
  - tabla de máximos individuales: 5+3+3+2+2 = 15
- `ARCHITECTURE_FUTURE.md § Flujo 3 — Scoring`: `business_quality_pts = min(15, ratingPts + reviewPts + dataConfidencePts + contactReliabilityPts + corroborationPts)` con comentarios inline de cada componente.
- `ARCHITECTURE_FUTURE.md § Migración de scoring.yaml`: yaml block actualizado con `rating_tiers: [[4.0, 4.3, 2], [4.3, 5.01, 5]]`, `data_confidence_multiplier: 3`, `contact_reliability_multiplier: 2`.

**Verificar:** (a) la tabla en `FUTURE.md` Fase 22 step 5 sigue siendo coherente con esto (granularidad y caps idénticos); (b) no quedan otras menciones de `data_confidence: +2 si ≥0.7` (formato binario antiguo); (c) el yaml block del scoring usa la sintaxis nueva consistentemente; (d) el ejemplo "Car dealer ... = 14/15" es correcto matemáticamente.

### N-2 (CRÍTICO) — `accessibility_factor` rango corregido
**Cambio aplicado:** `ARCHITECTURE_FUTURE.md` flujo de scoring (cerca de l.1573) ahora dice `accessibility_factor(...): 0.225–1.30` (antes: `0.30–1.40`).

**Verificar:** no quedan otras menciones de `1.40` como cap, o rango "0.30–1.40", en ningún archivo. Hacer grep mental por "1.40" en ARCHITECTURE_FUTURE.md y FUTURE.md.

### N-3 (CRÍTICO) — `pipeline_config` singleton enforced
**Cambio aplicado:** ambos archivos (`FUTURE.md` Fase API-0 step 6 y `ARCHITECTURE_FUTURE.md § Schema completo — pipeline_config`):
- PK cambiado de `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` → `id text PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton')`.
- INSERT cambiado de `DEFAULT VALUES` → `INSERT INTO pipeline_config (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING` (idempotente para replays).

**Verificar:** (a) el código TS de `loadPipelineConfig()` (mencionado en `ARCHITECTURE_FUTURE.md § configWatcher`) sigue siendo válido sin asumir un orden de filas — la query no necesita `LIMIT 1` ni `ORDER BY`; (b) los endpoints `PUT/PATCH /api/v1/pipeline/config` saben que están actualizando WHERE `id='singleton'`.

### N-4 (CRÍTICO) — "Tercer score --all" eliminado de Fase 6 y Fase 22 step 5
**Cambio aplicado:**
- `FUTURE.md` Fase 6 sección "Paso crítico post-implementación" reescrita: ahora dice "**NO correr `score --all` aquí (Bloque 3) — Fase 22 (Bloque 4) lo hace una sola vez con todos los inputs ya consolidados**".
- `FUTURE.md` Fase 22 step 5 (corroboration): eliminado "v2-preliminares" y "tercer score post-Fase 6", reemplazado por "Fase 6 ya está aplicada en el Bloque 3 (anterior a este Bloque 4)".

**Verificar:** no quedan referencias a "tres scoreos", "v2-preliminares", "tercer score --all", o "post-reconciliación" como justificación para un re-run. La narrativa "un solo `score --all`" es consistente en `FUTURE.md`, `PROJECT_MASTER.md` y `AUTONOMOUS.md`.

### N-5 (CRÍTICO) — `score_breakdown` completo en Fase 22 step 12
**Cambio aplicado:** `FUTURE.md` Fase 22 step 12 ahora lista los 12 campos canónicos (sub_scores, primary_offer, source_quality_bonus, contact_tier, pitch_hook, urgency_signal, gap_depth, commercial_breadth, business_quality_pts, accessibility_factor, timing_factor, urgency_bonus, inferred_state_summary) con tipos/rangos.

**Verificar:** (a) los campos `gap_depth?`, `commercial_breadth?`, `business_quality_pts?`, `accessibility_factor?`, `timing_factor?`, `urgency_bonus?` del `LeadCard` (`ARCHITECTURE_FRONTEND.md` y `ARCHITECTURE_FUTURE.md`) tienen el mismo set que el step 12; (b) el frontend Lead Detail mock muestra exactamente esos campos.

### N-6 (CRÍTICO) — Fase API-0 step 2 (lead_outreach.user_id) clarificado
**Cambio aplicado:** `FUTURE.md` Fase API-0 step 2 reescrito: "**NO ejecutar ALTER TABLE en esta fase.** En el flujo canónico por bloques, `lead_outreach` se crea en Fase 25 (Bloque 7) con el schema canónico... CC debe verificar con `SELECT to_regclass('lead_outreach');` antes de cualquier ALTER".

**Verificar:** (a) Fase 25 (FUTURE.md) referencia el schema canónico de ARCHITECTURE_FUTURE.md `§ Tabla lead_outreach — diseño final` que SÍ incluye `user_id NOT NULL` en el CREATE; (b) no hay otras menciones de un ALTER TABLE para lead_outreach en otras fases.

### N-7 (ALTO) — Fase API-0 marcada como aprobación humana en PROJECT_MASTER.md
**Cambio aplicado:** `PROJECT_MASTER.md` § Próximas acciones, Bloque 5 item 9: agregado "**Aprobación humana requerida** (migración multi-tabla con blast radius alto — ver `AUTONOMOUS.md § Fases que requieren aprobación humana`)".

**Verificar:** lista de aprobación humana coincide entre `AUTONOMOUS.md:325` y los items de `PROJECT_MASTER.md § Próximas acciones`. Específicamente: Fase 22, Fase 47, Fase 6, Fase API-0, todas marcadas.

### N-10 (CRÍTICO) — Fase 49 path-independent (sin sudo)
**Cambio aplicado:**
- `FUTURE.md` Fase 49: `BACKUP_DIR` default cambiado de `/backups` → `$HOME/blindspot-backups`. `sudo mkdir` reemplazado por `mkdir -p "$HOME/blindspot-backups"`. Cron log path cambiado de `/var/log/blindspot-backup.log` → `$HOME/blindspot-backup.log`.
- `FUTURE.md` Fase 47 step 0 (backup pre-destructivo): mismo cambio.
- `AUTONOMOUS.md § Backup obligatorio antes de fases destructivas`: mismo cambio.

**Verificar:** (a) no quedan menciones literales de `/backups` en ningún archivo; (b) los ejemplos de comandos de verificación (`gunzip -t /backups/...`) están actualizados; (c) la variable `BLINDSPOT_BACKUP_DIR` se usa consistentemente como override; (d) si la cron line aún tiene path hardcodeado a `/home/nicolasfalcioni/...` para el script, sigue siendo válido porque ese path SÍ existe (es el repo).

### N-9 (ALTO) — LeadCard sincronizado ARCHITECTURE_FUTURE.md ↔ ARCHITECTURE_FRONTEND.md
**Cambio aplicado:** `ARCHITECTURE_FUTURE.md` interface `LeadCard` ahora incluye:
- `detected_sub_niche?: string` (post-Fase 28).
- 6 campos opcionales de "Score breakdown v2": `gap_depth?`, `commercial_breadth?`, `business_quality_pts?`, `accessibility_factor?`, `timing_factor?`, `urgency_bonus?`.
- `primary_offer` ahora con union type literal (no `string`).
- Comentario final: "Los campos opcionales de Score breakdown v2 vienen de `leads.score_breakdown` (jsonb) — la API los aplana en la respuesta."

**Verificar:** (a) los 7 campos opcionales también aparecen en `ARCHITECTURE_FRONTEND.md` LeadCard idénticamente; (b) los campos vienen de `score_breakdown` que Fase 22 step 12 sí persiste (N-5 cerrada); (c) los endpoints `GET /api/v1/leads` y `GET /api/v1/leads/:id` documentan que aplanan estos campos.

### N-8 (ALTO) — Fase 23 ya no dice "Implementar las tablas..."
**Cambio aplicado:** `FUTURE.md` Fase 23 "Implementación — API" reescrito: "**las tablas `pipeline_runs` y `pipeline_config` YA fueron creadas con schema canónico completo en Fase API-0 (Bloque 5)**. Fase 23 NO ejecuta `CREATE TABLE`; solo agrega la lógica que las consume". Bullets actualizados a `node-cron`, `configWatcher()`, `scheduled_for` (cron-parser), comando CLI, poblar `phase_results`.

**Verificar:** (a) no quedan menciones de "Implementar las tablas" en Fase 23; (b) la sección "**Archivos:**" sigue siendo coherente (no menciona migrations de pipeline_runs/pipeline_config).

---

## Qué buscar además (nuevas debilidades potenciales)

**A. Coherencia del nuevo flujo por bloques tras las correcciones:**
- ¿El paso 3 de AUTONOMOUS.md (que ordena ejecutar "primer item del Bloque más bajo") puede ahora confundirse con Fase API-0 marcada como approval? ¿La regla "STOP CONDITION approval-required-fase-<N>" se aplica también a Fase API-0?
- ¿Hay alguna fase en Bloques 0–4 que NO está documentada como aprobación humana pero debería estarlo? (ej: Fase 21 PostGIS, Fase 22-pre, Fase 15).
- ¿El cron line de Fase 49 con path absoluto `/home/nicolasfalcioni/Documentos/blindspot/scripts/backup.sh` es portable si el repo se mueve? ¿Debería ser env var?

**B. Schema canónico tras los cambios de tipo:**
- Cambiar `pipeline_config.id` de `uuid` a `text` (N-3): ¿algún código en ARCHITECTURE_FUTURE.md sigue asumiendo `uuid`? ¿Algún FK desde otra tabla? (`pipeline_runs` no tiene FK a `pipeline_config`, ok.)
- ¿`audit_log.target_id text` (text para flexibilidad) sigue siendo coherente con el resto (los targets son uuid en otras tablas)?

**C. Consistencia matemática del scoring:**
- Con la fórmula consolidada de `business_quality_pts` (max 15 con suma 5+3+3+2+2), ¿el ejemplo "87×0.30=26" del archivo sigue funcionando? (87 = 60 gap_depth + 12 breadth + 15 quality_pts).
- ¿El ejemplo "Lead tier A con reliability=1.0 → 1.30 × 1.00 = 1.30 y +2 pts" se mantiene coherente con la nueva tabla?

**D. Implementabilidad por CC tras las correcciones:**
- Si CC empieza Fase 49 ahora: ¿`$HOME/blindspot-backups` se crea correctamente sin sudo? ¿El cron del user puede leer del repo en `/home/nicolasfalcioni/...`? ¿El script asume `$HOME` resuelto correctamente en cron environment? **Nota:** los cron jobs típicamente NO heredan `$HOME` del shell del usuario — solo `HOME` está disponible. Verificar que el script use `$HOME` (variable env, presente en cron) y no `~` (que cron a veces no expande).
- Si CC empieza Fase 22 ahora con la nueva tabla de business_quality_pts: ¿queda claro que la suma de componentes individuales se topea en 15 con `min(15, ...)`? ¿La calibración esperada en `§ Efecto esperado en datos actuales` sigue siendo correcta?
- Si CC empieza Fase API-0 ahora: ¿el step 2 con el `to_regclass()` check es suficiente, o necesita un step adicional explicando cómo recuperarse si el orden se rompió en una sesión anterior?

**E. Sobredimensionamiento residual no atendido (continúa de auditorías anteriores):**
- Cursor pagination en TODOS los endpoints, rate-limit 100/min general, JWT con refresh tokens, X-API-Version headers, polls separados a distintos intervalos — ¿siguen sin decisión documentada?
- ¿La decisión "no simplificar hasta evidencia de necesidad" está escrita en algún lugar, o sigue siendo un hallazgo abierto?

**F. Coherencia con archivos no tocados en la séptima auditoría:**
- `SECURITY.md` puede mencionar `/backups` (path absoluto antiguo). Verificar si fue alineado o quedó desincronizado.
- `LEADS_DATA.md` y `research/*.md` probablemente no se tocaron — son snapshots de datos. No deberían tener referencias a paths o schemas. Verificar igual.

---

## Formato del reporte

1. **Resumen ejecutivo** (3–6 líneas): ¿la doc está lista para que CC empiece el Bloque 0 ahora? ¿Riesgo residual de avanzar?

2. **Verificación de correcciones de la séptima auditoría** — para cada N-1 a N-10: ✅ CERRADA | ⚠️ PARCIAL (con qué falta) | ❌ NO APLICADA / NUEVA CONTRADICCIÓN INTRODUCIDA. Citar archivo:línea concreta.

3. **Hallazgos nuevos** (CRÍTICO / ALTO / MEDIO / BAJO). Para cada uno: archivo:línea, problema, impacto si CC lo implementa, fix específico.

4. **Contradicciones residuales** — las que sobrevivieron O las nuevas introducidas al corregir.

5. **Sobredimensionamiento residual** — partes desproporcionadas para "1 admin + 2–8 socios". Solo lo nuevo o lo que sigue sin decisión documentada.

6. **Gaps de información** — qué falta documentar para que CC no asuma mal.

7. **Hallazgos por bloque** — para Bloque 0 (Fase 49), Bloque 1 (22-pre + 21), Bloque 2 (47), Bloque 3 (15 + 6), Bloque 4 (22), Bloque 5 (API-0 + API): si CC empieza ese bloque ahora, ¿qué falla o qué necesita que no está documentado?

8. **Veredicto final**: AVANZAR | CORREGIR menor | PAUSAR Y CORREGIR | REPLANTEAR sección X.

---

## Reglas

- Sé crítico, no complaciente. Si las correcciones cerraron limpiamente, decilo — pero solo si es verdad.
- Citá archivo:línea concreta para cada hallazgo.
- Si algo es ambiguo, marcá la ambigüedad — no la resuelvas por tu cuenta.
- NO modifiques archivos. NO escribas código. NO corras tests/queries — solo entregá la auditoría.
- Si una corrección introdujo una nueva inconsistencia, identificala como "NUEVA CONTRADICCIÓN post-corrección de N-X".
- Prestá atención especial a las correcciones de schema (N-3, N-9) y a la fórmula consolidada (N-1) — son las que tienen mayor probabilidad de haber introducido inconsistencias laterales.
