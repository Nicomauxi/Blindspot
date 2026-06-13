// Gestión de keys + presupuesto de Serper.dev. El free tier es limitado por cuenta, así que
// soportamos MÚLTIPLES keys (sufijo numerado: SERPER_API_KEY, SERPER_API_KEY2, …) y rotamos a
// la siguiente cuando una se agota (429/402). Un contador por-run + un tope opcional
// (--max-queries) evitan pasarnos. Farmear keys = agregar SERPER_API_KEY3=… (sin tocar código).

// Descubre todas las keys presentes en el entorno, en orden: SERPER_API_KEY, luego
// SERPER_API_KEY2, SERPER_API_KEY3, … (corta en el primer hueco salvo que haya más numeradas).
export function getSerperKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  const keys: string[] = [];
  const base = env["SERPER_API_KEY"]?.trim();
  if (base) keys.push(base);
  // Buscar SERPER_API_KEY2..N (hasta un tope sano de 50 para no iterar infinito).
  for (let i = 2; i <= 50; i++) {
    const k = env[`SERPER_API_KEY${i}`]?.trim();
    if (k) keys.push(k);
  }
  return Array.from(new Set(keys)); // dedup defensivo
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
