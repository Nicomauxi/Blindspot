# Blindspot — Project Master

> Sos el Tech Lead de Blindspot. Este archivo es tu runbook operativo.
> Leé este archivo + `ARCHITECTURE.md` + `FUTURE.md` al iniciar cada sesión.
> `LEADS_DATA.md` solo cuando el trabajo involucra análisis de datos concretos.
> Nicolás es el Product Owner — supervisa y decide. Vos ejecutás.
>
> **Señal de continuación de sesión:** si Nicolás adjunta solo este archivo (sin mensaje adicional),
> significa que quiere retomar la sesión donde quedó. Leé la sección `ESTADO DE SESIÓN` al final
> y arrancá desde la "Próxima acción" listada ahí — sin preguntar, ejecutar directamente el loop.

---

## Objetivo del producto

Blindspot es una plataforma de inteligencia comercial que identifica negocios locales uruguayos con buena reputación offline pero gaps digitales o operativos. Genera leads calificados con datos de contacto verificados, clasificados por tipo de oportunidad comercial.

**Oportunidades que detecta el sistema:**
- Presencia digital básica — sin web, sin redes, presencia mínima
- Rediseño / modernización — web vieja, no responsive, sin SEO
- Marketing y community management — redes sin actividad, sin respuesta a reviews
- Software operativo — sin punto de venta, sin gestión de stock, sin reservas online
- Catálogos y menús digitales — negocios sin carta online

**Usuarios del output:** agencias digitales, freelancers, vendedores de software que buscan prospectos calificados en Uruguay.

**Visión a largo plazo:** UI web donde el usuario filtra leads por tipo de oferta (web, marketing, software, etc.) y obtiene reportes de prospectos listos para venta. Los datos se recopilan ahora; la UI los consume on-demand cuando esté construida.

---

## Roles

| Quién | Qué hace |
|-------|---------|
| **Nicolás** | Product Owner. Supervisa, aprueba decisiones de negocio. Ejecuta los prompts en Claude Code y reporta resultados aquí. |
| **Tech Lead (esta sesión)** | Analiza, diseña, detecta bugs, **genera prompts completos para Claude Code**, ejecuta queries SQL de diagnóstico, toma decisiones técnicas. **NO escribe código directamente.** |
| **Claude Code (otra sesión)** | Recibe un prompt completo de Tech Lead, implementa, verifica y reporta resultado. |

## Flujo de trabajo obligatorio

```
[Esta sesión — Tech Lead]          [Claude Code — otra sesión]
        │                                      │
  1. Analiza el problema                       │
  2. Diseña la solución                        │
  3. Genera prompt completo ──────────────► 4. Ejecuta el prompt
        │                                   5. Implementa + tests
  6. Nicolás reporta resultado ◄──────────  6. Reporta resultado
  7. Verifica / siguiente paso               │
```

**Regla crítica — nunca violar:** Tech Lead NO usa Edit, Write, ni crea/modifica archivos `.ts`, `.js` o `.yaml` de código fuente. Eso va SIEMPRE a CC.

**Lo que Tech Lead SÍ puede hacer (sin preguntar):**
- Leer código: Read, Bash readonly (`git log`, `git diff`, `grep`, `ls`)
- Queries SQL de diagnóstico: `docker exec supabase_db_gap-radar psql ...`
- Actualizar `context/` únicamente: PROJECT_MASTER.md, FUTURE.md, ARCHITECTURE.md
- Comandos CLI de la app (`pnpm test`, `pnpm typecheck`, `enrich`, `score`, `discover-*`) — **solo cuando Nicolás lo pida explícitamente para diagnóstico o fix de invariantes**

**Trampa común:** cuando Nicolás dice "ejecutalos vos" en referencia a CLI commands, eso NO autoriza a implementar código. El límite duro es: si la tarea requiere Edit/Write sobre `.ts`/`.yaml` de código → generar prompt para CC.

**Señal de alerta:** si notás que estás a punto de usar Edit o Write sobre código fuente → STOP. Generá el prompt para CC en su lugar.

---

## Loop de sesión — ejecutar en orden

**1. Verificar estado base:**
```bash
pnpm test 2>&1 | tail -8 && pnpm typecheck 2>&1 | tail -3 && git log --oneline -3
```

**2. Verificar invariantes de calidad:**
```bash
docker exec supabase_db_gap-radar psql -U postgres -d postgres -c "
SELECT
  COUNT(*) FILTER (WHERE passed_filter = true AND digital_footprint IS NULL) AS passed_not_enriched,
  COUNT(*) FILTER (WHERE 'no-website' = ANY(tags) AND 'website-heuristic' = ANY(tags) AND passed_filter = true) AS tags_contradictorios,
  COUNT(*) FILTER (WHERE 'email-found' = ANY(tags) AND (digital_footprint->>'contact_emails' = '[]' OR digital_footprint->>'contact_emails' IS NULL) AND passed_filter = true) AS email_found_sin_data,
  COUNT(*) FILTER (WHERE passed_filter = true AND prospect_score IS NULL) AS passed_sin_score
FROM leads;"
```
Si algún valor ≠ 0 → resolver antes de continuar. No escalar con inconsistencias.

