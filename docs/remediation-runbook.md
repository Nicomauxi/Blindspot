# Blindspot Remediation Runbook

## Local Safety Sequence

1. Backup verificable antes de cualquier reset o cambio destructivo:

```bash
BACKUP_TAG=pre-remediacion BLINDSPOT_BACKUP_DIR="$HOME/blindspot-backups" bash scripts/backup.sh
```

2. Verificar que el directorio exista y sea escribible:

```bash
mkdir -p "$HOME/blindspot-backups"
test -w "$HOME/blindspot-backups"
```

3. Verificar el stack local:

```bash
supabase status
```

4. Recrear baseline local limpio:

```bash
supabase db reset
```

5. Validar contratos mínimos reales:

```bash
pnpm smoke:api
pnpm test
pnpm typecheck
pnpm --dir ui typecheck
pnpm --dir ui build
```

## Operación de backups

### Backup manual

- Desde UI: `Admin > Backups > Ejecutar backup ahora`.
- Desde shell: `BACKUP_TAG=manual BLINDSPOT_BACKUP_DIR="<dir>" bash scripts/backup.sh`.
- Si el directorio no existe o no tiene permisos, la API devuelve un error operativo claro y el intento queda registrado como fallido.

### Programación

- La configuración vive en `backup_config`.
- `enabled` activa o desactiva el scheduler.
- `cron_expression` usa sintaxis cron estándar de cinco campos.
- `directory` puede quedar vacío; en ese caso el runtime resuelve `BLINDSPOT_BACKUP_DIR` y si no existe usa `$HOME/blindspot-backups`.
- `max_backups` define la retención por cantidad. Siempre se conservan los `N` más recientes.

### Retención

- La limpieza corre al finalizar cada backup exitoso.
- La política es determinística por `created_at DESC`.
- Los excedentes se eliminan del disco y se marcan con `deleted_at` en `backup_runs`.
- Si la limpieza falla, el backup principal sigue registrado y el error queda visible en Admin/Health.

### Ubicación de archivos

- Ruta efectiva: `backup_config.directory ?? BLINDSPOT_BACKUP_DIR ?? $HOME/blindspot-backups`.
- El directorio debe existir, ser absoluto y tener permisos de escritura.
- El archivo resultante usa el patrón `blindspot_<trigger>_<timestamp>.sql.gz`.

## Restore local

### Restore desde UI

- Ir a `Admin > Backups`.
- Elegir un backup `completed` y usar `Restaurar`.
- Confirmar la acción. La confirmación dispara un flujo destructivo sobre la DB activa.
- Antes de restaurar, el sistema crea automáticamente un checkpoint del estado actual con propósito `restore_checkpoint`.
- Durante el restore, `backup_config.maintenance_mode=true` y se pausan el scheduler de backups y el polling del pipeline.
- Al terminar, Admin/Health muestran el último restore, su estado y el checkpoint generado.

### Restore desde shell

El flujo seguro de restore local reutiliza el script operativo:

```bash
BLINDSPOT_RESTORE_FILE="$HOME/blindspot-backups/<backup>.sql.gz" bash scripts/restore.sh
```

### Qué hace el restore

- valida integridad gzip antes de tocar la DB
- genera un checkpoint previo obligatorio desde la capa operativa
- reemplaza el contenido de la DB activa local de Supabase
- reaplica la cadena completa de `supabase/migrations`
- deja trazabilidad en `backup_restores` y en `backup_runs`

### Cómo volver atrás

- Si el restore falla antes de reemplazar la DB, el restore queda `failed` y el checkpoint sigue disponible.
- Si el restore completa pero querés revertir el estado, restaurá desde `Admin > Backups` usando el checkpoint `restore_checkpoint` que quedó creado justo antes del restore.
- Los checkpoints participan de la retención por cantidad igual que cualquier otro backup. Si necesitás conservar uno, aumentá `max_backups` antes de ejecutar limpiezas posteriores.

## Ruta de upgrade sobre DB existente

Para una base existente con datos:

1. sacar backup verificable
2. restaurar el backup en una copia local
3. aplicar la cadena `supabase/migrations`
4. ejecutar `pnpm smoke:api` y tests focalizados
5. comparar invariantes finales contra una DB fresh

## Invariantes mínimas de salida

- `GET /api/v1/health` -> `200`
- `invariants.lead_dashboard_schema_current=true`
- `GET /api/v1/admin/backups` -> `200` para admin
- login `admin@blindspot.local` y `cm@blindspot.local`
- `GET /api/v1/leads`, `/campaigns`, `/outreach`, `/discovery/jobs`, `/discovery/job-batches`, `/pipeline/config` responden sobre DB limpia
- CM recibe `403` en `/api/v1/users` y `/api/v1/admin/backups`
