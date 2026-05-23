# Blindspot — Autonomous Runbook

> **Modo de uso:** adjuntar este archivo a un chat nuevo sin más contexto.
> El agente debe leer los contextos indicados, seleccionar la primera fase pendiente
> del roadmap canónico, planificarla, auditarla, implementarla, verificarla,
> actualizar `context/` y pasar a la siguiente fase automáticamente.
>
> Solo debe hacer preguntas cuando exista una necesidad real de input humano,
> aprobación de dependencia nueva, riesgo destructivo real o costo externo real.

---

## Contexto requerido al arrancar

Leer en este orden:
1. `context/ROADMAP_CANONICAL.md`
2. `context/FUTURE.md`
3. `context/PROJECT_MASTER.md`
4. `context/ARCHITECTURE.md`
5. `context/ARCHITECTURE_FUTURE.md`
6. `context/ARCHITECTURE_FRONTEND.md`
7. `context/ADMIN_PANEL.md`
8. `context/SECURITY.md`
9. `context/LEADS_DATA.md` solo si la fase toca análisis de datos concretos

Si hay contradicción, gana `ROADMAP_CANONICAL.md`.

## Misión actual

El sistema ya fue remediado y dejado operable. La misión actual es ejecutar el
programa de mejoras por fases chicas y verificables, con calidad profesional,
sin reabrir caos arquitectónico ni agrandar diffs innecesariamente.

## Reglas de oro

1. Una sola fase canónica por iteración.
2. No empezar implementación sin leer código real del área y tests existentes.
3. Antes de cualquier cambio destructivo sobre DB, crear backup verificable.
4. No usar discovery real billable, scraping pago ni cargas externas costosas para validar una fase salvo necesidad estricta y aprobación explícita.
5. No importar dependencias nuevas antes de pedir aprobación.
6. No cerrar una fase sin validación real acorde al área.
7. No cerrar una fase sin actualizar `context/`.
8. Si aparece drift entre contexto y repo, corregir el contexto antes de seguir acumulando trabajo.
9. Si el worktree ya está sucio, no revertir ni pisar cambios ajenos; entenderlos y trabajar alrededor salvo conflicto real.
10. Si una fase es demasiado grande, partirla internamente y dejar explícito el sub-paquete que se está ejecutando.
11. Después de cerrar una fase, seguir automáticamente a la siguiente pendiente salvo stop condition.

## Stop conditions

Detenerse y pedir input solo si ocurre alguno de estos casos:
- dependencia nueva no aprobada
- acción destructiva real no respaldada por backup
- costo externo real o uso billable no aprobado
- contradicción fuerte entre contexto y código que impida cerrar la fase con seguridad
- decisión de producto no resuelta en los contextos
- fase imposible de cerrar sin credenciales, archivos o acciones manuales fuera del repo

## Loop autónomo

### Paso 1 — Boot

1. Leer los contextos requeridos.
2. Inspeccionar el estado del repo y del worktree.
3. Si hay cambios ajenos/unrelated en el worktree, registrarlos mentalmente y no revertirlos; si chocan con la fase, detenerse solo cuando el conflicto sea real.
4. Confirmar que la fase a ejecutar no esté ya hecha en código.
5. Si la fase toca código, correr una verificación base acorde al área:
   - general: `pnpm test` y `pnpm typecheck`
   - UI-only: al menos `pnpm --dir ui typecheck`
   - si el baseline ya viene roto, registrar el problema antes de seguir

### Paso 2 — Selección de fase

- Tomar la primera fase del orden canónico cuyo estado figure como `pending` en `FUTURE.md`.
- Buscar su detalle en `FUTURE.md`.
- Si el roadmap y el future no coinciden, corregir contexto antes de tocar código.

### Paso 3 — Phase packet

Construir internamente un packet mínimo con:
- `phase_id`
- objetivo observable
- prerequisitos
- áreas/archivos probables
- cambios prohibidos
- validación mínima
- riesgos y rollback

### Paso 4 — Auditoría previa

Antes de editar:
- leer archivos reales del área
- revisar tipos/contratos/tests relevantes
- auditar si el diseño del phase packet es demasiado grande
- si la fase proyecta más de 12 archivos de código, más de 600 líneas netas o mezcla schema + backend + UI, partirla antes de editar
- si hace falta, partir el trabajo en un sub-paquete explícito sin cambiar el orden canónico

### Paso 5 — Implementación

- editar solo lo necesario para cerrar la fase
- respetar patrones existentes del repo
- evitar refactors paralelos no pedidos
- si aparecen mejoras laterales, solo tomarlas si bloquean el cierre de la fase actual

### Paso 6 — Verificación

Correr las validaciones mínimas definidas para la fase y cualquier gate adicional razonable:
- `pnpm test`
- `pnpm typecheck`
- `pnpm --dir ui typecheck`
- `pnpm --dir ui build`
- `pnpm smoke:api`
- `supabase db reset`

No hace falta correr siempre todas. Ejecutar las que correspondan según el área tocada, pero nunca menos de lo razonable para el riesgo introducido.

### Paso 7 — Auditoría posterior

Revisar críticamente el resultado:
- bugs funcionales
- contratos UI/API inconsistentes
- impactos de RBAC
- migraciones y upgrade path si hubo schema
- tests faltantes
- deudas nuevas creadas por la propia fase

Si la auditoría encuentra algo serio, corregirlo antes de cerrar.

### Paso 8 — Actualización de contexto

Al cerrar una fase:
- marcar el estado en `FUTURE.md`
- actualizar `PROJECT_MASTER.md` con snapshot y próxima acción
- actualizar `ARCHITECTURE*.md` y `ADMIN_PANEL.md` si cambió el diseño o el estado actual
- tocar `ROADMAP_CANONICAL.md` solo si cambió el orden real o la definición de listo
- tocar `AUTONOMOUS.md` solo si cambió el loop o los guardrails

### Paso 9 — Continuación automática

- pasar a la siguiente fase pendiente
- repetir el loop hasta completar el roadmap o encontrar una stop condition

## Criterio de calidad de salida

Cada fase debe dejar:
- código funcionando
- tests/gates razonables en verde
- contexto sincronizado
- estado y siguiente paso explícitos
- cero ambigüedad sobre qué quedó resuelto y qué sigue

## Estado inicial del programa

- `CTX-0` completo
- próxima fase esperada: `NAV-1`
- el programa actual termina recién cuando `CRM-4` quede cerrada y documentada
