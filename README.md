# blindspot

Blindspot detecta negocios locales con reputación offline fuerte y brechas digitales accionables. El repo tiene tres superficies:

- `src/`: CLI y pipeline principal
- `api/`: API Fastify para panel/admin
- `ui/`: panel Next.js

El stack real usa Supabase/Postgres local, discovery multi-source, enriquecimiento heurístico/social, scoring v2, buyer scores, campañas y panel admin.

## Estructura del repositorio

- `src/`: CLI y pipeline principal
- `api/`: API Fastify y scheduler embebible
- `ui/`: panel Next.js
- `supabase/`: migraciones y configuración local
- `tests/`: pruebas de API y discovery

## Requisitos

- Node.js 20+
- `pnpm` 10+
- Supabase CLI
- Una `.env` válida
- Google Places API Key si vas a correr `discover-google-places`

## Variables de entorno

Variables mínimas para desarrollo local:

| Variable | Uso |
| --- | --- |
| `SUPABASE_URL` | URL del stack local o remoto de Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key |
| `DATABASE_URL` | Conexión directa a Postgres |
| `API_JWT_SECRET` | Obligatoria para levantar `api/` |
| `GOOGLE_PLACES_API_KEY` | Obligatoria para discovery con Google Places |
| `LOG_LEVEL` | `info`, `debug`, `warn`, `error` |
| `CORS_ORIGIN` | Opcional, default `http://localhost:3000` |
| `PORT` | Opcional, default `3001` para el API |
| `NEXT_PUBLIC_API_URL` | Opcional en UI, default `http://localhost:3001` |

## Base local

Levantar Supabase local:

```bash
supabase start
```

Aplicar el schema local desde `supabase/migrations/`:

```bash
supabase db reset
```

Si trabajás contra un proyecto remoto linkeado:

```bash
supabase db push
```

Si `supabase db push` falla con `Cannot find project ref`, no está linkeado; usá `supabase db reset` para local o conectate por `psql`/SQL Editor al destino correcto.

## Bootstrap de usuario admin

No hay self-registration. Para entrar al panel necesitás un usuario en la tabla `users`.

Generá el hash:

```bash
node -e "import bcrypt from 'bcryptjs'; bcrypt.hash('tu_password_segura', 12).then(console.log)"
```

Insertalo:

```sql
INSERT INTO users (email, password_hash, role)
VALUES ('admin@blindspot.local', '$2b$12$<hash>', 'admin');
```

## Instalar dependencias

```bash
pnpm install
```

## Levantar el sistema

CLI / comandos manuales:

```bash
pnpm dev -- --help
```

API local:

```bash
pnpm --dir api dev
```

UI local:

```bash
pnpm --dir ui dev
```

URLs locales:

- UI: `http://localhost:3000/login`
- API health: `http://127.0.0.1:3001/api/v1/health`
- Supabase Studio: `http://127.0.0.1:54403`

## Comandos útiles

Discovery Google Places:

```bash
node --env-file=.env --import tsx/esm src/cli/index.ts discover-google-places \
  --niche "restaurante" \
  --location "Montevideo Uruguay" \
  --profile b \
  --max-results 5
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

Inferencia de estado:

```bash
node --env-file=.env --import tsx/esm src/cli/index.ts infer-state \
  --all \
  --force \
  --concurrency 20
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

Listar leads de una corrida:

```bash
node --env-file=.env --import tsx/esm src/cli/index.ts leads list \
  --seen-in <run_id> \
  --passed-only \
  --format json
```

## Verificación

Suite principal:

```bash
pnpm test
pnpm typecheck
```

Smoke API contra DB local limpia:

```bash
pnpm smoke:api
```

Runbook operativo: [docs/remediation-runbook.md](/home/nicolasfalcioni/Documentos/blindspot/docs/remediation-runbook.md)

Frontend:

```bash
pnpm --dir ui typecheck
pnpm --dir ui build
```

Health check en vivo:

```bash
curl http://127.0.0.1:3001/api/v1/health
```

El `health` valida también que `lead_dashboard` tenga el schema esperado. Si `invariants.lead_dashboard_schema_current=false`, hay drift de migraciones entre código y base.

