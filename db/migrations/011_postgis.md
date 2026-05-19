# Migration 011: PostGIS activation

Fase 21 requiere un paso manual/env-specific para la extension y un paso SQL normal
para el schema de `gps`.

## Local Docker

Ejecutar antes de `011_add_gps.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

Comando usado en la fase autonoma:

```bash
docker exec supabase_db_gap-radar psql -U postgres -d postgres -c "CREATE EXTENSION IF NOT EXISTS postgis;"
```

## Supabase Cloud

No correr `CREATE EXTENSION` via migration runner. Habilitar `postgis` desde:

`Dashboard -> Database -> Extensions -> postgis -> Enable`

Luego aplicar el SQL normal de schema/backfill (`011_add_gps.sql` o su equivalente en
`supabase/migrations/`).

## Backfill canónico actual

- Backfillear `leads.gps` solo desde fuentes con coordenadas persistidas y confiables.
- En el estado actual del repo, eso significa filas `source='osm'` con
  `source_data.lat` y `source_data.lon`.
- No usar MINTUR para GPS.
- Google Places no se backfillea en esta fase porque el pipeline actual persiste
  `latitude/longitude = null`.
