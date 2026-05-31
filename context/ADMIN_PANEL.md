# Blindspot — Admin Panel

> Especificación del panel admin para el programa de mejoras vigente.
> Complementa `ARCHITECTURE_FRONTEND.md` con foco en operación del admin.

---

## Objetivo del admin panel

Permitir que el admin opere Blindspot sin depender de CLI para tareas habituales,
con visibilidad real del sistema, control de backups, discovery usable y un CRM
operativo para seguimiento comercial.

## Principios

1. La pantalla principal técnica del admin pasa a ser `Monitoreo`.
2. La navegación debe escalar; el sidebar ya no puede ser una lista plana creciente.
3. El shell admin debe funcionar en claro y oscuro con persistencia de preferencia.
4. Acciones destructivas o sensibles siguen teniendo confirmación inline.
5. La observabilidad debe mostrar problemas reales, no esconderlos.
6. El CRM debe sentirse como herramienta de trabajo diario, no como un formulario disperso.

## IA de navegación objetivo

### Secciones sugeridas

- Operación
  - Inicio
  - Leads
  - Discovery
  - Pipeline
  - CRM
- Comercial
  - Outreach
  - Segmentos
- Plataforma
  - Importación
  - Backups
  - Monitoreo
  - Usuarios
  - Auditoría
- Ayuda
  - Help

### Requisitos

Estado actual (`NAV-1` cerrado):
- grupos colapsables
- colapsados por defecto, salvo grupo activo
- buscador arriba del sidebar
- persistencia por sesión del estado de colapso
- iconos personalizados/coherentes por opción

## Monitoreo

### Rol de la pantalla

Unificar lo que hoy está disperso entre Health/System, Costs, Performance y parte de Backups.

Estado actual (`MON-2` cerrado): la superficie visual unificada ya existe sobre `GET /api/v1/admin/monitoring/overview`; `Health` queda solo como alias de compatibilidad.

### Debe mostrar

- estado de `api` y `core`
- scheduler/pipeline activo
- errores recientes
- logs útiles
- backups y restore
- tamaño actual de DB
- costos y performance resumidos
- drift/config warnings relevantes

### Comportamiento esperado

- refresh periódico cuando la pantalla está abierta
- fallos visibles y entendibles
- acciones operativas disponibles solo donde corresponda

## Backups

### Cambios objetivo

Estado actual (`BKP-1` cerrado):
- retención máxima separada entre manuales y programados
- restore, scheduler y listado existente siguen visibles
- backups y monitoreo muestran peso actual estimado de DB
- la UI deja claro cuántos backups hay por tipo, su límite y la huella almacenada

## Discovery Control Center

### Mejoras UX objetivo

Estado actual (`DISC-2` cerrado):
- nichos sugeridos con detalle por fuente en hover
- composer persistente después de crear batch
- `jobs legacy` fuera de la experiencia principal, visibles solo como compatibilidad
- `Contexto y mapa` con Leaflet + OSM, cuadrículas granulares, geocoding on-demand cacheado, lista lateral acotada, scroll, filtros server-side con debounce y métricas separadas de GPS real vs inferido
- composer con toggle persistente `discovery + enrich` y trazabilidad por runs en cada job hijo
- Lead Explorer puede lanzar enrichment de la colección filtrada actual con guardrails de volumen, concurrencia y trazabilidad por run

### Ciclo 4

- Estado actual (`MAP-5` cerrado): `Contexto y mapa` comparte base con `Mapa de leads` vía `LocationDensityMapBase`; no se mantienen dos implementaciones cartográficas paralelas.
- Estado actual (`MAP-6` cerrado): `Filtrar zona` consume `GET /api/v1/admin/geo/zones`, no texto libre primario; el selector muestra jerarquía y conteo.
- Estado actual (`MAP-6` cerrado): `lead-density` y `zone-leads` comparten parser/serializador de filtros y ya tienen validación E2E de combinaciones sobre la UI compartida de mapas.
- Composer y Creación masiva pueden activar sugerencias predictivas basadas en catálogo importado e histórico de discoverys.
- Las sugerencias predictivas son revisables y explicables; nunca crean jobs sin confirmación humana.
- Estado actual (`DISC-14` cerrado): Composer y Creación masiva ya pueden activar sugerencias predictivas, revisar/deseleccionar lugares sugeridos y crear jobs/batches con trazabilidad predictiva persistida en metadata.
- Estado actual: la selección de locación de todo el Workspace de discovery se unificó en una sola superficie compartida (`DiscoveryLocationPicker`) pensada para el operador: tabs `Catálogo` (busca/elige lugares reales del catálogo importado, con jerarquía y score visibles) y `Predictivo`, más fallback de texto libre en el Composer. `Creación masiva` dejó de usar la grilla fija de ciudades y ahora combina ubicaciones del catálogo × nichos; la sección `Catálogo de lugares` standalone quedó plegada dentro del picker. Con catálogo vacío el fallback es explícito (mensaje + link a Importación). No hay lógica de selección duplicada entre pantallas.

