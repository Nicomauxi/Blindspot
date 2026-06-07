import { describe, expect, it } from "vitest";
import { detectLiveness, isHardDead, type LivenessInput } from "../../src/modules/social-enrich/liveness.js";

const NOW = "2026-06-07T00:00:00Z";

function input(over: Partial<LivenessInput> & { platform: LivenessInput["platform"]; requestedUrl: string }): LivenessInput {
  return { checkedAt: NOW, ...over };
}

describe("detectLiveness", () => {
  it("ANCLA La Proa: og:title cacheado pero título dice contenido no disponible → dead/deleted", () => {
    const r = detectLiveness(input({
      platform: "facebook",
      requestedUrl: "https://www.facebook.com/restaurante-la-proa",
      finalUrl: "https://www.facebook.com/restaurante-la-proa",
      httpStatus: 200,
      ogTitle: "Este contenido no está disponible en este momento",
    }));
    expect(r.state).toBe("dead");
    expect(r.reason).toBe("deleted");
    expect(isHardDead(r)).toBe(true);
  });

  it("substring legítimo en og:title NO marca muerto (guard falso-positivo)", () => {
    const r = detectLiveness(input({
      platform: "facebook",
      requestedUrl: "https://www.facebook.com/laproa",
      ogTitle: "Restaurante La Proa - Inicio",
      ogDescription: "Mariscos y pescados frescos en Montevideo",
      httpStatus: 200,
    }));
    expect(r.state).toBe("alive");
  });

  it("título genérico exacto 'Facebook' → dead/generic_title (hard)", () => {
    const r = detectLiveness(input({ platform: "facebook", requestedUrl: "https://facebook.com/x", ogTitle: "Facebook", httpStatus: 200 }));
    expect(r).toMatchObject({ state: "dead", reason: "generic_title" });
    expect(isHardDead(r)).toBe(true);
  });

  it("substring 'Facebook · ...' NO es genérico", () => {
    const r = detectLiveness(input({ platform: "facebook", requestedUrl: "https://facebook.com/x", ogTitle: "Facebook · Restaurante La Proa", httpStatus: 200 }));
    expect(r.state).toBe("alive");
  });

  it("redirect a /login → dead/login_wall (soft)", () => {
    const r = detectLiveness(input({
      platform: "instagram",
      requestedUrl: "https://www.instagram.com/laproa",
      finalUrl: "https://www.instagram.com/accounts/login",
      httpStatus: 200,
      ogTitle: "Instagram",
    }));
    expect(r.reason).toBe("login_wall");
    expect(isHardDead(r)).toBe(false);
  });

  it("redirect al home → dead/redirected_home (hard)", () => {
    const r = detectLiveness(input({
      platform: "facebook",
      requestedUrl: "https://www.facebook.com/restaurante-la-proa",
      finalUrl: "https://www.facebook.com/",
      httpStatus: 200,
      ogTitle: "Restaurante La Proa",
    }));
    expect(r.reason).toBe("redirected_home");
    expect(isHardDead(r)).toBe(true);
  });

  it("http 404 → dead/http_error", () => {
    const r = detectLiveness(input({ platform: "facebook", requestedUrl: "https://facebook.com/x", httpStatus: 404 }));
    expect(r.reason).toBe("http_error");
  });

  it("errores transitorios (429/503) → unverified, no dead", () => {
    expect(detectLiveness(input({ platform: "facebook", requestedUrl: "https://facebook.com/x", httpStatus: 429 })).state).toBe("unverified");
    expect(detectLiveness(input({ platform: "facebook", requestedUrl: "https://facebook.com/x", httpStatus: 503 })).state).toBe("unverified");
  });

  it("no marca muerta por 'no disponible' en la descripción (solo título)", () => {
    const r = detectLiveness(input({
      platform: "facebook",
      requestedUrl: "https://facebook.com/laproa",
      ogTitle: "Restaurante La Proa",
      ogDescription: "El delivery no está disponible en tu zona por el momento.",
      httpStatus: 200,
    }));
    expect(r.state).toBe("alive");
  });

  it("cuenta privada → dead/private (soft, no borra confirmaciones)", () => {
    const r = detectLiveness(input({ platform: "instagram", requestedUrl: "https://instagram.com/laproa", ogTitle: "La Proa (@laproa)", ogDescription: "This account is private", httpStatus: 200 }));
    expect(r.reason).toBe("private");
    expect(isHardDead(r)).toBe(false);
  });

  it("normaliza acentos y apóstrofes", () => {
    expect(detectLiveness(input({ platform: "facebook", requestedUrl: "https://facebook.com/x", ogTitle: "Contenido no esta disponible", httpStatus: 200 })).state).toBe("dead");
    expect(detectLiveness(input({ platform: "instagram", requestedUrl: "https://instagram.com/x", ogTitle: "Sorry, this page isn’t available", httpStatus: 200 })).reason).toBe("deleted");
  });

  it("página viva con título real → alive", () => {
    const r = detectLiveness(input({ platform: "facebook", requestedUrl: "https://facebook.com/laproa", finalUrl: "https://facebook.com/laproa", ogTitle: "Restaurante La Proa", httpStatus: 200 }));
    expect(r.state).toBe("alive");
    expect(r.reason).toBeNull();
  });

  it("sin título ni señales → unverified", () => {
    const r = detectLiveness(input({ platform: "facebook", requestedUrl: "https://facebook.com/x" }));
    expect(r.state).toBe("unverified");
  });
});
