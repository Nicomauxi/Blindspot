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

El sistema ya fue remediado y dejado operable, y el ciclo 2 cerró el 2026-05-24.
La misión actual es ejecutar el **ciclo 3** del programa de mejoras (35 fases nuevas
desde `BUG-1` hasta `UI-RESP-1`), por fases chicas y verificables, con calidad
profesional, sin reabrir caos arquitectónico ni agrandar diffs innecesariamente.

El ciclo 3 cubre: bugfixes urgentes de budget GP, unificación Pipeline+Monitoreo
en una pantalla `Operaciones` con secciones de Variables y Procesos en vivo,
refresh masivo de leads en Discovery (incluyendo re-discovery de Google Places),
hard cap mensual del budget GP, optimización del costo por lead nuevo, mapa
heatmap granular con geocoding + filtros + modo individual, limpieza de UI
deprecated (campañas, asistente comercial, outreach historial), sistema de
alertas persistido con campanita en UI, mejoras CRM (transiciones bidireccionales,
historial en popup, filtros) y safeguard RBAC para datos de contacto, rediseño
completo de la ficha de Lead con **auditoría triple obligatoria** (técnico, UX,
vendedor), aliasing de nichos en Calidad y responsive global como cierre.

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

- Ciclo 1 cerrado: `CTX-0` → `CRM-4` (todos done, 2026-05-22 a 2026-05-24).
- Ciclo 2 cerrado: `UI-2`, `UI-1`, `NAV-2`, `THEME-2`, `MON-3`, `MON-4`, `OPS-1`, `PIPE-1`, `PIPE-3`, `PIPE-2`, `CRM-5`, `DISC-4`, `DISC-5`, `DISC-6` (todos done, 2026-05-23/24).
- **Ciclo 3 activo desde 2026-05-24**: 35 fases nuevas (ver `ROADMAP_CANONICAL.md` órdenes 32–66).
- Próxima fase esperada: `BUG-1` (Budget GP spent muestra 0).
- Asset auxiliar entregado por el usuario (fuera del flujo): `context/prompts/deepsearch-discovery-places.md`. Su output (un `.xlsx` con catálogo de lugares de Uruguay) se consume en la fase `DISC-10`.
- El ciclo 3 termina cuando `UI-RESP-1` quede cerrada y documentada.

## Notas específicas del ciclo 3

- **Auditoría triple en `LEAD-5`**: la fase de rediseño global de la ficha de Lead no puede cerrarse sin las tres auditorías documentadas en `context/research/lead-5-audits.md`:
  - **técnico**: contratos UI/API, regresiones de scoring/enrichment, accesibilidad, performance del render.
  - **UX**: jerarquía visual, contraste, dark mode, mobile responsive en viewport target.
  - **comercial (vendedor)**: simular flujo de un vendedor con un lead nuevo — debe entender quién es, qué venderle, cómo contactarlo y cuál es el próximo paso en menos de 30 segundos.

  Si alguna auditoría detecta un issue mayor, abrir sub-fase explícita y registrarla en `PROJECT_MASTER.md`.

- **`UI-RESP-1` al final**: el responsive global es lo último del ciclo. No auditar responsive de pantallas que aún están en rediseño activo.

- **Dependencias nuevas potenciales**:
  - `OPS-5` puede requerir librería de charts (Recharts, Chart.js). Verificar `package.json` primero; si no hay, detenerse y pedir aprobación.
  - `DISC-10` requiere `xlsx` parser; verificar deps primero.
  - `MAP-4` requiere `leaflet.markercluster`; verificar deps.
  - `MAP-2` con Nominatim queda autónomo bajo rate-limit estricto (1 req/s + cache); si se decide Mapbox/Google Geocoding pagos, detenerse y pedir aprobación.

- **Hard cap GP budget**: `PIPE-4` es prerequisito de `DISC-11` y de cualquier campaña real de discovery. Tras cerrarla, el sistema debe rechazar runs que superarían el cap en UI, API y core.

- **RBAC del ciclo**: `RBAC-1` cambia el shape de la API para usuarios `comercial`. Cualquier fase posterior que toque Lead Detail o pantallas comerciales debe respetar la redacción server-side.
