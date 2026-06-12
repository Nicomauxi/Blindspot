// Métricas + liveness de IG vía un SearXNG self-hosted (gratis, $0, legal).
//
// SearXNG es un metabuscador open-source: reenvía la query a varios buscadores reales
// (Google, Mojeek, Startpage, Brave, DuckDuckGo…) y agrega los resultados. Corriéndolo
// localmente (Docker) no hay API key ni cuota. Para `site:instagram.com/<handle>` el campo
// `content` del resultado trae el og:description de IG ("X Followers, Y Following, Z Posts - bio").
//
// Ventaja sobre DuckDuckGo directo: cuando un buscador bloquea (DDG da CAPTCHA, Brave
// rate-limita), SearXNG completa con los otros engines → mucho más resiliente. El anti-bot
// upstream sigue existiendo, así que igual conviene throttle y degradar con gracia a null.
//
// Setup: docker run -d --name searxng -p 8080:8080 -v <cfg>:/etc/searxng searxng/searxng
//        con settings.yml: search.formats incluye 'json' y server.limiter=false.
import { pickProfileFromSnippets } from "./duckduckgo-snippet.js";
import type { SocialProfileData } from "./social-fusion.js";

const DEFAULT_SEARXNG_URL = "http://localhost:8080";
const SEARXNG_TIMEOUT_MS = 8000; // F4.3

interface SearxngResult {
  content?: string;
  title?: string;
  url?: string;
}

// N50: si el resultado trae url, debe ser EL perfil pedido (path /<username>); la query
// site:instagram.com/<handle> también devuelve perfiles parecidos (arco → arcohanna).
function resultMatchesUsername(result: SearxngResult, username: string): boolean {
  if (typeof result.url !== "string" || result.url.length === 0) return true; // sin url: decide el snippet
  try {
    const path = new URL(result.url).pathname.toLowerCase();
    const segment = path.split("/").filter(Boolean)[0] ?? "";
    return segment === username.toLowerCase();
  } catch {
    return false;
  }
}

export interface SearxngSnippetOptions {
  baseUrl?: string;
  throttleMs?: number;
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function fetchInstagramSnippetViaSearxng(
  username: string,
  opts: SearxngSnippetOptions = {}
): Promise<SocialProfileData | null> {
  const base = (opts.baseUrl ?? process.env.SEARXNG_URL ?? DEFAULT_SEARXNG_URL).replace(/\/+$/, "");
  const doFetch = opts.fetchImpl ?? fetch;
  if (opts.throttleMs && opts.throttleMs > 0) await sleep(opts.throttleMs);

  const query = `site:instagram.com/${username}`;
  try {
    // Engines resilientes (qwant/yandex): los grandes ponen CAPTCHA a nuestra IP. Override SEARXNG_ENGINES.
    const engines = process.env["SEARXNG_ENGINES"] ?? "qwant,yandex";
    const url = `${base}/search?q=${encodeURIComponent(query)}&format=json&engines=${encodeURIComponent(engines)}`;
    // F4.3: timeout para no colgar el enrich si SearXNG no responde (patrón de http.ts).
    const res = await doFetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(SEARXNG_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: SearxngResult[] };
    const snippets = (data.results ?? [])
      .filter((r) => resultMatchesUsername(r, username))
      .flatMap((r) => [r.content, r.title].filter((s): s is string => typeof s === "string" && s.length > 0));
    return pickProfileFromSnippets(snippets, username);
  } catch {
    // SearXNG caído / red / JSON inválido → degradar a null (el caller sigue sin métricas).
    return null;
  }
}
