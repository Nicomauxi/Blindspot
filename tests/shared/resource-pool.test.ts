import { describe, it, expect } from "vitest";
import {
  runAdaptivePool,
  allowedConcurrency,
  hostHeadroom,
  type Headroom,
} from "../../src/shared/resource-pool.js";

const GB = 1_000_000_000;
const HOLGADO: Headroom = { freeRamBytes: 12 * GB, cpuFreePct: 80 };
const SIN_RAM: Headroom = { freeRamBytes: 3 * GB, cpuFreePct: 80 };
const SIN_CPU: Headroom = { freeRamBytes: 12 * GB, cpuFreePct: 10 };

describe("allowedConcurrency", () => {
  it("permite maxConcurrency con holgura", () => {
    expect(allowedConcurrency(HOLGADO, 5 * GB, 30, 10)).toBe(10);
  });
  it("baja a 1 si la RAM libre < mínimo (5GB)", () => {
    expect(allowedConcurrency(SIN_RAM, 5 * GB, 30, 10)).toBe(1);
  });
  it("baja a 1 si el CPU libre < mínimo (30%)", () => {
    expect(allowedConcurrency(SIN_CPU, 5 * GB, 30, 10)).toBe(1);
  });
});

describe("hostHeadroom", () => {
  it("devuelve freeRamBytes positivo y cpuFreePct en [0,100]", () => {
    const h = hostHeadroom();
    expect(h.freeRamBytes).toBeGreaterThan(0);
    expect(h.cpuFreePct).toBeGreaterThanOrEqual(0);
    expect(h.cpuFreePct).toBeLessThanOrEqual(100);
  });
});

describe("runAdaptivePool", () => {
  it("procesa todos los items en orden", async () => {
    const items = [1, 2, 3, 4, 5];
    const { results } = await runAdaptivePool(items, async (n) => n * 10, {
      probe: () => HOLGADO,
      maxConcurrency: 3,
    });
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it("con holgura usa paralelismo (pico > 1)", async () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    const { peakConcurrency } = await runAdaptivePool(
      items,
      async (n) => { await new Promise((r) => setTimeout(r, 10)); return n; },
      { probe: () => HOLGADO, maxConcurrency: 6 }
    );
    expect(peakConcurrency).toBeGreaterThan(1);
    expect(peakConcurrency).toBeLessThanOrEqual(6);
  });

  it("sin headroom limita a 1 worker concurrente (protege la PC)", async () => {
    const items = Array.from({ length: 6 }, (_, i) => i);
    let inFlight = 0;
    let maxInFlight = 0;
    const { results } = await runAdaptivePool(
      items,
      async (n) => {
        inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1; return n;
      },
      { probe: () => SIN_RAM, maxConcurrency: 8, backoffMs: 1 }
    );
    expect(maxInFlight).toBe(1);
    expect(results).toHaveLength(6);
  });

  it("un worker que falla deja null sin romper el pool", async () => {
    const items = [1, 2, 3];
    const { results } = await runAdaptivePool(
      items,
      async (n) => { if (n === 2) throw new Error("boom"); return n; },
      { probe: () => HOLGADO, maxConcurrency: 3 }
    );
    expect(results).toEqual([1, null, 3]);
  });

  it("se adapta: arranca sin headroom y acelera cuando se libera", async () => {
    let calls = 0;
    const probe = (): Headroom => {
      calls += 1;
      return calls > 3 ? HOLGADO : SIN_CPU; // primeras lecturas ajustadas, luego holgado
    };
    const items = Array.from({ length: 8 }, (_, i) => i);
    const { results, peakConcurrency } = await runAdaptivePool(
      items,
      async (n) => { await new Promise((r) => setTimeout(r, 5)); return n; },
      { probe, maxConcurrency: 4, backoffMs: 1 }
    );
    expect(results).toHaveLength(8);
    expect(peakConcurrency).toBeGreaterThan(1);
  });
});
