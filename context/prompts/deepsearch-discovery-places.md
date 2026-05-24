# Prompt — DeepSearch para importar XLS de lugares comerciales

> **Uso:** copiar y pegar este prompt en un chat con un modelo de DeepSearch (Gemini Pro DeepResearch, Perplexity Pro, GPT con Browse, etc.) **fuera** del flujo de AUTONOMOUS. El resultado es un XLS que después se carga en Blindspot vía la importación que cubre la fase `DISC-12`.
>
> No forma parte de la planificación ejecutable de `AUTONOMOUS.md`. Es un asset de input.

---

## Prompt

Necesito una lista exhaustiva de **lugares comerciales agrupables** dentro de Uruguay para usarlos como destinos de campañas de discovery (búsqueda automática de PyMEs). El output debe ser un archivo Excel (`.xlsx`) descargable con la estructura exacta que detallo más abajo.

### Qué buscar

Lugares comerciales reales con concentración de PyMEs activas, no solo capitales de departamento. Quiero:

1. **Ciudades** principales y secundarias de cada departamento (Uruguay tiene 19 departamentos).
2. **Barrios comerciales** de Montevideo (al menos 30: Pocitos, Cordón, Centro, Punta Carretas, Carrasco, Buceo, Tres Cruces, Aguada, La Blanqueada, Malvín, etc.).
3. **Zonas turísticas** con temporada alta de comercio (Punta del Este, Piriápolis, La Paloma, Cabo Polonio, Colonia del Sacramento, etc.).
4. **Polos industriales y de servicios** (Zonamérica, Aguada Park, Parque de las Ciencias, Polo Tecnológico Pando, etc.).
5. **Avenidas y zonas comerciales** características (Av. 18 de Julio, Av. Italia, Av. Brasil, World Trade Center, etc.) cuando sean unidades operables como destino de búsqueda.

Para cada lugar verificá que:
- Existe en Google Maps con su nombre comercial habitual.
- Tiene actividad comercial visible (no es solo un punto geográfico sin negocios).
- Su nombre tal cual lo escribís puede usarse como query para `Google Places Text Search` con resultados razonables.

### Formato del XLSX

Hoja única llamada `places`. Encabezados en la fila 1, en este orden exacto y en minúsculas:

| Columna | Tipo | Descripción |
|---|---|---|
| `location_key` | string slug | Identificador kebab-case, sin tildes, único. Ej. `pocitos-mvd`, `punta-del-este`, `paysandu`. |
| `display_name` | string | Nombre humano. Ej. `Pocitos (Montevideo)`, `Punta del Este`, `Paysandú`. |
| `parent_location` | string \| empty | Departamento o ciudad madre. Ej. `Montevideo`, `Maldonado`. Vacío para departamentos completos. |
| `kind` | enum | Uno de: `departamento`, `ciudad`, `barrio`, `zona_turistica`, `polo_industrial`, `avenida`. |
| `lat_approx` | number | Latitud aproximada del centro del lugar, 6 decimales. |
| `lng_approx` | number | Longitud aproximada del centro del lugar, 6 decimales. |
| `commercial_score` | integer 0-100 | Tu mejor estimación de densidad comercial relativa, donde 100 = Montevideo Centro y 0 = sin actividad comercial. |
| `notes` | string \| empty | Una sola línea libre (no romper celdas). Razón por la que lo incluiste si no es obvio. |

### Volumen objetivo

- Al menos **300 entries**. No menos.
- Sin duplicados por `location_key`.
- Sin nombres ambiguos (ej. evitar `Centro` solo; usar `Centro (Salto)` o `Centro de Montevideo`).
- Cobertura mínima por departamento: al menos 5 entradas por departamento, distribuidas entre ciudades y barrios cuando aplique.

### Validación que vas a hacer vos al final

Antes de devolverme el XLSX:
1. Listá los 19 departamentos de Uruguay y confirmá que están todos representados.
2. Listá los top 10 `display_name` por `commercial_score` y verificá que son realmente lugares con alta densidad comercial.
3. Verificá que no haya filas con `lat_approx` o `lng_approx` fuera del bounding box de Uruguay (lat entre -35 y -30, lng entre -58 y -53).
4. Si encontrás algún `location_key` duplicado, corregilo antes de exportar.

### Entrega

Devolveme **directamente el archivo .xlsx** descargable, además de un resumen en texto con:
- Total de filas.
- Distribución por `kind`.
- Cobertura por departamento (cuántas filas por cada uno).
- Cualquier supuesto que hayas hecho.

No me devuelvas el contenido como tabla markdown ni como JSON. Necesito el XLSX para subirlo directamente a la herramienta. Si tu entorno no permite descarga directa, generá un link a un archivo hospedado (Drive, Dropbox, OneDrive) y dame el link.
