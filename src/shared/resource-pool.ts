// Pool de concurrencia ADAPTATIVA a los recursos del host. Maximiza el paralelismo cuando hay
// holgura (hasta maxConcurrency) y lo baja a 1 (o espera) cuando los recursos libres caen por
// debajo de los mínimos: por defecto ≥5 GB de RAM y ≥30% de CPU libres, para no crashear la PC.
// Usado por el enrich masivo y el procesado de redes para procesar "la mayor cantidad por segundo
// con éxito" sin agotar la máquina.
import os from "node:os";

export interface Headroom {
  freeRamBytes: number;
  cpuFreePct: number;
}

// Headroom real del host. CPU libre = 100 - (load1/cores). RAM libre = os.freemem().
export function hostHeadroom(): Headroom {
  const cores = os.cpus().length || 1;
  const load1 = os.loadavg()[0] ?? 0;
  const cpuUsedPct = Math.min(100, (load1 / cores) * 100);
  return { freeRamBytes: os.freemem(), cpuFreePct: Math.max(0, 100 - cpuUsedPct) };
}

export interface AdaptivePoolOptions {
  minFreeRamGB?: number; // default 5
  minFreeCpuPct?: number; // default 30
  maxConcurrency?: number; // default cores - 2 (mín 1)
  backoffMs?: number; // espera cuando no hay headroom y nada activo (default 1000)
  probe?: () => Headroom; // inyectable para tests
  // FD-01: abort cooperativo. Se consulta una vez por iteración del loop (por lote): si
  // devuelve true, el pool deja de tomar nuevos ítems, drena lo en vuelo y retorna control
  // (los ítems no procesados quedan en null). Sin esto, un run de ~3200 leads era inabortable.
  shouldStop?: () => boolean | Promise<boolean>;
}

export interface AdaptivePoolResult<R> {
  results: Array<R | null>;
  peakConcurrency: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function defaultMaxConcurrency(): number {
  return Math.max(1, (os.cpus().length || 1) - 2);
}

// Cap de concurrencia permitido AHORA según el headroom: maxConcurrency si hay holgura, 1 si no.
export function allowedConcurrency(h: Headroom, minFreeRamBytes: number, minFreeCpuPct: number, maxConcurrency: number): number {
  const headroomOk = h.freeRamBytes >= minFreeRamBytes && h.cpuFreePct >= minFreeCpuPct;
  return headroomOk ? maxConcurrency : 1;
}

// Procesa items con concurrencia adaptativa. Un worker que lanza error deja null en su posición
// (no rompe el pool). Devuelve resultados en orden + el pico de concurrencia alcanzado.
export async function runAdaptivePool<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  opts: AdaptivePoolOptions = {}
): Promise<AdaptivePoolResult<R>> {
  const minFreeRamBytes = (opts.minFreeRamGB ?? 5) * 1_000_000_000;
  const minFreeCpuPct = opts.minFreeCpuPct ?? 30;
  const maxConcurrency = Math.max(1, opts.maxConcurrency ?? defaultMaxConcurrency());
  const backoffMs = opts.backoffMs ?? 1000;
  const probe = opts.probe ?? hostHeadroom;

  const results: Array<R | null> = new Array(items.length).fill(null);
  let next = 0;
  let peakConcurrency = 0;
  const active = new Set<Promise<void>>();

  const launchable = (): number => {
    const cap = allowedConcurrency(probe(), minFreeRamBytes, minFreeCpuPct, maxConcurrency);
    return Math.max(0, cap - active.size);
  };

  while (next < items.length || active.size > 0) {
    // FD-01: si pidieron abort, dejar de tomar nuevos ítems; se drena lo en vuelo y se sale.
    if (next < items.length && opts.shouldStop && (await opts.shouldStop())) {
      next = items.length;
    }
    let slots = next < items.length ? launchable() : 0;
    while (slots > 0 && next < items.length) {
      const i = next++;
      const item = items[i]!;
      const p = (async () => {
        try {
          results[i] = await worker(item, i);
        } catch {
          results[i] = null;
        }
      })().finally(() => {
        active.delete(p);
      });
      active.add(p);
      if (active.size > peakConcurrency) peakConcurrency = active.size;
      slots -= 1;
    }

    if (active.size > 0) {
      await Promise.race(active);
    } else if (next < items.length) {
      // Sin headroom y nada en vuelo → esperar a que se liberen recursos antes de reintentar.
      await sleep(backoffMs);
    }
  }

  return { results, peakConcurrency };
}
