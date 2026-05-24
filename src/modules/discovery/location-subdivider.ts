import { normalizeLocationKey } from "./normalize.js";

// Sub-areas for known Uruguayan cities. Expand as needed.
const URUGUAY_SUBAREAS: Record<string, string[]> = {
  "montevideo": [
    "Ciudad Vieja, Montevideo",
    "Centro, Montevideo",
    "Cordón, Montevideo",
    "Palermo, Montevideo",
    "Parque Rodó, Montevideo",
    "Pocitos, Montevideo",
    "Punta Carretas, Montevideo",
    "Carrasco, Montevideo",
    "Punta Gorda, Montevideo",
    "Buceo, Montevideo",
    "Malvín, Montevideo",
    "Tres Cruces, Montevideo",
    "Sayago, Montevideo",
    "Cerro, Montevideo",
    "La Teja, Montevideo",
    "Aguada, Montevideo",
    "Goes, Montevideo",
    "Brazo Oriental, Montevideo",
    "Peñarol, Montevideo",
    "Colón, Montevideo",
  ],
  "canelones": [
    "Las Piedras, Canelones",
    "Pando, Canelones",
    "Ciudad de la Costa, Canelones",
    "La Paz, Canelones",
    "Santa Lucía, Canelones",
    "Salinas, Canelones",
    "Atlántida, Canelones",
    "Progreso, Canelones",
  ],
  "maldonado": [
    "Maldonado, Maldonado",
    "Punta del Este, Maldonado",
    "San Carlos, Maldonado",
    "Piriápolis, Maldonado",
    "Pan de Azúcar, Maldonado",
  ],
  "salto": [
    "Centro, Salto",
    "Salto Este, Salto",
    "Salto Norte, Salto",
  ],
  "paysandu": [
    "Centro, Paysandú",
    "Paysandú Norte, Paysandú",
  ],
  "rivera": [
    "Centro, Rivera",
    "Rivera Norte, Rivera",
  ],
  "colonia": [
    "Colonia del Sacramento, Colonia",
    "Nueva Helvecia, Colonia",
    "Juan Lacaze, Colonia",
    "Carmelo, Colonia",
  ],
};

/**
 * Returns sub-areas for the given location string.
 * If no sub-areas are configured, returns an empty array (caller should use location as-is).
 */
export function getSubAreas(location: string): string[] {
  const key = normalizeLocationKey(location);
  return URUGUAY_SUBAREAS[key] ?? [];
}
