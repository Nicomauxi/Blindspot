import { fetch } from "undici";
import pRetry from "p-retry";
import { getLogger } from "../../shared/logger.js";

export const USER_AGENT = "blindspot/1.0";
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

// Knobs de velocidad leídos del env POR LLAMADA (no const fija al arranque): la API
// los settea desde pipeline_config (Variables) al lanzar jobs, sin reiniciar el proceso.
const DEFAULT_FETCH_TIMEOUT_MS = 8000;
const DEFAULT_FETCH_RETRIES = 2;

export function getFetchTimeoutMs(): number {
  const raw = process.env["FETCH_TIMEOUT_MS"];
  if (raw === undefined || raw.trim() === "") return DEFAULT_FETCH_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FETCH_TIMEOUT_MS;
}

export function getFetchRetries(): number {
  const raw = process.env["FETCH_RETRIES"];
  if (raw === undefined || raw.trim() === "") return DEFAULT_FETCH_RETRIES;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_FETCH_RETRIES;
}

const SCHEME_RE = /^https?:\/\//i;

/**
 * Garantiza que la URL tenga esquema antes de pasarla a fetch() (undici lanza ante
 * URLs sin esquema como "www.foo.com"). Por defecto asume https. F1.2.
 * NO confundir con normalizeDomain de whois.ts, que QUITA el esquema.
 */
export function ensureScheme(url: string): string {
  return SCHEME_RE.test(url) ? url : `https://${url}`;
}

export interface FetchHtmlResult {
  status: number | null;
  finalUrl: string | null;
  html: string | null;
  headers: Record<string, string>;
  fetchedAt: string;
  error?: string;
}

function isHtmlContentType(ct: string | null): boolean {
  if (!ct) return true;
  const lower = ct.toLowerCase();
  return lower.includes("text/html") || lower.includes("application/xhtml+xml");
}

async function readBodyCapped(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let received = 0;
  let html = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        html += decoder.decode(value, { stream: true });
        if (received >= MAX_BODY_BYTES) {
          try {
            await reader.cancel();
          } catch {
            // ignore
          }
          break;
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
  html += decoder.decode();
  return html;
}

async function attemptFetch(url: string): Promise<FetchHtmlResult> {
  const fetchedAt = new Date().toISOString();
  // Network errors thrown here will be caught by pRetry and retried.
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(getFetchTimeoutMs()),
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,*/*;q=0.5",
      "Accept-Language": "es-UY,es;q=0.9,en;q=0.5",
    },
  });

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const status = response.status;
  const finalUrl = response.url || url;

  if (status >= 400) {
    try {
      await response.body?.cancel();
    } catch {
      // ignore
    }
    return { status, finalUrl, html: null, headers, fetchedAt, error: `http-${status}` };
  }

  if (!isHtmlContentType(headers["content-type"] ?? null)) {
    try {
      await response.body?.cancel();
    } catch {
      // ignore
    }
    return { status, finalUrl, html: null, headers, fetchedAt, error: "non-html-content" };
  }

  if (!response.body) {
    return { status, finalUrl, html: "", headers, fetchedAt };
  }

  try {
    const html = await readBodyCapped(response.body as ReadableStream<Uint8Array>);
    return { status, finalUrl, html, headers, fetchedAt };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status, finalUrl, html: null, headers, fetchedAt, error: `read-body: ${msg}` };
  }
}

async function fetchWithRetries(url: string): Promise<FetchHtmlResult> {
  const log = getLogger();
  try {
    return await pRetry(() => attemptFetch(url), {
      retries: getFetchRetries(),
      factor: 2,
      minTimeout: 500,
      onFailedAttempt: (ctx) => {
        log.warn(
          {
            url,
            attempt: ctx.attemptNumber,
            retriesLeft: ctx.retriesLeft,
            msg: ctx.error.message,
          },
          "fetchHtml network error, retrying"
        );
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ url, msg }, "fetchHtml gave up after retries");
    return {
      status: null,
      finalUrl: null,
      html: null,
      headers: {},
      fetchedAt: new Date().toISOString(),
      error: `network: ${msg}`,
    };
  }
}

export async function fetchHtml(rawUrl: string): Promise<FetchHtmlResult> {
  const hadScheme = SCHEME_RE.test(rawUrl);
  const primaryUrl = ensureScheme(rawUrl); // https:// por defecto
  const result = await fetchWithRetries(primaryUrl);

  // Fallback http:// SOLO si nosotros sintetizamos el https y falló a nivel de red/TLS
  // (no degradamos un https provisto por el usuario). F1.2.
  if (!hadScheme && result.error?.startsWith("network:")) {
    return await fetchWithRetries(`http://${rawUrl}`);
  }

  return result;
}

export function checkSsl(finalUrl: string | null): {
  valid_https: boolean;
  cert_valid: boolean | null;
} {
  const valid_https = !!finalUrl && finalUrl.toLowerCase().startsWith("https://");
  return { valid_https, cert_valid: null };
}