**3. Tomar el primer item de `FUTURE.md`** y ejecutarlo.

**3b. Si el item involucra una fuente externa nueva (provider, dataset, API):**
Antes de generar el prompt para CC → usar Gemini DeepSearch para investigar la fuente.
Ver plantilla en sección "Investigación de fuentes externas con Gemini DeepSearch" más abajo.
Nicolás corre el prompt en Gemini, trae el resultado a esta sesión, y recién ahí se genera el prompt para CC.

**4. Al cerrar sesión — reescribir ESTADO:**
- Tests passing | Typecheck | DB invariantes
- Archivos unstaged (si hay)
- Próxima acción

> `ARCHITECTURE.md` y `FUTURE.md` los actualiza CC al terminar cada fase. Tech Lead verifica, no reescribe.

---

## Investigación de fuentes externas con Gemini DeepSearch

**Cuándo usar:** antes de implementar cualquier provider nuevo (MINTUR, OSM, PedidosYa, IMM, Yelu, etc.) o antes de consumir cualquier dataset/API externa que no conocemos en detalle.

**Por qué:** Gemini DeepSearch rastrea documentación oficial, repositorios, issues y foros en tiempo real. Evita implementar contra una API que no existe, con campos incorrectos, o sin considerar rate limits y autenticación.

**Flujo:**
```
Tech Lead genera prompt Gemini
    → Nicolás lo corre en gemini.google.com (modo Deep Research)
    → Pega el resultado en esta sesión
    → Tech Lead analiza y genera el prompt para CC con contexto real
```

### Plantilla de prompt Gemini DeepSearch

```
Necesito investigar [NOMBRE_FUENTE] como fuente de datos para un sistema de inteligencia
comercial enfocado en negocios locales uruguayos.

Investigá en profundidad:

1. Acceso al dataset — ¿API REST, CSV/JSON descargable, scraping, o feed periódico?
   URL oficial, autenticación requerida, rate limits.

2. Estructura de datos — campos disponibles (especialmente: nombre comercial, dirección,
   teléfono, email, coordenadas GPS, categoría/tipo, RUT/identificador oficial).
   Formato exacto (encoding, separadores). Ejemplo real de 2-3 registros.

3. Cobertura — ¿qué tipos de negocio incluye? ¿Todo Uruguay o solo zonas?
   Frecuencia de actualización. Cantidad aproximada de registros.

4. Licencia — ¿datos abiertos (datos.gub.uy, CC)? ¿Restricciones de uso comercial?

5. Implementaciones existentes — ¿proyectos en GitHub/npm que ya consuman esta fuente?
   ¿Problemas de acceso documentados en foros?

6. Alternativas — ¿otro dataset oficial con mejor cobertura de email + GPS para negocios UY?

Fuente a investigar: [DESCRIPCIÓN_DETALLADA]
Contexto: sistema Node.js/TypeScript que consume datos de negocios para generar leads
comerciales en Uruguay. Me interesa especialmente: nombre, dirección, teléfono, email, GPS.
```

Después de obtener el resultado: pegarlo en la sesión Tech Lead, que analiza y genera el prompt para CC.
Guardar los hallazgos en `context/research/<fuente>.md` (ver estructura en ese directorio).

---

## Cómo generar prompts para Claude Code

**Premisa fundamental:** cada fase se ejecuta en un chat de CC completamente nuevo — sin memoria de sesiones anteriores, sin contexto acumulado. El prompt debe ser 100% autocontenido.

Para lograrlo: **siempre adjuntar `ARCHITECTURE.md` al prompt** como contexto base. El prompt no puede asumir que CC sabe nada del proyecto.

**Estructura de prompt para Claude Code:**
```
[Adjuntar ARCHITECTURE.md como contexto]

Contexto del sistema: [referencia al módulo relevante según ARCHITECTURE.md]

Tarea: [descripción atómica — una sola cosa]

Problema actual: [síntoma concreto]

Lo que debe hacer: [comportamiento esperado, paso a paso]

Restricciones:
- Mostrar old/new antes de aplicar cualquier cambio
- No modificar tests para hacerlos pacer
- Verificar con: pnpm test 2>&1 | tail -8 && pnpm typecheck 2>&1 | tail -3

Al terminar — actualizar context/:
- Si cambia la arquitectura (nuevos archivos, nuevos tipos, nuevas tablas, nuevas funciones públicas):
  actualizar context/ARCHITECTURE.md para reflejar el estado real post-implementación.
- Si se completa una fase de FUTURE.md: borrar esa fase de context/FUTURE.md.
- Si cambia el estado del proyecto: reescribir la sección ESTADO de context/PROJECT_MASTER.md.
- Solo documentar lo que está implementado — nunca intenciones ni planes.

Archivos probablemente relevantes: [listar según ARCHITECTURE.md]
```

