# Blindspot — Frontend Architecture

> Diseño de la UI para el programa de mejoras vigente.
> Describe cómo debe evolucionar `ui/` a partir de la base ya implementada.
> El panel admin específico se complementa con `ADMIN_PANEL.md`.

---

## Principios de frontend

1. La navegación tiene que escalar con más módulos sin volverse caótica.
2. La UI debe priorizar operación real por encima de decoración.
3. El admin necesita contexto, estado y acciones visibles; no pantallas aisladas sin hilo conductor.
4. Discovery y CRM son superficies de trabajo, no páginas de reporte estático.
5. El diseño debe funcionar tanto en claro como en oscuro.

## Shell admin objetivo

### Sidebar

Estado actual (`NAV-1` cerrado):
- buscador arriba del sidebar
- grupos colapsables
- grupos colapsados por defecto, salvo el de la ruta activa
- persistencia de colapso por sesión
- iconografía coherente por sección
- organización sugerida:
  - Operación: Inicio, Leads, Discovery, Pipeline, CRM
  - Comercial: Outreach, Segmentos, Pricing si aplica
  - Plataforma: Backups, Monitoreo, Usuarios, Auditoría
  - Ayuda: Help/Docs

### Comportamiento

- no perder el estado de colapso entre páginas de una misma sesión si es simple persistirlo
- reflejar bien la ruta activa y sus padres
- no mostrar rutas admin a CM

## Theming objetivo

Estado actual (`THEME-1` cerrado):
- dark mode con tokens compartidos
- persistencia de preferencia
- script de hidratación temprana para respetar el tema antes del render
- componentes base con soporte dual desde el diseño, no parche por pantalla

## Pantalla Monitoreo

Estado actual (`MON-2` cerrado): reemplaza conceptualmente `Estado del sistema` como landing técnica del admin.
La ruta principal es `/admin/monitoring` y `/admin/health` quedó como alias por redirect.

### Secciones objetivo

- salud general
- procesos y scheduler
- pipeline activo/reciente
- backups y restore
- costos resumidos
- performance resumida
- errores/logs recientes

### Estilo buscado

- denso, claro y escaneable
- inspiración observability/Grafana
- sin “tarjetitas decorativas” si no aportan señal operativa

## Discovery workspace objetivo

Estado actual (`DISC-1` cerrado): hover con breakdown por fuente, draft persistido en `localStorage` y `jobs legacy` relegados a compatibilidad.

### Recomendaciones

- hover en contador de nicho con detalle por fuente
- capacidad de explicar por qué el nicho está sugerido

### Composer

- conserva el draft al crear un batch
- toggle de enrichment default-on persistido en `localStorage`
- el usuario entiende si el batch hará discovery solo o discovery + enrich
- los jobs hijos exponen `linked_run_id`, `linked_enrich_run_id` y `enrich_status` para trazabilidad operativa

### Contexto y mapa

- `Contexto y mapa` usa Leaflet sobre OpenStreetMap con atribución visible y viewport ajustado a cuadrículas granulares
- combina GPS reales y geocoding on-demand cacheado, mostrando métricas separadas para ambos
- panel lateral con altura limitada y scroll
- filtros server-side con debounce de 300ms (`source`, `niche`, `prospect_score_gte`, `contact_tier`, `gps_source`) + filtros locales de zona/orden
- metadata operativa del backlog de geocoding y contador de leads filtrados/posicionados
- estado actual (`MAP-5` cerrado): `Contexto y mapa` y `Mapa de leads` montan wrappers (`DiscoveryContextMap`, `LeadReviewMap`) sobre `LocationDensityMapBase`; las diferencias viven en `variant`/props, no en forks de UI

### Mapa de leads

- debe operar como mapa embebido para revisar leads, no como pantalla paralela
- la selección del mapa mantiene estado `draft` y no filtra `Leads para revisar` hasta que el usuario presiona `Aplicar`
- debe ofrecer `Cancelar` o `Limpiar` para recuperar el estado aplicado anterior
- Estado actual (`MAP-7` cerrado): `AdminHomePage` mantiene dos planos de estado (`draftDensityFilters`/`appliedDensityFilters`, `draftSelectedLocationKey`/`appliedSelectedLocationKey`) y sólo traduce el plano aplicado a `LeadExplorer`.
- `Filtrar zona` usa selector dinámico de zonas registradas con jerarquía Departamento > Ciudad > Barrio
- los filtros combinados deben comportarse igual que en `Contexto y mapa` y tener Playwright obligatorio
- Estado actual (`MAP-8` cerrado): el modo de leads individuales usa markers/iconos por niche/canonical niche, con preferencia persistida por grupo canónico en `localStorage`; el heatmap queda reservado para densidad agregada
- `Vista completa` no debe mostrarse porque ambos mapas tienen la misma capacidad embebida

### Cards de leads individuales en mapa

- diseño comercial, no técnico
- capitalización legible de nombre/nicho/zona sin mutar dato crudo
- resumen de score comercial con variables principales: website, redes, rating/reviews, contacto, señales de software y señales de marketing
- selector de icono por nicho cuando el usuario tenga permiso
- soporta claro/oscuro y mobile sin desbordar el viewport
- Estado actual (`MAP-8` cerrado): la variante compartida renderiza cards comerciales con señales compactas y selector de iconos por niche; la persistencia no toca schema y se resuelve por `canonical_niche`.

### Limpieza UX

- `jobs legacy` fuera de la experiencia principal
- Lead Explorer full-page puede encolar enrichment sobre la colección filtrada actual con guardrails y feedback inmediato de run
- Estado actual (`UI-8` cerrado): `Inicio` ya no duplica alertas hardcodeadas; el acceso a alertas queda concentrado en la campanita global y en `/admin/alerts`.

