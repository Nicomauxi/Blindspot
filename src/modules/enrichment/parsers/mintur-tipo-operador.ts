// Parses TipoOperador from MINTUR source_data JSONB and maps it to a sub-niche.
// MINTUR does NOT expose RUT — this parser only handles operator type classification.

export type TipoOperadorResult = {
  tipo_operador: string;
  tipo_operador_sub_niche: string;
};

// Canonical mapping: MINTUR TipoOperador → sub-niche for scoring/filtering.
// Keys are lowercased and trimmed for matching.
const TIPO_TO_SUB_NICHE: Array<{ pattern: RegExp; sub_niche: string }> = [
  { pattern: /agencia de viajes/i, sub_niche: "agencia_viajes" },
  { pattern: /alojamiento|hotel|hostel|cabañas|cabaña|camping|apart/i, sub_niche: "alojamiento" },
  { pattern: /restaurante|gastronomía|gastronomia|parrilla/i, sub_niche: "restaurante" },
  { pattern: /inmobiliaria/i, sub_niche: "inmobiliaria" },
  { pattern: /agencia de transportes|empresa de transporte/i, sub_niche: "transporte" },
  { pattern: /rentadora de autos|rent a car/i, sub_niche: "rent_a_car" },
  { pattern: /sala.*convencion|convención|convencion/i, sub_niche: "sala_convenciones" },
  { pattern: /guía turístico|guia turistico/i, sub_niche: "guia_turistico" },
  { pattern: /establecimiento rural|turismo rural/i, sub_niche: "turismo_rural" },
  { pattern: /aventura/i, sub_niche: "turismo_aventura" },
  { pattern: /spa|termas|balneario/i, sub_niche: "spa_termas" },
  { pattern: /casino|juego/i, sub_niche: "casino" },
  { pattern: /escuela náutica|nautica/i, sub_niche: "nautica" },
];

export function parseTipoOperador(
  sourceData: Record<string, unknown> | null | undefined
): TipoOperadorResult | null {
  if (!sourceData) return null;

  const raw = sourceData["TipoOperador"];
  if (typeof raw !== "string" || !raw.trim()) return null;

  const tipoOperador = raw.trim();
  const sub_niche = mapToSubNiche(tipoOperador);

  return { tipo_operador: tipoOperador, tipo_operador_sub_niche: sub_niche };
}

function mapToSubNiche(tipoOperador: string): string {
  for (const { pattern, sub_niche } of TIPO_TO_SUB_NICHE) {
    if (pattern.test(tipoOperador)) return sub_niche;
  }
  return "otro_mintur";
}
