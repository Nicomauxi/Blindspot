import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type GeocodedPoint = {
  lat: number;
  lng: number;
};

type CacheHit = {
  lat: number;
  lng: number;
  cached_at: string;
};

type CacheMiss = {
  miss: true;
  cached_at: string;
};

type CacheEntry = CacheHit | CacheMiss;

export type LeadGeocodingService = {
  geocodeAddress(address: string): Promise<GeocodedPoint | null>;
};

export type LeadGeocodingServiceOptions = {
  fetchImpl?: typeof fetch;
  cacheFile?: string;
  userAgent?: string;
  minIntervalMs?: number;
  ttlMs?: number;
  missTtlMs?: number;
};

const DEFAULT_CACHE_FILE = path.join(process.cwd(), "logs", "lead-geocode-cache.json");
const DEFAULT_USER_AGENT = "blindspot-local/1.0 (admin discovery map geocoder)";
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const DEFAULT_MISS_TTL_MS = 1000 * 60 * 60 * 6;
const DEFAULT_MIN_INTERVAL_MS = 1000;

function normalizeGeocodeQuery(address: string): string {
  const trimmed = address.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return /uruguay/i.test(trimmed) ? trimmed : `${trimmed}, Uruguay`;
}

function isCacheMiss(entry: CacheEntry): entry is CacheMiss {
  return "miss" in entry;
}

function isFresh(entry: CacheEntry, now: number, ttlMs: number, missTtlMs: number): boolean {
  const cachedAt = Date.parse(entry.cached_at);
  if (!Number.isFinite(cachedAt)) return false;
  return now - cachedAt < (isCacheMiss(entry) ? missTtlMs : ttlMs);
}

function parsePoint(payload: unknown): GeocodedPoint | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as { lat?: unknown; lon?: unknown };
  const lat = Number(record.lat);
  const lng = Number(record.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createLeadGeocodingService(options: LeadGeocodingServiceOptions = {}): LeadGeocodingService {
  const fetchImpl = options.fetchImpl ?? fetch;
  const cacheFile = options.cacheFile ?? DEFAULT_CACHE_FILE;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const missTtlMs = options.missTtlMs ?? DEFAULT_MISS_TTL_MS;

  const cache = new Map<string, CacheEntry>();
  let cacheReady = false;
  let cacheLoading: Promise<void> | null = null;
  let writeQueued = false;
  let serial: Promise<unknown> = Promise.resolve();
  let lastRequestAt = 0;

  async function ensureCacheLoaded(): Promise<void> {
    if (cacheReady) return;
    if (!cacheLoading) {
      cacheLoading = (async () => {
        try {
          const raw = await readFile(cacheFile, "utf8");
          const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
          for (const [key, value] of Object.entries(parsed)) {
            if (value && typeof value === "object" && typeof value.cached_at === "string") {
              cache.set(key, value);
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/ENOENT/i.test(message)) throw error;
        } finally {
          cacheReady = true;
        }
      })();
    }
    await cacheLoading;
  }

  async function persistCache(): Promise<void> {
    writeQueued = false;
    await mkdir(path.dirname(cacheFile), { recursive: true });
    const payload = Object.fromEntries(cache.entries());
    await writeFile(cacheFile, JSON.stringify(payload, null, 2), "utf8");
  }

  function schedulePersist(): void {
    if (writeQueued) return;
    writeQueued = true;
    queueMicrotask(() => {
      void persistCache().catch(() => {
        writeQueued = false;
      });
    });
  }

  function getCachedPoint(query: string): GeocodedPoint | null | undefined {
    const entry = cache.get(query);
    if (!entry) return undefined;
    const now = Date.now();
    if (!isFresh(entry, now, ttlMs, missTtlMs)) {
      cache.delete(query);
      return undefined;
    }
    if (isCacheMiss(entry)) return null;
    return { lat: entry.lat, lng: entry.lng };
  }

  async function requestGeocode(query: string): Promise<GeocodedPoint | null> {
    const waitMs = Math.max(0, lastRequestAt + minIntervalMs - Date.now());
    if (waitMs > 0) await delay(waitMs);

    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", "uy");
    url.searchParams.set("q", query);

    const response = await fetchImpl(url, {
      headers: {
        "accept-language": "es,es-UY;q=0.9",
        "user-agent": userAgent,
      },
    });

    lastRequestAt = Date.now();
    if (!response.ok) return null;

    const body = await response.json();
    if (!Array.isArray(body) || body.length === 0) return null;
    return parsePoint(body[0]);
  }

  async function geocodeAddress(address: string): Promise<GeocodedPoint | null> {
    const query = normalizeGeocodeQuery(address);
    if (!query) return null;

    await ensureCacheLoaded();
    const cached = getCachedPoint(query);
    if (cached !== undefined) return cached;

    const task = serial.catch(() => undefined).then(async () => {
      const freshCached = getCachedPoint(query);
      if (freshCached !== undefined) return freshCached;
      try {
        const point = await requestGeocode(query);
        cache.set(query, point ? { ...point, cached_at: new Date().toISOString() } : { miss: true, cached_at: new Date().toISOString() });
        schedulePersist();
        return point;
      } catch {
        return null;
      }
    });

    serial = task.then(() => undefined, () => undefined);
    return task;
  }

  return { geocodeAddress };
}