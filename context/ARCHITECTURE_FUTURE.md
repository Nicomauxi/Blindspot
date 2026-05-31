# Blindspot — Future Architecture

> Diseño objetivo del próximo programa de mejoras.
> Parte de un sistema ya remediado y operativo; no describe una app desde cero.
> El orden de ejecución vive en `ROADMAP_CANONICAL.md` y el detalle de cierre en `FUTURE.md`.

---

## Principios de diseño del programa actual

1. No tirar abajo lo que ya funciona para “hacerlo lindo”.
2. Introducir puentes y compatibilidad antes de reemplazar modelos existentes.
3. Separar datos operativos, datos observacionales y datos comerciales.
4. Mantener a `api/` como autoridad de contratos/RBAC y a `src/` como ejecución de pipeline.
5. Toda mejora de UI relevante debe tener un backend coherente detrás; no fabricar estados con mocks silenciosos.

## Monitoreo objetivo

El sistema debe converger hacia un dominio de `monitoring` unificado para admin.

### Qué debe mostrar

- estado de procesos (`api`, `core`, scheduler, maintenance/restore si aplica)
- pipeline activo, últimas ejecuciones y errores recientes
- backups: último, próximo, scheduler, retención, tamaño DB, fallos recientes
- costos resumidos
- performance resumida
- calidad/deriva operativa visible
- logs recientes útiles para operar sin CLI
- configuración crítica y drift detectable

### Contrato sugerido

Estado actual (`MON-1` cerrado): existe `GET /api/v1/admin/monitoring/overview` como read model unificado inicial para UI admin.
La familia todavía puede expandirse, pero ya hay un payload pensado para una vista unificada y no solo para pantallas aisladas.

### Regla de calidad

Un fallo reciente de backup, restore, scheduler o pipeline nunca debe quedar escondido detrás de un badge verde genérico.

## Backups objetivo

La configuración de backups debe diferenciar explícitamente:
- retención máxima de manuales
- retención máxima de programados

### Estado deseado

Estado actual (`BKP-1` cerrado): los dos límites ya se persisten, la poda por tipo está activa y backups/monitoreo ya muestran tamaño estimado de DB y huella agregada de backups.

- ambos límites persistidos
- limpieza por tipo, determinística
- peso actual de DB visible en backups/monitoreo
- restore sigue siendo admin-only y con checkpoint previo obligatorio

Estado actual (`MINTUR-1` cerrado): MINTUR ya aporta mejores niches canónicos usando `TipoOperador` y nombre del operador sin abrir una taxonomía paralela.

## Geografía y mapas objetivo

La visualización de densidad comercial y el contexto geográfico de discovery deben vivir sobre un mapa real del mundo.

### Requisitos

- contratos backend aptos para capas geográficas
- atribución correcta si se usa OSM
- reutilización entre mapa de densidad y `Contexto y mapa` de discovery cuando convenga

### Ciclo 4 target

`Mapa de leads` y `Contexto y mapa` deben compartir una misma base cartográfica. La diferencia entre ambos no es técnica sino de intención de uso:
- `Mapa de leads`: selector/filtro operativo para `Leads para revisar`.
- `Contexto y mapa`: soporte geográfico de discovery, recomendaciones y lectura de cobertura.

Estado actual (`MAP-5` cerrado): la base compartida ya existe en UI como `LocationDensityMapBase`, con wrappers declarativos por variante.

La base compartida debe resolver una sola vez:
- inicialización Leaflet/OSM y atribución.
- bounds/viewport.
- capas de densidad, leads individuales, zonas y backlog geocoding.
- loading/error/empty states.
- serialización de filtros.
- markers, popups y cards extensibles por variante.

`Filtrar zona` debe consumir zonas registradas dinámicamente. La entidad canónica debe tener al menos `id`, `departamento`, `ciudad`, `barrio`, `kind`, `label`, `normalized_key`, `source` y `active`. Estado actual (`DISC-12` cerrado): las zonas base se derivan del catálogo persistido en `discovery_places_catalog`; no se abrió tabla `location_import_batches` y la trazabilidad de importaciones quedó en `audit_log` (`discovery.places.import`).

