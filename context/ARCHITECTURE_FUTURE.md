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

## Cierre esperado del programa

El programa actual estará conceptualmente cerrado cuando:
- el admin opere el sistema desde un `Monitoreo` unificado
- backups/manual restore tengan políticas claras y visibles
- discovery sea más usable y pueda encadenar enrichment
- MINTUR alimente mejor la taxonomía comercial
- exista feedback humano persistido y aprovechable
- el seguimiento comercial viva en un CRM real y no en campañas/outreach dispersos
