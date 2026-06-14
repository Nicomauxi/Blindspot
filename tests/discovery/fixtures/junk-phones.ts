// Teléfonos basura reales para validación en ingest (R.3 → F5.3).
// Verificado en la DB: '24070000' lo comparten 52 leads DEI (teléfono de gestor/contador).

export interface JunkPhoneCase {
  phone: string;
  /** Debe rechazarse/marcarse no-confiable en ingest. */
  isJunk: boolean;
  reason: string;
}

export const JUNK_PHONE_CASES: JunkPhoneCase[] = [
  { phone: "0", isJunk: true, reason: "placeholder ^0+$" },
  { phone: "0000000", isJunk: true, reason: "placeholder ^0+$" },
  { phone: "123", isJunk: true, reason: "menos de 7 dígitos" },
  { phone: "24070000", isJunk: true, reason: "compartido por 52 leads DEI (gestor)" },
  { phone: "+598 99 111 222", isJunk: false, reason: "móvil válido propio" },
  { phone: "24013030", isJunk: false, reason: "fijo válido no compartido masivamente" },
];

/** Umbral por encima del cual un phone compartido se considera genérico/no-confiable. */
export const SHARED_PHONE_THRESHOLD = 5;
