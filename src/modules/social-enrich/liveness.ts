// Detección de "redes muertas": páginas de FB/IG asignadas a un lead que en realidad
// no existen (borradas, redirigen al home/login, título genérico). El og:title suele
// quedar cacheado aunque la página esté muerta, inflando el score → ruido.
//
// Detector PURO (testeable). Las señales de texto se buscan SOLO en título/og/h1,
// NUNCA en el body (un post compartido puede decir "no está disponible" legítimamente).

export const LIVENESS_DETECTOR_VERSION = 1;

export type LivenessState = "alive" | "dead" | "unverified";
export type LivenessReason =
  | "deleted"
  | "private"
  | "login_wall"
  | "redirected_home"
  | "generic_title"
  | "http_error"
  | null;

export interface Liveness {
  state: LivenessState;
  reason: LivenessReason;
  http_status: number | null;
  final_url: string | null;
  checked_at: string | null;
  detector_version: number;
}

export interface LivenessInput {
  platform: "facebook" | "instagram";
  requestedUrl: string;
  finalUrl?: string | null;
  httpStatus?: number | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  title?: string | null;
  h1?: string | null;
  checkedAt: string;
}

// hard-dead borra confirmaciones; soft-dead solo atenúa (puede ser geo-bloqueo / cuenta privada).
const HARD_DEAD_REASONS: ReadonlySet<LivenessReason> = new Set<LivenessReason>([
  "deleted",
  "redirected_home",
  "generic_title",
  "http_error",
]);

export function isHardDead(liveness: Pick<Liveness, "state" | "reason">): boolean {
  return liveness.state === "dead" && HARD_DEAD_REASONS.has(liveness.reason);
}

function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "") // quitar acentos
    .replace(/[’'`´]/g, "'") // unificar apóstrofes
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Frases (normalizadas, sin acentos) que aparecen en el título de páginas muertas.
const DEAD_PHRASES = [
  "contenido no esta disponible",
  "contenido no disponible",
  "this content isn't available",
  "this content isnt available",
  "esta pagina no esta disponible",
  "page isn't available",
  "page isnt available",
  "sorry, this page isn't available",
  "no se ha encontrado la pagina",
  "the link you followed may be broken",
  "contenido no encontrado",
  "pagina no encontrada",
];

const PRIVATE_PHRASES = ["this account is private", "esta cuenta es privada", "cuenta privada"];

const GENERIC_TITLES = new Set(["facebook", "instagram", "log in to facebook", "iniciar sesion en facebook"]);

function pathOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
}

const HOME_PATHS = new Set(["/", "/home", "/explore"]);
const LOGIN_PATHS = new Set(["/login", "/accounts/login", "/login.php"]);

function build(reason: LivenessReason, state: LivenessState, input: LivenessInput): Liveness {
  return {
    state,
    reason,
    http_status: input.httpStatus ?? null,
    final_url: input.finalUrl ?? input.requestedUrl,
    checked_at: input.checkedAt,
    detector_version: LIVENESS_DETECTOR_VERSION,
  };
}

export function detectLiveness(input: LivenessInput): Liveness {
  // 1. Error HTTP explícito.
  if (input.httpStatus != null && input.httpStatus >= 400) {
    return build("http_error", "dead", input);
  }

  // 2. Redirect estructural: la URL pedida tenía un path específico y terminó en home/login.
  const reqPath = pathOf(input.requestedUrl);
  const finalPath = pathOf(input.finalUrl);
  const requestedSpecific = reqPath != null && reqPath !== "/" && !HOME_PATHS.has(reqPath);
  if (requestedSpecific && finalPath != null && finalPath !== reqPath) {
    if (LOGIN_PATHS.has(finalPath)) return build("login_wall", "dead", input); // soft
    if (HOME_PATHS.has(finalPath)) return build("redirected_home", "dead", input); // hard
  }

  // 3. Señales de texto SOLO en título/descripcion/h1 (nunca body).
  const titleNorm = normalize(input.ogTitle ?? input.title);
  const haystack = [input.ogTitle, input.title, input.h1, input.ogDescription].map(normalize).join(" || ");

  if (GENERIC_TITLES.has(titleNorm)) {
    return build("generic_title", "dead", input);
  }
  for (const phrase of PRIVATE_PHRASES) {
    if (haystack.includes(normalize(phrase))) return build("private", "dead", input); // soft
  }
  for (const phrase of DEAD_PHRASES) {
    if (haystack.includes(normalize(phrase))) return build("deleted", "dead", input); // hard
  }

  // 4. Sin señales pero con título real → viva.
  if (titleNorm.length > 0) {
    return build(null, "alive", input);
  }

  // 5. Sin info suficiente.
  return build(null, "unverified", input);
}
