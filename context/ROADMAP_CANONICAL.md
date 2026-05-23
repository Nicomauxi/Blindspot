# Blindspot — Roadmap Canonical

> Fuente canónica de ejecución para el programa de mejoras vigente desde 2026-05-22.
> Si este archivo contradice `FUTURE.md`, `PROJECT_MASTER.md`, `AUTONOMOUS.md`,
> `ARCHITECTURE.md`, `ARCHITECTURE_FUTURE.md`, `ARCHITECTURE_FRONTEND.md` o
> `ADMIN_PANEL.md`, este archivo gana.
>
> Contexto actual: la remediación integral ya dejó baseline reproducible, API/UI
> operativas, backups/restores administrativos y una base repoblada por discovery.
> El trabajo pendiente ya no es “rescatar” el sistema sino llevarlo a una versión
> más operable, coherente y usable en profundidad.

---

## Estado base asumido

- Repo único con tres workspaces: `src/` (core pipeline), `api/` (Fastify), `ui/` (Next.js).
- Dos procesos de aplicación: `api/` y `src/`, coordinados solo por PostgreSQL.
- Supabase local es la base operativa actual.
- Backups manuales, programados y restore desde UI ya existen.
- Discovery Control Center, Pipeline, Backups, Leads, Outreach, Costs, Performance,
  Users y Audit Log ya existen en la UI admin.
- El estado actual de datos puede variar; la planificación no depende de un volumen fijo.

## Reglas no negociables

1. Ejecutar una sola fase canónica por iteración.
2. Antes de tocar código, leer `AUTONOMOUS.md`, `FUTURE.md`, `ARCHITECTURE.md` y el documento de arquitectura específico del área (`ARCHITECTURE_FRONTEND.md`, `ADMIN_PANEL.md`, `ARCHITECTURE_FUTURE.md`).
3. No usar discovery real billable ni scraping externo pago para validar una fase salvo que sea estrictamente necesario y exista instrucción explícita del usuario.
4. No ejecutar acciones destructivas sobre DB sin backup verificable previo.
5. Las migraciones nuevas deben ser aditivas por defecto. Si una fase requiere reemplazar algo existente, introducir primero compatibilidad o puente y postergar la eliminación a una fase explícita posterior.
6. Toda fase debe cerrar con validación real acorde al área tocada y actualización de `context/`.
7. Si una fase exige una dependencia nueva, pedir aprobación antes de escribir código que la importe.
8. Si una fase supera alguno de estos límites, partirla antes de implementarla:
   - más de `12` archivos de código modificados;
   - más de `600` líneas netas estimadas;
   - mezcla simultánea de `schema DB + backend + UI` sin una necesidad estricta.

## Modos

- `autonomous`: el agente puede analizar, implementar, verificar y seguir a la siguiente fase.
- `dependency-approval`: la fase es autónoma salvo por dependencias nuevas.
- `destructive-approval`: la fase es autónoma salvo por acciones destructivas reales sobre datos.
- `manual-input`: la fase requiere input humano real y se debe detener.

## Roadmap ejecutable