## Plataforma > Importación

### Rol de la pantalla

Permitir que el admin cargue XLS de lugares/zonas para alimentar filtros geográficos, Composer, Creación masiva y ranking predictivo de Discovery.

### Capacidades objetivo

- upload `.xls`/`.xlsx` con preview antes de confirmar
- validación de columnas y errores por fila
- deduplicación por ubicación/lugar/tipo
- historial de import batches
- catálogo activo consultable y filtrable
- auditoría de carga, confirmación y errores
- Estado actual (`DISC-15` cerrado): `/admin/imports` ya tiene un seed reproducible (`uruguay-location-seed.xlsx`) compatible con preview/commit; la trazabilidad de origen vive en `notes` y en `context/research/location-seed-sources.md`.

### Guardrails

- importar catálogo no dispara Google Places ni discovery automáticamente
- fuentes externas deben quedar trazadas con `source_name` y `source_url` cuando aplique
- si la dependencia `xlsx` no existe, pedir aprobación antes de importarla
- filas inválidas no deben contaminar el catálogo activo

## Inicio

### Limpieza ciclo 4

- remover la sección `Alertas: Solo lo que cambia decisión o requiere intervención`
- mantener la campanita, contador y página `/admin/alerts` como mecanismo oficial de alertas
- no reemplazar la sección removida por alertas hardcoded nuevas
- Estado actual (`UI-8` cerrado): el bloque ya fue removido de `Inicio`; la campanita sigue siendo la única entrada resumida a alertas persistidas.

## Leads y feedback

La ficha del lead debe volverse también punto de validación humana.

### Capacidad objetivo

- marcar dato bueno/malo
- dejar comentario
- persistir y auditar feedback
- usarlo luego para mejorar criterios operativos

Estado actual:
- ya existe feedback persistido por lead/campo en backend con auditoría
- `RBAC-1` cerrado: usuarios `cm` ven contacto redactado en Lead Detail hasta iniciar seguimiento propio
- la siguiente gran línea pendiente sobre la ficha comercial queda en `LEAD-*` y `CRM-9`

### Leads para revisar

- Estado actual (`LEAD-6` cerrado): soporta filtro `commercial_offer_type` y orden server-side por `marketing_score`, `software_score` y `offer_balance`.
- Tipos activos: `Marketing`, `Software`, `Marketing + Software` y `Sin señal suficiente`.
- El filtro se aplica en backend para mantener consistencia con exportaciones, mapas y otros listados que reutilicen `listLeads`.
- Las cards muestran badge derivado y score resumido (`MKT/SW`) cuando existe `commercial_offers_summary`.

### Mapa de leads

- estado actual (`MAP-5` cerrado): mapa embebido con base compartida con `Contexto y mapa`
- Estado actual (`MAP-7` cerrado): `Mapa de leads` ya no cambia `Leads para revisar` hasta confirmar; `Aplicar al listado`, `Cancelar` y `Limpiar` viven en la variante compartida `LeadReviewMap`.
- la geografía aplicada puede venir de una cuadrícula puntual o de `zone_ids` sin seleccionar marker individual
- Estado actual (`MAP-8` cerrado): leads individuales se muestran con iconos configurables por niche/canonical niche y card comercial rediseñada; `Vista completa` ya no aparece en el flujo embebido
- Estado actual (`MAP-9` cerrado): la auditoría integral vive en `context/research/map-flow-audit.md`; Inicio y Discovery muestran errores de red del mapa como tales y la base compartida ya no rompe `next start` por SSR.

## CRM

### Cambio de modelo

- `Iniciar campaña` deja de ser la acción principal
- la acción principal pasa a ser `Iniciar seguimiento`

### Reglas de negocio objetivo

- al iniciar seguimiento se asigna al usuario que lo inicia
- CM ve solo sus seguimientos
- admin puede ver propios o ajenos
- estados canónicos:
  - Pendiente
  - Validación
  - Contacto
  - Observado
  - Rechazado
  - Aceptado

### Detalle por estado

- `Pendiente`: to-do simple
- `Validación`: revisar datos (contacto, nicho, etc.)
- `Contacto`: registrar descripción, adjuntos y canal exitoso; también marcar “ningún canal funcionó”
- `Observado`: guardar fecha de recuerdo y contexto
- `Rechazado`: descarta la oportunidad con descripción
- `Aceptado`: cierre con descripción y adjuntos relevantes

### UI objetivo

- board con cards móviles tipo Jira
- modal/panel al hacer click en la card
- acciones y edición contextual sin saltar a formularios desconectados

## Guardrails de implementación

- no mezclar la creación del CRM con la eliminación inmediata del sistema previo de campañas
- primero crear tablas y endpoints nuevos; luego migrar la UX
- toda acción admin relevante sigue escribiendo `audit_log`
