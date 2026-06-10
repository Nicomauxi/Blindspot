# blindspot

Blindspot detecta, enriquece y prioriza leads de negocios locales con brechas digitales. El repo tiene tres superficies:

- `src/`: CLI y pipeline principal
- `api/`: API Fastify para panel/admin
- `ui/`: panel Next.js

## Contexto canónico

Para entender el sistema antes de tocar código, empezá por [context/README.md](/home/nicolasfalcioni/Documentos/blindspot/context/README.md).

- Estado actual del producto: [context/PROJECT_MASTER.md](/home/nicolasfalcioni/Documentos/blindspot/context/PROJECT_MASTER.md)
- Arquitectura real: [context/ARCHITECTURE.md](/home/nicolasfalcioni/Documentos/blindspot/context/ARCHITECTURE.md)
- Guardrails operativos: [context/SECURITY.md](/home/nicolasfalcioni/Documentos/blindspot/context/SECURITY.md)
- Operación diaria: [RUNBOOK.md](/home/nicolasfalcioni/Documentos/blindspot/RUNBOOK.md)

## Requisitos

- Node.js 20+
- `pnpm` 10+
- Supabase CLI
- una `.env` válida

## Variables de entorno

Copiá `.env.example` a `.env` y completá lo mínimo para desarrollo local:

| Variable | Uso |
| --- | --- |
| `SUPABASE_URL` | URL del stack local o remoto de Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key |
| `DATABASE_URL` | conexión directa a Postgres para `pg`/scheduler |
| `API_JWT_SECRET` | obligatoria para levantar `api/` |
| `EMBED_SCHEDULER` | `true` para el modo local normal |
| `GOOGLE_PLACES_API_KEY` | obligatoria solo si vas a correr discovery real con Google Places |
| `NEXT_PUBLIC_API_URL` | opcional en UI, default `http://localhost:3001` |
| `GEMINI_API_KEY` | opcional para features LLM |
| `SEARXNG_URL` | opcional, default `http://localhost:8080`; SearXNG self-hosted para enriquecer métricas de IG (comando `ig-snippet-enrich`) |

El runtime LLM también acepta `GOOGLE_GEMINI_API_KEY`, `VITE_GOOGLE_GEMINI_API_KEY` y `OPENAI_COMPAT_*`, pero no son necesarias para arrancar el sistema base.

## Arranque local

1. Instalar dependencias:

```bash
pnpm install
```

2. Levantar Supabase local:

```bash
supabase start
```

3. Aplicar schema local limpio cuando haga falta:

```bash
supabase db reset
```

4. Levantar API + scheduler embebido:

```bash
pnpm --dir api dev
```

5. Levantar UI:

```bash
pnpm --dir ui dev
```

URLs locales:

- UI: `http://localhost:3000/login`
- API health: `http://127.0.0.1:3001/api/v1/health`
- Supabase Studio: `http://127.0.0.1:54403`

El modo operativo normal es `EMBED_SCHEDULER=true`: con `pnpm --dir api dev` alcanza para API + pipeline. El modo legacy con core separado sigue disponible con `pnpm start:core`, pero no es el flujo recomendado.

## Comandos útiles

Ayuda de CLI:

```bash
pnpm dev -- --help
```

Pipeline integral:

```bash
node --env-file=.env --import tsx/esm src/cli/index.ts run \
  --niche "restaurante" \
  --location "Montevideo Uruguay" \
  --profile b \
  --max-results 5
```

Enriquecimiento:

```bash
node --env-file=.env --import tsx/esm src/cli/index.ts enrich \
  --run <run_id> \
  --with-heuristic \
  --force-refresh \
  --concurrency 1
```

Social enrich:

```bash
node --env-file=.env --import tsx/esm src/cli/index.ts social-enrich \
  --all \
  --limit 10 \
  --force
```

Métricas IG vía SearXNG self-hosted (gratis, $0; requiere `SEARXNG_URL` arriba):

```bash
node --env-file=.env --import tsx/esm src/cli/index.ts ig-snippet-enrich \
  --all \
  --limit 20 \
  --throttle-ms 1500
```

Scoring:

```bash
node --env-file=.env --import tsx/esm src/cli/index.ts score \
  --run <run_id> \
  --buyer-types
```

Reportes:

```bash
node --env-file=.env --import tsx/esm src/cli/index.ts report \
  --run <run_id> \
  --format all
```

## Verificación

```bash
pnpm test
pnpm typecheck
pnpm --dir ui typecheck
pnpm --dir ui build
pnpm smoke:api
```

Health check:

```bash
curl http://127.0.0.1:3001/api/v1/health
```

Si `invariants.lead_dashboard_schema_current=false`, hay drift entre migraciones y la base.

## Notas operativas

- `discover-google-places` consume Google Places. Usá `--max-results` bajo para pruebas manuales.
- No hay self-registration. Para entrar al panel necesitás un usuario en la tabla `users`.
- Para troubleshooting operativo, scheduler y logs, usar [RUNBOOK.md](/home/nicolasfalcioni/Documentos/blindspot/RUNBOOK.md).
