import { describe, it, expect, vi } from "vitest";
import { createIgLookupChain } from "../../src/modules/social-enrich/ig-lookup-chain.js";
import type { SocialProfileData } from "../../src/modules/social-enrich/social-fusion.js";

function profile(username: string): SocialProfileData {
  return { username, name: null, biography: null, followers_count: 100, follows_count: 10, media_count: 5, website: null, recent_media: [] };
}

describe("createIgLookupChain", () => {
  it("prueba en orden y devuelve el primer no-null (corta la cadena)", async () => {
    const p1 = vi.fn().mockResolvedValue(null);
    const p2 = vi.fn().mockResolvedValue(profile("x"));
    const p3 = vi.fn().mockResolvedValue(profile("y"));
    const chain = createIgLookupChain([
      { name: "a", lookup: p1 },
      { name: "b", lookup: p2 },
      { name: "c", lookup: p3 },
    ]);
    const r = await chain("x", { throttleMs: 0 });
    expect(r!.username).toBe("x");
    expect(p1).toHaveBeenCalledOnce();
    expect(p2).toHaveBeenCalledOnce();
    expect(p3).not.toHaveBeenCalled(); // ya cortó en p2
  });

  it("devuelve null si todos los proveedores devuelven null", async () => {
    const chain = createIgLookupChain([
      { name: "a", lookup: vi.fn().mockResolvedValue(null) },
      { name: "b", lookup: vi.fn().mockResolvedValue(null) },
    ]);
    expect(await chain("x", {})).toBeNull();
  });

  it("si un proveedor lanza, lo trata como null y sigue al siguiente", async () => {
    const p1 = vi.fn().mockRejectedValue(new Error("down"));
    const p2 = vi.fn().mockResolvedValue(profile("z"));
    const chain = createIgLookupChain([
      { name: "a", lookup: p1 },
      { name: "b", lookup: p2 },
    ]);
    const r = await chain("z", {});
    expect(r!.username).toBe("z");
    expect(p2).toHaveBeenCalledOnce();
  });
});
