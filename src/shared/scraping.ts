export function jitter(baseMs: number, pct = 0.3): number {
  const delta = Math.floor(baseMs * pct * Math.random());
  return baseMs + delta;
}

export function randomBetween(minMs: number, maxMs: number): number {
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}

export function pickRandom<T>(pool: T[]): T {
  if (pool.length === 0) throw new Error("pickRandom: empty pool");
  return pool[Math.floor(Math.random() * pool.length)]!;
}

export function backoffMs(attempt: number, baseMs = 1000, maxMs = 30_000): number {
  const exp = Math.min(attempt, 10);
  const raw = baseMs * 2 ** exp;
  return jitter(Math.min(raw, maxMs));
}

export function isBlockedStatus(status: number): boolean {
  return status === 403 || status === 429 || status === 503;
}
