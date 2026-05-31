# DISC-15 - Semilla XLS inicial para importacion de lugares

## Objetivo

Dejar un seed `.xlsx` pequeno, trazable y util para probar `Plataforma > Importacion`, filtros de zona y ranking predictivo sin correr discovery billable.

- Archivo generado: `tests/discovery/fixtures/uruguay-location-seed.xlsx`
- Fuente editable: `tests/discovery/fixtures/uruguay-location-seed.ts`
- Generador reproducible: `scripts/generate-location-seed.ts`

## Metodologia

1. Se eligieron ubicaciones uruguayas de alta recordacion comercial o turistica para cubrir varios kinds del contrato actual: `departamento`, `ciudad`, `barrio`, `zona_turistica` y `avenida`.
2. Cada fila conserva trazabilidad compacta en `notes` con el patron `SRC:...` porque el contrato vigente de `DISC-12` no acepta columnas extra tipo `source_name` o `source_url`.
3. Las coordenadas son centroides operativos aproximados, suficientes para preview, filtros y ranking inicial; no se presentan como cartografia oficial de precision.
4. Para no romper el validador de importacion, todas las coordenadas quedan dentro de los bounds duros del sistema (`lat -35..-30`, `lng -58..-53`).

## Codigos de fuente

| Codigo | Tipo | Uso en seed | URL de referencia |
| --- | --- | --- | --- |
| `IMM-MVD` | oficial | Montevideo departamento, ciudad, barrios y Av. 18 de Julio | `https://montevideo.gub.uy/` |
| `IDC-CAN` | oficial | Canelones departamento y Las Piedras | `https://www.imcanelones.gub.uy/` |
| `IDM-MAL` | oficial | Maldonado, Punta del Este, Piriapolis, Gorlero, Peninsula, Puerto, La Barra | `https://www.maldonado.gub.uy/` |
| `IDR-ROCHA` | oficial | Rocha, La Paloma y Puerto de La Paloma | `https://www.rocha.gub.uy/` |
| `IDS-SALTO` | oficial | Salto y Termas del Dayman | `https://www.salto.gub.uy/` |
| `IDP-PDU` | oficial | Paysandu y Av. Espana | `https://www.paysandu.gub.uy/` |
| `IDC-COL` | oficial | Colonia y Barrio Historico | `https://www.colonia.gub.uy/` |
| `MINTUR-UY` | oficial | Refuerzo para polos turisticos y balnearios | `https://www.gub.uy/ministerio-turismo/` |
| `OSM-MANUAL` | abierto | Ajuste manual de centroides aproximados compatibles con el validador | `https://www.openstreetmap.org/` |

## Cobertura del archivo

- 7 departamentos
- 9 ciudades
- 6 barrios montevideanos
- 6 zonas turisticas
- 4 avenidas/corredores
- 32 filas validas en total

## Muestreo manual de coherencia (20 filas)

| location_key | display_name | kind | parent_location | Chequeo manual |
| --- | --- | --- | --- | --- |
| `montevideo-departamento` | Montevideo (Departamento) | departamento | - | cabecera administrativa valida |
| `maldonado-departamento` | Maldonado (Departamento) | departamento | - | departamento turistico valido |
| `rocha-departamento` | Rocha (Departamento) | departamento | - | departamento costero valido |
| `salto-departamento` | Salto (Departamento) | departamento | - | nodo termal/comercial valido |
| `colonia-departamento` | Colonia (Departamento) | departamento | - | departamento turistico/logistico valido |
| `montevideo` | Montevideo | ciudad | Montevideo (Departamento) | ciudad capital valida |
| `las-piedras` | Las Piedras | ciudad | Canelones (Departamento) | ciudad metropolitana valida |
| `punta-del-este` | Punta del Este | ciudad | Maldonado (Departamento) | ciudad turistica valida |
| `piriapolis` | Piriapolis | ciudad | Maldonado (Departamento) | ciudad balnearia valida |
| `la-paloma` | La Paloma | ciudad | Rocha (Departamento) | balneario/ciudad valida |
| `salto` | Salto | ciudad | Salto (Departamento) | capital departamental valida |
| `paysandu` | Paysandu | ciudad | Paysandu (Departamento) | capital departamental valida |
| `colonia-del-sacramento` | Colonia del Sacramento | ciudad | Colonia (Departamento) | ciudad historica valida |
| `ciudad-vieja-mvd` | Ciudad Vieja | barrio | Montevideo | barrio historico/comercial valido |
| `centro-mvd` | Centro | barrio | Montevideo | centralidad comercial valida |
| `pocitos-mvd` | Pocitos | barrio | Montevideo | barrio denso en servicios valido |
| `avenida-18-de-julio` | Av. 18 de Julio | avenida | Montevideo | corredor comercial valido |
| `peninsula-pde` | Peninsula | zona_turistica | Punta del Este | polo turistico valido |
| `barrio-historico-colonia` | Barrio Historico | zona_turistica | Colonia del Sacramento | cluster turistico valido |
| `termas-del-dayman` | Termas del Dayman | zona_turistica | Salto | polo termal valido |

Resultado del muestreo: `20/20` filas coherentes para uso operativo inicial.

## Validacion ejecutada

- `pnpm exec tsx scripts/generate-location-seed.ts`
- preview real del archivo via test API (`POST /api/v1/admin/imports/locations/preview`)
- `pnpm test`
- `pnpm smoke:api`
- `pnpm typecheck`

## Notas operativas

- El seed no dispara importacion automatica ni jobs de discovery.
- El archivo es liviano y apto para commit en repo.
- Si en fases futuras se agregan columnas de trazabilidad nativas (`source_name`, `source_url`), el generador puede promover los codigos `SRC:*` desde `notes` a columnas dedicadas.
