// Ley 18.331 (protección de datos personales): NO debemos registrar/tratar datos de personas
// físicas (empresas unipersonales cuyo "negocio" es la persona — el teléfono/dirección suelen ser
// particulares). Este clasificador estima, a partir del nombre/razón social, si un lead es:
//   - "juridica": tiene forma societaria explícita (S.A./S.R.L./SAS/Ltda/Coop/…) → NO es persona física.
//   - "fisica": nombre de persona o marcador personal explícito ("y otros", "sucesión de") → SE FILTRA.
//   - "unknown": nombre de fantasía/comercial sin señal clara → se conserva (que lo resuelva DGI luego).
//
// Es una heurística sobre el nombre; la fuente AUTORITATIVA es el tipo de entidad de DGI (futuro).
// Por eso es conservadora: solo marca "fisica" cuando la señal es fuerte, para no descartar negocios.

export type LegalPersonType = "juridica" | "fisica" | "unknown";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Formas societarias uruguayas (persona jurídica). Espaciado/puntos flexibles: "S.A.", "SA",
// "S A", "S.R.L.", "S R L", "SAS", "LTDA", "S. en C.", "& Cía".
const CORPORATE_FORM_RE =
  /(\bs\.?\s?a\.?\s?s\.?\b|\bs\.?\s?a\.?\b|\bs\.?\s?r\.?\s?l\.?\b|\bltda?\.?\b|\bs\.?\s?c\.?\s?a?\.?\b|\bs\.?\s?en\s?c\.?\b|\bsociedad\b|\bcooperativa\b|\bcoop\.?\b|\basociaci\w*\b|\basoc\.?\b|\bfundaci\w*\b|&\s?c[ií]a|\by\s?c[ií]a\b|\bcorp\b|\bcorporation\b|\bincorporated\b|\binc\.?\b|\bs\.?\s?en\s?c\.?\s?p\.?\b)/;

// Marcadores explícitos de persona física / sociedad de hecho (familiar).
const PERSONAL_MARKER_RE =
  /(\by\s?otros?\b|\by\s?hnos\.?\b|\by\s?hermanos\b|\bsucesi\w*\b|\bsuc\.?\s?de\b|\by\s?f(?:lia|amilia)\.?\b|\by\s?sra\.?\b|\by\s?se[nñ]ora\b)/;

// Palabras que delatan un NEGOCIO con nombre (no clasificamos como persona física aunque incluya
// un nombre propio: "Almacén Juan" es un comercio nombrado, no podemos afirmar que sea unipersonal).
const COMMERCIAL_WORD_RE =
  /\b(bar|resto|restaurante?|parrillada?|pizzer\w*|cafe|cafeter\w*|almac\w*|kiosco|farmacia|botica|taller\w*|barraca|automotora|autom\w*|hotel|hostel|posada|lodge|caba\w*|panader\w*|pan|confiter\w*|carnicer\w*|ferreter\w*|supermercad\w*|mercado|agromercado|agropecuaria|minimercado|autoservicio|club|gimnasio|fitness|spa|zen|peluquer\w*|peinados?|estilista|coiffeur|barber\w*|inmobiliaria|inmuebles?|propiedades?|administracion\w*|estudio|cl[i]nica|sanatorio|farmac\w*|laborator\w*|tienda|boutique|local|comercial|industri\w*|distribuidora|importadora|exportadora|servicios?|sistemas?|soluciones|consultora|agencia|despensa|rotiser\w*|helader\w*|vivero|optica|joyer\w*|libreria|papeler\w*|muebler\w*|veterinaria|odontolog\w*|gomer\w*|lavadero|carwash|cerrajer\w*|electric\w*|construc\w*|transporte\w*|logistica|seguridad|limpieza|catering|eventos|fiesta|party|studio|group|grupo|company|gourmet|wine|tourist|turismo|travel|viajes|aventura|park|complex|pet|haus|tech|digital|media|labs?|negocios?|inmobiliarios?|motors?|internacional|bakery|supermarket|sushi|cocina|parador|hosteria|hoster[ií]a|estetica|est[eé]tica|belleza|coiffure|nissan|peugeot|chevrolet|toyota|ford|byd|estate|hair|stylist|dresser\w*|restoran\w*|restaur\w*|minisuper|minimarket|asociad\w*|cars?|sabores?|vegetarian\w*|fun)\b/;

function looksLikePersonName(normalized: string): boolean {
  // Tokens alfabéticos (incluye apóstrofo) — sin dígitos ni símbolos comerciales.
  const tokens = normalized.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length < 3 || tokens.length > 5) return false;
  const CONNECTORS = new Set(["de", "del", "la", "las", "los", "y", "da", "di", "do", "san"]);
  for (const token of tokens) {
    if (CONNECTORS.has(token)) continue;
    if (!/^[a-z][a-z']{1,}$/.test(token)) return false;
  }
  // ≥3 tokens "fuertes": los nombres legales uruguayos son Apellido1 [Apellido2] Nombre1 [Nombre2].
  // Exigir 3+ baja drásticamente el falso-positivo de nombres comerciales de 2 palabras
  // ("Ocean Park", "My Pet") sin perder los nombres de persona completos. La baja recall de
  // los "Apellido Nombre" de 2 tokens se acepta: el filtro autoritativo real será DGI.
  const strong = tokens.filter((t) => !CONNECTORS.has(t));
  return strong.length >= 3;
}

/**
 * Clasifica el tipo de persona a partir del nombre / razón social. Conservador: solo "fisica"
 * cuando hay forma personal fuerte, "juridica" cuando hay forma societaria, "unknown" si no.
 */
export function classifyLegalPersonType(name: string | null | undefined): LegalPersonType {
  if (!name) return "unknown";
  const n = normalize(name);
  if (n.length === 0) return "unknown";
  if (CORPORATE_FORM_RE.test(n)) return "juridica";
  if (PERSONAL_MARKER_RE.test(n)) return "fisica";
  if (COMMERCIAL_WORD_RE.test(n)) return "unknown"; // negocio con nombre → no podemos afirmar persona física
  if (looksLikePersonName(n)) return "fisica";
  return "unknown";
}

/** True si el lead debe excluirse del pool por ser (probable) persona física (Ley 18.331). */
export function isLikelyNaturalPerson(name: string | null | undefined): boolean {
  return classifyLegalPersonType(name) === "fisica";
}