La semántica global de filtros geográficos es:
- dimensiones distintas combinan con `AND`.
- múltiples valores dentro de la misma dimensión combinan con `OR`.
- filtro vacío significa ausencia de restricción.
- valores inválidos deben devolver error o estado vacío explícito, no datos silenciosamente incorrectos.

Estado actual (`MAP-8` cerrado): el modo individual de leads ya se representa con iconos sobre markers Leaflet y la preferencia por niche/canonical niche persiste localmente por grupo canónico, sin introducir schema nuevo.

El default sigue siendo punto de interés genérico; si más adelante hace falta sincronización multiusuario, la evolución natural es una tabla aditiva como `niche_icon_preferences` o metadata de grupos de nichos si no rompe responsabilidades.

## Discovery workspace objetivo

### Composer

- mantiene su estado al crear un batch
- puede disparar discovery y, opcionalmente, enrichment encadenado
- el toggle de enrichment viene activado por defecto

### Recomendaciones

- cada nicho sugerido puede detallar contribución por fuente
- la UX debe explicar por qué se sugiere algo, no solo mostrar un número

### Contexto y mapa

- lista lateral acotada visualmente con scroll
- filtros/orden operativos
- soporte para orden por score agregado cuando la data exista
- desde ciclo 4, debe embeber la misma base cartográfica que `Mapa de leads`; cualquier divergencia debe expresarse como variante/configuración

### Importación y catálogo de lugares

La sección `Plataforma > Importación` debe crear un catálogo reusable por Discovery y por filtros de zona. El modelo objetivo es aditivo:
- `location_import_batches`: lote de archivo, hash, usuario, estado, conteos y resumen de errores.
- `location_catalog_entries`: departamento, ciudad, barrio, lugar/zona, tipo, niche_hint, lat/lng opcional, fuente, URL, confianza, metadata y estado activo.

El catálogo no dispara discovery por sí solo. Sirve como input para:
- sugerencias del Composer.
- creación masiva.
- zonas dinámicas.
- Estado actual (`MAP-6` cerrado): la fuente canónica para opciones es `GET /api/v1/admin/geo/zones`, que prioriza catálogo importado y cae a derivación desde leads; `lead-density` y `zone-leads` ya comparten contrato server-side con `zone_ids`.
- Estado actual (`MAP-7` cerrado): `Mapa de leads` ya usa un flujo confirmable `draft`/`applied`; la geografía aplicada puede venir de cuadrícula o de `zone_ids` y es la única que viaja al `LeadExplorer` embebido.
- algoritmo predictivo de potencial.
- XLS semilla de pruebas ya materializado como fixture reproducible (`tests/discovery/fixtures/uruguay-location-seed.xlsx`).

### Discovery predictivo

Estado actual (`DISC-14` cerrado): el scoring se calcula on-demand desde catálogo + `discovery_jobs` + cobertura actual de `leads`, y ya alimenta Composer/Creación masiva vía `GET /api/v1/discovery/location-suggestions`. La creación persiste `suggestion_source`, `location_catalog_entry_id` y `opportunity_score_snapshot` en metadata existente para auditar jobs predictivos sin recalcular histórico.


El algoritmo objetivo debe priorizar lugares con potencial cruzando catálogo e histórico de discovery:
- jerarquía Departamento > Ciudad > Barrio.
- tasa histórica de leads nuevos.
- tasa de duplicados.
- costo promedio por lead nuevo.
- recencia de búsqueda.
- cobertura actual de leads.
- niche_hint y nichos sugeridos.

La salida debe ser explicable: `score`, `confidence`, `expected_new_leads`, `duplicate_risk`, `cost_estimate` y `reasons[]`. No debe usar llamadas Google Places ni costos externos para calcular sugerencias.

### Deuda a retirar

- `jobs legacy` no debe seguir siendo parte de la experiencia principal

### Enrichment por colección

Debe existir una forma específica de enriquecer leads seleccionados por filtros, sin obligar a correr discovery de nuevo.

