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

### Recomendaciones

- hover en contador de nicho con detalle por fuente
- capacidad de explicar por qué el nicho está sugerido

### Composer

- conserva el draft al crear un batch
- toggle de enrichment default-on
- el usuario entiende si el batch hará discovery solo o discovery + enrich

### Contexto y mapa

- mapa real del mundo, no abstracción plana sin geografía
- panel lateral con altura limitada y scroll
- filtros y orden útiles, incluyendo métricas agregadas cuando existan

### Limpieza UX

- `jobs legacy` fuera de la experiencia principal

## Leads y feedback humano

La ficha del lead debe poder mostrar y recibir validación humana sin romper su lectura rápida.

### Objetivo de UX

- marcar datos buenos/malos desde donde se inspecciona el lead
- ver feedback previo sin ruido excesivo
- mantener separación clara entre dato original, dato inferido y dato validado por humano

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
