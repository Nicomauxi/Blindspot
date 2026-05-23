# Blindspot — Project Master

> Runbook operativo del repo para ejecución directa.
> Leer junto con `ROADMAP_CANONICAL.md`, `FUTURE.md`, `ARCHITECTURE.md`,
> `ARCHITECTURE_FUTURE.md`, `ARCHITECTURE_FRONTEND.md`, `ADMIN_PANEL.md`
> y `SECURITY.md` al iniciar una sesión de implementación.
>
> Si se adjunta este archivo solo, la intención es retomar el estado descrito al final.

---

## Objetivo del producto

Blindspot es una herramienta interna para detectar, enriquecer, priorizar y operar
leads de negocios locales con brechas digitales. Hoy ya cuenta con pipeline,
API, UI admin, backups y restauración. El foco actual es elevar la operación,
la observabilidad, la UX de discovery y convertir el seguimiento comercial en un
CRM real con feedback humano estructurado.

## Modelo de uso vigente

- 1 admin principal
- 2–8 usuarios comerciales
- repo único: `src/`, `api/`, `ui/`
- dos procesos de aplicación: `api` y `core`
- Supabase local como entorno operativo base

## Principios de ejecución actuales

1. El roadmap vigente es el de `ROADMAP_CANONICAL.md`.
2. La planificación detallada por fase está en `FUTURE.md`.
3. La ejecución por defecto es directa/autónoma, no handoff a otra sesión.
4. No rehacer la remediación ya cerrada salvo evidencia de regresión real.
5. Mantener fases chicas, verificables y con contexto sincronizado.
6. No revertir ni pisar cambios ajenos del worktree; si la próxima fase entra en conflicto real con trabajo existente, resolver primero el conflicto o detenerse con contexto claro.

## Snapshot funcional actual

### Ya implementado

- baseline DB reproducible y migraciones ordenadas
- API Fastify con auth/RBAC y pantallas admin operativas
- backups manuales y programados desde UI
- restore administrativo con checkpoint previo
- páginas admin actuales: leads, lead detail, outreach, discovery, pipeline, backups, costs, performance, health, users, audit log, help
- pipeline core persistente con polling/listener/scheduler
- repoblación reciente por discovery completada sobre la base actual

### Gaps principales del programa vigente

- monitoreo fragmentado entre health/system/costs/performance
- monitoreo fragmentado entre health/system/costs/performance
- no hay dark mode
- density map no está apoyado sobre mapa real
- backups aún no separan retención manual vs scheduled
- discovery workspace todavía tiene deuda de UX y orquestación
- MINTUR sigue aportando demasiado `other`
- no existe feedback humano estructurado sobre calidad de datos
- el flujo comercial sigue modelado alrededor de campañas/outreach y no de un CRM de seguimiento

## Orden de lectura por área

- Navegación, theme, discovery y CRM UI: `ARCHITECTURE_FRONTEND.md`
- Monitoreo, backups y CRM admin: `ADMIN_PANEL.md`
- Cambios de datos o modelos nuevos: `ARCHITECTURE_FUTURE.md`
- Estado real implementado: `ARCHITECTURE.md`

## ESTADO DE SESIÓN

**Fecha:** 2026-05-22

**Contexto sincronizado:** sí, `CTX-0` completo.

**Snapshot operativo conocido:**
- remediación integral cerrada
- backup/restore ya operativos
- discovery reciente terminado con base repoblada
- enrich parcial, no bloqueante para este programa de mejoras
- `NAV-1` cerrado: sidebar admin con grupos colapsables, buscador, iconografía consistente y fix de keys duplicadas en health
- `THEME-1` cerrado: dark mode admin con toggle persistido, tokens compartidos y shell/superficies críticas cubiertas
- `MON-1` cerrado: contrato backend `admin/monitoring/overview` agregado sin romper endpoints legacy; smoke API sigue fallando por `backup_restore_failed` ya presente en health
- `MON-2` cerrado: nueva pantalla `Monitoreo` consume el contrato unificado y `/admin/health` queda como alias por redirect

**Programa activo:**
- `CTX-0` done
- `NAV-1` done
- `THEME-1` done
- `MON-1` done
- `MON-2` done
- próxima fase: `BKP-1`

**Objetivo inmediato de la siguiente sesión:**
- ejecutar `BKP-1`
- separar retención de backups manuales vs programados en config/servicio/UI
- exponer peso actual de DB y métricas operativas asociadas en backups/monitoreo

**Lo que no hacer al retomar:**
- no volver a planificar desde cero el roadmap histórico
- no correr discovery billable por costumbre
- no mezclar `BKP-1` con monitoreo visual nuevo, discovery o CRM en el mismo diff