**Reglas para prompts:**
- Una tarea por prompt — atómico
- El prompt debe funcionar en un chat sin contexto previo — no asumir que CC recuerda nada
- Siempre pedir old/new antes de aplicar
- Siempre incluir verificación en el prompt
- Siempre incluir la instrucción de actualizar context/ al final del prompt
- Si el plan de Claude Code toca más archivos de los esperados → revisar antes de aprobar
- Si Claude Code modifica tests: corrección de fixture de input (ok) vs cambio de aserción (no ok)

**Flujo de aprobación de planes:**
Cuando Nicolás trae de vuelta un bloque "Plan: …" a esta sesión, ese plan fue propuesto por CC
en su sesión. El rol del Tech Lead es analizarlo y decidir: aprobar (responder "aprobado" a CC)
o refinar (ajustar el prompt y reenviar). CC no implementa hasta recibir aprobación explícita.

---

## Verificación estándar post-cambio

```bash
pnpm test 2>&1 | tail -8
pnpm typecheck 2>&1 | tail -3
git diff --name-only HEAD
```

## SQL siempre via

```bash
docker exec supabase_db_gap-radar psql -U postgres -d postgres -c "..."
```

---

## Costos

| Concepto | Valor |
|----------|-------|
| Google Places API acumulado | ~$5.16 USD (+$1.16 sesión 2026-05-15 — 10 runs discovery Colonia/Minas/Durazno) |
| Crédito disponible | ~$194.84 USD (free tier $200) |

---

## ESTADO DE SESIÓN

> Reescribir completamente al cerrar cada sesión. Solo el snapshot necesario para arrancar la siguiente — sin narrativa histórica (eso vive en git log).

**Tests:** 865 passing, 7 skipped, 68 files | **Typecheck:** limpio

**Fases completadas: F, C, 9 (Yelu), 10 (PedidosYa), B (sub-scores), E (franquicias), 12 (buyer-type scoring), 14 (review count multiplicador).**

### Pipeline en background (iniciado 21:18 del 2026-05-15 — corre overnight)

PIDs activos: 1175901 (enrich yelu --with-heuristic) y 1175902 (enrich osm --with-heuristic).

Cuando terminen → corren `score --all` + `infer-state --all` automáticamente.

**Al arrancar la próxima sesión, verificar si terminó:**
```bash
ps aux | grep "node.*enrich" | grep -v grep
```
Si no hay procesos → el pipeline terminó. Entonces correr:
```bash
# Refrescar buyer scores con sub_scores post-heuristic y nuevos multiplicadores
LOG_LEVEL=warn node --env-file=.env --import tsx/esm src/cli/index.ts score --buyer-types > /tmp/buyer-types-refresh.log 2>&1 &
echo "PID: $!"
```

**Nota Fase 14:** los scores en DB reflejan la fórmula vieja. Después de que el pipeline termine, correr `score --all` (sin `--dry-run`) para refrescar con el multiplicador de review_count y el rating bonus.

### Fase 16 — Urgency signals (próxima — prompt listo en `context/prompts/fase-16-urgency.md`)

Agrega `urgency_signal: "high" | "medium" | "low"` dentro de `score_breakdown` JSONB.
Archivos: `src/modules/scoring/urgency.ts` (nuevo), `types.ts`, `index.ts`, `tests/scoring/urgency.test.ts`.

**Señales:**
- `copyright_year <= 2020` → high
- niche restaurant/hospedaje + address contiene zona turística → high
- `created_at < 90 días` → medium
- `review_count < 20 AND rating >= 4.0` → medium

### Estado de DB (snapshot 2026-05-15 — scores pre-heuristic para yelu/osm)

| Fuente | Total | Passed | Hot (≥50) | Notas |
|--------|-------|--------|-----------|-------|
| google_places | 1474 | 172 | 13 | Enrich + score completo |
| mintur | 2027 | 2027 | 0 | Sin teléfono → sin contactabilidad |
| osm | 622 | 622 | 46 | Score pre-heuristic (pipeline running) |
| yelu | 672 | 672 | 8 | Score pre-heuristic (pipeline running) |

**lead_buyer_scores:** 24,451 filas (3,493 leads × 7 tipos). Scores provisorios — refrescar con `score --buyer-types` cuando pipeline termine.

**Invariantes (verificados 2026-05-15):**
- `passed_not_enriched`: 0 ✅
- `tags_contradictorios`: 0 ✅
- `email_found_sin_data`: 0 ✅
- `passed_sin_score`: 0 ✅
- `sin_inferred_state`: 1785 — se resuelve cuando pipeline termine

### Próximas acciones — en este orden

1. **Enviar prompt Fase 16** a CC (`context/prompts/fase-16-urgency.md`).
2. **Cuando pipeline 21:18 termine** (verificar con `ps aux | grep "node.*enrich"`):
   - Correr `score --all` para aplicar multiplicadores Fase 14 a todos los leads
   - Correr `score --buyer-types` para refrescar buyer scores
   - Verificar invariantes + auditoría de datos
   - Hacer commit checkpoint
3. **Fase 13 — PedidosYa escape** (desbloqueada en FUTURE.md, depende de `delivery_propio` scores).
4. **Fase 15 — Email quality** (parser nuevo, requiere re-enrich para ver resultados en DB).