## Levantar el entorno local

Modo real por defecto:

1. Supabase local
2. API HTTP (`api/`) con scheduler embebido
3. UI Next (`ui/`)

El scheduler/pipeline corre embebido en la API cuando `EMBED_SCHEDULER=true` (modo operativo normal).
`src/start.ts` sigue existiendo como modo opcional/manual para correr el core separado, pero no es el
flujo principal de desarrollo local.

Secuencia recomendada desde la raíz del repo:

1. Instalar dependencias:

```bash
pnpm install
```

2. Levantar Supabase:

```bash
pnpm supabase start
```

3. Resetear baseline local cuando necesites base limpia:

```bash
supabase db reset
```

4. Levantar la API HTTP:

```bash
pnpm --dir api start
```

5. Levantar la UI:

```bash
pnpm --dir ui dev
```

6. Levantar el core pipeline persistente:

```bash
node --env-file=.env --import tsx/esm src/start.ts
```

URLs útiles:

- UI: `http://127.0.0.1:3000`
- API: `http://127.0.0.1:3001`
- Health: `http://127.0.0.1:3001/api/v1/health`
- Supabase Studio: `http://127.0.0.1:54403`

Credenciales seed locales:

- Admin: `admin@blindspot.local` / `admin_local_2026`
- CM: `cm@blindspot.local` / `cm_local_2026`

## Backups y restore

Backups desde el panel:

- `Admin > Backups > Ejecutar backup ahora` dispara un backup manual aunque haya cron activo.
- La configuración permite definir `enabled`, `cron_expression`, `directory` y `max_backups`.
- El directorio efectivo es `backup_config.directory ?? BLINDSPOT_BACKUP_DIR ?? $HOME/blindspot-backups`.
- La retención elimina determinísticamente los excedentes y conserva los `N` backups más recientes.

Restore desde el panel:

- En `Admin > Backups`, cada backup `completed` expone la acción `Restaurar`.
- El restore reemplaza la DB local activa y por eso exige confirmación explícita.
- Antes de restaurar, el sistema crea un checkpoint automático `restore_checkpoint`.
- Durante el restore, el sistema entra en mantenimiento y pausa backup scheduler y pipeline polling.
- Si necesitás deshacer el restore, podés restaurar el checkpoint recién creado desde la misma pantalla.

Comandos shell equivalentes:

```bash
BACKUP_TAG=manual BLINDSPOT_BACKUP_DIR="$HOME/blindspot-backups" bash scripts/backup.sh
BLINDSPOT_RESTORE_FILE="$HOME/blindspot-backups/<backup>.sql.gz" bash scripts/restore.sh
```

### Pipeline manual puntual

Si querés disparar un run completo una sola vez, además del proceso persistente podés ejecutar:

```bash
pnpm dev pipeline --run-all
```

Opciones útiles:

```bash
pnpm dev pipeline --run-all --dry-run
pnpm dev pipeline --run-all --cpu-budget conservative
pnpm dev pipeline --run-all --phases refresh,discovery,enrich,score
```

## Smoke test E2E recomendado

Secuencia mínima validada en local:

1. `pnpm supabase start`
2. `supabase db reset`
3. `pnpm install`
4. Levantar API con `pnpm --dir api start`
5. Levantar UI con `pnpm --dir ui dev`
6. Levantar core pipeline con `node --env-file=.env --import tsx/esm src/start.ts`
7. Correr discovery real pequeño con Google Places
8. Correr `enrich --run <run_id> --with-heuristic`
9. Correr `social-enrich --all --limit 1 --force`
10. Correr `infer-state --all --force`
11. Correr `score --run <run_id> --buyer-types`
12. Correr `report --run <run_id> --format all`
13. Verificar `/api/v1/health`, login en `/login` y lectura de un lead por API

## Costos

`discover-google-places` consume Google Places. Para pruebas manuales:

- usá `--max-results` bajo
- evitá repetir búsquedas amplias sin necesidad
- monitoreá billing en GCP

Referencia práctica: `max-results 3..5` sirve para smoke tests con costo bajo.
