// Clasificación de vertical de negocio por CIIU (F1.4). El DEI/MIEM trae el código
// CIIU principal de la actividad; lo usamos para separar el ICP comercial (comercio
// local: gastronomía, retail, hospedaje, servicios personales) de las verticales B2B
// (industria manufacturera y "otros": agro, construcción, servicios profesionales…),
// que NO entran al pool contactable comercial ni al tier A.

export type Vertical = "comercio-local" | "industrial" | "otro";

// Divisiones CIIU (Rev.4) que son comercio local / ICP:
//  45-47 (G) comercio (vehículos, mayorista, minorista), 55-56 (I) alojamiento y comida,
//  95 reparación de equipos y enseres personales, 96 otros servicios personales.
const COMERCIO_LOCAL_DIVISIONS = new Set([45, 46, 47, 55, 56, 95, 96]);

/**
 * Clasifica la vertical a partir del código CIIU principal (división = primeros 2 dígitos).
 * Sin código o ilegible → "otro" (conservador: no se puede confirmar comercio local).
 */
export function classifyVertical(ciiuCode: string | null | undefined): Vertical {
  const digits = (ciiuCode ?? "").replace(/\D/g, "");
  if (digits.length < 2) return "otro";
  const division = Number.parseInt(digits.slice(0, 2), 10);
  if (Number.isNaN(division)) return "otro";
  if (division >= 10 && division <= 33) return "industrial";
  if (COMERCIO_LOCAL_DIVISIONS.has(division)) return "comercio-local";
  return "otro";
}

export function verticalTag(v: Vertical): string {
  return `vertical-${v}`;
}

/** ¿La vertical es ICP comercial (entra al pool contactable comercial)? */
export function isCommercialVertical(v: Vertical): boolean {
  return v === "comercio-local";
}