### Importación y sugerencias predictivas

- `Plataforma > Importación` es la superficie de carga de XLS; Discovery solo consume el catálogo resultante
- Estado actual (`MAP-6` cerrado): `LocationDensityMapBase` consume zonas estructuradas (`zone_id`/`zone_ids`) desde `GET /api/v1/admin/geo/zones`; el selector de zona dejó de depender de texto libre y ambas pantallas de mapa comparten el mismo contrato de filtros y refetch de drilldown.
- Composer y Creación masiva pueden activar `Usar sugerencias predictivas`
- Estado actual (`DISC-14` cerrado): Discovery ya usa `GET /api/v1/discovery/location-suggestions` en Composer y Creación masiva; ambas superficies permiten revisar/deseleccionar sugerencias y siguen requiriendo confirmación humana antes de crear jobs.

### Selección de locación unificada (`DiscoveryLocationPicker`)

- Estado actual: la selección de locación del Workspace de discovery vive en una sola base compartida `DiscoveryLocationPicker` (`ui/src/components/discovery-location-picker.tsx`), parametrizada por props (`mode: "single" | "multi"`, `allowFreeText`, `enablePredictive`), sin forks por pantalla.
- El picker tiene dos tabs: `Catálogo` (browse/búsqueda debounced del `discovery_places_catalog` vía `listDiscoveryPlacesCatalog`, con filtro por `kind` y jerarquía/`commercial_score` visibles) y `Predictivo` (sugerencias scoreadas vía `getDiscoveryLocationSuggestions`, con seed opcional de ciudad). El catálogo es la fuente principal de ubicaciones.
- `Composer` lo monta en modo `single` con fallback de texto libre (preserva prefills de mapa/gaps y ubicaciones ad-hoc); `Creación masiva` lo monta en modo `multi` (combinación ubicaciones × nichos). La grilla hardcodeada de ciudades y los paneles predictivos duplicados quedaron eliminados.
- La sección standalone `Catálogo de lugares` se plegó dentro del picker (tab `Catálogo`); el link a `Plataforma > Importación` se conserva en el estado vacío.
- Estados loading/error/empty explícitos; catálogo vacío → mensaje claro + link a Importación, y el fallback de texto libre sigue usable.
- La serialización de la selección (catálogo/predictivo/freetext → payload de job + `predictive_context` + `recommendation_origin`) está centralizada en `ui/src/lib/discovery-location.ts`; no hay parsing duplicado entre pantallas.
- El zone-picker del mapa (`zone_ids` sobre `GET /api/v1/admin/geo/zones`) sigue siendo un filtro de densidad, semánticamente distinto de elegir la locación a descubrir; queda fuera de esta base compartida.
- las sugerencias muestran explicación: score, confianza, histórico de éxito, riesgo de duplicados, costo estimado y última exploración
- el usuario siempre confirma antes de crear jobs; no hay llamadas billable por ver sugerencias
- si no hay catálogo importado, mostrar CTA a Importación y mantener flujo manual disponible
- Estado actual (`DISC-15` cerrado): el repo trae `tests/discovery/fixtures/uruguay-location-seed.xlsx` como seed de validación y la UI de Importación ya explica que `notes` puede transportar trazabilidad `SRC:*`.

## Leads y feedback humano

La ficha del lead debe poder mostrar y recibir validación humana sin romper su lectura rápida.

### Objetivo de UX

- marcar datos buenos/malos desde donde se inspecciona el lead
- ver feedback previo sin ruido excesivo
- mantener separación clara entre dato original, dato inferido y dato validado por humano

Estado actual:
- ya existe API persistida de feedback humano por lead/campo
- la siguiente fase activa es `FDBK-2`, para integrarlo en la ficha del lead

### Filtros comerciales

- Estado actual (`LEAD-6` cerrado): `Leads para revisar` ya expone `Tipo de oferta comercial` como filtro y ordenamiento (`marketing_score`, `software_score`, `offer_balance`) sobre `listLeads`.
- Opciones activas: `Todas`, `Marketing`, `Software`, `Marketing + Software` y `Sin señal suficiente`.
- El filtro sigue siendo server-side y reutilizable por otros listados que consuman `listLeads`.
- Las cards muestran badge sobrio derivado de `commercial_offers_summary` y resumen breve `MKT/SW`.

## CRM objetivo

### Vista principal

- board tipo Jira con cards movibles por estado
- columnas:
  - Pendiente
  - Validación
  - Contacto
  - Observado
  - Rechazado
  - Aceptado

### Card

Debe mostrar al menos:
- lead
- owner
- estado
- último movimiento relevante
- señales útiles de contacto / score

### Modal o panel de detalle

- notas
- adjuntos/imagenes si el patrón técnico lo soporta
- canal exitoso
- caso “ningún canal funcionó”
- recordatorio para `Observado`
- texto de cierre para `Aceptado` y `Rechazado`

## Regla de validación frontend

Toda fase de UI debe cerrar con:
- `pnpm --dir ui typecheck`
- `pnpm --dir ui build`
- tests de la superficie tocada
- smoke en navegador si la fase cambia navegación o flujos operativos críticos
- Playwright obligatorio para mapas cuando cambian filtros, selección, markers o listas derivadas
- Estado actual (`MAP-9` cerrado): los wrappers de mapa usan carga dinámica sin SSR para aislar Leaflet del servidor de Next y la UI distingue errores de red de estados vacíos en densidad/drilldown.
- Estado actual (`DISC-12` cerrado): `Plataforma > Importación` vive en `/admin/imports`, hace preview/confirmación de XLS y Discovery dejó de hospedar el upload; ahí solo se consulta y preselecciona el catálogo.
