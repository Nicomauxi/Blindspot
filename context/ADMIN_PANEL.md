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
- `Contexto y mapa` con Leaflet + OSM, viewport real, lista lateral acotada, scroll y filtros/orden
- composer con toggle persistente `discovery + enrich` y trazabilidad por runs en cada job hijo
- Lead Explorer puede lanzar enrichment de la colección filtrada actual con guardrails de volumen, concurrencia y trazabilidad por run

## Leads y feedback

La ficha del lead debe volverse también punto de validación humana.

### Capacidad objetivo

- marcar dato bueno/malo
- dejar comentario
- persistir y auditar feedback
- usarlo luego para mejorar criterios operativos

Estado actual:
- ya existe feedback persistido por lead/campo en backend con auditoría
- la siguiente fase activa es `FDBK-2`, para exponerlo en Lead Detail

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
