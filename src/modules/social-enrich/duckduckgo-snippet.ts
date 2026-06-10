// Métricas + liveness de IG vía el snippet de DuckDuckGo (gratis, $0). Desde julio 2025 IG
// indexa cuentas profesionales en buscadores: la query `site:instagram.com/<handle>` devuelve
// "X Followers, Y Following, Z Posts - <bio>" en el snippet del resultado. No toca la API de IG
// (no aplica el ToS de Meta); el riesgo es el ToS del buscador y su rate-limit/anti-bot.
//
// IMPORTANTE: DuckDuckGo aplica anti-bot agresivo a IPs de datacenter (devuelve un "anomaly"
// modal). En IP residencial con throttle funciona; acá degradamos con gracia: si detectamos el
// anti-bot o no hay snippet, devolvemos null y el pipeline sigue sin métricas (no rompe nada).
import { parseSocialCount } from "./social-activity.js";
import type { SocialProfileData } from "./social-fusion.js";

const LITE_ENDPOINT = "https://lite.duckduckgo.com/lite/";
const HTML_ENDPOINT = "https://html.duckduckgo.com/html/";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export function isAntiBot(html: string): boolean {
  return /anomaly-modal|unfortunately, bots use duckduckgo too|challenge/i.test(html);
}

// Extrae los textos de snippet del HTML de resultados de DDG (html y lite tienen markup distinto).
export function extractSnippets(html: string): string[] {
  const out: string[] = [];
  // Variante html.duckduckgo.com: <a class="result__snippet" ...>texto</a>
  const reHtml = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  // Variante lite: el snippet va en <td class="result-snippet">texto</td>
  const reLite = /class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;
  for (const re of [reHtml, reLite]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const text = m[1]!.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
      if (text) out.push(text);
    }
  }
  return out;
}

// Parsea "X Followers, Y Following, Z Posts - <bio>" → SocialProfileData. El conteo soporta
// K/M/mil (reusa parseSocialCount). La bio es lo que sigue al primer " - " (best-effort: el
// snippet suele truncarla). Devuelve null si no hay al menos una métrica reconocible.
export function parseInstagramSnippet(snippet: string, username: string): SocialProfileData | null {
  const grab = (label: RegExp): number | null => {
    const m = snippet.match(label);
    return m ? parseSocialCount(m[1]) : null;
  };
  const followers = grab(/([\d.,]+\s*[KMB]?)\s+Followers/i) ?? grab(/([\d.,]+\s*[KMB]?)\s+seguidores/i);
  const following = grab(/([\d.,]+\s*[KMB]?)\s+Following/i) ?? grab(/([\d.,]+\s*[KMB]?)\s+sigui/i);
  const posts = grab(/([\d.,]+\s*[KMB]?)\s+Posts/i) ?? grab(/([\d.,]+\s*[KMB]?)\s+publicaciones/i);

  if (followers == null && following == null && posts == null) return null;

  // Bio: texto tras el primer " - " (formato típico del og:description que DDG copia).
  let biography: string | null = null;
  const dashIdx = snippet.indexOf(" - ");
  if (dashIdx >= 0) {
    let after = snippet.slice(dashIdx + 3).trim();
    // Quitar prefijos boilerplate del og:description de IG.
    after = after.replace(/^See Instagram photos and videos from\s+/i, "");
    const onIg = after.match(/on Instagram:\s*["']?(.+?)["']?$/i);
    if (onIg) after = onIg[1]!.trim();
    biography = after.length > 0 ? after : null;
  }

  return {
    username,
    name: null,
    biography,
    followers_count: followers,
    follows_count: following,
    media_count: posts,
    website: null,
    recent_media: [], // el snippet no trae timestamps → liveness fino no disponible por esta vía
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Consulta DDG por el perfil y devuelve el SocialProfileData, o null si bloqueo/sin datos.
// Degradación graciosa: nunca lanza por anti-bot/red — el caller sigue sin métricas.
export async function fetchInstagramSnippet(
  username: string,
  opts: { throttleMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<SocialProfileData | null> {
  const doFetch = opts.fetchImpl ?? fetch;
  if (opts.throttleMs && opts.throttleMs > 0) await sleep(opts.throttleMs);
  const query = `site:instagram.com/${username}`;
  for (const endpoint of [LITE_ENDPOINT, HTML_ENDPOINT]) {
    try {
      const url = `${endpoint}?q=${encodeURIComponent(query)}`;
      const res = await doFetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
      const html = await res.text();
      if (isAntiBot(html)) continue; // probar el otro endpoint; si ambos bloquean → null
      for (const snippet of extractSnippets(html)) {
        if (!/instagram/i.test(snippet) && !/Followers|seguidores/i.test(snippet)) continue;
        const parsed = parseInstagramSnippet(snippet, username);
        if (parsed) return parsed;
      }
    } catch {
      // red/timeout → probar siguiente endpoint o degradar a null
    }
  }
  return null;
}
