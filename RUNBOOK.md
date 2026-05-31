# Blindspot — Runbook operativo

## Arquitectura de procesos

El modo operativo por defecto es **single-process**: el PipelineScheduler corre **embebido**
en la API (`EMBED_SCHEDULER=true`, ya presente en `.env.example`). Solo hacen falta **dos procesos**:

| Proceso | Comando | Responsabilidad |
|---------|---------|----------------|
| **api** | `pnpm --dir api dev` → `api/src/server.ts` (puerto 3001) | HTTP API + PipelineScheduler embebido (drena `pending` runs y `queued` discovery jobs, pg_notify listener) + backup scheduler |
| **ui** | `pnpm --dir ui dev` → Next.js dev server (puerto 3000) | Frontend |

El scheduler se inicia/reinicia desde la UI en **Operaciones → Procesos**.

> **Importante**: si la API arranca sin `EMBED_SCHEDULER=true` y no hay un proceso core
> aparte, los pipeline runs quedan en `pending` y los discovery jobs no se procesan,
> generando el error "A pipeline run is already in progress" indefinidamente.

## Arranque para demo / desarrollo

```bash
# Recomendado: dos terminales con scheduler embebido
pnpm --dir api dev   # API + PipelineScheduler embebido
pnpm --dir ui dev    # UI

# Alternativa: script todo-en-uno
./scripts/dev-all.sh
```

### Modo legacy — core como proceso separado (opcional)

Si se quiere correr el scheduler fuera de la API, poner `EMBED_SCHEDULER=false` y levantar
el core aparte:

```bash
pnpm start:core       # node --env-file=.env --import tsx/esm src/start.ts
# ⚠️  NO usar 'pnpm dev' para el core — eso arranca la CLI (src/cli/index.ts), no el scheduler.
pnpm --dir api dev
pnpm --dir ui dev
```

### Variables de entorno requeridas (`.env`)

```
SUPABASE_URL=http://127.0.0.1:54401   # o la URL de Supabase cloud
SUPABASE_SERVICE_ROLE_KEY=...
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54402/postgres  # para pg LISTEN
JWT_SECRET=...
GOOGLE_PLACES_API_KEY=...             # para discovery jobs Google Places
GEMINI_API_KEY=...                    # para AI features (optional)
```

## Migraciones

```bash
# Aplicar nuevas migraciones al Supabase local
supabase db push

# O manualmente vía Docker (proyecto gap-radar)
docker exec -i supabase_db_gap-radar psql -U postgres -d postgres \
  < supabase/migrations/<archivo>.sql
```

## Troubleshooting

### "A pipeline run is already in progress" (409)
- **Causa**: hay un run en estado `pending` colgado porque el scheduler no estaba corriendo.
- **Solución**: confirmar que la API arrancó con `EMBED_SCHEDULER=true` (o reiniciar el scheduler desde **Operaciones → Procesos**). Al iniciar, `recoverOrphanedRuns()` aborta automáticamente runs `running` colgados y `pending` con más de 1 hora. El scheduler luego drena los runs nuevos.
- **Verificar**: `logs/api.log` debe mostrar *"Pipeline scheduler started"* y *"Picked up pending run"*.

### Discovery jobs se crean pero no se ejecutan
- **Causa**: el scheduler no está corriendo.
- **Solución**: verificar `EMBED_SCHEDULER=true` y reiniciar el scheduler desde **Operaciones → Procesos** (o relanzar `pnpm --dir api dev`).
- **Verificar**: `logs/api.log` debe mostrar *"Discovery jobs processed"* periódicamente.

### 500 "Database error" al crear jobs con sugerencias predictivas
- **Causa original** (corregida en migración `20260528120000`): el constraint `triggered_by` de `discovery_jobs` no incluía `predictive_location`.
- **Si reaparece**: verificar que la migración fue aplicada: `\d discovery_jobs` → constraint debe incluir `predictive_location`.

### 500 "Reply was already sent" en rutas admin
- **Causa original** (corregida): `requireAdmin` hacía doble-reply cuando el token era inválido.
- **Si reaparece con token expirado**: verificar que `api/src/auth/middleware.ts` tiene `if (reply.sent) return;` tras `requireAuth`.

### Logs
- API: `logs/api.log`
- Core: stdout del proceso `pnpm dev`
- UI: `logs/ui.log` (si se usa `dev-all.sh`)

## Resetear la DB (solo desarrollo, NO usar en producción)
```bash
# ⚠️ Destruye todos los datos
supabase db reset
```
