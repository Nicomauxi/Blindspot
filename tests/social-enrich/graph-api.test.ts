import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isGraphApiEnabled,
  lookupInstagramBusiness,
  extractUsernameFromUrl,
} from "../../src/modules/social-enrich/graph-api.js";

const ENV_KEYS = ["META_IG_USER_ID", "META_GRAPH_TOKEN", "META_GRAPH_VERSION", "META_GRAPH_BASE_URL"];

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

function enable() {
  process.env["META_IG_USER_ID"] = "17841400000000000";
  process.env["META_GRAPH_TOKEN"] = "test-token";
}

function stubFetch(impl: (url: string) => { status?: number; body: unknown }) {
  const fn = vi.fn(async (url: string) => {
    const { status = 200, body } = impl(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  clearEnv();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearEnv();
});

describe("extractUsernameFromUrl", () => {
  it("saca el handle de URLs de IG con o sin barra/query/www", () => {
    expect(extractUsernameFromUrl("https://www.instagram.com/panaderiagodoy")).toBe("panaderiagodoy");
    expect(extractUsernameFromUrl("https://instagram.com/panaderiagodoy/")).toBe("panaderiagodoy");
    expect(extractUsernameFromUrl("https://www.instagram.com/panaderiagodoy/?hl=es")).toBe("panaderiagodoy");
    expect(extractUsernameFromUrl("instagram.com/la.proa")).toBe("la.proa");
  });
  it("devuelve null para URLs que no son perfiles", () => {
    expect(extractUsernameFromUrl("https://www.instagram.com/p/Cabc123/")).toBeNull();
    expect(extractUsernameFromUrl("https://www.instagram.com/accounts/login/")).toBeNull();
    expect(extractUsernameFromUrl("https://example.com/foo")).toBeNull();
    expect(extractUsernameFromUrl(null)).toBeNull();
  });
});

describe("isGraphApiEnabled", () => {
  it("false sin env (token en stand-by) → la fuente queda inactiva", () => {
    expect(isGraphApiEnabled()).toBe(false);
  });
  it("true sólo con IG user id + token", () => {
    enable();
    expect(isGraphApiEnabled()).toBe(true);
  });
  it("false si falta alguno de los dos", () => {
    process.env["META_IG_USER_ID"] = "x";
    expect(isGraphApiEnabled()).toBe(false);
  });
});

describe("lookupInstagramBusiness", () => {
  it("disabled sin env, sin tocar la red", async () => {
    const fetchFn = stubFetch(() => ({ body: {} }));
    const r = await lookupInstagramBusiness("panaderiagodoy");
    expect(r.status).toBe("disabled");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("ok: parsea bio + counts + media de la respuesta de business_discovery", async () => {
    enable();
    stubFetch(() => ({
      body: {
        business_discovery: {
          username: "panaderiagodoy",
          name: "Panadería Godoy",
          biography: "Pan artesanal. Pedidos 099 123 456. Lun a Sáb 7-20h. Av. Italia 1234",
          followers_count: 3200,
          follows_count: 180,
          media_count: 412,
          website: "https://panaderiagodoy.uy",
          media: { data: [{ caption: "Hoy", timestamp: "2026-06-01T12:00:00+0000", like_count: 40, comments_count: 3 }] },
        },
        id: "17841400000000000",
      },
    }));
    const r = await lookupInstagramBusiness("panaderiagodoy");
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.profile.biography).toContain("099 123 456");
    expect(r.profile.followers_count).toBe(3200);
    expect(r.profile.media_count).toBe(412);
    expect(r.profile.website).toBe("https://panaderiagodoy.uy");
    expect(r.profile.recent_media[0]?.like_count).toBe(40);
  });

  it("arma la URL con ig-user-id, business_discovery.username(target), fields y token", async () => {
    enable();
    const fetchFn = stubFetch(() => ({ body: { business_discovery: { username: "x", biography: "", followers_count: 0, follows_count: 0, media_count: 0 } } }));
    await lookupInstagramBusiness("la.proa");
    const calledUrl = String(fetchFn.mock.calls[0]![0]);
    expect(calledUrl).toContain("/17841400000000000");
    expect(calledUrl).toContain("business_discovery.username(la.proa)");
    expect(calledUrl).toContain("access_token=test-token");
    expect(calledUrl).toMatch(/graph\.facebook\.com\/v\d+\.\d+\//);
  });

  it("not_professional: cuenta objetivo personal/no business", async () => {
    enable();
    stubFetch(() => ({
      status: 400,
      body: { error: { code: 100, message: "User is not a Business or Creator account", type: "OAuthException" } },
    }));
    const r = await lookupInstagramBusiness("cuenta_personal");
    expect(r.status).toBe("not_professional");
  });

  it("not_found: el username no existe", async () => {
    enable();
    stubFetch(() => ({
      status: 400,
      body: { error: { code: 100, message: "Cannot find user with username does not exist", type: "OAuthException" } },
    }));
    const r = await lookupInstagramBusiness("no_existe_xyz");
    expect(r.status).toBe("not_found");
  });

  it("rate_limited: code de límite de aplicación", async () => {
    enable();
    stubFetch(() => ({
      status: 400,
      body: { error: { code: 4, message: "Application request limit reached", type: "OAuthException" } },
    }));
    const r = await lookupInstagramBusiness("x");
    expect(r.status).toBe("rate_limited");
  });

  it("auth_error: token inválido/expirado (code 190)", async () => {
    enable();
    stubFetch(() => ({
      status: 401,
      body: { error: { code: 190, message: "Error validating access token: Session has expired", type: "OAuthException" } },
    }));
    const r = await lookupInstagramBusiness("x");
    expect(r.status).toBe("auth_error");
  });
});
