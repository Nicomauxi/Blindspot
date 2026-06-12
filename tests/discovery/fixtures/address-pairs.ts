// Pares de direcciones reales para los bugs de matching (R.3 del plan).
// Alimentan los tests de F2.2 (containment de 1 token), F2.3 (puerta = último número),
// F2.4 ("8 de Octubre"), F2.5 (orden de palabras en nameSimilarity).

export interface AddressMatchCase {
  a: string;
  b: string;
  /** Resultado esperado de streetAddressesMatch tras el fix. */
  shouldMatch: boolean;
  reason: string;
}

export const ADDRESS_MATCH_CASES: AddressMatchCase[] = [
  {
    a: "Rivera 1234",
    b: "Gral. Fructuoso Rivera 1234",
    shouldMatch: true,
    reason: "misma calle (prefijo de título) + misma puerta",
  },
  {
    a: "Rivera",
    b: "Rivera Indarte",
    shouldMatch: false,
    reason: "1 token sin puerta no debe containment-matchear con calle distinta (F2.2)",
  },
];

export interface DoorParseCase {
  input: string;
  /** Puerta esperada tras el fix (primer número tras el nombre de calle). */
  expectedDoor: string;
  /** Tokens significativos que deben conservarse. */
  mustKeepTokens?: string[];
}

export const DOOR_PARSE_CASES: DoorParseCase[] = [
  {
    input: "Av. Italia 3030 apto 5",
    expectedDoor: "3030", // hoy toma el último número (5) — F2.3
  },
  {
    input: "8 de Octubre 2720",
    expectedDoor: "2720",
    mustKeepTokens: ["8", "octubre"], // hoy "8 de Octubre" colapsa a {octubre} — F2.4
  },
];

export interface NameSimilarityCase {
  a: string;
  b: string;
  /** Debe superar el umbral de merge tras el fix (token-set/Jaccard). */
  shouldMatch: boolean;
  reason: string;
}

export const NAME_SIMILARITY_CASES: NameSimilarityCase[] = [
  {
    a: "MULTICAR",
    b: "Multicar Automotora",
    shouldMatch: true,
    reason: "token-set: 'multicar' contenido; hoy under-merge (MULTICAR x11) — F2.5",
  },
];
