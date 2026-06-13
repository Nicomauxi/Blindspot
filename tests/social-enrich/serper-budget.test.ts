import { afterEach, describe, expect, it, vi } from "vitest";
import { getSerperKeys, SerperBudget } from "../../src/modules/social-enrich/serper-budget.js";
import { serperSearch } from "../../src/modules/social-enrich/serper-provider.js";

describe("getSerperKeys", () => {
  it("descubre SERPER_API_KEY + sufijos numerados en orden", () => {
    expect(getSerperKeys({ SERPER_API_KEY: "k1", SERPER_API_KEY2: "k2", SERPER_API_KEY3: "k3" } as NodeJS.ProcessEnv))
      .toEqual(["k1", "k2", "k3"]);
  });
  it("soporta numeradas sin la base", () => {
    expect(getSerperKeys({ SERPER_API_KEY2: "k2" } as NodeJS.ProcessEnv)).toEqual(["k2"]);
  });
  it("sin keys → []", () => {
    expect(getSerperKeys({} as NodeJS.ProcessEnv)).toEqual([]);
  });
});

describe("SerperBudget", () => {
  it("respeta el tope de queries", () => {
    const b = new SerperBudget(["k1"], 2);
    expect(b.activeKey()).toBe("k1");
    b.recordQuery(); b.recordQuery();
    expect(b.activeKey()).toBeNull(); // tope alcanzado
    expect(b.state().stoppedReason).toBe("budget");
  });
  it("rota a la siguiente key al agotarse una", () => {
    const b = new SerperBudget(["k1", "k2"]);
    expect(b.activeKey()).toBe("k1");
    b.markExhausted(b.activeKey()!);
    expect(b.activeKey()).toBe("k2");
    b.markExhausted(b.activeKey()!);
    expect(b.activeKey()).toBeNull();
    expect(b.state().stoppedReason).toBe("all_keys_exhausted");
  });

  it("CONCURRENCIA: múltiples markActiveExhausted sobre la MISMA key no saltean la siguiente", () => {
    const b = new SerperBudget(["k1", "k2", "k3"]);
    // 8 workers concurrentes ven k1 agotada y la marcan a la vez → NO debe saltar a k3.
    for (let i = 0; i < 8; i++) b.markExhausted("k1");
    expect(b.activeKey()).toBe("k2"); // rota solo UNA posición pese a 8 marcas
    expect(b.state().exhaustedKeys).toBe(1);
  });
});

describe("serperSearch con budget (rotación ante 429)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rota a la 2da key cuando la 1ra devuelve 429, y cuenta las queries", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const key = (init.headers as Record<string, string>)["X-API-KEY"];
      calls.push(key);
      if (key === "k1") return { status: 429, ok: false, json: async () => ({}) } as unknown as Response;
      return { status: 200, ok: true, json: async () => ({ organic: [{ link: "https://x.com", title: "t", snippet: "s" }] }) } as unknown as Response;
    }) as unknown as typeof fetch;

    const budget = new SerperBudget(["k1", "k2"]);
    const res = await serperSearch("q", { fetchImpl, budget });
    expect(calls).toEqual(["k1", "k2"]); // probó k1 (429) → rotó a k2
    expect(res).toHaveLength(1);
    expect(budget.state().queriesUsed).toBe(2);
    expect(budget.state().exhaustedKeys).toBe(1);
  });

  it("devuelve [] sin gastar cuando no quedan créditos (tope)", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const budget = new SerperBudget(["k1"], 0); // tope 0
    const res = await serperSearch("q", { fetchImpl, budget });
    expect(res).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
