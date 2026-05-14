# MINTUR — Investigación de fuente

> Investigado: 2026-05-13 vía Gemini DeepSearch.

## Acceso

| Campo | Valor |
|-------|-------|
| Endpoint | `https://catalogodatos.gub.uy/api/3/action/datastore_search` |
| Resource ID | `eb614f27-36d8-4a34-8bbf-ed5c40473df0` |
| Autenticación | Ninguna |
| Actualización | Diaria |
| Licencia | Datos Abiertos Uruguay — Decreto 54/017. Uso comercial OK con nota de origen. |

## Campos disponibles

| Campo en API | Tipo | Notas |
|---|---|---|
| `Operador` | string | Nombre comercial o razón social |
| `Direccion` | string | Texto libre — puede incluir "S/N" o km de ruta |
| `Departamento` | string | MAYÚSCULAS — uno de los 19 departamentos de UY |
| `Localidad` | string | Ciudad o zona dentro del departamento |
| `Web` | string | Puede estar vacío |
| `Telefono` | string | Texto libre; múltiples números separados por ` - ` (ej: `"47725996 - 097226790"`) |
| `Email` | string | Email corporativo. Puede estar vacío |
| `_id` | integer | Auto-increment CKAN — no es RUT ni identificador oficial |

**Ausentes:**
- **GPS (lat/lng)** — no existe en el dataset público. Requeriría geocodificación externa.
- **RUT** — no expuesto por normativa de disociación de datos.

## Ejemplos de registros reales

```json
{ "_id": 1, "Operador": "COTABU S.R.L.", "Direccion": "LUIS ALBERTO DE HERRERA S/N",
  "Departamento": "ARTIGAS", "Localidad": "ARTIGAS", "Web": "", "Telefono": "47725996",
  "Email": "cotabu@vera.com.uy" }

{ "_id": 2, "Operador": "JOTA ELE VIAJES S.R.L.", "Direccion": "LUIS ALBERTO DE HERRERA S/N",
  "Departamento": "ARTIGAS", "Localidad": "ARTIGAS", "Web": "www.jotaele.com.uy",
  "Telefono": "47725996", "Email": "jotaelev@vera.com.uy" }

{ "_id": 3, "Operador": "BUQUEBUS", "Direccion": "RUTA 101 KILOMETRO 19950",
  "Departamento": "CANELONES", "Localidad": "AEROPUERTO", "Web": "www.buquebus.com.uy",
  "Telefono": "26046711", "Email": "janido@buquebus.com.uy" }
```

## Cobertura y alcance

- **Solo turismo habilitado formalmente**: hoteles, agencias de viajes, rentadoras de autos, turismo rural, inmobiliarias turísticas, organizadores de congresos, guías certificados, free shops.
- **No incluye**: restaurants generales, gyms, peluquerías, comercio minorista.
- Cobertura nacional — los 19 departamentos.
- Volumen dinámico — fluctúa diariamente con altas y bajas.

**Implicación para Blindspot**: la mayoría de registros se insertarán con `niche: 'other'`. El valor principal es la corroboración cross-source de negocios que ya existen como leads de Google Places (email oficial, web, teléfono verificado por registro ministerial).

## Paginación CKAN

```
GET /api/3/action/datastore_search
  ?resource_id=eb614f27-36d8-4a34-8bbf-ed5c40473df0
  &limit=500
  &offset=0
```

Primer response incluye `result.total`. Iterar con offset=0, 500, 1000... hasta cubrir total.

## Filtrado por ubicación

CKAN soporta filtro exacto server-side:
```
&filters={"Departamento":"MONTEVIDEO"}
```
El valor debe estar en MAYÚSCULAS. Si 0 resultados → fallback sin filtro.
Para ciudades específicas (ej: "Colonia del Sacramento") → filtrar por `Localidad` en su lugar.

## Problemas conocidos

- **TLS frágil**: `certificate verify failed` ocurre intermitentemente en `catalogodatos.gub.uy`.
  Solución: `https.Agent({ rejectUnauthorized: false })` en el cliente HTTP.

## Decisiones de implementación (Fase 6)

| Decisión | Valor |
|---|---|
| `source` | `'mintur'` |
| `source_confidence` | `0.80` |
| `external_id` | `String(record._id)` |
| `niche` | `'other'` (sin mapping directo) |
| `lat` / `lng` | `undefined` (no geocodificar en esta fase) |
| Phone parsing | split en `/ - |,/`, tomar primer valor no vacío |
| Descartar si | `Operador` vacío **o** (`Email` + `Telefono` + `Web` todos vacíos) |
| Deduplicación | `findCrossSourceMatch` (levenshtein sobre nombre) — sin clave exacta disponible |
