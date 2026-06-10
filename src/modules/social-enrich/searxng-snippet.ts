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

interface SearxngResult {
  content?: string;
  title?: string;
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
    const url = `${base}/search?q=${encodeURIComponent(query)}&format=json`;
    const res = await doFetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: SearxngResult[] };
    const snippets = (data.results ?? []).flatMap((r) =>
      [r.content, r.title].filter((s): s is string => typeof s === "string" && s.length > 0)
    );
    return pickProfileFromSnippets(snippets, username);
  } catch {
    // SearXNG caído / red / JSON inválido → degradar a null (el caller sigue sin métricas).
    return null;
  }
}
