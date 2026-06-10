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

// Extrae og:title / og:description / <title> / primer <h1> de un HTML crudo, para alimentar
// detectLiveness sin necesidad de un DOM (uso en discovery y en el reproceso de limpieza).
export function extractLivenessMeta(html: string | null): {
  ogTitle: string | null;
  ogDescription: string | null;
  title: string | null;
  h1: string | null;
} {
  if (!html) return { ogTitle: null, ogDescription: null, title: null, h1: null };
  const metaContent = (prop: string): string | null => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, "i");
    const alt = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, "i");
    return html.match(re)?.[1] ?? html.match(alt)?.[1] ?? null;
  };
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? null;
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? null;
  return { ogTitle: metaContent("og:title"), ogDescription: metaContent("og:description"), title, h1 };
}

export function detectLiveness(input: LivenessInput): Liveness {
  // 1. Error HTTP. 4xx (salvo 429 rate-limit) = definitivo → dead. 429/5xx = transitorio
  //    → unverified (no marcar muerta una página por un error temporal del servidor).
  if (input.httpStatus != null && input.httpStatus >= 400) {
    if (input.httpStatus >= 500 || input.httpStatus === 429) {
      return build(null, "unverified", input);
    }
    return build("http_error", "dead", input);
  }

  // 2. Redirect estructural: la URL pedida tenía un path específico y terminó en home/login.
  const reqPath = pathOf(input.requestedUrl);
  const finalPath = pathOf(input.finalUrl);
  const requestedSpecific = reqPath != null && reqPath !== "/" && !HOME_PATHS.has(reqPath);
  if (requestedSpecific && finalPath != null && finalPath !== reqPath) {
    // login_wall ya NO es señal de muerte: desde 2026 IG redirige TODO perfil anónimo al
    // login, exista o no. Marcar "dead" penalizaba (−60% score, atenuación en cleanup) a
    // negocios vivos por pura ceguera del scraper. Lo dejamos "unverified" (no confirma ni
    // penaliza) conservando el reason para diagnóstico. El early-return debe ir antes del
    // check de generic_title de abajo (si no, el og:title "Instagram" lo haría hard-dead).
    if (LOGIN_PATHS.has(finalPath)) return build("login_wall", "unverified", input);
    if (HOME_PATHS.has(finalPath)) return build("redirected_home", "dead", input); // hard
  }

  // 3. Señales de texto. Las frases de "muerta" se buscan SOLO en título/h1 (nunca en la
  //    descripción ni el body: una descripción larga puede mencionar "no está disponible"
  //    legítimamente). "Cuenta privada" sí puede venir en la descripción (IG).
  const titleNorm = normalize(input.ogTitle ?? input.title);
  const titleHaystack = [input.ogTitle, input.title, input.h1].map(normalize).join(" || ");
  const descHaystack = normalize(input.ogDescription);

  if (GENERIC_TITLES.has(titleNorm)) {
    return build("generic_title", "dead", input);
  }
  for (const phrase of PRIVATE_PHRASES) {
    if (titleHaystack.includes(normalize(phrase)) || descHaystack.includes(normalize(phrase))) return build("private", "dead", input); // soft
  }
  for (const phrase of DEAD_PHRASES) {
    if (titleHaystack.includes(normalize(phrase))) return build("deleted", "dead", input); // hard
  }

  // 4. Sin señales pero con título real → viva.
  if (titleNorm.length > 0) {
    return build(null, "alive", input);
  }

  // 5. Sin info suficiente.
  return build(null, "unverified", input);
}
