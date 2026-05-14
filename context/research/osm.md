# OSM / Overpass API — Investigación de fuente

> Investigado: 2026-05-13 vía Gemini DeepSearch.

## Endpoints disponibles

| Instancia | URL | Notas |
|---|---|---|
| Principal (FOSSGIS) | `https://overpass-api.de/api/interpreter` | Estándar global, 2 servidores |
| Mirror lz4 | `https://lz4.overpass-api.de/api/interpreter` | Alternativa de alta capacidad |
| private.coffee | `https://overpass.private.coffee/api/interpreter` | **Preferido para uso intensivo** — 256 GB RAM, límites más relajados |
| Francia (OSM FR) | `https://overpass.openstreetmap.fr/api/interpreter` | Respaldo secundario |

Sin autenticación. Sin API key.

## Rate limits

- Uso responsable: < 10.000 requests/día y < 1 GB/día por IP.
- Si se superan: las requests se encolan hasta 15 s y devuelven HTTP 429.
- Para crawling inicial usar `overpass.private.coffee` — política más permisiva (avisar si > 10 req/s).
- Rotar entre instancias si hay degradación.

## Parámetros de control en la query

```
[out:json][timeout:900][maxsize:1073741824]
```
- `timeout`: segundos máximos en servidor. Default 180. Para departamentos completos: 900–3600.
- `maxsize`: RAM máxima en bytes. Default 512 MiB. Para queries densas subirlo a 1 GB.

## Lenguaje de consulta (Overpass QL)

Usar `nwr` (nodes + ways + relations) + `out center` para obtener siempre lat/lon aunque el negocio esté mapeado como polígono de edificio.

### Niveles administrativos en Uruguay

| admin_level | Entidad |
|---|---|
| 4 | Departamento (Montevideo, Colonia, Maldonado…) |
| 8 | Ciudad / Municipio (Minas, Durazno, Treinta y Tres) |
| 10 | Barrio (Pocitos, Punta Carretas…) |

### Queries de ejemplo

**Restaurantes en Montevideo:**
```
[out:json][timeout:60];
area["name"="Montevideo"]["admin_level"="4"]->.a;
(nwr["amenity"="restaurant"](area.a););
out center;
```

**Gimnasios en Colonia (bounding box):**
```
[out:json][timeout:25];
(nwr["leisure"="gym"](-34.48,-57.86,-34.46,-57.82););
out center;
```

**Peluquerías + concesionarios en Minas:**
```
[out:json][timeout:60];
area["name"="Minas"]["admin_level"="8"]->.a;
(nwr["shop"="hairdresser"](area.a); nwr["shop"="car"](area.a););
out center;
```

## Mapeo de nichos Blindspot → tags OSM

| Niche Blindspot | Tag OSM |
|---|---|
| `restaurant` | `amenity=restaurant` |
| `gym` | `leisure=gym` |
| `hairdresser` | `shop=hairdresser` |
| `car_dealer` | `shop=car` |

## Campos disponibles en nodos OSM

```json
{
  "type": "node",
  "id": 4567891234,
  "lat": -34.9123456,
  "lon": -56.1567890,
  "tags": {
    "amenity": "restaurant",
    "name": "Lo de Pepe",
    "addr:city": "Montevideo",
    "addr:street": "Avenida Brasil",
    "addr:housenumber": "2500",
    "phone": "+598 2700 0000",
    "website": "https://lodepepe.com.uy",
    "opening_hours": "Mo-Su 12:00-15:30, 20:00-00:00"
  }
}
```

## Completitud estimada en Uruguay

| Campo | Presencia estimada | Notas |
|---|---|---|
| `name` | ~98% | Casi universal |
| `addr:street` | 75–85% | Alta en capitales, menor en interior |
| `phone` | 25–40% | Mejor en gastronomía y hotelería |
| `website` | 15–25% | Muchos prefieren redes sociales |
| `email` | < 10% | Campo menos poblado — no depender de él |

## Cobertura por zona

| Zona | Cobertura de negocios |
|---|---|
| Montevideo / Punta del Este | Exhaustiva — comparable a Google Maps |
| Ciudades medias (Minas, Durazno) | Buena en avenidas y centros comerciales |
| Rural / Treinta y Tres | Solo servicios críticos (estaciones, paradores) |

**Ventaja clave vs Google Maps**: sin ruido comercial pagado, datos puramente geográficos y semánticos. Google Maps tiene más micro-negocios informales; OSM tiene mejor precisión técnica.

## Licencia

ODbL v1.0 — uso comercial OK. Obligaciones:
- Atribución: `© Colaboradores de OpenStreetMap`
- Share-alike solo si se crea una "Base de Datos Derivada" inseparable. Mostrar resultados en una app = "Obra Producida" → no obliga a liberar código propio.

## Cliente npm recomendado

**`overpass-ts`** — TypeScript nativo, auto-retry en 429/504, soporte de streams. Es el más adecuado para este proyecto.

## Decisiones de implementación (Fase 8)

| Decisión | Valor |
|---|---|
| `source` | `'osm'` |
| `source_confidence` | `0.60` |
| `external_id` | `String(node.id)` — ID estable de OSM |
| `lat` / `lng` | **Nativo** — siempre disponible con `out center` |
| `niche` | Mapeado desde tag OSM (ver tabla arriba) |
| `email` | Opcional — presente en < 10% de nodos |
| `phone` | Opcional — presente en ~25–40% |
| Instancia preferida | `overpass.private.coffee` para discovery masivo |
| Particionamiento | Por departamento — nunca pedir todo Uruguay en una query |
| Caché | Implementar — los datos no cambian por minuto |
