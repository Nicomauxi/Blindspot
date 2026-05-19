# Re-auditoría crítica — Blindspot planning docs (séptima ronda)

> ARCHIVO HISTÓRICO. No ejecutar ni obedecer como runbook activo salvo pedido explícito de Nicolás.
> Para ejecución actual usar `context/ROADMAP_CANONICAL.md`.

Sos un Tech Lead / PO senior externo. Tu trabajo es hacer una **auditoría adversarial** de la documentación de planificación del proyecto Blindspot — verificar que las correcciones de la sexta auditoría (2026-05-16) NO introdujeron nuevas contradicciones, y que la documentación es suficiente para que Claude Code ejecute las fases del roadmap sin asumir mal.

**Tu output es solamente la auditoría escrita. No modifiques archivos. No escribas código. No corras tests ni queries SQL.**

---

## Contexto del proyecto

Blindspot es una herramienta interna privada (NO se comercializa) que identifica negocios uruguayos con gaps digitales, los scorea por potencial comercial, y los expone a un admin + 2–8 socios autorizados via panel web. El admin gestiona socios, configura cuándo corre el pipeline, monitorea costos y rendimiento. Los socios reciben ofertas automáticas para vender servicios.

Stack: Node.js 20 + TypeScript strict, PostgreSQL (Supabase local), Playwright, Fastify (planeado), Next.js 15 (planeado). **Mono-repo con pnpm workspaces:** `src/` (core pipeline) + `api/` (HTTP) + `ui/` (frontend Next.js). Coordinación entre `src/` y `api/` exclusivamente via PostgreSQL (`pg_notify` + polling).

## Archivos a auditar

Todos en `/home/nicolasfalcioni/Documentos/blindspot/context/`:

- `PROJECT_MASTER.md` (~370 líneas) — runbook tech lead, modelo de uso, roles, próximas acciones por bloques
- `AUTONOMOUS.md` (~340 líneas) — runbook ejecución autónoma
- `ARCHITECTURE.md` (~565 líneas) — arquitectura implementada hoy
- `ARCHITECTURE_FUTURE.md` (~3200+ líneas — usar Read con offset/limit) — arquitectura objetivo
- `ARCHITECTURE_FRONTEND.md` (~900 líneas) — UI de uso normal
- `ADMIN_PANEL.md` (~490 líneas) — panel admin
- `FUTURE.md` (~1560 líneas — leer completo con chunks) — backlog de fases
- `SECURITY.md` (~270 líneas) — reglas de seguridad

Empezá leyendo `PROJECT_MASTER.md` y `AUTONOMOUS.md` completos. Después `FUTURE.md` en chunks (offset 0, 400, 800, 1200 de a 400 líneas). Después `ARCHITECTURE_FUTURE.md` en chunks (offset 0, 500, 1000, 1500, 2000, 2500, 3000). Después `ADMIN_PANEL.md` y `ARCHITECTURE_FRONTEND.md`. Después ARCHITECTURE.md y SECURITY.md si hay hallazgos que requieran verificación.

## Qué cambió en la sesión anterior (lo que debes auditar específicamente)

La sexta auditoría (2026-05-16) aplicó estas correcciones. Verificar que cada una cerró limpiamente sin introducir nuevas inconsistencias:

**C-1 (CRÍTICO — A+B accessibility_factor):**
- Eliminado A+B de ARCHITECTURE_FUTURE.md (header l.19, § Componente 4 l.893, YAML l.985, flujo l.1493), AUTONOMOUS.md l.321, FUTURE.md Fase 22 step 6.
- Ahora: tiers mutuamente excluyentes (X=0.30, D=0.65, C=0.90, B=1.15, A=1.30). Ajuste por reliability: `× (0.75 + 0.25 × contact_reliability_score)`.
- **Verificar:** (a) no quedan menciones de A+B en ningún archivo; (b) la calibración numérica en ARCHITECTURE_FUTURE.md § Efecto esperado sigue siendo coherente con rango A=1.30 (no 1.40); (c) FUTURE.md Fase 22 step 6 describe correctamente el doble rol de contact_reliability_score.

