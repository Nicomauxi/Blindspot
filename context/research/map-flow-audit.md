# MAP-9 — Auditoría integral del flujo de mapas

**Fecha:** 2026-05-27  
**Rama:** feature/mejoras  
**Áreas auditadas:** `ui/src/components/location-density-map.tsx`, `ui/src/components/lead-review-map.tsx`, `ui/src/components/discovery-context-map.tsx`, `ui/src/app/admin/page.tsx`, `ui/src/app/admin/discovery/page.tsx`, `ui/src/lib/location-density-map.ts`, `tests/e2e/map-filter-matrix.playwright.ts`, `tests/e2e/map-apply-flow.playwright.ts`, `tests/e2e/map-icon-persistence.playwright.ts`, `tests/e2e/map-audit.playwright.ts`

---

## Auditoría 1 — QA

### Evidencia ejecutada
- `pnpm --dir ui typecheck`
- `pnpm typecheck`
- `pnpm --dir ui build`
- `MAP6_BASE_URL=http://127.0.0.1:3005 node --import tsx/esm tests/e2e/map-filter-matrix.playwright.ts`
- `MAP7_BASE_URL=http://127.0.0.1:3005 node --import tsx/esm tests/e2e/map-apply-flow.playwright.ts`
- `MAP8_BASE_URL=http://127.0.0.1:3005 node --import tsx/esm tests/e2e/map-icon-persistence.playwright.ts`
- `MAP9_BASE_URL=http://127.0.0.1:3005 node --import tsx/esm tests/e2e/map-audit.playwright.ts`
- `pnpm exec vitest run tests/ui/location-density-map.test.ts`

### PASS
- Combinación de filtros server-side verificada otra vez sobre Discovery: zona, source, niche, score mínimo, tier, gps_source y combinaciones AND/OR siguen en verde.
- Flujo `draft` / `applied` en Inicio sigue correcto: seleccionar zona no toca el listado, `Aplicar` sí, `Cancelar` revierte y `Limpiar` vuelve al universo inicial.
- Modo individual mantiene persistencia de icono por niche/canonical niche tras recarga real.
- Se agregó evidencia explícita de mobile + dark mode + error de red visible, tanto para `lead-density` como para `zone-leads`.
- `next start` sobre la build actual ya no dispara `window is not defined` al levantar `/admin/discovery`.

### Hallazgos

| Clasificación | Severidad | Hallazgo | Estado |
|---------------|-----------|----------|--------|
| fix-now | HIGH | La variante compartida de mapas seguía exponiendo un riesgo SSR en `next start` (`window is not defined` desde `/admin/discovery`). | Corregido con wrappers dinámicos `ssr: false` sobre la base compartida. |
| fix-now | MEDIUM | En Inicio y en el drilldown de zonas, un fallo de red podía verse como estado vacío y no como error real. | Corregido: la base compartida ahora recibe `loadError` / `zoneLeadsError` y los muestra en UI. |
| follow-up | MEDIUM | La superficie lateral de filtros/cards sigue fuertemente apoyada en clases claras fijas (`bg-white`, `text-slate-*`), por lo que dark mode es funcional pero no totalmente tokenizado. | No bloquea cierre; absorber en `UI-8` como limpieza visual global. |

---

## Auditoría 2 — Comercial

### Flujo simulado
1. Abrir Inicio.
2. Filtrar por zona registrada.
3. Combinar filtros operativos.
4. Revisar mapa de calor e ir a leads individuales.
5. Aplicar la geografía al listado.
6. Abrir una ficha desde la card lateral.

### PASS
- El flujo `Aplicar al listado` evita el error comercial más costoso: cambiar silenciosamente el universo de trabajo mientras el usuario explora el mapa.
- Las cards individuales ya son útiles para priorizar: nombre legible, tier, score, offer principal, pitch hook y señales resumidas de web/contacto/reviews/software/marketing.
- La selección por zona registrada es más confiable que el filtro libre anterior y reduce ambigüedad al hablar de “Montevideo”, “Salto”, etc.
- El selector de iconos confirma alcance por niche, lo que evita pensar que el cambio es solo visual para un lead aislado.

### Hallazgos

| Clasificación | Severidad | Hallazgo | Estado |
|---------------|-----------|----------|--------|
| follow-up | MEDIUM | En modo heatmap, hacer click en una fila lateral selecciona la cuadrícula pero no fuerza el drilldown a leads individuales; el drilldown completo hoy es más obvio desde el marker que desde la lista. | No bloquea cierre. Documentado como mejora UX menor del mapa compartido. |
| follow-up | LOW | La persistencia de iconos es local al navegador. Para operación diaria alcanza, pero no sincroniza preferencias entre usuarios/dispositivos. | Aceptado por ahora; si aparece necesidad multiusuario, mover a config persistida server-side. |

**Veredicto comercial:** APROBADO. No quedaron fricciones que impidan usar el mapa para decidir qué revisar/contactar hoy.

---

## Auditoría 3 — Desarrollador

### PASS
- La unificación sigue real: Inicio y Discovery consumen wrappers finos sobre una sola base cartográfica compartida.
- La semántica `draft` / `applied` permanece confinada a Inicio; Discovery no arrastra esa complejidad.
- La serialización compartida de filtros y de selección geográfica sigue concentrada en helpers reutilizables.
- No se agregaron dependencias nuevas ni schema nuevo para cerrar la fase.
- El fix SSR quedó en el borde correcto: wrappers, no forks del mapa ni hacks dentro de Leaflet.

### Hallazgos

| Clasificación | Severidad | Hallazgo | Estado |
|---------------|-----------|----------|--------|
| fix-now | HIGH | El bundle del mapa seguía evaluándose del lado servidor en `next start`, dejando una excepción no controlada fuera del flujo de tests. | Corregido con `next/dynamic(..., { ssr: false })` en ambos wrappers. |
| fix-now | MEDIUM | Error handling inconsistente entre Discovery e Inicio: Discovery ya tenía warning de sección para densidad, Inicio no; el drilldown de zonas en ambos lados colapsaba a vacío. | Corregido unificando props de error visibles en la base compartida. |
| follow-up | LOW | El nuevo test de wrappers dependía de la implementación anterior y tuvo que migrarse a la forma SSR-safe. Conviene evitar asserts demasiado estructurales sobre wrappers cuando la intención es “base única + variant fija”. | Ajustado en esta fase; criterio a mantener en próximos cambios. |

**Veredicto desarrollador:** APROBADO. No quedó duplicación grave ni deuda arquitectónica que justifique bloquear el cierre de `MAP-9`.

---

## Resumen ejecutivo

| Tipo | Total | Cerrados ahora | Pendientes |
|------|-------|----------------|------------|
| blocker | 0 | 0 | 0 |
| fix-now | 4 | 4 | 0 |
| follow-up | 4 | 0 | 4 |

**Veredicto final:** `MAP-9` aprobado sin blockers. Los hallazgos severos eran dos problemas reales de infraestructura/UX (SSR y errores ocultos) y quedaron corregidos dentro de la fase.
