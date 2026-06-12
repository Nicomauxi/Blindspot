import { whoisDomain } from "whoiser";
import { getLogger } from "../../shared/logger.js";

export interface WhoisLookupResult {
  fetched_at: string;
  created_at: string | null;
  registrar: string | null;
  expires_at: string | null;
  age_years: number | null;
  error?: string;
}

const TIMEOUT_MS = 5_000;

const CREATED_KEYS = [
  "Created Date",
  "Creation Date",
  "Created On",
  "Domain Registration Date",
  "Registered On",
  "created",
];
const EXPIRES_KEYS = [
  "Expiry Date",
  "Registry Expiry Date",
  "Registrar Registration Expiration Date",
  "Expiration Date",
  "Expires On",
  "expires",
];
const REGISTRAR_KEYS = ["Registrar", "Sponsoring Registrar", "registrar"];

export function normalizeDomain(input: string): string {
  let s = input.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^www\./, "");
  const slash = s.indexOf("/");
  if (slash !== -1) s = s.slice(0, slash);
  const colon = s.indexOf(":");
  if (colon !== -1) s = s.slice(0, colon);
  return s;
}

function pickField(
  resultObj: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const server of Object.keys(resultObj)) {
    const data = resultObj[server];
    if (!data || typeof data !== "object") continue;
    const rec = data as Record<string, unknown>;
    for (const key of keys) {
      const v = rec[key];
      if (typeof v === "string" && v.length > 0) return v;
      if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0];
    }
  }
  return null;
}

function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`whois-timeout-${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

// Caveat: TLDs like .uy may not expose 'Created Date' reliably via WHOIS. In
// those cases age_years stays null and 'domain-old-stale' is not emitted.
export async function whoisLookup(domain: string): Promise<WhoisLookupResult> {
  const fetched_at = new Date().toISOString();
  const log = getLogger();
  const cleanDomain = normalizeDomain(domain);
  if (!cleanDomain || !cleanDomain.includes(".")) {
    return {
      fetched_at,
      created_at: null,
      registrar: null,
      expires_at: null,
      age_years: null,
      error: "invalid-domain",
    };
  }

  // .uy / .com.uy no exponen WHOIS de forma fiable (1/1179 éxitos en producción) y la
  // consulta cuesta ~5-6s/lead. Se salta la llamada de red y se cachea como no-soportado. F4.1.
  if (/\.uy$/i.test(cleanDomain)) {
    return {
      fetched_at,
      created_at: null,
      registrar: null,
      expires_at: null,
      age_years: null,
      error: "uy-whois-unsupported",
    };
  }

  try {
    const raw = await withTimeout(
      whoisDomain(cleanDomain, { timeout: TIMEOUT_MS, follow: 1 }),
      TIMEOUT_MS + 1_000
    );
    const obj = raw as Record<string, unknown>;
    const created_at = pickField(obj, CREATED_KEYS);
    const expires_at = pickField(obj, EXPIRES_KEYS);
    const registrar = pickField(obj, REGISTRAR_KEYS);

    const createdDate = parseDate(created_at);
    const age_years =
      createdDate !== null
        ? (Date.now() - createdDate.getTime()) / (365.25 * 86_400 * 1_000)
        : null;

    return {
      fetched_at,
      created_at,
      registrar,
      expires_at,
      age_years,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ domain: cleanDomain, err: msg }, "whois lookup failed");
    return {
      fetched_at,
      created_at: null,
      registrar: null,
      expires_at: null,
      age_years: null,
      error: msg,
    };
  }
}