**C-2 (CRÍTICO — contact_reliability_score doble uso):**
- FUTURE.md Fase 22 step 6 ahora documenta explícitamente que contact_reliability_score se usa dos veces: en business_quality_pts (aditivo) Y en accessibility_factor (multiplicativo).
- **Verificar:** ambos usos son coherentes con ARCHITECTURE_FUTURE.md § Componente 4 y § flujo de scoring.

**C-3/C-4/C-5 (CRÍTICO — stubs divergentes Fase API-0):**
- FUTURE.md Fase API-0 step 6 reemplazó los stubs reducidos por schemas canónicos completos de pipeline_runs, pipeline_config, discovery_jobs, audit_log.
- Cambios clave: pipeline_runs ahora tiene triggered_by, config_snapshot, overrides, log_lines jsonb, webhook_status, status CHECK incluye 'partial'; pipeline_config tiene phases, scheduled_for, last_completed_at, defaults correctos (02:00 domingos); discovery_jobs usa user_id (no created_by), tiene progress, leads_found, leads_new, leads_corroborated, leads_hot_new, triggered_by; audit_log tiene lista canónica de action values.
- **Verificar:** los schemas en FUTURE.md Fase API-0 step 6 coinciden exactamente con los canónicos en ARCHITECTURE_FUTURE.md. No hay campos que existan en el canónico pero fallen en FUTURE.md.

**C-6 (CRÍTICO — script Fase 49 roto):**
- Script reescrito con `docker exec supabase_db_gap-radar pg_dump ...`, `mkdir -p`, `gunzip -t`, size check, `BLINDSPOT_DB_CONTAINER` env var, ruta absoluta en cron. Eliminada referencia a `blindspot_test` DB inexistente.
- **Verificar:** script es ejecutable sin modificaciones adicionales en el entorno de Nicolás. El nombre del container (`supabase_db_gap-radar`) coincide con lo usado en ARCHITECTURE.md y SECURITY.md.

**C-7 (CRÍTICO — llm_usage_log y pipeline_errors sin CREATE TABLE):**
- Agregadas Fase 44-pre (llm_usage_log) y Fase 45-pre (pipeline_errors) en FUTURE.md.
- Fase 44 y Fase 45 actualizadas para referenciarlas como prerequisito.
- **Verificar:** campos de llm_usage_log y pipeline_errors en FUTURE.md coinciden con lo que ADMIN_PANEL.md espera consumir en Cost Dashboard y Performance Dashboard.

**A-1 (ALTO — ordering AUTONOMOUS.md contradice ESTADO):**
- AUTONOMOUS.md reescrito con "Orden por bloques": Bloque 0 (Fase 49) → Bloque 1 (22-pre, 21) → Bloque 2 (47) → Bloque 3 (15, 6) → Bloque 4 (22) → etc.
- Reglas de bloque: no saltear bloques, aprobación humana activa para fases en la lista.
- PROJECT_MASTER.md § Próximas acciones reescrito con la misma estructura de bloques.
- **Verificar:** (a) el nuevo paso 3 de AUTONOMOUS.md no puede causar que CC salte Fase 49 y ejecute Fase 22-pre directamente; (b) los bloques coinciden entre PROJECT_MASTER.md y AUTONOMOUS.md; (c) la "sección Urgente — Bloqueantes" de FUTURE.md también lista Fase 49 primero (o el paso 3 no usa más esa sección).

**A-2 (ALTO — UI mocks con multiplicadores v1):**
- Mockups de Lead Detail en ARCHITECTURE_FUTURE.md l.2450-2461 y ARCHITECTURE_FRONTEND.md l.340-351 actualizados a fórmula v2 (gap_depth, breadth, quality_pts, accessibility ×1.30, timing ×1.05, urgency_bonus).
- **Verificar:** los campos mostrados en el mock existen en la interfaz TypeScript del frontend y en el endpoint de leads.

**A-3 (ALTO — primary_offer sin contacto_directo en frontend):**
- ARCHITECTURE_FRONTEND.md LeadCard ahora incluye `contacto_directo` en el union type de primary_offer.
- **Verificar:** el union type en ARCHITECTURE_FRONTEND.md y en ARCHITECTURE_FUTURE.md (l.710) son idénticos.

