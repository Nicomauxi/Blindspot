# Blindspot — Runbook operativo

## Contexto canónico

- Bootstrap y arranque rápido: [README.md](/home/nicolasfalcioni/Documentos/blindspot/README.md)
- Arquitectura vigente: [context/ARCHITECTURE.md](/home/nicolasfalcioni/Documentos/blindspot/context/ARCHITECTURE.md)
- Guardrails de ejecución: [context/SECURITY.md](/home/nicolasfalcioni/Documentos/blindspot/context/SECURITY.md)

## Arquitectura de procesos

El modo operativo por defecto es **single-process**: el `PipelineScheduler` corre **embebido**
en la API (`EMBED_SCHEDULER=true`, ya presente en `.env.example`). Solo hacen falta **dos procesos**:

| Proceso | Comando | Responsabilidad |
|---------|---------|----------------|
| **api** | `pnpm --dir api dev` → `api/src/server.ts` (puerto 3001) | HTTP API + PipelineScheduler embebido (drena `pending` runs y `queued` discovery jobs, `pg_notify`) + backup scheduler |
| **ui** | `pnpm --dir ui dev` → Next.js dev server (puerto 3000) | Frontend |

El scheduler se inicia/reinicia desde la UI en **Operaciones → Procesos**.

> Si la API arranca sin `EMBED_SCHEDULER=true` y no hay un proceso core aparte, los pipeline runs quedan en `pending` y los discovery jobs no se procesan.

## Arranque para demo / desarrollo

```bash
pnpm --dir api dev
pnpm --dir ui dev
```

Alternativa todo-en-uno:

```bash
./scripts/dev-all.sh
```

### Modo legacy — core como proceso separado

Si se quiere correr el scheduler fuera de la API, poner `EMBED_SCHEDULER=false` y levantar el core aparte:

```bash
pnpm start:core
pnpm --dir api dev
pnpm --dir ui dev
```

No usar `pnpm dev` para el core: eso arranca la CLI (`src/cli/index.ts`), no el scheduler.

### Variables de entorno requeridas (`.env`)

```dotenv
SUPABASE_URL=http://127.0.0.1:54401
SUPABASE_SERVICE_ROLE_KEY=...
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54402/postgres
API_JWT_SECRET=...
EMBED_SCHEDULER=true
GOOGLE_PLACES_API_KEY=...      # solo para discovery real con Google Places
NEXT_PUBLIC_API_URL=http://localhost:3001
GEMINI_API_KEY=...             # opcional para features LLM
SEARXNG_URL=http://localhost:8080  # opcional, métricas IG vía SearXNG (ig-snippet-enrich)
```

El runtime LLM también acepta `GOOGLE_GEMINI_API_KEY`, `VITE_GOOGLE_GEMINI_API_KEY` y `OPENAI_COMPAT_*`.

## Enriquecimiento de métricas IG (SearXNG self-hosted)

El comando `ig-snippet-enrich` obtiene followers/following/posts de IG ($0, legal) leyendo el
snippet (`og:description`) que devuelve un **SearXNG** local. Las APIs de búsqueda gratis 2026
(Brave/Google CSE/SerpApi) no sirven (ToS, cerradas o evaden anti-bot); SearXNG self-host es el
único camino $0+legal (agrega buscadores; resiliente al anti-bot de uno puntual).

```bash
# 1. Levantar SearXNG con JSON habilitado:
docker run -d --name searxng -p 8080:8080 -v <cfg>:/etc/searxng searxng/searxng
#    settings.yml debe tener:  search.formats: [html, json]  y  server.limiter: false
# 2. Correr el enrich (prioriza por prospect_score; salta ya-resueltos; marca no_data):
node --env-file=.env --import tsx/esm src/cli/index.ts ig-snippet-enrich --all --throttle-ms 1500
```

Hit-rate esperable ~58% (los misses son cuentas personales sin métricas públicas). `--retry-no-data`
re-consulta los previamente marcados sin métricas.

## Migraciones

```bash
supabase db push
```

Si necesitás una base local limpia:

```bash
supabase db reset
```

Aplicación manual por Docker solo si el flujo normal falla:

```bash
docker exec -i supabase_db_gap-radar psql -U postgres -d postgres \
  < supabase/migrations/<archivo>.sql
```

## Troubleshooting

### `A pipeline run is already in progress` (409)
- Causa: hay un run `pending` colgado porque el scheduler no estaba corriendo.
- Solución: confirmar `EMBED_SCHEDULER=true` o reiniciar el scheduler desde **Operaciones → Procesos**.
- Verificar: `logs/api.log` debe mostrar `Pipeline scheduler started` y `Picked up pending run`.

### Discovery jobs se crean pero no se ejecutan
- Causa: el scheduler no está corriendo.
- Solución: verificar `EMBED_SCHEDULER=true` y reiniciar el scheduler desde **Operaciones → Procesos**.
- Verificar: `logs/api.log` debe mostrar actividad periódica de discovery jobs.

### 500 `Database error` al crear jobs con sugerencias predictivas
- Causa original: el constraint `triggered_by` de `discovery_jobs` no incluía `predictive_location`.
- Si reaparece: verificar que la migración `20260528120000` fue aplicada.

### 500 `Reply was already sent` en rutas admin
- Causa original: `requireAdmin` hacía doble-reply cuando el token era inválido.
- Si reaparece: verificar que `api/src/auth/middleware.ts` conserva `if (reply.sent) return;` tras `requireAuth`.

### Logs
- API: `logs/api.log`
- UI: `logs/ui.log` si se usa `dev-all.sh`
- Core separado: stdout del proceso `pnpm start:core`

## Resetear la DB

```bash
supabase db reset
```

Es destructivo y solo corresponde a desarrollo local.
