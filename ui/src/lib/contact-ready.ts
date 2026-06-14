// MA-02: contact_ready es tri-estado (listo / incompleto / aún no evaluado=NULL).
// La UI colapsaba NULL a "incompleto" (afirmación negativa sobre un dato que todavía no
// conocemos). Este helper expone el tercer estado "sin evaluar" para no mentirle al vendedor.

export type ContactReadyState = "ready" | "incomplete" | "unevaluated";

export interface ContactReadyCopy {
  state: ContactReadyState;
  /** Etiqueta corta para pills/badges. */
  pill: string;
  /** Frase para textos explicativos / hints. */
  hint: string;
}

const COPY: Record<ContactReadyState, ContactReadyCopy> = {
  ready: {
    state: "ready",
    pill: "Contacto listo",
    hint: "Listo para pasar a una propuesta o contacto inicial.",
  },
  incomplete: {
    state: "incomplete",
    pill: "Contacto incompleto",
    hint: "Conviene validar datos de contacto antes de salir a prospectar.",
  },
  unevaluated: {
    state: "unevaluated",
    pill: "Sin evaluar",
    hint: "Este lead todavía no fue evaluado para contacto.",
  },
};

export function contactReadyState(value: boolean | null | undefined): ContactReadyState {
  if (value === true) return "ready";
  if (value === false) return "incomplete";
  return "unevaluated";
}

export function contactReadyCopy(value: boolean | null | undefined): ContactReadyCopy {
  return COPY[contactReadyState(value)];
}
