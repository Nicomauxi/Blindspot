// Gestión de keys + presupuesto de Serper.dev. El free tier es limitado por cuenta, así que
// soportamos MÚLTIPLES keys (sufijo numerado: SERPER_API_KEY, SERPER_API_KEY2, …) y rotamos a
// la siguiente cuando una se agota (429/402). Un contador por-run + un tope opcional
// (--max-queries) evitan pasarnos. Farmear keys = agregar SERPER_API_KEY3=… (sin tocar código).

// Descubre dinámicamente TODAS las keys del entorno cuyo nombre matchea SERPER_API_KEY con
// un sufijo numérico opcional: SERPER_API_KEY, SERPER_API_KEY_1, SERPER_API_KEY_2,
// SERPER_API_KEY2, … (con o sin guion bajo). Solo cuenta las no-vacías. Ordena por el número
// (la base sin número va primero). Farmear keys = agregar SERPER_API_KEY_3=… sin tocar código.
const SERPER_KEY_RE = /^SERPER_API_KEY(?:_?(\d+))?$/;

export function getSerperKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  const found: Array<{ n: number; key: string }> = [];
  for (const [name, value] of Object.entries(env)) {
    const m = SERPER_KEY_RE.exec(name);
    const key = value?.trim();
    if (!m || !key) continue;
    found.push({ n: m[1] ? Number(m[1]) : 0, key }); // base (sin número) = 0 → primero
  }
  found.sort((a, b) => a.n - b.n);
  return Array.from(new Set(found.map((f) => f.key))); // dedup defensivo, conserva orden
}

export interface SerperBudgetState {
  queriesUsed: number;
  activeKeyIndex: number;
  exhaustedKeys: number;
  totalKeys: number;
  stoppedReason: "budget" | "all_keys_exhausted" | null;
}

// Estado mutable de presupuesto para UN run. Una instancia por corrida.
export class SerperBudget {
  private used = 0;
  private readonly exhausted = new Set<number>();

  constructor(
    private readonly keys: string[],
    private readonly maxQueries: number | null = null
  ) {}

  static fromEnv(maxQueries: number | null = null, env: NodeJS.ProcessEnv = process.env): SerperBudget {
    return new SerperBudget(getSerperKeys(env), maxQueries);
  }

  hasKeys(): boolean {
    return this.keys.length > 0;
  }

  // Índice de la primera key NO agotada (derivado del set, no un cursor mutable — así
  // múltiples workers concurrentes marcando agotada NO saltean keys por un idx++ en carrera).
  private currentIndex(): number {
    let i = 0;
    while (i < this.keys.length && this.exhausted.has(i)) i++;
    return i;
  }

  // Key a usar ahora, o null si no quedan créditos (tope alcanzado o todas agotadas).
  activeKey(): string | null {
    if (this.maxQueries != null && this.used >= this.maxQueries) return null;
    const i = this.currentIndex();
    return i < this.keys.length ? this.keys[i]! : null;
  }

  recordQuery(): void {
    this.used++;
  }

  // Marca como agotada LA key que recibió el 429/402 (no "la activa") — bajo concurrencia
  // varios workers usan la misma key; cada uno marca ESA, no la siguiente. Idempotente.
  markExhausted(key: string): void {
    const i = this.keys.indexOf(key);
    if (i >= 0) this.exhausted.add(i);
  }

  stoppedReason(): SerperBudgetState["stoppedReason"] {
    if (this.maxQueries != null && this.used >= this.maxQueries) return "budget";
    if (this.exhausted.size >= this.keys.length) return "all_keys_exhausted";
    return null;
  }

  state(): SerperBudgetState {
    return {
      queriesUsed: this.used,
      activeKeyIndex: this.currentIndex(),
      exhaustedKeys: this.exhausted.size,
      totalKeys: this.keys.length,
      stoppedReason: this.stoppedReason(),
    };
  }
}