| Orden | Bloque | Fase | Modo | Definición de listo |
|---:|---|---|---|---|
| 0 | Contexto | CTX-0 | complete | Contextos sincronizados con el programa actual de mejoras y loop autónomo listo. |
| 1 | Navegación | NAV-1 | autonomous | Sidebar con grupos colapsables colapsados por defecto, buscador superior, iconografía consistente y fix del warning de keys duplicadas. |
| 2 | UX base | THEME-1 | autonomous | Dark mode funcional en dashboard admin con tokens compartidos, persistencia y contraste validado. |
| 3 | Monitoreo | MON-1 | autonomous | Contrato backend unificado para monitoreo (`monitoring`) definido e implementado sin romper compatibilidad actual. |
| 4 | Monitoreo | MON-2 | autonomous | Pantalla `Monitoreo` tipo observabilidad unificada reemplaza la dispersión actual de Health/estado, con logs y métricas operativas claras. |
| 5 | Backups | BKP-1 | autonomous | Retención separada para backups manuales y programados, peso actual de DB expuesto y UI/admin coherentes. |
| 6 | Geografía | MAP-1 | dependency-approval | El mapa de densidad comercial usa un mapa real del mundo por ubicación, con atribución correcta y contratos backend/UI estables. |
| 7 | Discovery UX | DISC-1 | autonomous | Workspace de discovery mejora ergonomía: detalles por fuente en hover, composer persistente, lista lateral limitada con scroll/filtros y sin `jobs legacy`. |
| 8 | Discovery Orchestration | DISC-2 | autonomous | Composer puede encadenar discovery + enrichment mediante toggle default-on, con estado claro por batch/job. |
| 9 | Discovery Enrichment | DISC-3 | autonomous | Existe un flujo dedicado para enriquecer colecciones de leads por filtros relevantes desde la UI admin. |
| 10 | Discovery Data | MINTUR-1 | autonomous | Lógica de nichos MINTUR mejorada, baja el bucket `other` y quedan tests de parser/mapeo sólidos. |
| 11 | Feedback | FDBK-1 | autonomous | Schema y API de retroalimentación de calidad de datos por lead disponibles con auditoría y RBAC. |
| 12 | Feedback | FDBK-2 | autonomous | Lead Detail permite marcar datos buenos/malos con contexto operativo claro. |
| 13 | Feedback | FDBK-3 | autonomous | El sistema consume feedback humano en agregados/reglas operativas sin romper scoring ni enriquecimiento existentes. |
| 14 | CRM | CRM-1 | autonomous | Modelo de datos CRM propio y puente con campañas existentes listos sin pérdida de historial. |
| 15 | CRM | CRM-2 | autonomous | API/RBAC/audit del nuevo seguimiento CRM implementados; `iniciar campaña` deja paso a `iniciar seguimiento`. |
| 16 | CRM | CRM-3 | autonomous | Pantalla CRM tipo board móvil estilo Jira, con cards por etapa y permisos correctos. |
| 17 | CRM | CRM-4 | autonomous | Modal/flujo completo por card: notas, archivos, canal exitoso, observado con recordatorio, rechazado y aceptado. |

## Dependencias entre fases

- `NAV-1` antes de `THEME-1`, `MON-2`, `DISC-1` y `CRM-3`.
- `MON-1` antes de `MON-2` y `BKP-1`.
- `MAP-1` antes de cerrar completamente `DISC-1` si la sección “Contexto y mapa” cambia de contrato.
- `DISC-1` antes de `DISC-2` y `DISC-3`.
- `MINTUR-1` puede correr después de `DISC-1`; idealmente antes de campañas fuertes de repoblación.
- `FDBK-1` antes de `FDBK-2`; `FDBK-2` antes de `FDBK-3`.
- `CRM-1` antes de `CRM-2`; `CRM-2` antes de `CRM-3`; `CRM-3` antes de `CRM-4`.

## Criterios globales de validación por tipo de fase

### UI only

- `pnpm --dir ui typecheck`
- `pnpm --dir ui build`
- tests UI/RTL o equivalentes si existen
- smoke manual/Playwright si la fase toca navegación, formularios o boards

### API/core/schema

- `pnpm test`
- `pnpm typecheck`
- `pnpm --dir ui typecheck` si cambia contrato consumido por UI
- `pnpm smoke:api` si cambia endpoint o shape admin/API
- `supabase db reset` cuando la fase agrega o modifica migraciones

### Fases con DB destructive risk

- backup verificable previo
- prueba del camino de migración/rollback acordado en la fase
- nunca borrar tablas o columnas viejas en la misma fase que introduce el reemplazo

## Decisiones cerradas para este programa

- `Estado del sistema` se reemplaza conceptualmente por `Monitoreo`; la información hoy dispersa en health/costs/performance/system debe converger ahí.
- El sidebar admin pasa a tener grupos colapsables y buscador. La navegación existente puede reubicarse, pero no se eliminan capacidades sin un reemplazo funcional.
- Los backups manuales y los programados deben tener retención separada; los manuales no pueden ser barridos por la política de scheduled.
- `Composer` de discovery deja de ser discovery-only: el objetivo funcional es discovery con encadenamiento opcional de enrichment.
- `Jobs legacy` en discovery se considera deuda de UI y debe retirarse de la experiencia principal.
- El CRM nuevo usa tablas propias. No se reusa `outreach_campaigns` como modelo central del seguimiento; solo puede haber compatibilidad transitoria.
- La retroalimentación humana debe quedar persistida y trazable; no alcanza con un flag efímero en frontend.

## Histórico

- El roadmap largo previo queda archivado como contexto histórico del sistema y no como fuente de selección autónoma.
- `context/prompts/` sigue siendo archivo histórico; no usarlo como fuente canónica.