**A-4 (ALTO — lead_filter sin semántica SQL):**
- ARCHITECTURE_FUTURE.md ahora tiene interfaz TypeScript `LeadFilter` completa + pseudoSQL de traducción + validaciones de API.
- **Verificar:** geo_radius documenta dependencia de PostGIS (Fase 21). detected_sub_niche documenta dependencia de Fase 28. max_leads_visible documenta semántica LIMIT.

**A-5 (ALTO — endpoints /admin/* ausentes de matriz de acceso):**
- Matriz de acceso por rol en ARCHITECTURE_FUTURE.md ahora incluye /api/v1/admin/costs/*, /admin/performance/*, /admin/system/*, /admin/audit-log, /api/v1/users/:id (singular), DELETE /api/v1/users/:id.
- **Verificar:** todos los endpoints que menciona ADMIN_PANEL.md están cubiertos en la matriz.

**A-6 (ALTO — audit_log action list divergente):**
- Lista canónica consolidada en FUTURE.md Fase API-0 step 7 como tabla Markdown.
- Incluye: user.create/update/password_reset/deactivate/reactivate/role_change/delete, lead_filter.update, pipeline.config.update/run.trigger/run.abort, discovery.job.create/update, system.restart.
- **Verificar:** ADMIN_PANEL.md y FUTURE.md usan los mismos valores, sin duplicados ni naming divergente.

**A-7 (ALTO — restart endpoints sin flujo documentado):**
- ADMIN_PANEL.md ahora documenta: orden de operaciones (audit log ANTES del exec), manejo de restart-api que mata al propio handler, comportamiento en modo dev (501), respuesta JSON con exit_code.
- **Verificar:** el flujo documentado es coherente con la separación api/src y con lo que dice SECURITY.md sobre permisos de proceso.

**A-8 (ALTO — trigger vs triggered_by en código sample):**
- ARCHITECTURE_FUTURE.md l.2853 corregido a `triggered_by: 'cron'`.
- **Verificar:** no quedan otras referencias a `trigger:` (como parámetro de función, no como event) en código sample de ARCHITECTURE_FUTURE.md.

**M-1 (MEDIO — ARCHITECTURE.md desactualizado):**
- ARCHITECTURE.md § Scoring ahora tiene nota: "Estado: fórmula v1 — vigente hasta Fase 22."
- **Verificar:** la nota está y es visible.

**M-2 (MEDIO — fases postpuestas sin marker):**
- Fases 32, 34, 39, 41, 42 ahora tienen `> **Status: POSTPONED**` al inicio de su sección.
- **Verificar:** los markers están presentes y referencian la sección de postpuestas al final de FUTURE.md.

**M-3 (MEDIO — Fase 13 threshold 60):**
- Ahora tiene nota explicando que 60 es threshold de `lead_buyer_scores.score` (escala de buyer_type), no de `prospect_score` (cuyo hot threshold es 55).
- **Verificar:** la nota está y es suficientemente clara.

---

## Qué buscar además (nuevas debilidades potenciales)

**A. Coherencia del flujo por bloques:**
- ¿Las fases en Bloque 1 (22-pre, 21) son realmente independientes entre sí y paralelizables? ¿Hay prerequisitos ocultos?
- ¿Bloque 3 (Fase 15 → Fase 6) tiene el orden correcto? ¿Fase 15 debe ir antes de Fase 6?
- ¿El "tercer `score --all`" post-Fase 6 está documentado en FUTURE.md Fase 6 Y en PROJECT_MASTER.md? ¿Hay un cuarto score oculto?

**B. Integridad referencial de schemas:**
- ¿`lead_outreach.user_id` tiene su migración documentada (ALTER TABLE si la tabla ya existe, o en CREATE si Fase 25 va primero que Fase API-0)?
- ¿`leads.contacted_by` (Fase API-0 step 5) es coherente con `lead_outreach.user_id`? ¿Para qué sirven los dos? ¿No es redundante?
- ¿`llm_usage_log.user_id` es nullable (null = sistema)? ¿La tabla `users` existe cuando Fase 44-pre se ejecuta?

**C. Sobredimensionamiento aplicado:**
- ¿Se simplificaron cursor pagination, pg_notify/polls, JWT refresh, token_version, X-API-Version headers, rate limiting en todos los endpoints (no solo /auth/login)?
- O ¿siguen presentes en ARCHITECTURE_FUTURE.md aunque la decisión de simplificar estaba en el hallazgo S-8?

**D. Gaps de implementación:**
- ¿`cleanup_v1` mencionado en FUTURE.md:83 (ahora con líneas offset) tiene definición concreta? ¿O sigue siendo un "cuando apliques Fase 22, eliminá la v1"?
- ¿El campo `detected_sub_niche` en LeadCard está documentado como `optional` con la nota de dependencia de Fase 28?
- ¿El endpoint `GET /api/v1/leads/:id` tiene su spec en ARCHITECTURE_FUTURE.md (devuelve el mismo objeto que el list, o enriquecido)?

**E. Riesgos del modo autónomo post-corrección:**
- ¿El paso 3 de AUTONOMOUS.md puede confundir a CC si Fase 49 ya está aplicada (¿salta al Bloque 1 o se queda preguntando)?
- ¿Las fases en "REQUIERE APROBACIÓN HUMANA" cubren ahora Fases 6, 22, 47 Y también Fase API-0 (que es multi-step y puede romper DB si sale a medias)?
- ¿Hay alguna fase en los Bloques 1-3 que CC podría ejecutar sin backup previo (porque el bloque 0 ya se ejecutó en una sesión anterior y el script `scripts/backup.sh` puede no estar en el repo todavía)?

**F. Implementabilidad por CC (sesión fresca):**
- Si CC empieza Fase 49 ahora: ¿el nombre del container Docker está documentado de forma que CC lo encuentre sin buscar? ¿La ruta absoluta del cron es correcta?
- Si CC empieza Fase 22-pre: ¿las 3 columnas (scoring_version, contact_ready, prospect_score_v1) están documentadas con sus tipos exactos, defaults y por qué se crean aquí?
- Si CC empieza Fase API-0 sub-step A-0.1 (usuarios): ¿tiene todo lo que necesita en un solo lugar o tiene que leer 3 archivos para armar el CREATE TABLE?
- Si CC empieza Fase API (Fastify): ¿está documentada la estructura de directorios de `api/` (donde van los handlers, middleware, types)?

---

## Formato del reporte

1. **Resumen ejecutivo** (3–6 líneas): ¿la doc está lista para que CC empiece Fase 49 → 22-pre → 21 → 47 → 15 → 6 → 22 → API-0 → API en ese orden? ¿Riesgo de avanzar tal como está?

2. **Verificación de correcciones anteriores** — para cada corrección C-1 a M-3: ✅ CERRADA | ⚠️ PARCIAL (con qué falta) | ❌ NO APLICADA / NUEVA CONTRADICCIÓN INTRODUCIDA.

3. **Hallazgos nuevos** (CRÍTICO / ALTO / MEDIO / BAJO). Para cada uno:
   - Archivo(s) y línea(s) — citar concretamente
   - Qué es el problema
   - Por qué importa (impacto si CC lo implementa con la doc actual)
   - Cómo corregirlo (acción específica)

4. **Sobredimensionamiento residual** — decisiones arquitecturales que siguen siendo desproporcionadas para "1 admin + 2–8 socios". Solo nuevos hallazgos (los ya señalados en ronda anterior y no corregidos se repiten aquí si siguen presentes).

5. **Gaps de información** — qué falta documentar para que CC no asuma mal.

6. **Hallazgos por bloque** — para Bloque 0 (Fase 49), Bloque 1 (22-pre + 21), Bloque 2 (47), Bloque 4 (22), Bloque 5 (API-0): si CC empieza ese bloque ahora, ¿qué falla o qué necesita que no está documentado?

7. **Veredicto final**: AVANZAR | CORREGIR menor | PAUSAR Y CORREGIR | REPLANTEAR sección X.

---

## Reglas

- Sé crítico, no complaciente. Si las correcciones cerraron limpiamente los problemas, decilo — pero solo si es verdad.
- Citá archivo:línea concreta para cada hallazgo.
- Si algo es ambiguo, marcá la ambigüedad — no la resuelvas por tu cuenta.
- NO modifiques archivos. NO escribas código. NO corras tests/queries — solo entregá la auditoría.
- Si una corrección previa introdujo una nueva inconsistencia, identificala como "NUEVA CONTRADICCIÓN post-corrección".
- Prestá especial atención al flujo por bloques: es nuevo y nunca fue auditado.
