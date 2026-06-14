// (b) IP-diversity: pool de instancias SearXNG. Cada instancia debe tener una IP de
// salida DISTINTA (vía proxy o host separado) — solo así se multiplica la cuota con los
// engines upstream (que limitan por IP). El dispatcher reparte queries round-robin y
// pone en cooldown la instancia cuya respuesta vino con TODOS los engines unresponsive
// (señal de IP throttleada), para no insistir sobre una IP quemada.
//
// Config: SEARXNG_URLS="http://host1:8080,http://host2:8080,..." (fallback a SEARXNG_URL,
// y a http://localhost:8080). Una sola URL = comportamiento de instancia única.

const DEFAULT_URL = "http://localhost:8080";
// Tras detectar throttle (todos los engines pedidos unresponsive), apartar la instancia
// este tiempo antes de reintentarla.
const COOLDOWN_MS = 60_000;

export interface PoolInstance {
  url: string;
  cooldownUntil: number;
}

export function parseSearxngUrls(env: NodeJS.ProcessEnv = process.env): string[] {
  const multi = env["SEARXNG_URLS"];
  if (multi && multi.trim().length > 0) {
    const urls = multi.split(",").map((u) => u.trim().replace(/\/+$/, "")).filter(Boolean);
    if (urls.length > 0) return urls;
  }
  const single = env["SEARXNG_URL"];
  return [(single ?? DEFAULT_URL).replace(/\/+$/, "")];
}

export class SearxngPool {
  private readonly instances: PoolInstance[];
  private cursor = 0;

  constructor(urls: string[], private readonly now: () => number = Date.now) {
    if (urls.length === 0) throw new Error("SearxngPool requires at least one URL");
    this.instances = urls.map((url) => ({ url, cooldownUntil: 0 }));
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): SearxngPool {
    return new SearxngPool(parseSearxngUrls(env));
  }

  size(): number {
    return this.instances.length;
  }

  // Próxima instancia disponible (round-robin, salteando las en cooldown). Si TODAS están
  // en cooldown, devuelve la de cooldown más próximo a vencer (mejor intentar que frenar).
  next(): PoolInstance {
    const t = this.now();
    const n = this.instances.length;
    for (let i = 0; i < n; i++) {
      const inst = this.instances[(this.cursor + i) % n]!;
      if (inst.cooldownUntil <= t) {
        this.cursor = (this.cursor + i + 1) % n;
        return inst;
      }
    }
    return [...this.instances].sort((a, b) => a.cooldownUntil - b.cooldownUntil)[0]!;
  }

  // Marcar una instancia como throttleada (IP quemada) → cooldown.
  markThrottled(url: string): void {
    const inst = this.instances.find((i) => i.url === url);
    if (inst) inst.cooldownUntil = this.now() + COOLDOWN_MS;
  }

  availableCount(): number {
    const t = this.now();
    return this.instances.filter((i) => i.cooldownUntil <= t).length;
  }
}
