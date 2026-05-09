# blindspot

CLI para identificar negocios locales con buena reputación offline pero pobre presencia digital.

**Lógica totalmente determinística** — sin LLMs, sin magia. Reglas con pesos configurables. Vos leés los reportes y tomás las decisiones comerciales.

---

## Requisitos

- Node.js 20+
- pnpm 9+
- Una cuenta de Supabase (puede ser free tier)
- Una API Key de Google Places (New)

---

## Setup

### 1. Clonar e instalar dependencias

```bash
git clone <repo>
cd gap-radar
pnpm install
```

### 2. Variables de entorno

```bash
cp .env.example .env
# Editá .env con tus valores reales
```

Variables requeridas:

| Variable | Descripción |
|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase (e.g. `https://xyz.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (en Settings > API de tu proyecto Supabase) |
| `GOOGLE_PLACES_API_KEY` | API Key con Places API (New) habilitada |
| `LOG_LEVEL` | `info` (default), `debug`, `warn`, `error` |

### 3. Base de datos — correr la migración

**Opción A — Supabase Dashboard (recomendada para empezar):**

1. Ir a [supabase.com](https://app.supabase.com) → tu proyecto → SQL Editor
2. Copiar y ejecutar el contenido de `db/migrations/001_initial.sql`

**Opción B — Supabase CLI:**

```bash
# Si tenés Supabase CLI instalada y el proyecto vinculado
supabase db push
```

### 4. Cómo obtener la API Key de Google Places

1. Ir a [Google Cloud Console](https://console.cloud.google.com/)
2. Crear o seleccionar un proyecto
3. Ir a **APIs & Services → Library**
4. Buscar y habilitar **"Places API (New)"** (¡ojo: es la nueva, no la legacy!)
5. Ir a **APIs & Services → Credentials → Create Credentials → API Key**
6. Opcional pero recomendado: restringir la key a Places API (New) solamente
7. Copiar la key y pegarla en `GOOGLE_PLACES_API_KEY` en tu `.env`

> **Costos estimados:** Text Search cuesta ~$0.032/solicitud, Place Details ~$0.017/solicitud.
> Para 50 resultados con detalles, estimá ~$1 por run. Activá alertas de billing en GCP.

---

## Uso

### Comando `discover`

```bash
# Perfil A — "Joya escondida" (rating alto, pocas reseñas, sin web real)
blindspot discover \
  --niche "peluquería" \
  --location "Montevideo Uruguay" \
  --profile a

# Perfil B — "Saturado sin web" (muchas reseñas, sin website)
blindspot discover \
  --niche "restaurante" \
  --location "Buenos Aires Argentina" \
  --profile b \
  --max-results 100

# Con overrides de rating
blindspot discover \
  --niche "taller mecánico" \
  --location "Salto Uruguay" \
  --profile a \
  --min-rating 4.5 \
  --max-results 30
```

#### Opciones

| Flag | Descripción | Default |
|---|---|---|
| `--niche` | Rubro a buscar | requerido |
| `--location` | Ubicación geográfica | requerido |
| `--profile` | `a` (joya escondida) o `b` (saturado sin web) | requerido |
| `--max-results` | Máximo de lugares a consultar en Places | `50` |
| `--min-rating` | Rating mínimo (override sobre el perfil) | `4.0` |

#### Perfiles de filtro

**Perfil A — "Joya escondida"**
- Rating ≥ 4.3
- Entre 10 y 50 reseñas
- Sin web real (ausente, o apunta a facebook.com / instagram.com / etc.)

**Perfil B — "Saturado sin web"**
- Más de 100 reseñas
- Sin website

#### Output de ejemplo

```
Run 3fa85f64-5717-4562-b3fc-2c963f66afa6 completado.
Descubiertos:      47
Pasaron filtros:   12
Nuevos:            9
Ya existían:       3
```

### Modo dev (sin build)

```bash
pnpm dev -- discover --niche "panadería" --location "Punta del Este" --profile a
```

---

## Desarrollo

```bash
pnpm test           # correr tests (vitest)
pnpm test:watch     # modo watch
pnpm typecheck      # TypeScript strict check
pnpm build          # producción (tsup → dist/)
```

---

## Estructura del proyecto

```
src/
  cli/
    index.ts                    # entrypoint Commander
    commands/
      discover.ts               # comando discover
  modules/
    discovery/
      places.ts                 # cliente Google Places API (New)
      filters.ts                # perfiles A/B con thresholds configurables
  shared/
    config.ts                   # validación zod de process.env
    logger.ts                   # pino singleton
    supabase.ts                 # cliente supabase singleton
    types.ts                    # tipos compartidos
  storage/
    leads.ts                    # CRUD leads (con dedupe por place_id)
    runs.ts                     # CRUD runs
  pipeline/
    run.ts                      # orquestador (esqueleto — Fase 2+)
config/
  scoring.yaml                  # placeholder pesos de scoring (Fase 3)
db/
  migrations/
    001_initial.sql             # schema inicial
tests/
  discovery/
    filters.test.ts             # tests de perfiles A y B
    fixtures/places.ts          # datos de prueba
```

---

## Roadmap

- **Fase 1** (actual): Discovery via Google Places + filtros por perfil + persistencia Supabase
- **Fase 2**: Análisis de presencia digital (scraping web, detección de píxeles, WhatsApp, etc.)
- **Fase 3**: Scoring determinístico con pesos configurables via `config/scoring.yaml`
- **Fase 4**: Reportes (Handlebars templates, CSV export)
- **Fase 5**: Estado de leads (contactado, calificado, descartado) + notas