## MINTUR target

- aprovechar mejor `source_data` para reducir `other`
- mantener salida en la taxonomía canónica que consume scoring/UI
- evitar lógica opaca difícil de testear

## Feedback humano objetivo

El sistema debe permitir que un usuario valide manualmente calidad de datos por lead y que esa señal quede persistida, auditable y consumible.

### Modelo sugerido

Tabla principal de feedback por lead/campo, por ejemplo:
- `id`
- `lead_id`
- `field_key`
- `verdict` (`good` | `bad`)
- `comment`
- `created_by`
- `created_at`

Se pueden agregar tablas/eventos auxiliares si la evolución lo justifica, pero no mezclar esto con `lead_outreach` ni con flags efímeros en `leads`.

### Consumo objetivo

El primer nivel de “aprendizaje” no es reentrenamiento mágico; es usar agregados y overrides operativos para:
- mejorar confiabilidad mostrada
- refinar heurísticas
- detectar campos/proveedores sistemáticamente problemáticos

## CRM objetivo

El CRM nuevo reemplaza el concepto operativo de campaña como entrypoint principal.

### Principio

La acción visible pasa a ser `Iniciar seguimiento`, no `Iniciar campaña`.

### Modelo conceptual

Entidad principal de seguimiento CRM con tablas propias.

**Estados canónicos:**
- `pending`
- `validation`
- `contact`
- `observed`
- `rejected`
- `accepted`

### Reglas de negocio mínimas

- iniciar seguimiento asigna el lead al usuario que lo inicia
- CM ve solo sus seguimientos
- admin puede ver propios o ajenos
- en `contact` se registra canal exitoso o “ningún canal funcionó”
- `observed` permite fecha de recordatorio
- `rejected` y `accepted` cierran el flujo con contexto
- notas y adjuntos viven dentro del detalle del seguimiento, no dispersos por otras tablas

### Compatibilidad transitoria

- no borrar `campaigns` y estructuras viejas en la misma fase que se crea CRM
- introducir puente o alias temporal si hace falta mantener partes de la UI/API funcionando mientras migra la experiencia

## Frontend target

- sidebar escalable con grupos, buscador e iconografía clara
- dark mode real
- `Monitoreo` como pantalla unificada
- Discovery workspace más operativo
- CRM tipo board móvil estilo Jira con modal de detalle
- mapas compartidos con variantes declarativas y botón `Aplicar` en el flujo de revisión de leads
- Estado actual (`MAP-9` cerrado): la auditoría de mapas quedó documentada y cerró dos deudas transversales del shared map (`ssr: false` en wrappers y error handling visible para densidad/drilldown).
- `Plataforma > Importación` como fuente operativa de catálogo de lugares/zonas

## Filtros comerciales objetivo

`Tipo de oferta comercial` debe ser una dimensión transversal de leads, inicialmente con `Marketing` y `Software`. El backend debe ser la fuente de verdad del filtro y del ordenamiento; la UI solo lo expone.

Modelo recomendado:
- derivar desde el resumen comercial dual cuando el costo sea bajo.
- materializar en `lead_commercial_offer_summary` si los listados se vuelven caros.

Contrato mínimo por lead:
- `primary_offer_type`.
- `software_score`.
- `marketing_score`.
- `top_software_offer`.
- `top_marketing_offer`.
- `evidence_count` o resumen equivalente.

Estado actual (`LEAD-6` cerrado, 2026-05-27): el contrato ya vive en `commercial_offers_summary`, el filtro `commercial_offer_type` y los órdenes derivados se resuelven server-side en `/api/v1/leads`, y la UI sólo serializa/expone esos parámetros.

## Cierre esperado del programa

El programa actual estará conceptualmente cerrado cuando:
- el admin opere el sistema desde un `Monitoreo` unificado
- backups/manual restore tengan políticas claras y visibles
- discovery sea más usable y pueda encadenar enrichment
- MINTUR alimente mejor la taxonomía comercial
- exista feedback humano persistido y aprovechable
- el seguimiento comercial viva en un CRM real y no en campañas/outreach dispersos
